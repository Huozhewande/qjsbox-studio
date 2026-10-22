import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import {
  cloneExpression, containsId, defaultValue, emptyGroup, expressionId, groupLinks, newCondition, newId, normalizeExpression,
  replaceAt, validateExpression, type FactTarget,
} from "../expression";
import { tryT, useT, type Translate } from "../i18n";
import { factOperators, type Combinator, type Condition, type Evidence, type EvidenceMap, type Expression, type Fact, type Operator } from "../model";
import { evidenceLabel, formatValue, summarizeExpression } from "../summary";

export interface ConditionBuilderProps {
  value: Expression;
  onChange: (value: Expression) => void;
  /** Facts a condition may test, including custom factors (see `factorAsFact`). */
  facts: Fact[];
  disabled?: boolean;
  /** Preview or server evidence keyed by condition and group id. */
  evidence?: EvidenceMap;
  /** When set, the fact field opens a picker instead of a plain select. */
  onRequestFact?: (target: FactTarget) => void;
  /** The condition or group currently receiving a picked fact; it is highlighted and expanded. */
  activeTarget?: FactTarget | null;
  initiallyCollapsed?: boolean;
}

/**
 * Visual editor for nested condition groups. Each item states its relation to the previous one;
 * the emitted value is normalized so that “and” binds tighter than “or” within a group.
 */
export function ConditionBuilder({ value, onChange, facts, disabled = false, evidence = {}, onRequestFact, activeTarget = null, initiallyCollapsed = false }: ConditionBuilderProps) {
  const t = useT();
  // The editor keeps per-link relations locally; the parent only ever receives normalized values.
  const [editorValue, setEditorValue] = useState(value);
  const lastEmitted = useRef(value);
  useLayoutEffect(() => {
    if (value !== lastEmitted.current) {
      setEditorValue(value);
      lastEmitted.current = value;
    }
  }, [value]);
  const update = (path: number[], replacement: Expression | null) => {
    const next = replaceAt(editorValue, path, replacement);
    setEditorValue(next);
    const normalized = normalizeExpression(next);
    lastEmitted.current = normalized;
    onChange(normalized);
  };
  const issue = validateExpression(value);
  const emptyRoot = value.kind === "GROUP" && value.group.children.length === 0;
  return <section className="qs-condition-builder" aria-label={t("cb.label")}>
    <Item expression={editorValue} path={[]} siblings={1} ctx={{ facts, disabled, evidence, onRequestFact, activeTarget, initiallyCollapsed, update, t }} />
    {!emptyRoot && <div className="qs-summary"><strong>{t("cb.summary")}</strong><p>{summarizeExpression(value, facts, t)}</p></div>}
    {issue && !emptyRoot && <p className="qs-error" role="alert">{t(`issue.${issue}`)}</p>}
  </section>;
}

interface Ctx {
  facts: Fact[];
  disabled: boolean;
  evidence: EvidenceMap;
  onRequestFact?: (target: FactTarget) => void;
  activeTarget: FactTarget | null;
  initiallyCollapsed: boolean;
  update: (path: number[], replacement: Expression | null) => void;
  t: Translate;
}

function Item({ expression, path, siblings, ctx }: { expression: Expression; path: number[]; siblings: number; ctx: Ctx }) {
  return expression.kind === "CONDITION"
    ? <ConditionRow expression={expression} path={path} siblings={siblings} ctx={ctx} />
    : <GroupBox expression={expression} path={path} ctx={ctx} />;
}

function ConditionRow({ expression, path, siblings, ctx }: { expression: Extract<Expression, { kind: "CONDITION" }>; path: number[]; siblings: number; ctx: Ctx }) {
  const { facts, disabled, evidence, onRequestFact, activeTarget, update, t } = ctx;
  const condition = expression.condition;
  const fact = facts.find((item) => item.key === condition.fact);
  const available = Boolean(fact && !fact.disabled);
  const isTarget = activeTarget?.id === condition.id;
  const index = path.at(-1) ?? 0;
  const patch = (next: Partial<Condition>) => update(path, { kind: "CONDITION", condition: { ...condition, ...next } });
  const selectFact = (key: string) => {
    const next = facts.find((item) => item.key === key);
    if (next) update(path, { kind: "CONDITION", condition: (newCondition(next, condition.id) as typeof expression).condition });
  };
  const selectOperator = (operator: Operator) => {
    const value = defaultValue(fact, operator);
    const { value: _old, ...rest } = condition;
    update(path, { kind: "CONDITION", condition: { ...rest, operator, ...(value === undefined ? {} : { value }) } });
  };
  const factText = !condition.fact ? t("cb.chooseFact") : !fact ? t("cb.unknownFact", { ref: condition.fact }) : available ? fact.label : t("cb.unavailable", { name: fact.label });
  const operators = fact ? factOperators(fact) : [condition.operator];
  const result = evidence[condition.id];
  return <div className={`qs-condition${isTarget ? " is-target" : ""}${available ? "" : " is-unavailable"}${result ? " has-evidence" : ""}`} data-expression-id={condition.id}>
    {onRequestFact
      ? <button type="button" className="qs-fact-field" aria-label={`${t("cb.fact")}: ${factText}`} disabled={disabled} onClick={() => onRequestFact({ id: condition.id, mode: "REPLACE" })}>
        <span className="qs-fact-caption">{t("cb.fact")}</span><span className="qs-fact-value">{factText}</span><span aria-hidden="true">▾</span>
      </button>
      : <label className="qs-field">{t("cb.fact")}<select value={condition.fact} disabled={disabled} onChange={(event) => selectFact(event.target.value)}>
        {!fact && <option value={condition.fact} disabled>{factText}</option>}
        {facts.map((item) => <option key={item.key} value={item.key} disabled={item.disabled}>{item.disabled ? t("cb.unavailable", { name: item.label }) : item.label}</option>)}
      </select></label>}
    <label className="qs-field">{t("cb.operator")}<select value={condition.operator} disabled={disabled || !available} onChange={(event) => selectOperator(event.target.value as Operator)}>
      {operators.map((operator) => <option key={operator} value={operator}>{t(`op.${operator}`)}</option>)}
    </select></label>
    {condition.operator === "EXISTS"
      ? <span className="qs-novalue">{t("cb.noValue")}</span>
      : <ValueControl condition={condition} fact={fact} disabled={disabled || !available} onChange={(value) => patch({ value })} t={t} />}
    <div className="qs-tools">
      {path.length === 0 && <button type="button" className="qs-tool" disabled={disabled} onClick={() => update([], { kind: "GROUP", group: { id: newId("group"), combinator: "ALL", children: [expression, newCondition(facts.find((item) => !item.disabled))] } })}>{t("cb.wrap")}</button>}
      <button type="button" className="qs-tool" aria-label={t("cb.copy")} title={t("cb.copy")} disabled={disabled || path.length === 0} onClick={() => update(path, cloneExpression(expression))}>⧉</button>
      <button type="button" className="qs-tool" aria-label={t("cb.moveUp")} title={t("cb.moveUp")} disabled={disabled || path.length === 0 || index === 0} onClick={() => update([...path.slice(0, -1), index - 1], expression)}>↑</button>
      <button type="button" className="qs-tool" aria-label={t("cb.moveDown")} title={t("cb.moveDown")} disabled={disabled || path.length === 0 || index >= siblings - 1} onClick={() => update([...path.slice(0, -1), index + 1], expression)}>↓</button>
      <button type="button" className="qs-tool is-danger" aria-label={t("cb.remove")} title={t("cb.remove")} disabled={disabled || path.length === 0} onClick={() => update(path, null)}>✕</button>
    </div>
    {result && <EvidenceLine evidence={result} t={t} />}
  </div>;
}

function EvidenceLine({ evidence, t }: { evidence: Evidence; t: Translate }) {
  const detail = evidence.actual !== undefined || evidence.reason;
  return <div className={`qs-evidence is-${(evidence.status === "SKIPPED" ? "skipped" : evidence.truth ?? "unavailable").toLowerCase()}`}>
    <strong>{evidenceLabel(evidence, t)}</strong>
    {detail && <details><summary>{t("cb.details")}</summary>
      {evidence.actual !== undefined && <span>{t("cb.actual", { value: JSON.stringify(evidence.actual) })}</span>}
      {evidence.reason && <span>{t("cb.reason", { reason: tryT(t, `reason.${evidence.reason}`, evidence.reason) })}</span>}
    </details>}
  </div>;
}

function ValueControl({ condition, fact, disabled, onChange, t }: { condition: Condition; fact?: Fact; disabled: boolean; onChange: (value: Condition["value"]) => void; t: Translate }) {
  const { operator, value } = condition;
  const wrap = (control: ReactElement) => <label className="qs-field">{t("cb.value")}{control}</label>;
  if (!fact) return wrap(<input value={formatValue(value, undefined, t)} disabled readOnly />);
  if (operator === "IN" || operator === "ANY_MATCH") {
    const selected = Array.isArray(value) ? value : [];
    if (fact.options?.length) {
      const known = new Set(fact.options.map((option) => option.value));
      const toggle = (choice: string) => onChange(selected.includes(choice) ? selected.filter((item) => item !== choice) : [...selected.filter(Boolean), choice]);
      return <fieldset className="qs-field qs-choices" disabled={disabled}><legend>{t("cb.value")}</legend>
        {fact.options.map((option) => <label key={option.value} className="qs-choice"><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />{option.label ?? option.value}</label>)}
        {selected.filter((item) => item && !known.has(item)).map((item) => <label key={item} className="qs-choice is-removed"><input type="checkbox" checked onChange={() => toggle(item)} />{item}</label>)}
      </fieldset>;
    }
    return wrap(<input value={selected.join(", ")} placeholder={t("cb.listHint")} disabled={disabled} onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()))} />);
  }
  if (operator === "GTE" || operator === "LTE" || (operator === "EQUALS" && fact.kind === "NUMBER")) {
    return wrap(<input type="number" step="any" value={typeof value === "number" ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />);
  }
  if (fact.kind === "BOOLEAN") {
    return wrap(<select value={String(value ?? true)} disabled={disabled} onChange={(event) => onChange(event.target.value === "true")}><option value="true">{t("value.true")}</option><option value="false">{t("value.false")}</option></select>);
  }
  if (fact.options?.length) {
    const current = typeof value === "string" ? value : "";
    return wrap(<select value={current} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {!fact.options.some((option) => option.value === current) && <option value={current} disabled>{current}</option>}
      {fact.options.map((option) => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}
    </select>);
  }
  return wrap(<input value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} />);
}

function GroupBox({ expression, path, ctx }: { expression: Extract<Expression, { kind: "GROUP" }>; path: number[]; ctx: Ctx }) {
  const { facts, disabled, evidence, onRequestFact, activeTarget, initiallyCollapsed, update, t } = ctx;
  const group = expression.group;
  const [expanded, setExpanded] = useState(!initiallyCollapsed);
  useEffect(() => {
    if (activeTarget && containsId(expression, activeTarget.id)) setExpanded(true);
  }, [activeTarget]);
  const label = path.length ? `1.${path.map((item) => item + 1).join(".")}` : "1";
  const links = groupLinks(group);
  const result = evidence[group.id];
  const firstFact = facts.find((item) => !item.disabled);
  const setLink = (index: number, combinator: Combinator) => {
    const next = [...links];
    next[index] = combinator;
    update(path, { kind: "GROUP", group: { ...group, links: next } });
  };
  return <fieldset className={`qs-group${path.length ? " is-nested" : ""}${activeTarget?.id === group.id ? " is-target" : ""}`} data-expression-id={group.id}>
    <legend>{t("cb.group", { path: label })}</legend>
    <div className="qs-group-head">
      <button type="button" className="qs-group-toggle" aria-expanded={expanded} aria-label={t(expanded ? "cb.collapse" : "cb.expand", { path: label })} onClick={() => setExpanded(!expanded)}>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span><strong>{t("cb.group", { path: label })}</strong>
      </button>
      <span className="qs-muted">{t("cb.items", { count: group.children.length })}</span>
      {result && <strong className={`qs-truth is-${(result.status === "SKIPPED" ? "skipped" : result.truth ?? "unavailable").toLowerCase()}`}>{evidenceLabel(result, t)}</strong>}
      {!expanded && <span className="qs-group-summary">{summarizeExpression(expression, facts, t)}</span>}
    </div>
    <div hidden={!expanded} className="qs-group-body">
      {group.children.length === 0 && <p className="qs-muted">{t("cb.empty")}</p>}
      {group.children.map((child, index) => <div key={expressionId(child)} className={`qs-group-item${child.kind === "GROUP" ? " is-group" : ""}`}>
        {index > 0 && <label className="qs-link">
          <span>{t("cb.relation")}</span>
          <select value={links[index - 1]} disabled={disabled} onChange={(event) => setLink(index - 1, event.target.value as Combinator)}>
            <option value="ALL">{t("cb.and")}</option><option value="ANY">{t("cb.or")}</option>
          </select>
        </label>}
        <Item expression={child} path={[...path, index]} siblings={group.children.length} ctx={ctx} />
      </div>)}
      <div className="qs-group-actions">
        <button type="button" className="qs-button is-small" disabled={disabled || !firstFact} onClick={() => onRequestFact
          ? onRequestFact({ id: group.id, mode: "APPEND" })
          : update(path, { kind: "GROUP", group: { ...group, children: [...group.children, newCondition(firstFact)] } })}>{t("cb.addCondition")}</button>
        <button type="button" className="qs-button is-small" disabled={disabled} onClick={() => update(path, { kind: "GROUP", group: { ...group, children: [...group.children, emptyGroup()] } })}>{t("cb.addGroup")}</button>
        {path.length > 0 && <button type="button" className="qs-button is-small" disabled={disabled} onClick={() => update(path, null)}>{t("cb.removeGroup")}</button>}
      </div>
    </div>
  </fieldset>;
}
