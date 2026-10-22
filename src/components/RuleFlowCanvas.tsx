import { useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type Viewport,
} from "@xyflow/react";
import { connectionIssue, validateFlow, type FlowIssue } from "../flow";
import { useT } from "../i18n";
import type { FlowNode } from "../model";

export interface RuleFlowCanvasProps {
  nodes: FlowNode<any>[];
  /** Remembers the viewport per flow while the canvas unmounts, e.g. during rule editing. */
  flowKey?: string;
  selectedKey?: string;
  disabled?: boolean;
  maxNodes?: number;
  onSelect: (key: string) => void;
  onAddNode: (position?: { x: number; y: number }) => void;
  onMoveNode: (key: string, position: { x: number; y: number }) => void;
  onConnect: (source: string, target: string) => void;
  onDisconnect: (source: string) => void;
  onValidationChange?: (issues: FlowIssue[]) => void;
}

const DRAG_TYPE = "application/x-qjsbox-studio-node";
const rememberedViewports = new Map<string, Viewport>();

type CardNode = Node<{ label: string; meta: string; enabled: boolean; selectLabel: string; output: string; onSelect: () => void }, "rule">;

// The whole card is a drag handle; only the connection handles stop the drag. A click without
// movement selects the node (React Flow swallows the click that ends an actual drag).
function NodeCard({ data, selected }: NodeProps<CardNode>) {
  return <div className={`qs-node${selected ? " is-selected" : ""}${data.enabled ? "" : " is-disabled"}`}>
    <Handle type="target" position={Position.Left} />
    <button type="button" className="qs-node-body" aria-label={data.selectLabel} aria-pressed={selected} onClick={data.onSelect}>
      <strong>{data.label}</strong><small>{data.meta}</small>
    </button>
    <span className="qs-node-output">{data.output}</span>
    <Handle type="source" position={Position.Right} />
  </div>;
}

const nodeTypes = { rule: NodeCard };

function Canvas({ nodes, flowKey, selectedKey, disabled = false, maxNodes = 16, onSelect, onAddNode, onMoveNode, onConnect, onDisconnect, onValidationChange }: RuleFlowCanvasProps) {
  const t = useT();
  const { screenToFlowPosition } = useReactFlow();
  const [notice, setNotice] = useState("");
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({});
  const issues = useMemo(() => validateFlow(nodes), [nodes]);
  useEffect(() => onValidationChange?.(issues), [issues, onValidationChange]);
  const selected = nodes.find((node) => node.key === selectedKey);
  const remembered = flowKey ? rememberedViewports.get(flowKey) : undefined;
  const full = nodes.length >= maxNodes;
  const cards: CardNode[] = nodes.map((node) => ({
    id: node.key,
    type: "rule",
    measured: measured[node.key],
    position: dragging[node.key] ?? node.position,
    selected: node.key === selectedKey,
    dragging: Boolean(dragging[node.key]),
    data: {
      label: node.label,
      meta: t("canvas.meta", { state: t(node.enabled ? "canvas.enabled" : "canvas.disabled"), count: node.rules.length }),
      enabled: node.enabled,
      selectLabel: t("canvas.selectNode", { name: node.label }),
      output: t("canvas.output"),
      onSelect: () => onSelect(node.key),
    },
  }));
  const edges: Edge[] = nodes.flatMap((node) => node.next ? [{
    id: `${node.key}--${node.next}`, source: node.key, target: node.next, label: t("canvas.miss"),
    ariaLabel: t("canvas.edge", { name: node.label }), markerEnd: { type: MarkerType.ArrowClosed },
  }] : []);
  const connect = (source: string, target: string) => {
    if (disabled) return;
    const issue = connectionIssue(nodes, source, target);
    setNotice(issue ? t(`flow.${issue}`) : "");
    if (!issue) onConnect(source, target);
  };
  const select = (key: string) => { if (key !== selectedKey) onSelect(key); };
  return <section className="qs-canvas" aria-label={t("canvas.label")}>
    <div className="qs-canvas-toolbar">
      <button type="button" className="qs-button is-small" draggable={!disabled && !full} disabled={disabled || full}
        onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, "node"); event.dataTransfer.effectAllowed = "move"; }}
        onClick={() => onAddNode()}>{t("canvas.addNode")}</button>
      <span className="qs-muted">{t("canvas.hint")}</span>
      {selected && <label className="qs-field is-inline">{t("canvas.next")}
        <select value={selected.next ?? ""} disabled={disabled} onChange={(event) => {
          if (event.target.value) connect(selected.key, event.target.value);
          else { setNotice(""); onDisconnect(selected.key); }
        }}>
          <option value="">{t("canvas.end")}</option>
          {nodes.filter((node) => node.key !== selected.key).map((node) => <option key={node.key} value={node.key}>{node.label}</option>)}
        </select>
      </label>}
    </div>
    <div className="qs-canvas-surface"
      onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={(event) => {
        event.preventDefault();
        if (disabled || full || event.dataTransfer.getData(DRAG_TYPE) !== "node") return;
        onAddNode(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}>
      <ReactFlow nodes={cards} edges={edges} nodeTypes={nodeTypes} nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={false} elementsSelectable
        onConnect={(connection: Connection) => connect(connection.source, connection.target)}
        onNodeClick={(_, node) => select(node.id)} onNodeDragStart={(_, node) => select(node.id)} nodeClickDistance={4}
        onNodesChange={(changes) => {
          for (const change of changes) {
            // React Flow hides unmeasured nodes; keep its measurements when we supply new positions.
            if (change.type === "dimensions" && change.dimensions) {
              const size = change.dimensions;
              setMeasured((current) => current[change.id]?.width === size.width && current[change.id]?.height === size.height ? current : { ...current, [change.id]: size });
            }
            if (!disabled && change.type === "position" && change.position && change.dragging) {
              const position = change.position;
              setDragging((current) => ({ ...current, [change.id]: position }));
            }
          }
        }}
        onNodeDragStop={(_, node) => {
          if (!disabled) onMoveNode(node.id, node.position);
          setDragging((current) => { const next = { ...current }; delete next[node.id]; return next; });
        }}
        onEdgesDelete={(deleted) => { if (!disabled) deleted.forEach((edge) => onDisconnect(edge.source)); }}
        onMoveEnd={(_, viewport) => { if (flowKey) rememberedViewports.set(flowKey, viewport); }}
        // Keyboard deletion would also drop edges of a selected node; links change only explicitly.
        deleteKeyCode={null}
        fitView={!remembered} defaultViewport={remembered} minZoom={0.3} maxZoom={1.5}>
        <Background gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {!nodes.length && <div className="qs-canvas-empty">{t("canvas.empty")}</div>}
      <span className="qs-canvas-order">{t("canvas.orderHint")}</span>
    </div>
    {(notice || issues.length > 0) && <div className="qs-canvas-issues" role="status">{notice || issues.map((issue) => t(`flow.${issue}`)).join(" ")}</div>}
  </section>;
}

/** React Flow canvas for a single-chain rule flow: drag to place, connect to set “next”. */
export function RuleFlowCanvas(props: RuleFlowCanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
