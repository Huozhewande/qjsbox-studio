import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { applyFactAt, targetExists, type FactTarget } from "../expression";
import { flowEdits, rulesByPriority, type FlowIssue } from "../flow";
import { useT } from "../i18n";
import { factorAsFact, type EvidenceMap, type Fact, type Factor, type FlowNode, type Rule, type RuleFlow } from "../model";
import { FactPickerDialog } from "./FactPicker";
import { RuleFlowCanvas } from "./RuleFlowCanvas";
import { ConditionPreview, RuleConditionEditor } from "./RuleConditionEditor";

export interface OutcomeEditorProps<Outcome> {
  value: Outcome;
  onChange: (value: Outcome) => void;
  disabled: boolean;
}

export interface RuleStudioProps<Outcome> {
  value: RuleFlow<Outcome>;
  onChange: (value: RuleFlow<Outcome>) => void;
  facts: Fact[];
  factors?: Factor[];
  /** Outcome given to new rules. */
  defaultOutcome: Outcome;
  /** Edits a rule's outcome, e.g. pass / review / reject plus your own fields. */
  renderOutcome: (props: OutcomeEditorProps<Outcome>) => ReactNode;
  /** Short text for an outcome in rule cards. */
  describeOutcome?: (outcome: Outcome) => string;
  /** Evidence per rule key, e.g. from `evaluateFlow` or a server simulation through qjsbox. */
  evidence?: Record<string, EvidenceMap>;
  disabled?: boolean;
  maxNodes?: number;
  onValidationChange?: (issues: FlowIssue[]) => void;
}

/**
 * Rule flow authoring: a canvas of nodes beside the selected node's rules, and a focused editor
 * for one rule. The flow is controlled; every edit goes through `onChange`.
 */
export function RuleStudio<Outcome>({ value: flow, onChange, facts, factors = [], defaultOutcome, renderOutcome, describeOutcome, evidence = {}, disabled = false, maxNodes, onValidationChange }: RuleStudioProps<Outcome>) {
  const t = useT();
  const [nodeKey, setNodeKey] = useState(flow.nodes[0]?.key ?? "");
  const [ruleKey, setRuleKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<FactTarget | null>(null);
  // Rule-list scroll offsets per node survive the trip to the rule editor and back.
  const ruleScroll = useRef<Record<string, number>>({});
  const node = flow.nodes.find((item) => item.key === nodeKey) ?? null;
  const rule = node?.rules.find((item) => item.key === ruleKey) ?? null;
  const allFacts = [...facts, ...factors.map(factorAsFact)];
  useLayoutEffect(() => { if (!node && flow.nodes.length) setNodeKey(flow.nodes[0].key); }, [flow.nodes, node]);
  useLayoutEffect(() => { if (editing && !rule) setEditing(false); }, [editing, rule]);
  useEffect(() => { setTarget(null); }, [ruleKey, editing]);

  const addNode = useCallback((position?: { x: number; y: number }) => {
    const next = flowEdits.addNode(flow, { label: t("np.newNode"), position });
    onChange(next);
    setNodeKey(next.nodes.at(-1)!.key);
    setRuleKey("");
  }, [flow, onChange, t]);
  const updateRule = (patch: Partial<Rule<Outcome>>) => { if (node && rule) onChange(flowEdits.updateRule(flow, node.key, rule.key, patch)); };
  const addRule = () => {
    if (!node) return;
    const next = flowEdits.addRule(flow, node.key, { label: t("np.newRule"), outcome: defaultOutcome });
    onChange(next);
    const created = next.nodes.find((item) => item.key === node.key)!.rules.at(-1)!;
    setRuleKey(created.key);
    setEditing(true);
  };
  const pick = (fact: Fact) => {
    if (!rule || !target || !targetExists(rule.condition.expression, target)) { setTarget(null); return; }
    updateRule({ condition: { ...rule.condition, expression: applyFactAt(rule.condition.expression, target, fact) } });
    setTarget(null);
  };

  return <div className={`qs-studio${editing && rule ? " is-editing" : ""}`}>
    {!(editing && rule) && <>
      <RuleFlowCanvas nodes={flow.nodes} flowKey={flow.key} selectedKey={node?.key} disabled={disabled} maxNodes={maxNodes}
        onSelect={(key) => { setNodeKey(key); setRuleKey(""); }}
        onAddNode={addNode}
        onMoveNode={(key, position) => onChange(flowEdits.updateNode(flow, key, { position }))}
        onConnect={(source, targetKey) => onChange(flowEdits.connect(flow, source, targetKey))}
        onDisconnect={(source) => onChange(flowEdits.disconnect(flow, source))}
        onValidationChange={onValidationChange} />
      <NodePanel node={node} facts={allFacts} scrollMemory={ruleScroll} disabled={disabled} selectedRule={ruleKey} describeOutcome={describeOutcome}
        onPatch={(patch) => node && onChange(flowEdits.updateNode(flow, node.key, patch))}
        onRemove={() => { if (node) { onChange(flowEdits.removeNode(flow, node.key)); setNodeKey(""); } }}
        onAddRule={addRule}
        onSelectRule={setRuleKey}
        onEditRule={(key) => { setRuleKey(key); setEditing(true); }}
        onMoveRule={(key, delta) => node && onChange(flowEdits.moveRule(flow, node.key, key, delta))} />
    </>}
    {editing && rule && node && <section className="qs-panel qs-rule-editor" aria-label={t("re.label")}>
      <div className="qs-breadcrumb">
        <button type="button" className="qs-button is-small" onClick={() => setEditing(false)}>{t("re.back")}</button>
        <span>{flow.label} → {node.label} → {rule.label}</span>
      </div>
      <header className="qs-panel-head">
        <div><h3>{rule.label}</h3><p className="qs-muted">{t("re.key", { key: rule.key })}</p></div>
        <div className="qs-row">
          <button type="button" className="qs-button is-small" disabled={disabled} onClick={() => updateRule({ enabled: !rule.enabled })}>{t(rule.enabled ? "re.disable" : "re.enable")}</button>
          <button type="button" className="qs-button is-small is-danger" disabled={disabled} onClick={() => {
            if (!window.confirm(t("re.removeConfirm", { name: rule.label }))) return;
            onChange(flowEdits.removeRule(flow, node.key, rule.key));
            setEditing(false);
          }}>{t("re.remove")}</button>
        </div>
      </header>
      <section className="qs-section" aria-label={t("re.basics")}>
        <h4>{t("re.basics")}</h4>
        <div className="qs-grid">
          <label className="qs-field">{t("re.name")}<input value={rule.label} disabled={disabled} onChange={(event) => updateRule({ label: event.target.value })} /></label>
          <label className="qs-field">{t("re.priority")}<input type="number" min={1} value={rule.priority} disabled={disabled} onChange={(event) => updateRule({ priority: Number(event.target.value) })} /></label>
        </div>
        <p className="qs-hint">{t("re.priorityHint")}</p>
      </section>
      <section className="qs-section" aria-label={t("re.condition")}>
        <h4>{t("re.condition")}</h4>
        <RuleConditionEditor value={rule.condition} onChange={(condition) => updateRule({ condition })} facts={allFacts} factors={factors}
          disabled={disabled} evidence={evidence[rule.key]} onRequestFact={setTarget} activeTarget={target} />
        {target && <FactPickerDialog facts={allFacts} onSelect={pick} onCancel={() => setTarget(null)} disabled={disabled}
          description={t(target.mode === "APPEND" ? "fp.append" : "fp.replace")} />}
      </section>
      <section className="qs-section" aria-label={t("re.outcome")}>
        <h4>{t("re.outcome")}</h4>
        {renderOutcome({ value: rule.outcome, onChange: (outcome) => updateRule({ outcome }), disabled })}
      </section>
    </section>}
  </div>;
}

interface NodePanelProps<Outcome> {
  node: FlowNode<Outcome> | null;
  facts: Fact[];
  disabled: boolean;
  selectedRule: string;
  describeOutcome?: (outcome: Outcome) => string;
  onPatch: (patch: Partial<FlowNode<Outcome>>) => void;
  onRemove: () => void;
  onAddRule: () => void;
  onSelectRule: (key: string) => void;
  onEditRule: (key: string) => void;
  onMoveRule: (key: string, delta: -1 | 1) => void;
  scrollMemory: MutableRefObject<Record<string, number>>;
}

/** The selected node's settings and its rules in priority order. */
function NodePanel<Outcome>({ node, facts, disabled, selectedRule, describeOutcome, onPatch, onRemove, onAddRule, onSelectRule, onEditRule, onMoveRule, scrollMemory: scroll }: NodePanelProps<Outcome>) {
  const t = useT();
  const list = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { if (list.current && node) list.current.scrollTop = scroll.current[node.key] ?? 0; }, [node?.key]);
  if (!node) return <section className="qs-panel qs-node-panel" aria-label={t("np.label")}><h3>{t("np.selectNode")}</h3><p className="qs-muted">{t("np.selectHint")}</p></section>;
  const ordered = rulesByPriority(node);
  return <section className="qs-panel qs-node-panel" aria-label={t("np.label")}>
    <header className="qs-panel-head">
      <div><h3>{node.label}</h3><p className="qs-muted">{t("np.meta", { count: node.rules.length })}</p></div>
      <button type="button" className="qs-button is-small is-primary" disabled={disabled} onClick={onAddRule}>{t("np.addRule")}</button>
    </header>
    <details className="qs-node-settings">
      <summary>{t("np.settings")}</summary>
      <label className="qs-field">{t("np.name")}<input value={node.label} disabled={disabled} onChange={(event) => onPatch({ label: event.target.value })} /></label>
      <label className="qs-field">{t("np.description")}<textarea rows={2} value={node.description ?? ""} disabled={disabled} onChange={(event) => onPatch({ description: event.target.value })} /></label>
      <div className="qs-row">
        <button type="button" className="qs-button is-small" disabled={disabled} onClick={() => onPatch({ enabled: !node.enabled })}>{t(node.enabled ? "np.disable" : "np.enable")}</button>
        <button type="button" className="qs-button is-small is-danger" disabled={disabled} onClick={() => { if (window.confirm(t("np.removeConfirm", { name: node.label, count: node.rules.length }))) onRemove(); }}>{t("np.remove")}</button>
      </div>
    </details>
    {!node.rules.length && <p className="qs-muted">{t("np.noRules")}</p>}
    <nav className="qs-rule-list" aria-label={t("np.rules")} ref={list} onScroll={(event) => { scroll.current[node.key] = event.currentTarget.scrollTop; }}>
      {ordered.map((rule, index) => <article key={rule.key} className={`qs-rule-card${rule.key === selectedRule ? " is-selected" : ""}${rule.enabled ? "" : " is-disabled"}`}>
        <button type="button" className="qs-rule-card-head" aria-label={t("np.selectRule", { name: rule.label })} aria-pressed={rule.key === selectedRule} onClick={() => onSelectRule(rule.key)}>
          <strong>{rule.label}</strong>
          <small>{t("np.ruleMeta", { priority: rule.priority, state: t(rule.enabled ? "canvas.enabled" : "canvas.disabled") })}{describeOutcome ? ` · ${describeOutcome(rule.outcome)}` : ""}</small>
        </button>
        <div className="qs-rule-card-body">
          {rule.condition.mode === "JAVASCRIPT"
            ? <details><summary>{t("np.code")}</summary><pre><code>{rule.condition.source}</code></pre></details>
            : <ConditionPreview expression={rule.condition.expression} facts={facts} />}
        </div>
        <div className="qs-row">
          <button type="button" className="qs-button is-small is-primary" aria-label={t("np.editRule", { name: rule.label })} onClick={() => onEditRule(rule.key)}>{t("np.edit")}</button>
          <button type="button" className="qs-button is-small" aria-label={t("np.moveUp", { name: rule.label })} disabled={disabled || index === 0} onClick={() => onMoveRule(rule.key, -1)}>↑</button>
          <button type="button" className="qs-button is-small" aria-label={t("np.moveDown", { name: rule.label })} disabled={disabled || index === ordered.length - 1} onClick={() => onMoveRule(rule.key, 1)}>↓</button>
        </div>
      </article>)}
    </nav>
  </section>;
}
