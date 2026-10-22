import { normalizeExpression } from "./expression";
import { executionOrder, rulesByPriority, validateFlow, type FlowIssue } from "./flow";
import type { Condition, Evidence, EvidenceMap, Expression, Fact, Factor, RuleFlow, Truth } from "./model";

/**
 * In-browser preview of qjsbox's three-valued `__rule` semantics, for editors and demos.
 * It is not a sandbox and does not run JavaScript-mode rules: production evaluation belongs to
 * qjsbox on the server.
 */

/** Fact values by key. A missing or null key is unavailable. */
export type FactValues = Record<string, unknown>;

export interface PreviewContext {
  /** Enables option-catalog checks: a choice no longer offered by the fact is unavailable. */
  facts?: Fact[];
  /** Visual factors are computed from their definition when `values` lacks them. */
  factors?: Factor[];
}

type Scalar = boolean | number | string | string[];
type Read = { ok: true; value: Scalar } | { ok: false; reason: string };

export interface ExpressionResult {
  truth: Truth;
  evidence: EvidenceMap;
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function read(ref: string, values: FactValues, context: PreviewContext, depth: number): Read {
  if (Object.prototype.hasOwnProperty.call(values, ref) && values[ref] != null) {
    const value = values[ref];
    return isScalar(value) ? { ok: true, value } : { ok: false, reason: "TYPE_MISMATCH" };
  }
  const factor = context.factors?.find((item) => item.identifier === ref);
  if (!factor) return { ok: false, reason: "MISSING_VALUE" };
  if (!factor.enabled) return { ok: false, reason: "FACTOR_DISABLED" };
  if (factor.definition.mode === "JAVASCRIPT") return { ok: false, reason: "NEEDS_SERVER" };
  if (depth > 0) return { ok: false, reason: "NESTED_FACTOR" };
  const { truth } = evaluate(factor.definition.expression, values, context, depth + 1);
  return truth === "UNAVAILABLE" ? { ok: false, reason: "FACTOR_UNAVAILABLE" } : { ok: true, value: truth === "TRUE" };
}

/** Mirrors `__rule.test` in qjsbox's worker bootstrap. */
function test(condition: Condition, value: Scalar, context: PreviewContext): Truth | "OPTION_REMOVED" {
  const { operator, value: expected } = condition;
  const options = context.facts?.find((fact) => fact.key === condition.fact)?.options;
  const catalogApplies = (operator === "EQUALS" && typeof expected === "string") || operator === "IN" || operator === "ANY_MATCH";
  if (catalogApplies && options) {
    const requested = Array.isArray(expected) ? expected : [expected as string];
    if (requested.some((choice) => !options.some((option) => option.value === choice))) return "OPTION_REMOVED";
  }
  const truth = (result: boolean): Truth => result ? "TRUE" : "FALSE";
  if (operator === "EXISTS") return typeof value === "boolean" ? truth(value) : "UNAVAILABLE";
  if (operator === "EQUALS") {
    if (Array.isArray(value)) return typeof expected === "string" ? truth(value.includes(expected)) : "UNAVAILABLE";
    return typeof value === typeof expected ? truth(value === expected) : "UNAVAILABLE";
  }
  if (operator === "GTE" || operator === "LTE") {
    if (typeof value !== "number" || typeof expected !== "number") return "UNAVAILABLE";
    return truth(operator === "GTE" ? value >= expected : value <= expected);
  }
  if (!Array.isArray(expected)) return "UNAVAILABLE";
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : null;
  return list ? truth(expected.some((choice) => list.includes(choice))) : "UNAVAILABLE";
}

function skip(item: Expression, evidence: EvidenceMap) {
  if (item.kind === "CONDITION") evidence[item.condition.id] = { status: "SKIPPED" };
  else {
    evidence[item.group.id] = { status: "SKIPPED" };
    item.group.children.forEach((child) => skip(child, evidence));
  }
}

function evaluate(expression: Expression, values: FactValues, context: PreviewContext, depth: number): ExpressionResult {
  const evidence: EvidenceMap = {};
  const visit = (item: Expression): Truth => {
    if (item.kind === "CONDITION") {
      const value = read(item.condition.fact, values, context, depth);
      let entry: Evidence;
      if (!value.ok) entry = { status: "EVALUATED", truth: "UNAVAILABLE", reason: value.reason };
      else {
        const result = test(item.condition, value.value, context);
        entry = result === "OPTION_REMOVED"
          ? { status: "EVALUATED", truth: "UNAVAILABLE", actual: value.value, reason: result }
          : { status: "EVALUATED", truth: result, actual: value.value, ...(result === "UNAVAILABLE" ? { reason: "TYPE_MISMATCH" } : {}) };
      }
      evidence[item.condition.id] = entry;
      return entry.truth!;
    }
    const decisive: Truth = item.group.combinator === "ALL" ? "FALSE" : "TRUE";
    let unavailable = false;
    let result: Truth | null = null;
    for (const child of item.group.children) {
      if (result) { skip(child, evidence); continue; }
      const truth = visit(child);
      if (truth === decisive) result = decisive;
      else if (truth === "UNAVAILABLE") unavailable = true;
    }
    const truth = result ?? (unavailable ? "UNAVAILABLE" : decisive === "FALSE" ? "TRUE" : "FALSE");
    evidence[item.group.id] = { status: "EVALUATED", truth };
    return truth;
  };
  return { truth: visit(normalizeExpression(expression)), evidence };
}

export function evaluateExpression(expression: Expression, values: FactValues, context: PreviewContext = {}): ExpressionResult {
  return evaluate(expression, values, context, 0);
}

export type StepStatus = "HIT" | "MISS" | "UNAVAILABLE" | "NEEDS_SERVER" | "NODE_DISABLED" | "RULE_DISABLED";

export interface FlowStep {
  nodeKey: string;
  ruleKey?: string;
  status: StepStatus;
}

export interface FlowResult<Outcome = unknown> {
  /**
   * HIT: a rule matched. NO_HIT: the chain ended. UNAVAILABLE and NEEDS_SERVER stop the flow
   * (fail closed) because the preview cannot decide. INVALID_FLOW: see `issues`.
   */
  status: "HIT" | "NO_HIT" | "UNAVAILABLE" | "NEEDS_SERVER" | "INVALID_FLOW";
  nodeKey?: string;
  ruleKey?: string;
  outcome?: Outcome;
  steps: FlowStep[];
  /** Evidence per evaluated rule key. */
  evidence: Record<string, EvidenceMap>;
  issues?: FlowIssue[];
}

/** Walks the chain: enabled nodes in order, enabled rules by priority, first hit wins. */
export function evaluateFlow<Outcome>(flow: RuleFlow<Outcome>, values: FactValues, context: PreviewContext = {}): FlowResult<Outcome> {
  const issues = validateFlow(flow.nodes);
  if (issues.length) return { status: "INVALID_FLOW", steps: [], evidence: {}, issues };
  const steps: FlowStep[] = [];
  const evidence: Record<string, EvidenceMap> = {};
  for (const node of executionOrder(flow.nodes)) {
    if (!node.enabled) { steps.push({ nodeKey: node.key, status: "NODE_DISABLED" }); continue; }
    for (const rule of rulesByPriority(node)) {
      const step = { nodeKey: node.key, ruleKey: rule.key };
      if (!rule.enabled) { steps.push({ ...step, status: "RULE_DISABLED" }); continue; }
      if (rule.condition.mode === "JAVASCRIPT") {
        steps.push({ ...step, status: "NEEDS_SERVER" });
        return { status: "NEEDS_SERVER", ...step, steps, evidence };
      }
      const result = evaluateExpression(rule.condition.expression, values, context);
      evidence[rule.key] = result.evidence;
      if (result.truth === "TRUE") {
        steps.push({ ...step, status: "HIT" });
        return { status: "HIT", ...step, outcome: rule.outcome, steps, evidence };
      }
      if (result.truth === "UNAVAILABLE") {
        steps.push({ ...step, status: "UNAVAILABLE" });
        return { status: "UNAVAILABLE", ...step, steps, evidence };
      }
      steps.push({ ...step, status: "MISS" });
    }
  }
  return { status: "NO_HIT", steps, evidence };
}
