import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AgentNode from "./AgentNode";
import {
  createEdges,
  createNodes,
  normalizeStrategy,
  type AgentFlowNode,
  type AgentNodeData,
  type AgentStatus,
  type Strategy,
} from "./workflowData";
import "./App.css";

const nodeTypes = { agentNode: AgentNode };

interface RunRecord {
  run_id: string;
  strategy?: string;
  status?: string;
  summary?: Record<string, unknown>;
  last_state?: Record<string, unknown>;
}

interface StreamEvent {
  seq: number;
  timestamp: string;
  event_type: string;
  payload: Record<string, unknown>;
}

interface LogEntry {
  seq: number;
  time: string;
  agent: string;
  action: string;
  type: "info" | "success" | "warning" | "error";
}

interface QueueItem {
  runId: string;
  status: "pending" | "running" | "completed" | "failed";
  label: string;
  triples?: number;
}

function parseInitialParams() {
  const params = new URLSearchParams(window.location.search);
  const kbId = params.get("kb") || localStorage.getItem("kgtool.current_kb") || "default";
  const rawRuns = params.get("runs");
  const runIds = rawRuns
    ? rawRuns.split(",").map((x) => x.trim()).filter(Boolean)
    : [params.get("run") || ""].filter(Boolean);
  return { kbId, runIds };
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function eventTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleTimeString();
  }
  return d.toLocaleTimeString();
}

function payloadNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function summarizePayload(event: StreamEvent) {
  const payload = event.payload || {};
  if (event.event_type === "run_started") {
    return `任务启动，共 ${payloadNumber(payload, "chunk_count") ?? "-"} 个分块`;
  }
  if (event.event_type === "chunk_started") {
    return `开始处理分块 ${payloadNumber(payload, "chunk_id") ?? "-"}`;
  }
  if (event.event_type === "chunk_finished") {
    return `分块完成，抽取三元组 ${payloadNumber(payload, "triple_count") ?? 0} 条`;
  }
  if (event.event_type === "run_finished") {
    const metrics = payload.summary_metrics;
    return `运行完成：${JSON.stringify(metrics || {})}`;
  }
  if (event.event_type === "run_failed") {
    return `运行失败：${String(payload.error || "unknown error")}`;
  }
  if (event.event_type === "node_started") {
    return "开始执行";
  }
  if (event.event_type === "node_finished") {
    if (payload.raw_len !== undefined && payload.clean_len !== undefined) {
      return `压缩: ${payload.raw_len}→${payload.clean_len} 字符`;
    }
    if (payload.entity_count !== undefined || payload.triple_count !== undefined) {
      const rounds = payload.rounds !== undefined ? ` (${payload.rounds}轮并行)` : "";
      return `实体 ${payload.entity_count ?? "-"}，三元组 ${payload.triple_count ?? "-"}${rounds}`;
    }
    if (payload.vector_hits !== undefined) {
      return `召回上下文 ${payload.vector_hits} 条`;
    }
    if (payload.rated !== undefined) {
      return `模型评估: ${payload.passed ?? 0}/${payload.rated} 通过, 准确率 ${Math.round((payload.score as number || 0) * 100)}%`;
    }
    if (payload.cooccurrence !== undefined || payload.embedding !== undefined) {
      return `共现 ${payload.cooccurrence ?? 0} + 语义 ${payload.embedding ?? 0} → 写入 ${payload.written ?? 0}`;
    }
    if (payload.write_result !== undefined) {
      return `写库结果 ${JSON.stringify(payload.write_result)}`;
    }
    if (payload.metrics !== undefined) {
      return `评测指标 ${JSON.stringify(payload.metrics)}`;
    }
    return "节点完成";
  }
  return JSON.stringify(payload);
}

function nodeMetrics(payload: Record<string, unknown>) {
  const metrics: string[] = [];
  if (payload.raw_len !== undefined && payload.clean_len !== undefined) {
    const ratio = payloadNumber(payload, "raw_len") && payloadNumber(payload, "clean_len")
      ? Math.round(((payloadNumber(payload, "raw_len")! - payloadNumber(payload, "clean_len")!) / payloadNumber(payload, "raw_len")! * 100)) + "%"
      : "";
    metrics.push(`compress ${ratio} (${payload.raw_len}→${payload.clean_len})`);
  }
  if (payload.entity_count !== undefined) metrics.push(`entities ${payload.entity_count}`);
  if (payload.triple_count !== undefined) metrics.push(`triples ${payload.triple_count}`);
  if (payload.rounds !== undefined) metrics.push(`${payload.rounds} rounds`);
  if (payload.vector_hits !== undefined) metrics.push(`memory ${payload.vector_hits}`);
  if (payload.rated !== undefined) metrics.push(`quality ${Math.round((payload.score as number || 0) * 100)}% (${payload.passed}/${payload.rated})`);
  if (payload.cooccurrence !== undefined) metrics.push(`co-occur ${payload.cooccurrence}`);
  if (payload.embedding !== undefined) metrics.push(`semantic ${payload.embedding}`);
  if (payload.write_result && typeof payload.write_result === "object") {
    const written = (payload.write_result as Record<string, unknown>).written;
    if (written !== undefined) metrics.push(`written ${written}`);
  }
  return metrics;
}

function App() {
  const initial = useMemo(parseInitialParams, []);
  const [kbId] = useState(initial.kbId);
  const [runIds] = useState(initial.runIds);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [strategy, setStrategy] = useState<Strategy>("multi");
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>(createNodes("multi"));
  const [edges, setEdges, onEdgesChange] = useEdgesState(createEdges("multi"));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [queue, setQueue] = useState<Record<string, QueueItem>>(() =>
    Object.fromEntries(
      initial.runIds.map((runId, index) => [
        runId,
        { runId, status: index === 0 ? "running" : "pending", label: runId.slice(0, 8) },
      ]),
    ),
  );
  const [chunkInfo, setChunkInfo] = useState({ current: 0, total: 0 });
  const [allDone, setAllDone] = useState(false);
  const strategyRef = useRef<Strategy>("multi");
  const statusesRef = useRef<Record<string, AgentStatus>>({});
  const nodeStartRef = useRef<Record<string, number>>({});
  const eventSourceRef = useRef<EventSource | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const advancedRunsRef = useRef<Set<string>>(new Set());
  const chunkTotalRef = useRef(0);

  const currentRunId = runIds[currentIndex] || "";
  const selectedAgentData = selectedAgent ? nodes.find((node) => node.id === selectedAgent)?.data : null;
  const isBatch = runIds.length > 1;
  const currentQueueItem = currentRunId ? queue[currentRunId] : undefined;
  const canViewGraph = allDone || currentQueueItem?.status === "completed";

  const syncEdges = useCallback(() => {
    setEdges(createEdges(strategyRef.current, statusesRef.current));
  }, [setEdges]);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const resetWorkflow = useCallback(
    (nextStrategy: Strategy) => {
      clearProgressTimer();
      strategyRef.current = nextStrategy;
      statusesRef.current = {};
      createNodes(nextStrategy).forEach((node) => {
        statusesRef.current[node.id] = "idle";
      });
      setStrategy(nextStrategy);
      setNodes(createNodes(nextStrategy));
      setEdges(createEdges(nextStrategy, statusesRef.current));
      setSelectedAgent(null);
      setChunkInfo({ current: 0, total: 0 });
    },
    [clearProgressTimer, setEdges, setNodes],
  );

  const startProgressTimer = useCallback(
    (nodeId: string) => {
      clearProgressTimer();
      progressTimerRef.current = window.setInterval(() => {
        setNodes((current) =>
          current.map((node) => {
            if (node.id !== nodeId || node.data.status !== "running") {
              return node;
            }
            return {
              ...node,
              data: {
                ...node.data,
                progress: Math.min(94, node.data.progress + 7),
              },
            };
          }),
        );
      }, 420);
    },
    [clearProgressTimer, setNodes],
  );

  const setNodeStatus = useCallback(
    (nodeId: string, status: AgentStatus, updates: Partial<AgentNodeData> = {}) => {
      statusesRef.current[nodeId] = status;
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              ...updates,
              status,
              progress: updates.progress ?? node.data.progress,
            },
          };
        }),
      );
      syncEdges();
    },
    [setNodes, syncEdges],
  );

  const pushLog = useCallback((event: StreamEvent, type: LogEntry["type"], agent: string, action: string) => {
    setLogs((current) => [
      { seq: event.seq, time: eventTime(event.timestamp), agent, action, type },
      ...current.filter((item) => item.seq !== event.seq).slice(0, 160),
    ]);
  }, []);

  const advanceQueue = useCallback(
    (status: "completed" | "failed", event: StreamEvent) => {
      setQueue((current) => ({
        ...current,
        [currentRunId]: {
          ...(current[currentRunId] || { runId: currentRunId, label: currentRunId.slice(0, 8) }),
          status,
          triples:
            status === "completed"
              ? Number((event.payload.summary_metrics as Record<string, unknown> | undefined)?.triple_count ?? 0)
              : undefined,
        },
      }));
      if (!isBatch || advancedRunsRef.current.has(currentRunId)) {
        if (!isBatch) setAllDone(true);
        return;
      }
      advancedRunsRef.current.add(currentRunId);
      if (currentIndex < runIds.length - 1) {
        window.setTimeout(() => {
          const nextRun = runIds[currentIndex + 1];
          setQueue((current) => ({
            ...current,
            [nextRun]: { ...(current[nextRun] || { runId: nextRun, label: nextRun.slice(0, 8) }), status: "running" },
          }));
          setCurrentIndex((value) => Math.min(value + 1, runIds.length - 1));
        }, 900);
      } else {
        setAllDone(true);
      }
    },
    [currentIndex, currentRunId, isBatch, runIds],
  );

  const applyEvent = useCallback(
    (event: StreamEvent) => {
      const payload = event.payload || {};
      if (event.event_type === "run_started") {
        const nextStrategy = normalizeStrategy(String(payload.strategy || strategyRef.current));
        const total = payloadNumber(payload, "chunk_count") || 0;
        chunkTotalRef.current = total;
        resetWorkflow(nextStrategy);
        setChunkInfo({ current: 0, total });
        pushLog(event, "info", "System", summarizePayload(event));
        return;
      }

      if (event.event_type === "chunk_started") {
        const chunkId = payloadNumber(payload, "chunk_id") || 0;
        const total = chunkTotalRef.current;
        const nextStrategy = strategyRef.current;
        resetWorkflow(nextStrategy);
        setChunkInfo({ current: chunkId, total });
        pushLog(event, "info", "Chunk", summarizePayload(event));
        return;
      }

      if (event.event_type === "node_started") {
        const nodeId = String(payload.node || "");
        if (!nodeId) return;
        nodeStartRef.current[nodeId] = Date.now();
        setNodeStatus(nodeId, "running", { progress: 18 });
        setSelectedAgent(nodeId);
        startProgressTimer(nodeId);
        pushLog(event, "info", nodeId, summarizePayload(event));
        return;
      }

      if (event.event_type === "node_finished") {
        const nodeId = String(payload.node || "");
        if (!nodeId) return;
        const startedAt = nodeStartRef.current[nodeId] || Date.now();
        clearProgressTimer();
        setNodeStatus(nodeId, "success", {
          progress: 100,
          executionTime: Date.now() - startedAt,
          lastOutput: summarizePayload(event),
          metrics: nodeMetrics(payload),
        });
        pushLog(event, "success", nodeId, summarizePayload(event));
        return;
      }

      if (event.event_type === "chunk_finished") {
        pushLog(event, "success", "Chunk", summarizePayload(event));
        return;
      }

      if (event.event_type === "run_finished") {
        clearProgressTimer();
        Object.keys(statusesRef.current).forEach((nodeId) => {
          if (statusesRef.current[nodeId] !== "error") {
            statusesRef.current[nodeId] = "success";
          }
        });
        setNodes((current) =>
          current.map((node) => ({ ...node, data: { ...node.data, status: "success", progress: 100 } })),
        );
        syncEdges();
        pushLog(event, "success", "System", summarizePayload(event));
        advanceQueue("completed", event);
        return;
      }

      if (event.event_type === "run_failed") {
        clearProgressTimer();
        const runningNode = Object.entries(statusesRef.current).find(([, status]) => status === "running")?.[0];
        if (runningNode) {
          setNodeStatus(runningNode, "error", { lastOutput: summarizePayload(event) });
        }
        pushLog(event, "error", "System", summarizePayload(event));
        advanceQueue("failed", event);
      }
    },
    [
      advanceQueue,
      clearProgressTimer,
      pushLog,
      resetWorkflow,
      setNodeStatus,
      setNodes,
      startProgressTimer,
      syncEdges,
    ],
  );

  useEffect(() => {
    localStorage.setItem("kgtool.current_kb", kbId);
  }, [kbId]);

  useEffect(() => {
    if (!currentRunId) return undefined;

    let closed = false;
    setLogs([]);
    setAllDone(false);
    advancedRunsRef.current.delete(currentRunId);

    apiGet<RunRecord>(`/api/kbs/${encodeURIComponent(kbId)}/runs/${encodeURIComponent(currentRunId)}`)
      .then((run) => {
        if (closed) return;
        resetWorkflow(normalizeStrategy(run.strategy));
        setQueue((current) => ({
          ...current,
          [currentRunId]: {
            ...(current[currentRunId] || { runId: currentRunId, label: currentRunId.slice(0, 8) }),
            status: run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "running",
          },
        }));
      })
      .catch((err) => {
        if (!closed) {
          setLogs([{ seq: -1, time: new Date().toLocaleTimeString(), agent: "System", action: err.message, type: "error" }]);
        }
      });

    const source = new EventSource(
      `/api/kbs/${encodeURIComponent(kbId)}/runs/${encodeURIComponent(currentRunId)}/events?from_seq=0`,
    );
    eventSourceRef.current = source;
    source.onmessage = (message) => {
      if (closed) return;
      applyEvent(JSON.parse(message.data) as StreamEvent);
    };
    source.onerror = () => {
      if (!closed) {
        setQueue((current) => ({
          ...current,
          [currentRunId]: {
            ...(current[currentRunId] || { runId: currentRunId, label: currentRunId.slice(0, 8) }),
            status: current[currentRunId]?.status || "running",
          },
        }));
      }
    };

    return () => {
      closed = true;
      source.close();
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null;
      }
    };
  }, [applyEvent, currentRunId, kbId, resetWorkflow]);

  useEffect(() => () => clearProgressTimer(), [clearProgressTimer]);

  const queueItems = runIds.map((runId) => queue[runId] || { runId, status: "pending" as const, label: runId.slice(0, 8) });

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left">
          <div className="logo">
            <span className="logo-mark">KG</span>
            <span className="logo-text">Multi-Agent Run</span>
          </div>
          <div className="top-bar-divider" />
          <span className="workflow-name">{strategy} extraction pipeline</span>
        </div>
        <div className="top-bar-right">
          <div className="step-indicator">
            Run {Math.min(currentIndex + 1, Math.max(runIds.length, 1))} / {Math.max(runIds.length, 1)}
          </div>
          <div className="step-indicator">
            Chunk {chunkInfo.current || "-"} / {chunkInfo.total || "-"}
          </div>
          <a className="btn btn-ghost" href="/ui/kb.html">
            返回知识库
          </a>
          <a className={`btn btn-primary ${canViewGraph ? "" : "btn-disabled"}`} href={`/ui/kg.html?kb=${encodeURIComponent(kbId)}`}>
            查看图谱结果
          </a>
        </div>
      </header>

      {!currentRunId ? (
        <main className="empty-state">
          <h1>没有可展示的运行任务</h1>
          <a className="btn btn-primary" href="/ui/kb.html">
            返回知识库
          </a>
        </main>
      ) : (
        <div className="main-content">
          <div className="flow-panel">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => setSelectedAgent(node.id)}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              minZoom={0.35}
              maxZoom={1.45}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2f3b4b" />
              <Controls position="bottom-left" />
            </ReactFlow>
          </div>

          <aside className="sidebar">
            <section className="sidebar-section">
              <div className="sidebar-title">Run Queue</div>
              <div className="queue-list">
                {queueItems.map((item, index) => (
                  <div key={item.runId} className={`queue-item queue-item--${item.status} ${index === currentIndex ? "active" : ""}`}>
                    <span className={`status-dot status-dot--${item.status === "completed" ? "success" : item.status === "failed" ? "error" : item.status === "running" ? "running" : "idle"}`} />
                    <span className="queue-id">{item.label}</span>
                    <span className="queue-status">{item.status}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="sidebar-section">
              <div className="sidebar-title">
                {selectedAgentData ? (
                  <>
                    <span className={`status-dot status-dot--${selectedAgentData.status}`} />
                    {selectedAgentData.label}
                  </>
                ) : (
                  "Agent Detail"
                )}
              </div>
              {selectedAgentData ? (
                <div className="agent-detail">
                  <div className="detail-row">
                    <span className="detail-label">Role</span>
                    <span className="detail-value">{selectedAgentData.role}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Status</span>
                    <span className={`detail-value status-text--${selectedAgentData.status}`}>
                      {selectedAgentData.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Latency</span>
                    <span className="detail-value">{selectedAgentData.executionTime || 0}ms</span>
                  </div>
                  {selectedAgentData.lastOutput && <div className="detail-output-box">{selectedAgentData.lastOutput}</div>}
                  <div className="detail-tools-list">
                    {selectedAgentData.tools.map((tool) => (
                      <span key={tool} className="detail-tool-chip">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="sidebar-hint">点击流程图节点查看 Agent 状态。</div>
              )}
            </section>

            <section className="sidebar-section sidebar-section--log">
              <div className="sidebar-title">Activity Log</div>
              <div className="log-list">
                {logs.length === 0 ? (
                  <div className="sidebar-hint">等待运行事件...</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.seq} className={`log-entry log-entry--${log.type}`}>
                      <span className="log-time">{log.time}</span>
                      <span className="log-agent">{log.agent}</span>
                      <span className="log-action">{log.action}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

export default App;
