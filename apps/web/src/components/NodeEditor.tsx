import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import EngineNodeComponent, { type EngineNodeData } from "./EngineNode";
import {
  useNodeEditor,
  isValidConnection,
  FAMILY_COLORS,
  FAMILY_LABELS,
  type NodeTypeDef,
} from "../hooks/useNodeEditor";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NodeEditorProps {
  graphId: string;
  onBack: () => void;
}

const nodeTypes = { engineNode: EngineNodeComponent };

export default function NodeEditor({ graphId, onBack }: NodeEditorProps) {
  const {
    nodes, edges, onNodesChange, onEdgesChange, onConnect,
    graphName, loading, saving, running, error, status, setStatus,
    panelOpen, setPanelOpen, families,
    handleAddNode, handleSave, handleRun,
  } = useNodeEditor(graphId);

  if (loading) {
    return <div className="muted" style={{ padding: 40 }}>Loading graph editor...</div>;
  }

  return (
    <div className="node-editor-container">
      {/* Toolbar */}
      <div className="node-editor-toolbar">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <h3 className="node-editor-title">{graphName}</h3>
        <div className="node-editor-toolbar-actions">
          <button className="btn btn-secondary" onClick={() => setPanelOpen(!panelOpen)}>
            + Add Node
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleRun}
            disabled={running}
            style={{ background: "#2c6e49", borderColor: "#2c6e49" }}
          >
            {running ? "Starting..." : "Run"}
          </button>
        </div>
      </div>

      {error && <div className="banner">{error}</div>}
      {status && (
        <div className="node-editor-status" onClick={() => setStatus("")}>
          {status}
        </div>
      )}

      <div className="node-editor-workspace">
        {/* Add Node Panel */}
        {panelOpen && (
          <div className="node-editor-panel">
            <div className="node-editor-panel-header">
              <strong>Add Node</strong>
              <button
                className="btn btn-secondary"
                onClick={() => setPanelOpen(false)}
                style={{ padding: "4px 8px", fontSize: 11 }}
              >
                X
              </button>
            </div>
            {Array.from(families.entries()).map(([familyId, types]) => (
              <div key={familyId} className="node-editor-family-group">
                <div
                  className="node-editor-family-label"
                  style={{ borderLeftColor: FAMILY_COLORS[familyId] || "#666" }}
                >
                  {FAMILY_LABELS[familyId] || familyId}
                </div>
                {types.map((t: NodeTypeDef) => (
                  <button
                    key={t.id}
                    className="node-editor-add-btn"
                    onClick={() => handleAddNode(t)}
                    style={{ borderLeftColor: FAMILY_COLORS[familyId] || "#666" }}
                  >
                    <span>{t.label}</span>
                    <span className="node-editor-add-io">
                      {t.inputs.length > 0 && `in: ${t.inputs.join(", ")}`}
                      {t.inputs.length > 0 && t.outputs.length > 0 && " | "}
                      {t.outputs.length > 0 && `out: ${t.outputs.join(", ")}`}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* React Flow canvas */}
        <div className="node-editor-flow">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            isValidConnection={isValidConnection}
            fitView
            snapToGrid
            snapGrid={[20, 20]}
            deleteKeyCode="Delete"
          >
            <Background gap={20} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as unknown as EngineNodeData;
                return FAMILY_COLORS[d?.family] || "#999";
              }}
              maskColor="rgba(246, 240, 223, 0.7)"
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
