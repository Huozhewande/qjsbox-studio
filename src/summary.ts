import type { Translate } from "./i18n";
import type { ConditionValue, Evidence, Expression, Fact } from "./model";

export function formatValue(value: ConditionValue | undefined, fact: Fact | undefined, t: Translate): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return t(value ? "value.true" : "value.false");
  const label = (item: string) => fact?.options?.find((option) => option.value === item)?.label ?? item;
  return Array.isArray(value) ? value.map(label).join(", ") : typeof value === "string" ? label(value) : String(value);
}

/** One-line, natural-language form of an expression, e.g. `Amount ≥ 1000 and (Country is one of US, CA)`. */
export function summarizeExpression(value: Expression, facts: Fact[], t: Translate): string {
  if (value.kind === "GROUP") {
    if (!value.group.children.length) return t("sum.empty");
    const join = t(value.group.combinator === "ALL" ? "sum.and" : "sum.or");
    return value.group.children.map((child) => child.kind === "GROUP" ? `(${summarizeExpression(child, facts, t)})` : summarizeExpression(child, facts, t)).join(join);
  }
  const { fact: key, operator, value: operand } = value.condition;
  const fact = facts.find((item) => item.key === key);
  const name = fact?.label ?? (key || t("sum.unknown"));
  const text = formatValue(operand, fact, t);
  return `${name} ${t(`op.${operator}`)}${text ? ` ${text}` : ""}`;
}

export function evidenceLabel(evidence: Evidence, t: Translate): string {
  if (evidence.status === "SKIPPED") return t("evidence.SKIPPED");
  return t(`truth.${evidence.truth ?? "UNAVAILABLE"}`);
}
