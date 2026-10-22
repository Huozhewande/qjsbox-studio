import { collectFactKeys } from "./expression";
import type { RuleCondition, RuleFlow } from "./model";

export interface Reference {
  flowKey: string;
  nodeKey: string;
  ruleKey: string;
  /** `Flow → Node → Rule`, for display. */
  label: string;
}

/**
 * Keys a condition reads. Visual conditions list their facts; JavaScript is scanned for
 * `factors.x`, `factors["x"]` and `__rule.test("x"` the same way qjsbox's static analysis
 * accepts them. Both drafts count, so switching modes never hides a dependency.
 */
export function conditionReferences(condition: RuleCondition): Set<string> {
  const keys = collectFactKeys(condition.expression);
  const code = condition.source;
  for (const match of code.matchAll(/\bfactors\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])/g)) keys.add(match[1] ?? match[3]);
  for (const match of code.matchAll(/__rule\.test\(\s*(["'])([^"']+)\1/g)) keys.add(match[2]);
  keys.delete("");
  return keys;
}

/** Every rule that reads each key, across flows. */
export function findReferences(flows: RuleFlow<unknown>[]): Map<string, Reference[]> {
  const found = new Map<string, Reference[]>();
  for (const flow of flows) for (const node of flow.nodes) for (const rule of node.rules) {
    for (const key of conditionReferences(rule.condition)) {
      const list = found.get(key) ?? [];
      list.push({ flowKey: flow.key, nodeKey: node.key, ruleKey: rule.key, label: `${flow.label} → ${node.label} → ${rule.label}` });
      found.set(key, list);
    }
  }
  return found;
}
