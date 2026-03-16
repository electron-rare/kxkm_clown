import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

const FAMILY_COLORS: Record<string, string> = {
  dataset_source: "#4a90d9",
  data_processing: "#50b83c",
  dataset_builder: "#9c6ade",
  training: "#de3618",
  evaluation: "#f49342",
  model_registry: "#47c1bf",
  registry: "#47c1bf",
  deployment: "#212b36",
};

export interface EngineNodeData {
  label: string;
  family: string;
  runtime: string;
  inputs: string[];
  outputs: string[];
  params: Record<string, unknown>;
  [key: string]: unknown;
}

function EngineNodeComponent({ data, selected }: NodeProps) {
  const [showParams, setShowParams] = useState(false);

  const nodeData = data as unknown as EngineNodeData;
  const color = FAMILY_COLORS[nodeData.family] || "#666";
  const inputs = nodeData.inputs || [];
  const outputs = nodeData.outputs || [];
  const params = nodeData.params || {};

  return (
    <div
      className="engine-node"
      style={{
        borderColor: selected ? "#c84c0c" : color,
        minWidth: 180,
      }}
    >
      {/* Header bar */}
      <div className="engine-node-header" style={{ background: color }}>
        <span className="engine-node-label">{nodeData.label}</span>
        <span className="engine-node-runtime">{nodeData.runtime}</span>
      </div>

      {/* Input handles */}
      <div className="engine-node-body">
        {inputs.map((inp, i) => (
          <div key={inp} className="engine-node-port engine-node-input">
            <Handle
              type="target"
              position={Position.Left}
              id={inp}
              style={{
                top: `${((i + 1) / (inputs.length + 1)) * 100}%`,
                background: color,
              }}
            />
            <span className="engine-node-port-label">{inp}</span>
          </div>
        ))}

        {inputs.length === 0 && outputs.length === 0 && (
          <div className="engine-node-empty">No I/O</div>
        )}

        {outputs.map((out, i) => (
          <div key={out} className="engine-node-port engine-node-output">
            <span className="engine-node-port-label">{out}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={out}
              style={{
                top: `${((i + 1) / (outputs.length + 1)) * 100}%`,
                background: color,
              }}
            />
          </div>
        ))}

        {/* Params toggle */}
        {Object.keys(params).length > 0 && (
          <button
            className="engine-node-params-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setShowParams(!showParams);
            }}
          >
            {showParams ? "Hide params" : `Params (${Object.keys(params).length})`}
          </button>
        )}

        {showParams && (
          <div className="engine-node-params">
            {Object.entries(params).map(([k, v]) => (
              <div key={k} className="engine-node-param-row">
                <span className="engine-node-param-key">{k}</span>
                <span className="engine-node-param-val">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(EngineNodeComponent);
