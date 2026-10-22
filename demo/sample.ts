import type { Expression, Fact, Factor, Locale, RuleFlow } from "qjsbox-studio";

/** Demo outcome. The library treats outcomes as opaque; the demo edits them with its own form. */
export interface Outcome {
  action: "PASS" | "REVIEW" | "REJECT";
  note?: string;
}

type Text = Record<Locale, string>;
const pick = (locale: Locale, text: Text) => text[locale];

export function sampleFacts(locale: Locale): Fact[] {
  const fact = (key: string, label: Text, kind: Fact["kind"], category: Text, extra: Partial<Fact> = {}): Fact =>
    ({ key, label: pick(locale, label), kind, category: pick(locale, category), source: "SYSTEM", ...extra });
  const order = { "zh-CN": "订单", en: "Order" };
  const user = { "zh-CN": "用户", en: "User" };
  const device = { "zh-CN": "设备", en: "Device" };
  return [
    fact("order.amount", { "zh-CN": "订单金额", en: "Order amount" }, "NUMBER", order, { description: pick(locale, { "zh-CN": "本单应付金额（元）", en: "Amount payable" }) }),
    fact("order.itemCount", { "zh-CN": "商品件数", en: "Item count" }, "NUMBER", order),
    fact("order.categories", { "zh-CN": "商品品类", en: "Item categories" }, "SET", order, { options: [
      { value: "electronics", label: pick(locale, { "zh-CN": "数码", en: "Electronics" }) },
      { value: "giftcard", label: pick(locale, { "zh-CN": "礼品卡", en: "Gift cards" }) },
      { value: "apparel", label: pick(locale, { "zh-CN": "服饰", en: "Apparel" }) },
      { value: "grocery", label: pick(locale, { "zh-CN": "生鲜", en: "Grocery" }) },
    ] }),
    fact("order.paymentMethod", { "zh-CN": "支付方式", en: "Payment method" }, "ENUM", order, { options: [
      { value: "card", label: pick(locale, { "zh-CN": "银行卡", en: "Card" }) },
      { value: "wallet", label: pick(locale, { "zh-CN": "钱包", en: "Wallet" }) },
      { value: "cod", label: pick(locale, { "zh-CN": "货到付款", en: "Cash on delivery" }) },
      { value: "crypto", label: pick(locale, { "zh-CN": "加密货币", en: "Crypto" }) },
    ] }),
    fact("user.accountAgeDays", { "zh-CN": "注册天数", en: "Account age (days)" }, "NUMBER", user),
    fact("user.verified", { "zh-CN": "已实名", en: "Verified" }, "BOOLEAN", user),
    fact("user.country", { "zh-CN": "国家/地区", en: "Country" }, "ENUM", user, { options: ["CN", "US", "DE", "JP", "BR"].map((value) => ({ value })) }),
    fact("user.ordersLast24h", { "zh-CN": "近 24 小时订单数", en: "Orders in last 24h" }, "NUMBER", user),
    fact("device.isEmulator", { "zh-CN": "模拟器设备", en: "Emulator device" }, "BOOLEAN", device),
    fact("device.sharedAccounts", { "zh-CN": "设备关联账号数", en: "Accounts on device" }, "NUMBER", device),
    fact("model.fraudScore", { "zh-CN": "欺诈模型分", en: "Fraud model score" }, "NUMBER", { "zh-CN": "模型", en: "Model" }, { source: "MODEL", description: pick(locale, { "zh-CN": "0–100，越高越可疑", en: "0–100, higher is riskier" }) }),
    fact("model.textRisk", { "zh-CN": "备注文本风险", en: "Note text risk" }, "ENUM", { "zh-CN": "模型", en: "Model" }, { source: "MODEL", disabled: true, disabledReason: pick(locale, { "zh-CN": "模型服务未接入", en: "Model service not connected" }) }),
  ];
}

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;
const c = (fact: string, operator: string, value?: unknown): Expression =>
  ({ kind: "CONDITION", condition: { id: id("c"), fact, operator, ...(value === undefined ? {} : { value }) } }) as Expression;
const all = (...children: Expression[]): Expression => ({ kind: "GROUP", group: { id: id("g"), combinator: "ALL", children } });
const any = (...children: Expression[]): Expression => ({ kind: "GROUP", group: { id: id("g"), combinator: "ANY", children } });
const visual = (expression: Expression) => ({ mode: "VISUAL" as const, expression, source: "" });

export function sampleFactors(locale: Locale): Factor[] {
  return [
    { key: "factor-new-high-value", identifier: "newHighValue", label: pick(locale, { "zh-CN": "新号大额", en: "New account, big order" }), category: pick(locale, { "zh-CN": "账号", en: "Account" }),
      description: pick(locale, { "zh-CN": "注册 7 天内且金额不低于 2000", en: "Account ≤ 7 days old and amount ≥ 2000" }),
      valueType: "BOOLEAN", enabled: true, definition: visual(all(c("user.accountAgeDays", "LTE", 7), c("order.amount", "GTE", 2000))) },
    { key: "factor-risky-payment", identifier: "riskyPayment", label: pick(locale, { "zh-CN": "高风险支付", en: "Risky payment" }), category: pick(locale, { "zh-CN": "支付", en: "Payment" }),
      description: pick(locale, { "zh-CN": "加密货币支付，或购买礼品卡", en: "Crypto payment, or buying gift cards" }),
      valueType: "BOOLEAN", enabled: true, definition: visual(any(c("order.paymentMethod", "IN", ["crypto"]), c("order.categories", "ANY_MATCH", ["giftcard"]))) },
    { key: "factor-velocity", identifier: "ordersLastHour", label: pick(locale, { "zh-CN": "近 1 小时下单数", en: "Orders in the last hour" }), category: pick(locale, { "zh-CN": "频率", en: "Velocity" }),
      description: pick(locale, { "zh-CN": "JavaScript 因子，由服务端 qjsbox 计算", en: "JavaScript factor, computed server-side by qjsbox" }),
      valueType: "NUMBER", enabled: true, definition: { mode: "JAVASCRIPT", expression: all(), source: "return input.recentOrders.filter((order) => order.createdAt >= context.now - 3600000).length;" } },
  ];
}

export function sampleFlow(locale: Locale): RuleFlow<Outcome> {
  const rule = (key: string, priority: number, label: Text, condition: ReturnType<typeof visual> | { mode: "JAVASCRIPT"; expression: Expression; source: string }, action: Outcome["action"], enabled = true) =>
    ({ key, label: pick(locale, label), priority, enabled, condition, outcome: { action } });
  return {
    key: "checkout",
    label: pick(locale, { "zh-CN": "下单风控", en: "Checkout risk" }),
    nodes: [
      { key: "account", label: pick(locale, { "zh-CN": "设备与账号", en: "Device & account" }), enabled: true, position: { x: 40, y: 80 }, next: "model",
        description: pick(locale, { "zh-CN": "先拦截明显的作弊设备和高风险新号", en: "Stop obvious device abuse and risky new accounts first" }),
        rules: [
          rule("emulator-farm", 1, { "zh-CN": "模拟器且设备多号", en: "Emulator shared by many accounts" }, visual(all(c("device.isEmulator", "EXISTS"), c("device.sharedAccounts", "GTE", 3))), "REJECT"),
          rule("unverified-new-high", 2, { "zh-CN": "未实名的新号大额", en: "Unverified new account, big order" }, visual(all(c("newHighValue", "EXISTS"), c("user.verified", "EQUALS", false))), "REVIEW"),
        ] },
      { key: "model", label: pick(locale, { "zh-CN": "模型判断", en: "Model" }), enabled: true, position: { x: 340, y: 200 }, next: "velocity",
        rules: [
          rule("fraud-very-high", 1, { "zh-CN": "欺诈分极高", en: "Very high fraud score" }, visual(c("model.fraudScore", "GTE", 90)), "REJECT"),
          rule("fraud-high-risky-pay", 2, { "zh-CN": "欺诈分偏高且高风险支付", en: "High score with risky payment" }, visual(all(c("model.fraudScore", "GTE", 70), c("riskyPayment", "EXISTS"))), "REVIEW"),
        ] },
      { key: "velocity", label: pick(locale, { "zh-CN": "频率控制", en: "Velocity" }), enabled: true, position: { x: 640, y: 80 }, next: null,
        rules: [
          rule("too-many-orders", 1, { "zh-CN": "下单过于频繁", en: "Too many orders" }, visual(any(c("user.ordersLast24h", "GTE", 10), all(c("order.itemCount", "GTE", 20), c("order.categories", "ANY_MATCH", ["giftcard"])))), "REVIEW"),
          rule("burst-script", 2, { "zh-CN": "短时爆单（JavaScript 示例）", en: "Order burst (JavaScript example)" },
            { mode: "JAVASCRIPT", expression: all(), source: "// Runs server-side in qjsbox; the in-browser preview stops here.\nreturn factors.ordersLastHour >= 5 && input.order.amount > 500;" }, "REVIEW", false),
        ] },
    ],
  };
}

export const samples: Array<{ key: string; label: Text; values: Record<string, unknown> }> = [
  { key: "normal", label: { "zh-CN": "正常订单", en: "Normal order" }, values: {
    "order.amount": 320, "order.itemCount": 2, "order.categories": ["apparel"], "order.paymentMethod": "card",
    "user.accountAgeDays": 420, "user.verified": true, "user.country": "DE", "user.ordersLast24h": 1,
    "device.isEmulator": false, "device.sharedAccounts": 1, "model.fraudScore": 12 } },
  { key: "new-high", label: { "zh-CN": "未实名新号大额", en: "Unverified new account" }, values: {
    "order.amount": 5800, "order.itemCount": 1, "order.categories": ["electronics"], "order.paymentMethod": "card",
    "user.accountAgeDays": 2, "user.verified": false, "user.country": "US", "user.ordersLast24h": 1,
    "device.isEmulator": false, "device.sharedAccounts": 1, "model.fraudScore": 40 } },
  { key: "gift-crypto", label: { "zh-CN": "加密货币买礼品卡", en: "Gift cards with crypto" }, values: {
    "order.amount": 900, "order.itemCount": 3, "order.categories": ["giftcard"], "order.paymentMethod": "crypto",
    "user.accountAgeDays": 90, "user.verified": true, "user.country": "BR", "user.ordersLast24h": 2,
    "device.isEmulator": false, "device.sharedAccounts": 1, "model.fraudScore": 78 } },
  { key: "missing-score", label: { "zh-CN": "缺少模型分（失败即停）", en: "Missing model score (fail closed)" }, values: {
    "order.amount": 300, "order.itemCount": 1, "order.categories": ["grocery"], "order.paymentMethod": "wallet",
    "user.accountAgeDays": 300, "user.verified": true, "user.country": "JP", "user.ordersLast24h": 1,
    "device.isEmulator": false, "device.sharedAccounts": 1 } },
];
