import { factOperators, type Combinator, type Condition, type ConditionValue, type Expression, type Fact, type Group, type Operator } from "./model";

export const MAX_DEPTH = 8;
export const MAX_NODES = 512;

let serial = 0;
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++serial).toString(36)}`;
}

export function expressionId(value: Expression): string {
  return value.kind === "GROUP" ? value.group.id : value.condition.id;
}

export function emptyGroup(combinator: Combinator = "ALL"): Expression {
  return { kind: "GROUP", group: { id: newId("group"), combinator, children: [] } };
}

/** The typed value a fresh condition starts with, so it always has exactly one valid arm. */
export function defaultValue(fact: Fact | undefined, operator: Operator): ConditionValue | undefined {
  if (operator === "EXISTS") return undefined;
  if (operator === "GTE" || operator === "LTE") return 0;
  if (operator === "IN" || operator === "ANY_MATCH") return [fact?.options?.[0]?.value ?? ""];
  if (fact?.kind === "BOOLEAN") return true;
  if (fact?.kind === "NUMBER") return 0;
  return fact?.options?.[0]?.value ?? "";
}

export function newCondition(fact?: Fact, id = newId("condition")): Expression {
  const operator = fact ? factOperators(fact)[0] : "EXISTS";
  const value = defaultValue(fact, operator);
  return { kind: "CONDITION", condition: { id, fact: fact?.key ?? "", operator, ...(value === undefined ? {} : { value }) } };
}

export function groupLinks(group: Group): Combinator[] {
  return group.children.slice(1).map((_, index) => group.links?.[index] ?? group.combinator);
}

/**
 * Turns per-link relations into nested groups. Parentheses are explicit groups and, inside a
 * group, AND binds more tightly than OR: `a AND b OR c` becomes `ANY(ALL(a, b), c)`.
 */
export function normalizeExpression(expression: Expression): Expression {
  if (expression.kind === "CONDITION") return expression;
  const { links: _links, ...group } = expression.group;
  const children = group.children.map(normalizeExpression);
  const links = groupLinks(expression.group);
  if (!links.includes("ANY") || !links.includes("ALL")) {
    return { kind: "GROUP", group: { ...group, combinator: links[0] ?? group.combinator, children } };
  }
  const runs: Expression[][] = [[]];
  children.forEach((child, index) => {
    if (index && links[index - 1] === "ANY") runs.push([]);
    runs[runs.length - 1].push(child);
  });
  return {
    kind: "GROUP",
    group: {
      ...group,
      combinator: "ANY",
      children: runs.map((run) => run.length === 1 ? run[0] : { kind: "GROUP", group: { id: `${group.id}__and_${expressionId(run[0])}`, combinator: "ALL", children: run } }),
    },
  };
}

export function containsId(value: Expression, id: string): boolean {
  return expressionId(value) === id || (value.kind === "GROUP" && value.group.children.some((child) => containsId(child, id)));
}

export function updateById(current: Expression, id: string, update: (current: Expression) => Expression): Expression {
  if (expressionId(current) === id) return update(current);
  if (current.kind !== "GROUP") return current;
  let changed = false;
  const children = current.group.children.map((child) => {
    const next = updateById(child, id, update);
    changed ||= next !== child;
    return next;
  });
  return changed ? { kind: "GROUP", group: { ...current.group, children } } : current;
}

/**
 * Replaces, removes (`null`) or moves the item at `path`. A replacement whose id already exists
 * among the siblings is moved to `path`; an unknown id is inserted after `path` (a copy).
 */
export function replaceAt(root: Expression, path: number[], replacement: Expression | null): Expression {
  if (!path.length) return replacement ?? root;
  if (root.kind !== "GROUP") return root;
  const [index, ...rest] = path;
  const children = [...root.group.children];
  if (!rest.length) {
    if (replacement === null) children.splice(index, 1);
    else {
      const existing = children.findIndex((child) => expressionId(child) === expressionId(replacement));
      if (existing === index) children[index] = replacement;
      else if (existing >= 0) {
        children.splice(existing, 1);
        children.splice(Math.max(0, Math.min(index, children.length)), 0, replacement);
      } else children.splice(index + 1, 0, replacement);
    }
  } else children[index] = replaceAt(children[index], rest, replacement);
  return { kind: "GROUP", group: { ...root.group, children } };
}

export function cloneExpression(value: Expression): Expression {
  if (value.kind === "CONDITION") {
    const { value: operand } = value.condition;
    return { kind: "CONDITION", condition: { ...value.condition, id: newId("condition"), ...(Array.isArray(operand) ? { value: [...operand] } : {}) } };
  }
  return { kind: "GROUP", group: { ...value.group, id: newId("group"), links: value.group.links && [...value.group.links], children: value.group.children.map(cloneExpression) } };
}

export type FactTarget = { id: string; mode: "REPLACE" | "APPEND" };

/** Applies a fact chosen in a picker to the condition or group named by `target`. */
export function applyFactAt(root: Expression, target: FactTarget, fact: Fact): Expression {
  return updateById(root, target.id, (current) => {
    if (target.mode === "REPLACE") return current.kind === "CONDITION" ? newCondition(fact, current.condition.id) : current;
    if (current.kind !== "GROUP") return current;
    return { kind: "GROUP", group: { ...current.group, children: [...current.group.children, newCondition(fact)] } };
  });
}

export function targetExists(root: Expression, target: FactTarget): boolean {
  if (expressionId(root) === target.id) return target.mode === "REPLACE" ? root.kind === "CONDITION" : root.kind === "GROUP";
  return root.kind === "GROUP" && root.group.children.some((child) => targetExists(child, target));
}

export function collectFactKeys(value: Expression, into = new Set<string>()): Set<string> {
  if (value.kind === "CONDITION") into.add(value.condition.fact);
  else value.group.children.forEach((child) => collectFactKeys(child, into));
  return into;
}

export type ExpressionIssue =
  | "EMPTY_GROUP"
  | "MISSING_FACT"
  | "INVALID_VALUE"
  | "DUPLICATE_ID"
  | "TOO_DEEP"
  | "TOO_LARGE";

function validValue(condition: Condition): boolean {
  const { operator, value } = condition;
  if (operator === "EXISTS") return value === undefined;
  if (operator === "GTE" || operator === "LTE") return typeof value === "number" && Number.isFinite(value);
  if (operator === "IN" || operator === "ANY_MATCH") return Array.isArray(value) && value.length > 0 && value.every((item) => item.trim() !== "");
  return typeof value === "boolean" || (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value));
}

/** Returns the first problem that would make generated code fail qjsbox analysis, or null. */
export function validateExpression(value: Expression): ExpressionIssue | null {
  let nodes = 0;
  let issue: ExpressionIssue | null = null;
  const ids = new Set<string>();
  const visit = (item: Expression, depth: number) => {
    nodes++;
    if (depth > MAX_DEPTH) issue ??= "TOO_DEEP";
    const id = expressionId(item);
    if (!id || ids.has(id)) issue ??= "DUPLICATE_ID";
    ids.add(id);
    if (item.kind === "GROUP") {
      if (!item.group.children.length) issue ??= "EMPTY_GROUP";
      item.group.children.forEach((child) => visit(child, depth + 1));
      return;
    }
    if (!item.condition.fact.trim()) issue ??= "MISSING_FACT";
    else if (!validValue(item.condition)) issue ??= "INVALID_VALUE";
  };
  visit(value, 1);
  return nodes > MAX_NODES ? "TOO_LARGE" : issue;
}
