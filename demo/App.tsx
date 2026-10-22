import { useMemo, useState } from "react";
import {
  evaluateFlow, FactorManager, generateRuleCode, RuleStudio, StudioProvider,
  type FlowResult, type Locale, type OutcomeEditorProps, type RuleFlow,
} from "qjsbox-studio";
import { sampleFactors, sampleFacts, sampleFlow, samples, type Outcome } from "./sample";

type Tab = "flow" | "factors";

const copy = {
  "zh-CN": {
    tagline: "可视化编排三值规则、节点和因子，生成的代码由 qjsbox 沙箱安全执行。",
    flow: "规则编排", factors: "因子管理", reset: "重置示例", language: "English",
    simulate: "试算", sample: "示例输入", run: "运行试算", input: "事实取值（JSON）",
    preview: "浏览器预览只计算可视化规则，语义与 qjsbox 的 __rule 一致；JavaScript 规则需在服务端运行。",
    status: { HIT: "命中", NO_HIT: "未命中任何规则（放行）", UNAVAILABLE: "因子不可用，失败即停", NEEDS_SERVER: "遇到 JavaScript 规则，需要服务端 qjsbox 继续", INVALID_FLOW: "规则流结构无效" },
    step: { HIT: "命中", MISS: "未命中", UNAVAILABLE: "不可用", NEEDS_SERVER: "需服务端", NODE_DISABLED: "节点已停用", RULE_DISABLED: "规则已停用" },
    action: { PASS: "放行", REVIEW: "转人工", REJECT: "拒绝" },
    outcome: "处置", note: "备注", badJson: "输入不是有效的 JSON 对象", code: "整条规则流生成的代码",
    open: "打开规则查看证据", source: "源码",
  },
  en: {
    tagline: "Author three-valued rules, nodes and factors visually; the generated code runs safely in the qjsbox sandbox.",
    flow: "Rule flow", factors: "Factors", reset: "Reset sample", language: "中文",
    simulate: "Simulate", sample: "Sample input", run: "Run", input: "Fact values (JSON)",
    preview: "The browser preview evaluates visual rules with the same semantics as qjsbox's __rule; JavaScript rules run server-side.",
    status: { HIT: "Hit", NO_HIT: "No rule hit (pass)", UNAVAILABLE: "A fact was unavailable, stopped (fail closed)", NEEDS_SERVER: "Reached a JavaScript rule; qjsbox on the server continues", INVALID_FLOW: "The flow is not a valid chain" },
    step: { HIT: "hit", MISS: "miss", UNAVAILABLE: "unavailable", NEEDS_SERVER: "needs server", NODE_DISABLED: "node disabled", RULE_DISABLED: "rule disabled" },
    action: { PASS: "Pass", REVIEW: "Review", REJECT: "Reject" },
    outcome: "Action", note: "Note", badJson: "The input is not a valid JSON object", code: "Code generated for the whole flow",
    open: "Open the rule to see evidence", source: "Source",
  },
} as const;

function initialLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const text = copy[locale];
  const [tab, setTab] = useState<Tab>("flow");
  const [flow, setFlow] = useState<RuleFlow<Outcome>>(() => sampleFlow(locale));
  const [factors, setFactors] = useState(() => sampleFactors(locale));
  const facts = useMemo(() => sampleFacts(locale), [locale]);
  const [input, setInput] = useState(() => JSON.stringify(samples[1].values, null, 2));
  const [result, setResult] = useState<FlowResult<Outcome> | null>(null);
  const [error, setError] = useState("");
  const [studioKey, setStudioKey] = useState(0);

  const run = (source = input) => {
    try {
      const values = JSON.parse(source);
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
      setResult(evaluateFlow(flow, values, { facts, factors }));
      setError("");
    } catch {
      setError(text.badJson);
      setResult(null);
    }
  };
  const reset = () => {
    setFlow(sampleFlow(locale));
    setFactors(sampleFactors(locale));
    setResult(null);
    setStudioKey((key) => key + 1);
  };
  const nodeLabel = (key?: string) => flow.nodes.find((node) => node.key === key)?.label ?? key;
  const ruleLabel = (nodeKey?: string, ruleKey?: string) => flow.nodes.find((node) => node.key === nodeKey)?.rules.find((rule) => rule.key === ruleKey)?.label ?? ruleKey;
  const flowCode = flow.nodes.map((node) => `// ${node.label}\n${node.rules.map((rule) => `//   ${rule.label}\n${rule.condition.mode === "JAVASCRIPT" ? rule.condition.source : generateRuleCode(rule.condition.expression)}`).join("\n")}`).join("\n\n");

  return <StudioProvider locale={locale}>
    <div className="demo">
      <header className="demo-header">
        <div>
          <h1>qjsbox-studio</h1>
          <p>{text.tagline} <a href="https://github.com/Huozhewande/qjsbox">qjsbox</a></p>
        </div>
        <div className="demo-actions">
          <button type="button" className="qs-button" onClick={reset}>{text.reset}</button>
          <button type="button" className="qs-button" onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}>{text.language}</button>
        </div>
      </header>
      <nav className="demo-tabs" role="tablist">
        {(["flow", "factors"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{text[item]}</button>)}
      </nav>
      {tab === "flow" && <>
        <RuleStudio key={studioKey} value={flow} onChange={(next) => { setFlow(next); setResult(null); }} facts={facts} factors={factors}
          defaultOutcome={{ action: "REVIEW" }} renderOutcome={(props) => <OutcomeEditor {...props} labels={text} />}
          describeOutcome={(outcome) => text.action[outcome.action]} evidence={result?.evidence} />
        <section className="qs-panel demo-simulate" aria-label={text.simulate}>
          <header className="qs-panel-head"><h3>{text.simulate}</h3></header>
          <p className="qs-hint">{text.preview}</p>
          <div className="demo-simulate-grid">
            <div className="demo-simulate-input">
              <div className="qs-row">
                <span className="qs-muted">{text.sample}</span>
                {samples.map((sample) => <button key={sample.key} type="button" className="qs-button is-small" onClick={() => { const json = JSON.stringify(sample.values, null, 2); setInput(json); run(json); }}>{sample.label[locale]}</button>)}
              </div>
              <label className="qs-field qs-code">{text.input}<textarea rows={14} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} /></label>
              <button type="button" className="qs-button is-primary" onClick={() => run()}>{text.run}</button>
              {error && <p className="qs-error" role="alert">{error}</p>}
            </div>
            <div className="demo-simulate-result" aria-live="polite">
              {result && <>
                <p className={`demo-status is-${result.status.toLowerCase()}`}>
                  <strong>{text.status[result.status]}</strong>
                  {result.status === "HIT" && result.outcome && <> · {nodeLabel(result.nodeKey)} → {ruleLabel(result.nodeKey, result.ruleKey)} · <b>{text.action[result.outcome.action]}</b></>}
                  {(result.status === "UNAVAILABLE" || result.status === "NEEDS_SERVER") && <> · {nodeLabel(result.nodeKey)} → {ruleLabel(result.nodeKey, result.ruleKey)}</>}
                </p>
                <ol className="demo-steps">
                  {result.steps.map((step, index) => <li key={index} className={`is-${step.status.toLowerCase()}`}>
                    <span>{nodeLabel(step.nodeKey)}{step.ruleKey ? ` → ${ruleLabel(step.nodeKey, step.ruleKey)}` : ""}</span><em>{text.step[step.status]}</em>
                  </li>)}
                </ol>
                <p className="qs-hint">{text.open}</p>
              </>}
              <details className="qs-generated"><summary>{text.code}</summary><pre><code>{flowCode}</code></pre></details>
            </div>
          </div>
        </section>
      </>}
      {tab === "factors" && <FactorManager factors={factors} onChange={(next) => { setFactors(next); setResult(null); }} facts={facts} flows={[flow]} />}
      <footer className="demo-footer">Apache-2.0 · <a href="https://github.com/Huozhewande/qjsbox-studio">{text.source}</a></footer>
    </div>
  </StudioProvider>;
}

function OutcomeEditor({ value, onChange, disabled, labels }: OutcomeEditorProps<Outcome> & { labels: (typeof copy)[Locale] }) {
  return <div className="qs-grid">
    <label className="qs-field">{labels.outcome}<select value={value.action} disabled={disabled} onChange={(event) => onChange({ ...value, action: event.target.value as Outcome["action"] })}>
      {(["PASS", "REVIEW", "REJECT"] as const).map((action) => <option key={action} value={action}>{labels.action[action]}</option>)}
    </select></label>
    <label className="qs-field">{labels.note}<input value={value.note ?? ""} disabled={disabled} onChange={(event) => onChange({ ...value, note: event.target.value || undefined })} /></label>
  </div>;
}
