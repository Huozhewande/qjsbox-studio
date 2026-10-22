import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ConditionBuilder, FactorManager, FactPicker, RuleConditionEditor, RuleStudio, StudioProvider,
  type Expression, type Fact, type Factor, type RuleCondition, type RuleFlow,
} from "../src";

const facts: Fact[] = [
  { key: "order.amount", label: "Amount", kind: "NUMBER", category: "Order", source: "SYSTEM" },
  { key: "user.verified", label: "Verified", kind: "BOOLEAN", category: "User", source: "SYSTEM" },
  { key: "user.country", label: "Country", kind: "ENUM", category: "User", source: "SYSTEM", options: [{ value: "XX", label: "Xland" }, { value: "YY", label: "Yland" }] },
  { key: "model.score", label: "Fraud score", kind: "NUMBER", category: "Model", source: "MODEL", disabled: true, disabledReason: "Model offline" },
];

function Controlled({ initial, onValue }: { initial: Expression; onValue?: (value: Expression) => void }) {
  const [value, setValue] = useState(initial);
  return <StudioProvider locale="en"><ConditionBuilder value={value} facts={facts} onChange={(next) => { setValue(next); onValue?.(next); }} /></StudioProvider>;
}

describe("ConditionBuilder", () => {
  it("adds typed conditions and normalizes and/or links", () => {
    const seen: Expression[] = [];
    render(<Controlled initial={{ kind: "GROUP", group: { id: "root", combinator: "ALL", children: [] } }} onValue={(value) => seen.push(value)} />);
    const add = screen.getByRole("button", { name: "+ Add condition" });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getAllByRole("combobox", { name: "Fact" })).toHaveLength(3);
    fireEvent.change(screen.getAllByRole("combobox", { name: "Relation to previous" })[1], { target: { value: "ANY" } });
    const last = seen.at(-1)!;
    expect(last.kind === "GROUP" && last.group.combinator).toBe("ANY");
    expect(last.kind === "GROUP" && last.group.children[0].kind).toBe("GROUP");
    expect(screen.getByText(/Full expression/).nextSibling?.textContent).toBe("(Amount ≥ 0 and Amount ≥ 0) or Amount ≥ 0");
  });

  it("switches fact and operator while keeping exactly one valid value", () => {
    const seen: Expression[] = [];
    render(<Controlled initial={{ kind: "GROUP", group: { id: "root", combinator: "ALL", children: [{ kind: "CONDITION", condition: { id: "c1", fact: "order.amount", operator: "GTE", value: 10 } }] } }} onValue={(value) => seen.push(value)} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Fact" }), { target: { value: "user.country" } });
    const condition = () => { const v = seen.at(-1)!; return v.kind === "GROUP" && v.group.children[0].kind === "CONDITION" ? v.group.children[0].condition : null; };
    expect(condition()).toEqual({ id: "c1", fact: "user.country", operator: "EQUALS", value: "XX" });
    fireEvent.change(screen.getByRole("combobox", { name: "Operator" }), { target: { value: "IN" } });
    expect(condition()).toEqual({ id: "c1", fact: "user.country", operator: "IN", value: ["XX"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Yland" }));
    expect(condition()?.value).toEqual(["XX", "YY"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("copies, moves and removes conditions", () => {
    const seen: Expression[] = [];
    render(<Controlled initial={{ kind: "GROUP", group: { id: "root", combinator: "ALL", children: [
      { kind: "CONDITION", condition: { id: "c1", fact: "order.amount", operator: "GTE", value: 1 } },
      { kind: "CONDITION", condition: { id: "c2", fact: "user.verified", operator: "EXISTS" } },
    ] } }} onValue={(value) => seen.push(value)} />);
    const ids = () => { const v = seen.at(-1)!; return v.kind === "GROUP" ? v.group.children.map((child) => child.kind === "CONDITION" ? child.condition.fact : "group") : []; };
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect(ids()).toEqual(["user.verified", "order.amount"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy condition" })[0]);
    expect(ids()).toEqual(["user.verified", "user.verified", "order.amount"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove condition" })[2]);
    expect(ids()).toEqual(["user.verified", "user.verified"]);
  });

  it("shows evidence and keeps unknown references visible but locked", () => {
    render(<StudioProvider locale="en"><ConditionBuilder facts={facts} onChange={() => {}}
      value={{ kind: "GROUP", group: { id: "root", combinator: "ALL", children: [{ kind: "CONDITION", condition: { id: "c1", fact: "gone.fact", operator: "EQUALS", value: "a" } }] } }}
      evidence={{ c1: { status: "EVALUATED", truth: "UNAVAILABLE", reason: "MISSING_VALUE" }, root: { status: "EVALUATED", truth: "UNAVAILABLE" } }} /></StudioProvider>);
    expect(screen.getByRole("combobox", { name: "Operator" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Unavailable reference: gone.fact" })).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Reason: missing value")).toBeInTheDocument();
  });
});

describe("RuleConditionEditor", () => {
  it("initializes JavaScript from the visual draft once and keeps both drafts", () => {
    const changes: RuleCondition[] = [];
    function Host() {
      const [value, setValue] = useState<RuleCondition>({ mode: "VISUAL", source: "", expression: { kind: "CONDITION", condition: { id: "c1", fact: "user.verified", operator: "EXISTS" } } });
      return <StudioProvider locale="en"><RuleConditionEditor value={value} facts={facts} onChange={(next) => { setValue(next); changes.push(next); }} /></StudioProvider>;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "JavaScript" }));
    expect(changes.at(-1)).toMatchObject({ mode: "JAVASCRIPT", source: 'return __rule.test("user.verified", "EXISTS");' });
    fireEvent.change(screen.getByRole("textbox", { name: "JavaScript condition" }), { target: { value: "return input.flag === true;" } });
    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    fireEvent.click(screen.getByRole("button", { name: "JavaScript" }));
    expect(changes.at(-1)).toMatchObject({ mode: "JAVASCRIPT", source: "return input.flag === true;" });
  });
});

describe("FactPicker", () => {
  it("filters facts and keeps unavailable ones inspectable but not selectable", () => {
    const onSelect = vi.fn();
    render(<StudioProvider locale="en"><FactPicker facts={facts} onSelect={onSelect} /></StudioProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "MODEL" } });
    const row = screen.getByText("Fraud score").closest("tr")!;
    expect(within(row).getByRole("button", { name: "Select Fraud score" })).toBeDisabled();
    expect(within(row).getByText("Model offline")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search facts" }), { target: { value: "coun" } });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Options: Xland, Yland")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Country" }));
    expect(onSelect).toHaveBeenCalledWith(facts[2]);
  });
});

describe("RuleStudio", () => {
  it("adds a rule, picks a fact through the dialog and edits the outcome", () => {
    let latest: RuleFlow<string> | null = null;
    function Host() {
      const [flow, setFlow] = useState<RuleFlow<string>>({ key: "f", label: "Orders", nodes: [{ key: "n1", label: "Screening", enabled: true, position: { x: 0, y: 0 }, next: null, rules: [] }] });
      latest = flow;
      return <StudioProvider locale="en"><RuleStudio value={flow} onChange={setFlow} facts={facts} defaultOutcome="PASS"
        renderOutcome={({ value, onChange }) => <select aria-label="Action" value={value} onChange={(event) => onChange(event.target.value)}><option>PASS</option><option>REJECT</option></select>} /></StudioProvider>;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Select Verified" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Action" }), { target: { value: "REJECT" } });
    const rule = latest!.nodes[0].rules[0];
    expect(rule.outcome).toBe("REJECT");
    expect(rule.condition.expression).toMatchObject({ kind: "GROUP", group: { children: [{ kind: "CONDITION", condition: { fact: "user.verified", operator: "EXISTS" } }] } });
    fireEvent.click(screen.getByRole("button", { name: "Back to node" }));
    expect(screen.getByRole("button", { name: "Edit rule New rule" })).toBeInTheDocument();
    expect(screen.getByText("Verified is true")).toBeInTheDocument();
  });
});

describe("FactorManager", () => {
  const flow: RuleFlow<null> = { key: "f", label: "F", nodes: [{ key: "n", label: "N", enabled: true, position: { x: 0, y: 0 }, next: null, rules: [
    { key: "r", label: "R", priority: 1, enabled: true, outcome: null, condition: { mode: "JAVASCRIPT", expression: { kind: "GROUP", group: { id: "g", combinator: "ALL", children: [] } }, source: "return factors.bigOrder;" } },
  ] }] };
  const factor: Factor = { key: "f1", identifier: "bigOrder", label: "Big order", valueType: "BOOLEAN", enabled: true,
    definition: { mode: "VISUAL", source: "", expression: { kind: "CONDITION", condition: { id: "c", fact: "order.amount", operator: "GTE", value: 1000 } } } };

  it("creates a factor after validating its identifier and definition", () => {
    const onChange = vi.fn();
    render(<StudioProvider locale="en"><FactorManager factors={[factor]} onChange={onChange} facts={facts} /></StudioProvider>);
    fireEvent.click(screen.getByRole("button", { name: "New factor" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Unverified" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Identifier" }), { target: { value: "bigOrder" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Another factor or fact already uses this identifier.");
    fireEvent.change(screen.getByRole("textbox", { name: "Identifier" }), { target: { value: "unverified" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid definition: A condition group cannot be empty");
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledWith([factor, expect.objectContaining({ identifier: "unverified", label: "Unverified", valueType: "BOOLEAN" })]);
  });

  it("locks referenced factors and tests visual definitions in the browser", () => {
    render(<StudioProvider locale="en"><FactorManager factors={[factor]} onChange={() => {}} facts={facts} flows={[flow]} /></StudioProvider>);
    expect(within(screen.getByText("Big order").closest("tr")!).getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit factor Big order" }));
    expect(screen.getByRole("textbox", { name: "Identifier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete factor" })).toBeDisabled();
    expect(screen.getByText("F → N → R")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Test input/ }), { target: { value: '{"order.amount": 1500}' } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(screen.getByText("Result: True")).toBeInTheDocument();
  });
});
