import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AgentFlowNode, AgentStatus } from "./workflowData";
import "./AgentNode.css";

const statusConfig: Record<AgentStatus, { label: string; icon: string }> = {
  idle: { label: "Idle", icon: "○" },
  running: { label: "Running", icon: "◉" },
  success: { label: "Done", icon: "✓" },
  error: { label: "Error", icon: "!" },
  waiting: { label: "Waiting", icon: "◷" },
};

function AgentNode({ data }: NodeProps<AgentFlowNode>) {
  const status = statusConfig[data.status];

  return (
    <div className={`agent-node agent-node--${data.status}`}>
      <Handle type="target" position={Position.Left} className="agent-handle" />
      <Handle type="target" position={Position.Top} className="agent-handle" />

      <div className="agent-header">
        <div className="agent-avatar">
          <span className="agent-avatar-icon">{status.icon}</span>
        </div>
        <div className="agent-title-block">
          <div className="agent-label">{data.label}</div>
          <div className="agent-role">{data.role}</div>
        </div>
        <div className="agent-status-badge">{status.label}</div>
      </div>

      <div className="agent-description">{data.description}</div>

      {data.status === "running" && (
        <div className="agent-progress">
          <div className="agent-progress-bar">
            <div className="agent-progress-fill" style={{ width: `${data.progress}%` }} />
          </div>
          <span className="agent-progress-text">{data.progress}%</span>
        </div>
      )}

      {data.lastOutput && data.status !== "idle" && (
        <div className="agent-output">
          <span className="agent-output-label">Output:</span>
          <span className="agent-output-text">{data.lastOutput}</span>
        </div>
      )}

      <div className="agent-footer">
        <div className="agent-tools">
          {data.tools.map((tool) => (
            <span key={tool} className="agent-tool-tag">
              {tool}
            </span>
          ))}
        </div>
        {!!data.metrics?.length && (
          <div className="agent-metrics">
            {data.metrics.slice(0, 2).map((metric) => (
              <span key={metric} className="agent-metric">
                {metric}
              </span>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="agent-handle" />
      <Handle type="source" position={Position.Bottom} className="agent-handle" />
    </div>
  );
}

export default AgentNode;
