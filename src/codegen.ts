import { normalizeExpression } from "./expression";
import type { Expression, RuleCondition } from "./model";

/**
 * Generates the closed `__rule` helper code that qjsbox analyzes and executes. Children are
 * delayed arrows, so evaluation short-circuits and an unavailable fact stays unavailable.
 */
export function generateRuleCode(expression: Expression): string {
  const generate = (item: Expression): string => {
    if (item.kind === "GROUP") {
      const helper = item.group.combinator === "ALL" ? "all" : "any";
      return `__rule.${helper}([${item.group.children.map((child) => `() => ${generate(child)}`).join(", ")}])`;
    }
    const { fact, operator, value } = item.condition;
    const operand = operator === "EQUALS" && Array.isArray(value) ? value[0] : value;
    return `__rule.test(${JSON.stringify(fact)}, ${JSON.stringify(operator)}${operator === "EXISTS" ? "" : `, ${JSON.stringify(operand) ?? "null"}`})`;
  };
  return `return ${generate(normalizeExpression(expression))};`;
}

/** The JavaScript a rule or factor actually runs: its code in JAVASCRIPT mode, generated otherwise. */
export function conditionSource(condition: RuleCondition): string {
  return condition.mode === "JAVASCRIPT" ? condition.source : generateRuleCode(condition.expression);
}
