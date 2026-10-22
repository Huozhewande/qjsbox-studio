import { emptyGroup, newId } from "./expression";
import type { FlowNode, Rule, RuleFlow } from "./model";

export type FlowIssue =
  | "DUPLICATE_KEY"
  | "INVALID_POSITION"
  | "SELF_LINK"
  | "DANGLING_LINK"
  | "MULTIPLE_PREDECESSORS"
  | "START_NOT_UNIQUE"
  | "CYCLE"
  | "UNREACHABLE";

export type ConnectionIssue = "SELF_LINK" | "UNKNOWN_NODE" | "TARGET_HAS_PREDECESSOR" | "CYCLE";

/**
 * A flow is one execution chain: exactly one start, at most one predecessor per node, no
 * cycles, and every node reachable. Positions only affect layout, never execution order.
 */
export function validateFlow(nodes: FlowNode[]): FlowIssue[] {
  if (!nodes.length) return [];
  const issues = new Set<FlowIssue>();
  const keys = new Set(nodes.map((node) => node.key));
  if (keys.size !== nodes.length) issues.add("DUPLICATE_KEY");
  const incoming = new Map(nodes.map((node) => [node.key, 0]));
  for (const node of nodes) {
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) issues.add("INVALID_POSITION");
    if (!node.next) continue;
    if (node.next === node.key) issues.add("SELF_LINK");
    else if (!keys.has(node.next)) issues.add("DANGLING_LINK");
    else incoming.set(node.next, (incoming.get(node.next) ?? 0) + 1);
  }
  if ([...incoming.values()].some((count) => count > 1)) issues.add("MULTIPLE_PREDECESSORS");
  const starts = nodes.filter((node) => incoming.get(node.key) === 0);
  if (starts.length !== 1) issues.add("START_NOT_UNIQUE");
  const visited = new Set<string>();
  let cursor: string | null | undefined = starts[0]?.key;
  while (cursor && keys.has(cursor) && !visited.has(cursor)) {
    visited.add(cursor);
    cursor = nodes.find((node) => node.key === cursor)?.next;
  }
  if (cursor && visited.has(cursor)) issues.add("CYCLE");
  if (visited.size !== nodes.length) issues.add("UNREACHABLE");
  return [...issues];
}

/** Checks a new `source → target` link before it changes the flow. */
export function connectionIssue(nodes: FlowNode[], source: string, target: string): ConnectionIssue | null {
  if (!source || !target || source === target) return "SELF_LINK";
  if (!nodes.some((node) => node.key === source) || !nodes.some((node) => node.key === target)) return "UNKNOWN_NODE";
  if (nodes.some((node) => node.key !== source && node.next === target)) return "TARGET_HAS_PREDECESSOR";
  const seen = new Set([source]);
  let cursor: string | null = target;
  while (cursor) {
    if (seen.has(cursor)) return "CYCLE";
    seen.add(cursor);
    cursor = nodes.find((node) => node.key === cursor)?.next ?? null;
  }
  return null;
}

/** Nodes in execution order. For an invalid flow, the chain from the first start that exists. */
export function executionOrder<O>(nodes: FlowNode<O>[]): FlowNode<O>[] {
  const targets = new Set(nodes.map((node) => node.next).filter(Boolean));
  const ordered: FlowNode<O>[] = [];
  let cursor = nodes.find((node) => !targets.has(node.key));
  while (cursor && !ordered.includes(cursor)) {
    ordered.push(cursor);
    cursor = nodes.find((node) => node.key === cursor!.next);
  }
  return ordered;
}

export function rulesByPriority<O>(node: FlowNode<O>): Rule<O>[] {
  return [...node.rules].sort((a, b) => a.priority - b.priority);
}

export interface NewNodeOptions {
  label: string;
  position?: { x: number; y: number };
  key?: string;
}

export interface NewRuleOptions<O> {
  label: string;
  outcome: O;
  key?: string;
}

/** Pure flow edits. Every function returns a new flow and leaves its input untouched. */
export const flowEdits = {
  /** Appends a node and links the current end of the chain to it, so the flow stays one chain. */
  addNode<O>(flow: RuleFlow<O>, options: NewNodeOptions): RuleFlow<O> {
    const key = options.key ?? newId("node");
    const tail = validateFlow(flow.nodes).length ? undefined : executionOrder(flow.nodes).at(-1);
    const position = options.position ?? (tail ? { x: tail.position.x + 280, y: tail.position.y } : { x: 80, y: 80 });
    const node: FlowNode<O> = { key, label: options.label, enabled: true, position, next: null, rules: [] };
    return { ...flow, nodes: [...flow.nodes.map((item) => item === tail ? { ...item, next: key } : item), node] };
  },
  updateNode<O>(flow: RuleFlow<O>, key: string, patch: Partial<Omit<FlowNode<O>, "key">>): RuleFlow<O> {
    return { ...flow, nodes: flow.nodes.map((node) => node.key === key ? { ...node, ...patch } : node) };
  },
  /** Removes a node and reconnects its predecessor to its successor. */
  removeNode<O>(flow: RuleFlow<O>, key: string): RuleFlow<O> {
    const removed = flow.nodes.find((node) => node.key === key);
    if (!removed) return flow;
    return { ...flow, nodes: flow.nodes.filter((node) => node.key !== key).map((node) => node.next === key ? { ...node, next: removed.next } : node) };
  },
  /** Links `source → target` when that keeps a valid chain; otherwise returns the flow unchanged. */
  connect<O>(flow: RuleFlow<O>, source: string, target: string): RuleFlow<O> {
    if (connectionIssue(flow.nodes, source, target)) return flow;
    return flowEdits.updateNode(flow, source, { next: target });
  },
  disconnect<O>(flow: RuleFlow<O>, source: string): RuleFlow<O> {
    return flowEdits.updateNode(flow, source, { next: null });
  },
  addRule<O>(flow: RuleFlow<O>, nodeKey: string, options: NewRuleOptions<O>): RuleFlow<O> {
    const node = flow.nodes.find((item) => item.key === nodeKey);
    if (!node) return flow;
    const rule: Rule<O> = {
      key: options.key ?? newId("rule"),
      label: options.label,
      priority: Math.max(0, ...node.rules.map((item) => item.priority)) + 1,
      enabled: true,
      condition: { mode: "VISUAL", expression: emptyGroup(), source: "" },
      outcome: options.outcome,
    };
    return flowEdits.updateNode(flow, nodeKey, { rules: [...node.rules, rule] });
  },
  updateRule<O>(flow: RuleFlow<O>, nodeKey: string, ruleKey: string, patch: Partial<Omit<Rule<O>, "key">>): RuleFlow<O> {
    const node = flow.nodes.find((item) => item.key === nodeKey);
    if (!node) return flow;
    return flowEdits.updateNode(flow, nodeKey, { rules: node.rules.map((rule) => rule.key === ruleKey ? { ...rule, ...patch } : rule) });
  },
  removeRule<O>(flow: RuleFlow<O>, nodeKey: string, ruleKey: string): RuleFlow<O> {
    const node = flow.nodes.find((item) => item.key === nodeKey);
    if (!node) return flow;
    return flowEdits.updateNode(flow, nodeKey, { rules: node.rules.filter((rule) => rule.key !== ruleKey) });
  },
  /** Swaps a rule with its neighbour in priority order and renumbers priorities from 1. */
  moveRule<O>(flow: RuleFlow<O>, nodeKey: string, ruleKey: string, delta: -1 | 1): RuleFlow<O> {
    const node = flow.nodes.find((item) => item.key === nodeKey);
    if (!node) return flow;
    const ordered = rulesByPriority(node);
    const index = ordered.findIndex((rule) => rule.key === ruleKey);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return flow;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    return flowEdits.updateNode(flow, nodeKey, { rules: ordered.map((rule, at) => ({ ...rule, priority: at + 1 })) });
  },
};
