import { describe, expect, it } from "vitest";
import {
  applyFactAt, conditionReferences, conditionSource, connectionIssue, evaluateExpression, evaluateFlow, executionOrder,
  findReferences, flowEdits, generateRuleCode, normalizeExpression, validateExpression, validateFlow,
  type Expression, type Fact, type Factor, type FlowNode, type RuleFlow,
} from "../src";

const cond = (id: string, fact: string, operator: string, value?: unknown): Expression =>
  ({ kind: "CONDITION", condition: { id, fact, operator, ...(value === undefined ? {} : { value }) } }) as Expression;
const group = (id: string, combinator: "ALL" | "ANY", children: Expression[], links?: ("ALL" | "ANY")[]): Expression =>
  ({ kind: "GROUP", group: { id, combinator, children, ...(links ? { links } : {}) } });

describe("codegen", () => {
  it("generates only delayed helpers with typed operands", () => {
    const code = generateRuleCode(group("g", "ALL", [
      cond("a", "user.verified", "EXISTS"),
      cond("b", "order.amount", "GTE", 1000),
      group("h", "ANY", [cond("c", "user.country", "IN", ["XX", "YY"]), cond("d", "order.tags", "EQUALS", ["gift"])]),
    ]));
    expect(code).toBe('return __rule.all([() => __rule.test("user.verified", "EXISTS"), () => __rule.test("order.amount", "GTE", 1000), () => __rule.any([() => __rule.test("user.country", "IN", ["XX","YY"]), () => __rule.test("order.tags", "EQUALS", "gift")])]);');
  });

  it("returns JavaScript-mode source unchanged", () => {
    expect(conditionSource({ mode: "JAVASCRIPT", expression: group("g", "ALL", []), source: "return true;" })).toBe("return true;");
  });
});

describe("normalizeExpression", () => {
  it("binds AND tighter than OR and keeps every leaf id", () => {
    const value = normalizeExpression(group("g", "ALL", [cond("a", "x", "EXISTS"), cond("b", "y", "EXISTS"), cond("c", "z", "EXISTS")], ["ALL", "ANY"]));
    expect(value).toEqual(group("g", "ANY", [group("g__and_a", "ALL", [cond("a", "x", "EXISTS"), cond("b", "y", "EXISTS")]), cond("c", "z", "EXISTS")]));
  });

  it("uses a uniform link as the group combinator", () => {
    expect(normalizeExpression(group("g", "ALL", [cond("a", "x", "EXISTS"), cond("b", "y", "EXISTS")], ["ANY"]))).toEqual(group("g", "ANY", [cond("a", "x", "EXISTS"), cond("b", "y", "EXISTS")]));
  });
});

describe("validateExpression", () => {
  it("reports what qjsbox analysis would reject", () => {
    expect(validateExpression(group("g", "ALL", []))).toBe("EMPTY_GROUP");
    expect(validateExpression(group("g", "ALL", [cond("a", "", "EXISTS")]))).toBe("MISSING_FACT");
    expect(validateExpression(group("g", "ALL", [cond("a", "x", "IN", [])]))).toBe("INVALID_VALUE");
    expect(validateExpression(group("g", "ALL", [cond("a", "x", "GTE", "1")]))).toBe("INVALID_VALUE");
    expect(validateExpression(group("g", "ALL", [cond("a", "x", "EXISTS", true)]))).toBe("INVALID_VALUE");
    expect(validateExpression(group("g", "ALL", [cond("a", "x", "EXISTS"), cond("a", "y", "EXISTS")]))).toBe("DUPLICATE_ID");
    let deep: Expression = cond("leaf", "x", "EXISTS");
    for (let i = 0; i < 9; i++) deep = group(`g${i}`, "ALL", [deep]);
    expect(validateExpression(deep)).toBe("TOO_DEEP");
    expect(validateExpression(group("g", "ALL", [cond("a", "x", "EQUALS", "ok")]))).toBeNull();
  });
});

describe("evaluateExpression", () => {
  const facts: Fact[] = [{ key: "region", label: "Region", kind: "ENUM", options: [{ value: "eu" }, { value: "us" }] }];

  it("follows three-valued AND/OR with short-circuit evidence", () => {
    const and = evaluateExpression(group("g", "ALL", [cond("a", "missing", "EXISTS"), cond("b", "no", "EXISTS"), cond("c", "yes", "EXISTS")]), { no: false, yes: true });
    expect(and.truth).toBe("FALSE");
    expect(and.evidence.a).toMatchObject({ truth: "UNAVAILABLE", reason: "MISSING_VALUE" });
    expect(and.evidence.c).toEqual({ status: "SKIPPED" });
    expect(evaluateExpression(group("g", "ANY", [cond("a", "missing", "EXISTS"), cond("b", "yes", "EXISTS")]), { yes: true }).truth).toBe("TRUE");
    expect(evaluateExpression(group("g", "ANY", [cond("a", "missing", "EXISTS"), cond("b", "no", "EXISTS")]), { no: false }).truth).toBe("UNAVAILABLE");
  });

  it("mirrors qjsbox operator semantics", () => {
    const run = (expression: Expression, value: unknown) => evaluateExpression(expression, { v: value }).truth;
    expect(run(cond("a", "v", "GTE", 3), 3)).toBe("TRUE");
    expect(run(cond("a", "v", "GTE", 3), "3")).toBe("UNAVAILABLE");
    expect(run(cond("a", "v", "EQUALS", "x"), ["x", "y"])).toBe("TRUE");
    expect(run(cond("a", "v", "EQUALS", 1), "1")).toBe("UNAVAILABLE");
    expect(run(cond("a", "v", "IN", ["a", "b"]), "b")).toBe("TRUE");
    expect(run(cond("a", "v", "ANY_MATCH", ["z"]), ["a", "b"])).toBe("FALSE");
    expect(run(cond("a", "v", "EXISTS"), 1)).toBe("UNAVAILABLE");
  });

  it("treats choices outside the fact's options as unavailable", () => {
    expect(evaluateExpression(cond("a", "region", "IN", ["eu", "gone"]), { region: "eu" }, { facts }).evidence.a).toMatchObject({ truth: "UNAVAILABLE", reason: "OPTION_REMOVED" });
    expect(evaluateExpression(cond("a", "region", "EQUALS", "us"), { region: "us" }, { facts }).truth).toBe("TRUE");
  });

  it("computes visual factors and refuses JavaScript factors", () => {
    const factors: Factor[] = [
      { key: "f1", identifier: "bigOrder", label: "Big order", valueType: "BOOLEAN", enabled: true, definition: { mode: "VISUAL", expression: cond("x", "amount", "GTE", 100), source: "" } },
      { key: "f2", identifier: "scripted", label: "Scripted", valueType: "NUMBER", enabled: true, definition: { mode: "JAVASCRIPT", expression: group("g", "ALL", []), source: "return 1;" } },
    ];
    expect(evaluateExpression(cond("a", "bigOrder", "EXISTS"), { amount: 150 }, { factors }).truth).toBe("TRUE");
    expect(evaluateExpression(cond("a", "scripted", "GTE", 1), {}, { factors }).evidence.a.reason).toBe("NEEDS_SERVER");
  });
});

const node = (key: string, next: string | null, x = 0): FlowNode => ({ key, label: key.toUpperCase(), enabled: true, position: { x, y: 0 }, next, rules: [] });

describe("flow validation", () => {
  it("accepts one chain and orders by links, not positions", () => {
    const nodes = [node("b", "c", 0), node("a", "b", 500), node("c", null, 250)];
    expect(validateFlow(nodes)).toEqual([]);
    expect(executionOrder(nodes).map((item) => item.key)).toEqual(["a", "b", "c"]);
  });

  it("rejects broken chains", () => {
    expect(validateFlow([node("a", "a")])).toContain("SELF_LINK");
    expect(validateFlow([node("a", "zz")])).toContain("DANGLING_LINK");
    expect(validateFlow([node("a", "c"), node("b", "c"), node("c", null)])).toEqual(expect.arrayContaining(["MULTIPLE_PREDECESSORS", "START_NOT_UNIQUE"]));
    expect(validateFlow([node("a", null), node("b", null)])).toEqual(expect.arrayContaining(["START_NOT_UNIQUE", "UNREACHABLE"]));
    expect(validateFlow([node("a", "b"), node("b", "c"), node("c", "b")])).toContain("CYCLE");
    expect(validateFlow([node("a", null), node("b", "c"), node("c", "b")])).toEqual(["UNREACHABLE"]);
  });

  it("checks a link before it is made", () => {
    const nodes = [node("a", "b"), node("b", null), node("c", null)];
    expect(connectionIssue(nodes, "c", "b")).toBe("TARGET_HAS_PREDECESSOR");
    expect(connectionIssue(nodes, "b", "a")).toBe("CYCLE");
    expect(connectionIssue(nodes, "b", "c")).toBeNull();
  });
});

describe("flowEdits", () => {
  const empty: RuleFlow<string> = { key: "f", label: "Flow", nodes: [] };

  it("appends nodes to the end of the chain and reconnects on removal", () => {
    let flow = flowEdits.addNode(empty, { label: "A", key: "a" });
    flow = flowEdits.addNode(flow, { label: "B", key: "b" });
    flow = flowEdits.addNode(flow, { label: "C", key: "c" });
    expect(executionOrder(flow.nodes).map((item) => item.key)).toEqual(["a", "b", "c"]);
    flow = flowEdits.removeNode(flow, "b");
    expect(flow.nodes.find((item) => item.key === "a")?.next).toBe("c");
    expect(validateFlow(flow.nodes)).toEqual([]);
  });

  it("refuses invalid links and renumbers moved rules", () => {
    let flow = flowEdits.addNode(flowEdits.addNode(empty, { label: "A", key: "a" }), { label: "B", key: "b" });
    expect(flowEdits.connect(flow, "b", "a")).toBe(flow);
    flow = flowEdits.addRule(flow, "a", { label: "R1", outcome: "PASS", key: "r1" });
    flow = flowEdits.addRule(flow, "a", { label: "R2", outcome: "REJECT", key: "r2" });
    flow = flowEdits.moveRule(flow, "a", "r2", -1);
    expect(flow.nodes[0].rules.map((rule) => [rule.key, rule.priority])).toEqual(expect.arrayContaining([["r2", 1], ["r1", 2]]));
  });
});

describe("evaluateFlow", () => {
  const rule = (key: string, priority: number, expression: Expression, outcome: string, enabled = true) => ({ key, label: key, priority, enabled, outcome, condition: { mode: "VISUAL" as const, expression, source: "" } });
  const flow: RuleFlow<string> = {
    key: "f", label: "F",
    nodes: [
      { ...node("a", "b"), rules: [rule("a2", 2, cond("x", "score", "GTE", 90), "REJECT"), rule("a1", 1, cond("y", "blocked", "EXISTS"), "BLOCK", false)] },
      { ...node("b", null), rules: [rule("b1", 1, cond("z", "amount", "GTE", 1000), "REVIEW")] },
    ],
  };

  it("runs enabled rules by priority along the chain and stops at the first hit", () => {
    const result = evaluateFlow(flow, { score: 10, amount: 5000, blocked: true });
    expect(result).toMatchObject({ status: "HIT", nodeKey: "b", ruleKey: "b1", outcome: "REVIEW" });
    expect(result.steps.map((step) => step.status)).toEqual(["RULE_DISABLED", "MISS", "HIT"]);
  });

  it("fails closed when a rule is unavailable or needs the server", () => {
    expect(evaluateFlow(flow, { amount: 5000 }).status).toBe("UNAVAILABLE");
    const scripted = flowEdits.updateRule(flow, "a", "a2", { condition: { mode: "JAVASCRIPT", expression: cond("x", "score", "GTE", 90), source: "return true;" } });
    expect(evaluateFlow(scripted, { score: 99 }).status).toBe("NEEDS_SERVER");
    expect(evaluateFlow({ ...flow, nodes: [node("a", "a")] }, {}).status).toBe("INVALID_FLOW");
  });
});

describe("references", () => {
  it("finds facts and factors in both drafts of every rule", () => {
    expect([...conditionReferences({ mode: "JAVASCRIPT", expression: cond("a", "region", "EXISTS"), source: `return factors.bigOrder && factors["other"] && __rule.test("x.y", "EXISTS");` })].sort())
      .toEqual(["bigOrder", "other", "region", "x.y"]);
    const flow: RuleFlow = { key: "f", label: "F", nodes: [{ ...node("a", null), rules: [{ key: "r", label: "R", priority: 1, enabled: true, outcome: null, condition: { mode: "VISUAL", expression: cond("c", "bigOrder", "EXISTS"), source: "" } }] }] };
    expect(findReferences([flow]).get("bigOrder")).toEqual([{ flowKey: "f", nodeKey: "a", ruleKey: "r", label: "F → A → R" }]);
  });

  it("applies a picked fact at a nested target only", () => {
    const fact: Fact = { key: "amount", label: "Amount", kind: "NUMBER" };
    const value = applyFactAt(group("g", "ALL", [cond("a", "x", "EXISTS"), group("h", "ANY", [cond("b", "y", "EXISTS")])]), { id: "h", mode: "APPEND" }, fact);
    const inner = (value as Extract<Expression, { kind: "GROUP" }>).group.children[1] as Extract<Expression, { kind: "GROUP" }>;
    expect(inner.group.children).toHaveLength(2);
    expect(inner.group.children[1]).toMatchObject({ kind: "CONDITION", condition: { fact: "amount", operator: "GTE", value: 0 } });
  });
});
