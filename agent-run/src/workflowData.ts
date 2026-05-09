import { MarkerType, type Edge, type Node } from "@xyflow/react";

export type Strategy = "single" | "ontology" | "multi";
export type AgentStatus = "idle" | "running" | "success" | "error" | "waiting";

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  role: string;
  status: AgentStatus;
  description: string;
  progress: number;
  lastOutput?: string;
  tools: string[];
  executionTime?: number;
  metrics?: string[];
}

export type AgentFlowNode = Node<AgentNodeData, "agentNode">;

interface AgentDef {
  id: string;
  label: string;
  role: string;
  description: string;
  tools: string[];
  position: { x: number; y: number };
}

const AGENTS: Record<string, AgentDef> = {
  ingest: {
    id: "ingest",
    label: "输入处理",
    role: "Memory Agent",
    description: "读取分块文本并召回上下文记忆。",
    tools: ["chunk_reader", "vector_recall"],
    position: { x: 0, y: 260 },
  },
  planner: {
    id: "planner",
    label: "规划压缩",
    role: "Planner Agent",
    description: "文本去噪压缩，去除OCR噪声和冗余，提取关键句并生成动态本体约束。",
    tools: ["text_compress", "denoise", "schema_plan"],
    position: { x: 350, y: 40 },
  },
  single_extract: {
    id: "single_extract",
    label: "单体抽取",
    role: "Extractor Agent",
    description: "在单 Agent 模式下同时抽取实体与关系。",
    tools: ["entity_extract", "relation_extract"],
    position: { x: 700, y: 260 },
  },
  entity_extract: {
    id: "entity_extract",
    label: "实体抽取",
    role: "Entity Agent",
    description: "识别领域实体、类型和别名。",
    tools: ["ner", "alias_detect"],
    position: { x: 700, y: 40 },
  },
  relation_extract: {
    id: "relation_extract",
    label: "关系抽取",
    role: "Relation Agent",
    description: "多轮分组抽取：结构归属→作用因果→描述动作，每轮聚焦不同关系类型并行执行。",
    tools: ["multi_round", "triple_extract", "evidence_trace"],
    position: { x: 700, y: 500 },
  },
  fusion: {
    id: "fusion",
    label: "融合校验",
    role: "Fusion Agent",
    description: "归一化实体并过滤低质量三元组。",
    tools: ["normalize", "dedupe", "validate"],
    position: { x: 1050, y: 260 },
  },
  link: {
    id: "link",
    label: "语义关联",
    role: "Linker Agent",
    description: "全局后处理：共现链接 + 语义相似度链接，发现隐藏的实体关系。",
    tools: ["cooccurrence", "embedding_link"],
    position: { x: 1400, y: 40 },
  },
  evaluate: {
    id: "evaluate",
    label: "质量评估",
    role: "Evaluator Agent",
    description: "调用大模型对全部三元组（含链接）进行质量评估，输出准确率评分和改进建议。",
    tools: ["model_eval", "quality_score", "metrics"],
    position: { x: 1750, y: 260 },
  },
  write_graph: {
    id: "write_graph",
    label: "写入图谱",
    role: "Graph Writer",
    description: "所有三元组评估通过后最终写入知识库图谱。",
    tools: ["upsert_graph", "source_trace"],
    position: { x: 2100, y: 40 },
  },
};

export const STRATEGY_NODES: Record<Strategy, string[]> = {
  single: ["ingest", "single_extract", "fusion", "link", "evaluate", "write_graph"],
  ontology: ["ingest", "planner", "single_extract", "fusion", "link", "evaluate", "write_graph"],
  multi: ["ingest", "planner", "entity_extract", "relation_extract", "fusion", "link", "evaluate", "write_graph"],
};

export const STRATEGY_EDGES: Record<Strategy, Array<[string, string, string]>> = {
  single: [
    ["ingest", "single_extract", "text"],
    ["single_extract", "fusion", "candidates"],
    ["fusion", "link", "fused triples"],
    ["link", "evaluate", "linked triples"],
    ["evaluate", "write_graph", "verified"],
  ],
  ontology: [
    ["ingest", "planner", "context"],
    ["ingest", "single_extract", "chunks"],
    ["planner", "single_extract", "schema"],
    ["single_extract", "fusion", "candidates"],
    ["fusion", "link", "fused triples"],
    ["link", "evaluate", "linked triples"],
    ["evaluate", "write_graph", "verified"],
  ],
  multi: [
    ["ingest", "planner", "context"],
    ["ingest", "entity_extract", "chunks"],
    ["planner", "entity_extract", "schema"],
    ["planner", "relation_extract", "schema"],
    ["entity_extract", "relation_extract", "entities"],
    ["entity_extract", "fusion", "entity set"],
    ["relation_extract", "fusion", "triples"],
    ["fusion", "link", "fused triples"],
    ["link", "evaluate", "linked triples"],
    ["evaluate", "write_graph", "verified"],
  ],
};

export function createNodes(strategy: Strategy): AgentFlowNode[] {
  return STRATEGY_NODES[strategy].map((id) => {
    const agent = AGENTS[id];
    return {
      id,
      type: "agentNode",
      position: agent.position,
      data: {
        label: agent.label,
        role: agent.role,
        status: "idle",
        description: agent.description,
        progress: 0,
        tools: agent.tools,
        executionTime: 0,
        metrics: [],
      },
    };
  });
}

export function createEdges(strategy: Strategy, statuses: Record<string, AgentStatus> = {}): Edge[] {
  return STRATEGY_EDGES[strategy].map(([source, target, label]) => {
    const sourceStatus = statuses[source] || "idle";
    const targetStatus = statuses[target] || "idle";
    const active = sourceStatus === "running" || targetStatus === "running";
    const done = sourceStatus === "success" && targetStatus === "success";
    const failed = sourceStatus === "error" || targetStatus === "error";
    const color = failed ? "#f87171" : active ? "#3b82f6" : done ? "#22c55e" : "#3c4658";
    return {
      id: `e-${source}-${target}`,
      source,
      target,
      label,
      animated: active,
      style: { stroke: color, strokeWidth: active || done || failed ? 2.5 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });
}

export function normalizeStrategy(value: string | null | undefined): Strategy {
  return value === "single" || value === "ontology" || value === "multi" ? value : "multi";
}
