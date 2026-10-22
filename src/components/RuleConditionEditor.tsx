import { Fragment } from "react";
import { generateRuleCode } from "../codegen";
import { expressionId, type FactTarget } from "../expression";
import { useT } from "../i18n";
import { IDENTIFIER, type AuthoringMode, type EvidenceMap, type Expression, type Fact, type Factor, type RuleCondition } from "../model";
import { summarizeExpression } from "../summary";
import { ConditionBuilder } from "./ConditionBuilder";

export interface RuleConditionEditorProps {
  value: RuleCondition;
  onChange: (value: RuleCondition) => void;
  facts: Fact[];
  /** Factors listed as `factors.<identifier>` references in JavaScript mode. */
  factors?: Factor[];
  disabled?: boolean;
  evidence?: EvidenceMap;
  onRequestFact?: (target: FactTarget) => void;
  activeTarget?: FactTarget | null;
  /** Replaces the hint shown under the code editor. */
  codeHint?: string;
}

/**
 * Switches a condition between the visual builder and JavaScript with one click. Each mode keeps
 * its own draft. The first switch to JavaScript, while no code was ever written, starts from the
 * code generated for the visual conditions; code is never parsed back into visual conditions.
 */
export function RuleConditionEditor({ value, onChange, facts, factors = [], disabled = false, evidence, onRequestFact, activeTarget, codeHint }: RuleConditionEditorProps) {
  const t = useT();
  const generated = generateRuleCode(value.expression);
  const references = factors.filter((factor) => factor.enabled && IDENTIFIER.test(factor.identifier));
  const switchMode = (mode: AuthoringMode) => {
    if (mode === value.mode) return;
    onChange({ ...value, mode, source: mode === "JAVASCRIPT" && !value.source.trim() ? generated : value.source });
  };
  return <section className="qs-rule-condition" aria-label={t("rce.label")}>
    <div className="qs-mode-switch" role="group" aria-label={t("rce.mode")}>
      {(["VISUAL", "JAVASCRIPT"] as const).map((mode) => <button key={mode} type="button" className={`qs-mode${value.mode === mode ? " is-active" : ""}`} aria-pressed={value.mode === mode} disabled={disabled} onClick={() => switchMode(mode)}>{t(mode === "VISUAL" ? "rce.visual" : "rce.javascript")}</button>)}
      <span className="qs-muted">{t("rce.modeNote")}</span>
    </div>
    {value.mode === "VISUAL"
      ? <>
        <p className="qs-hint">{t("cb.precedence")}</p>
        <ConditionBuilder value={value.expression} onChange={(expression) => onChange({ ...value, expression })} facts={facts} disabled={disabled} evidence={evidence} onRequestFact={onRequestFact} activeTarget={activeTarget} />
        <details className="qs-generated"><summary>{t("rce.generated")}</summary><pre><code>{generated}</code></pre><p className="qs-hint">{t("rce.generatedNote")}</p></details>
      </>
      : <>
        <label className="qs-field qs-code">{t("rce.code")}<textarea rows={12} spellCheck={false} disabled={disabled} value={value.source} onChange={(event) => onChange({ ...value, source: event.target.value })} /></label>
        <p className="qs-hint">{codeHint ?? t("rce.codeHint")}</p>
        <details className="qs-references" open>
          <summary>{t("rce.factors")}</summary>
          {references.length
            ? <ul>{references.map((factor) => <li key={factor.key}><span>{factor.label}</span> · <code>{`factors.${factor.identifier}`}</code> · <span>{t(`kind.${factor.valueType}`)}</span></li>)}</ul>
            : <p className="qs-muted">{t("rce.noFactors")}</p>}
        </details>
      </>}
  </section>;
}

/** Read-only view of a condition that keeps its group structure visible. */
export function ConditionPreview({ expression, facts, depth = 0 }: { expression: Expression; facts: Fact[]; depth?: number }) {
  const t = useT();
  if (expression.kind === "CONDITION") return <span className="qs-preview-condition">{summarizeExpression(expression, facts, t)}</span>;
  const join = t(expression.group.combinator === "ALL" ? "cb.and" : "cb.or");
  return <div className={`qs-preview-group${depth ? " is-nested" : ""}`}>
    {expression.group.children.map((child, index) => <Fragment key={expressionId(child)}>
      {index > 0 && <span className="qs-preview-join">{join}</span>}
      <ConditionPreview expression={child} facts={facts} depth={depth + 1} />
    </Fragment>)}
    {!expression.group.children.length && <span className="qs-preview-condition is-empty">{t("sum.empty")}</span>}
  </div>;
}
