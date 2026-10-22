/** Operators understood by qjsbox's `__rule.test` helper. */
export type Operator = "EQUALS" | "GTE" | "LTE" | "IN" | "ANY_MATCH" | "EXISTS";
export type Combinator = "ALL" | "ANY";
/** Three-valued result: a missing or failed fact is UNAVAILABLE, never silently FALSE. */
export type Truth = "TRUE" | "FALSE" | "UNAVAILABLE";
export type FactKind = "BOOLEAN" | "NUMBER" | "TEXT" | "ENUM" | "SET";
export type ValueType = "BOOLEAN" | "NUMBER" | "TEXT";

export interface FactOption {
  value: string;
  label?: string;
}

/** Something a condition can test. `key` is the reference passed to the resolver. */
export interface Fact {
  key: string;
  label: string;
  kind: FactKind;
  /** Defaults to {@link defaultOperators} for the kind. */
  operators?: Operator[];
  options?: FactOption[];
  category?: string;
  /** Free-form origin used for filtering, e.g. SYSTEM, MODEL or CUSTOM. */
  source?: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export type ConditionValue = boolean | number | string | string[];

export interface Condition {
  id: string;
  fact: string;
  operator: Operator;
  /** Absent for EXISTS; a string array for IN and ANY_MATCH. */
  value?: ConditionValue;
}

export interface Group {
  id: string;
  combinator: Combinator;
  children: Expression[];
  /** Editor-only relation between each child and the previous one. Normalized away on change. */
  links?: Combinator[];
}

export type Expression =
  | { kind: "GROUP"; group: Group }
  | { kind: "CONDITION"; condition: Condition };

export type AuthoringMode = "VISUAL" | "JAVASCRIPT";

/** Both drafts are kept so switching modes never loses work; `mode` decides which one runs. */
export interface RuleCondition {
  mode: AuthoringMode;
  expression: Expression;
  source: string;
}

/** A rule inside a node. Rules run by ascending priority; the first hit ends the flow. */
export interface Rule<Outcome = unknown> {
  key: string;
  label: string;
  priority: number;
  enabled: boolean;
  condition: RuleCondition;
  /** Opaque to the library; edited through `renderOutcome`. */
  outcome: Outcome;
}

/** A node in a single execution chain. `next` is where evaluation continues when no rule hits. */
export interface FlowNode<Outcome = unknown> {
  key: string;
  label: string;
  description?: string;
  enabled: boolean;
  position: { x: number; y: number };
  next: string | null;
  rules: Rule<Outcome>[];
}

export interface RuleFlow<Outcome = unknown> {
  key: string;
  label: string;
  nodes: FlowNode<Outcome>[];
}

/** A reusable, named computation over facts. Rules read it like a fact through its identifier. */
export interface Factor {
  key: string;
  /** JavaScript identifier: `factors.<identifier>` in code, the fact key in visual conditions. */
  identifier: string;
  label: string;
  category?: string;
  description?: string;
  valueType: ValueType;
  definition: RuleCondition;
  enabled: boolean;
}

export interface Evidence {
  status: "EVALUATED" | "SKIPPED";
  truth?: Truth;
  actual?: unknown;
  /** Why a value is unavailable, e.g. MISSING_VALUE, TYPE_MISMATCH or NEEDS_SERVER. */
  reason?: string;
}

export type EvidenceMap = Record<string, Evidence>;

export function defaultOperators(kind: FactKind): Operator[] {
  switch (kind) {
    case "BOOLEAN": return ["EXISTS", "EQUALS"];
    case "NUMBER": return ["GTE", "LTE", "EQUALS"];
    case "SET": return ["ANY_MATCH", "EQUALS"];
    default: return ["EQUALS", "IN"];
  }
}

export function factOperators(fact: Fact): Operator[] {
  return fact.operators?.length ? fact.operators : defaultOperators(fact.kind);
}

/** Custom factors appear in pickers and condition builders as facts of source CUSTOM. */
export function factorAsFact(factor: Factor): Fact {
  return {
    key: factor.identifier,
    label: factor.label,
    kind: factor.valueType,
    category: factor.category,
    source: "CUSTOM",
    description: factor.description,
    disabled: !factor.enabled,
  };
}

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
