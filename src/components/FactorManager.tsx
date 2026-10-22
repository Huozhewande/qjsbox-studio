import { useMemo, useState } from "react";
import { emptyGroup, newId, validateExpression } from "../expression";
import { evaluateExpression } from "../evaluate";
import { useT } from "../i18n";
import { IDENTIFIER, type Fact, type Factor, type RuleFlow, type ValueType } from "../model";
import { findReferences, type Reference } from "../references";
import { summarizeExpression } from "../summary";
import { RuleConditionEditor } from "./RuleConditionEditor";

export interface FactorTestResult {
  value?: unknown;
  error?: string;
}

export interface FactorManagerProps {
  factors: Factor[];
  onChange: (factors: Factor[]) => void;
  /** Facts a factor definition may use. Factors cannot use other factors. */
  facts: Fact[];
  /** Flows whose rules may reference factors; used for reference counts and locking. */
  flows?: RuleFlow<any>[];
  /** Server-side test, e.g. qjsbox `Execute` with Kind FACTOR. Without it, only visual factors are tested in the browser. */
  testFactor?: (factor: Factor, input: Record<string, unknown>) => Promise<FactorTestResult>;
  disabled?: boolean;
}

type Draft = Factor & { isNew: boolean };

function newFactor(): Draft {
  return { key: newId("factor"), identifier: "", label: "", valueType: "BOOLEAN", enabled: true, definition: { mode: "VISUAL", expression: emptyGroup(), source: "" }, isNew: true };
}

/** Table of reusable factors with a side panel to create, edit, test and delete them. */
export function FactorManager({ factors, onChange, facts, flows = [], testFactor, disabled = false }: FactorManagerProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const references = useMemo(() => findReferences(flows), [flows]);
  const categories = useMemo(() => [...new Set(factors.map((factor) => factor.category).filter((item): item is string => Boolean(item)))].sort(), [factors]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = factors.filter((factor) => (!category || factor.category === category) && (!state || String(factor.enabled) === state)
    && (!needle || `${factor.label} ${factor.identifier} ${factor.description ?? ""}`.toLocaleLowerCase().includes(needle)));
  const save = (next: Factor) => {
    const exists = factors.some((factor) => factor.key === next.key);
    onChange(exists ? factors.map((factor) => factor.key === next.key ? next : factor) : [...factors, next]);
    setDraft(null);
  };
  return <section className={`qs-factors${draft ? " has-panel" : ""}`} aria-label={t("fm.label")}>
    <div className="qs-factors-main">
      <div className="qs-toolbar">
        <label className="qs-field is-grow">{t("fm.search")}<input type="search" placeholder={t("fm.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="qs-field">{t("fm.colCategory")}<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("fp.allCategories")}</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="qs-field">{t("fm.colState")}<select value={state} onChange={(event) => setState(event.target.value)}><option value="">{t("fm.allStates")}</option><option value="true">{t("fm.enabled")}</option><option value="false">{t("fm.disabled")}</option></select></label>
        <button type="button" className="qs-button is-primary" disabled={disabled} onClick={() => setDraft(newFactor())}>{t("fm.new")}</button>
      </div>
      <div className="qs-table-wrap">
        <table className="qs-table">
          <thead><tr><th>{t("fm.colName")}</th><th>{t("fm.colCategory")}</th><th>{t("fm.colType")}</th><th>{t("fm.colDefinition")}</th><th>{t("fm.colRefs")}</th><th>{t("fm.colState")}</th><th>{t("fm.colActions")}</th></tr></thead>
          <tbody>
            {visible.length ? visible.map((factor) => <tr key={factor.key} className={`${draft?.key === factor.key ? "is-selected" : ""}${factor.enabled ? "" : " is-unavailable"}`}>
              <td><strong>{factor.label}</strong><code className="qs-block">factors.{factor.identifier}</code></td>
              <td>{factor.category || "—"}</td>
              <td>{t(`kind.${factor.valueType}`)}</td>
              <td className="qs-description">{factor.definition.mode === "JAVASCRIPT" ? <code>JavaScript</code> : summarizeExpression(factor.definition.expression, facts, t)}</td>
              <td>{t("fm.refs", { count: references.get(factor.identifier)?.length ?? 0 })}</td>
              <td>{t(factor.enabled ? "fm.enabled" : "fm.disabled")}</td>
              <td className="qs-actions">
                <button type="button" className="qs-button is-small" aria-label={t("fm.editFactor", { name: factor.label })} onClick={() => setDraft({ ...factor, isNew: false })}>{t("fm.edit")}</button>
                <button type="button" className="qs-link-button" disabled={disabled} onClick={() => onChange(factors.map((item) => item.key === factor.key ? { ...item, enabled: !item.enabled } : item))}>{t(factor.enabled ? "fm.disable" : "fm.enable")}</button>
              </td>
            </tr>) : <tr><td colSpan={7} className="qs-empty">{t("fm.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    {draft && <FactorPanel key={draft.key} draft={draft} factors={factors} facts={facts} references={references.get(draft.identifier) ?? []} disabled={disabled} testFactor={testFactor}
      categories={categories} onCancel={() => setDraft(null)} onSave={save}
      onRemove={() => { onChange(factors.filter((factor) => factor.key !== draft.key)); setDraft(null); }} />}
  </section>;
}

interface PanelProps {
  draft: Draft;
  factors: Factor[];
  facts: Fact[];
  references: Reference[];
  categories: string[];
  disabled: boolean;
  testFactor?: FactorManagerProps["testFactor"];
  onCancel: () => void;
  onSave: (factor: Factor) => void;
  onRemove: () => void;
}

function FactorPanel({ draft: initial, factors, facts, references, categories, disabled, testFactor, onCancel, onSave, onRemove }: PanelProps) {
  const t = useT();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [input, setInput] = useState("{}");
  const [result, setResult] = useState("");
  const locked = !initial.isNew && references.length > 0;
  const original = factors.find((factor) => factor.key === initial.key);
  const visual = draft.definition.mode === "VISUAL";
  const patch = (next: Partial<Factor>) => { setDraft((current) => ({ ...current, ...next })); setError(""); };
  const validate = (): string => {
    if (!draft.label.trim()) return t("fm.errName");
    if (!IDENTIFIER.test(draft.identifier)) return t("fm.errIdentifier");
    if (factors.some((factor) => factor.key !== draft.key && factor.identifier === draft.identifier) || facts.some((fact) => fact.key === draft.identifier)) return t("fm.errIdentifierTaken");
    if (visual) {
      const issue = validateExpression(draft.definition.expression);
      if (issue) return t("fm.errDefinition", { issue: t(`issue.${issue}`) });
    } else if (!draft.definition.source.trim()) return t("fm.errCode");
    return "";
  };
  const submit = () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    const { isNew: _isNew, ...factor } = draft;
    onSave(visual ? { ...factor, valueType: "BOOLEAN" } : factor);
  };
  const runTest = async () => {
    let values: Record<string, unknown>;
    try {
      values = JSON.parse(input);
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
    } catch { setResult(t("fm.errJson")); return; }
    const { isNew: _isNew, ...factor } = draft;
    if (testFactor) {
      const outcome = await testFactor(factor, values);
      setResult(outcome.error ?? t("fm.testResult", { value: JSON.stringify(outcome.value) }));
    } else if (visual) {
      setResult(t("fm.testResult", { value: t(`truth.${evaluateExpression(draft.definition.expression, values, { facts }).truth}`) }));
    } else setResult(t("fm.testNeedsServer"));
  };
  return <aside className="qs-panel qs-factor-panel" aria-label={t(initial.isNew ? "fm.panelNew" : "fm.panelEdit")}>
    <header className="qs-panel-head">
      <h3>{t(initial.isNew ? "fm.panelNew" : "fm.panelEdit")}</h3>
      <button type="button" className="qs-button is-small" onClick={onCancel}>{t("fm.cancel")}</button>
    </header>
    <div className="qs-grid">
      <label className="qs-field">{t("fm.name")}<input value={draft.label} disabled={disabled} onChange={(event) => patch({ label: event.target.value })} /></label>
      <label className="qs-field">{t("fm.identifier")}<input value={draft.identifier} disabled={disabled || locked} spellCheck={false} onChange={(event) => patch({ identifier: event.target.value.trim() })} /></label>
      <label className="qs-field">{t("fm.category")}<input value={draft.category ?? ""} list="qs-factor-categories" disabled={disabled} onChange={(event) => patch({ category: event.target.value || undefined })} /></label>
      <label className="qs-field">{t("fm.valueType")}<select value={visual ? "BOOLEAN" : draft.valueType} disabled={disabled || locked || visual} onChange={(event) => patch({ valueType: event.target.value as ValueType })}>
        {(["BOOLEAN", "NUMBER", "TEXT"] as const).map((type) => <option key={type} value={type}>{t(`kind.${type}`)}</option>)}
      </select></label>
    </div>
    <datalist id="qs-factor-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
    <p className="qs-hint">{t("fm.identifierHint", { identifier: draft.identifier || "identifier" })}{locked ? ` ${t("fm.locked", { count: references.length })}` : ""}</p>
    <label className="qs-field">{t("fm.description")}<textarea rows={2} value={draft.description ?? ""} disabled={disabled} onChange={(event) => patch({ description: event.target.value || undefined })} /></label>
    <section className="qs-section">
      <h4>{t("fm.definition")}</h4>
      {visual && <p className="qs-hint">{t("fm.visualBoolean")}</p>}
      <RuleConditionEditor value={draft.definition} facts={facts} disabled={disabled}
        codeHint={t("fm.codeHint", { type: t(`kind.${draft.valueType}`) })}
        onChange={(definition) => patch({ definition, ...(definition.mode === "VISUAL" && !locked ? { valueType: "BOOLEAN" as const } : {}) })} />
    </section>
    <section className="qs-section">
      <h4>{t("fm.test")}</h4>
      <label className="qs-field qs-code">{t("fm.testInput")}<textarea rows={4} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} /></label>
      <div className="qs-row"><button type="button" className="qs-button is-small" onClick={() => void runTest()}>{t("fm.runTest")}</button>{result && <output className="qs-test-result">{result}</output>}</div>
    </section>
    <section className="qs-section">
      <h4>{t("fm.references")}</h4>
      {references.length ? <ul className="qs-references-list">{references.map((reference) => <li key={`${reference.flowKey}/${reference.ruleKey}`}>{reference.label}</li>)}</ul> : <p className="qs-muted">{t("fm.noReferences")}</p>}
    </section>
    {error && <p className="qs-error" role="alert">{error}</p>}
    <footer className="qs-row">
      <button type="button" className="qs-button is-primary" disabled={disabled} onClick={submit}>{t("fm.save")}</button>
      {original && <button type="button" className="qs-button is-danger" disabled={disabled || references.length > 0} title={references.length ? t("fm.removeBlocked") : undefined} onClick={onRemove}>{t("fm.remove")}</button>}
    </footer>
  </aside>;
}
