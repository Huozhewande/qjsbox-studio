# qjsbox-studio

[English](README.md)

给 [qjsbox](https://github.com/Huozhewande/qjsbox) 配套的规则编写组件（React）：可视化条件编辑器（可一键切换到 JavaScript）、规则流画布与节点编辑、因子管理。

![规则流画布与节点规则列表](docs/overview.jpg)

qjsbox 负责在服务端安全执行不可信的 JavaScript 规则；qjsbox-studio 负责编写。运营在页面上可视化地配置条件，组件生成封闭的 `__rule` 辅助代码，交给 qjsbox 分析和执行。条件采用**三值逻辑**：取不到或出错的事实记为"不可用"，不会被悄悄当成 `false`；规则流遇到无法判断的情况会停下，而不是放行。

## 包含什么

| 组件 / 函数 | 作用 |
|-|-|
| `ConditionBuilder` | 嵌套条件组；按事实类型给出对应的取值控件；复制、排序、删除；每一项单独设置与上一项的"且 / 或"关系（"且"优先于"或"）；自然语言汇总；逐条显示证据。 |
| `RuleConditionEditor` | 可视化与 JavaScript 一键切换，两种模式各自保留草稿；第一次切到 JavaScript 时用生成的代码初始化。 |
| `RuleFlowCanvas` | 基于 React Flow 的单链画布：拖动摆放节点，把"未命中"出口连到下一个节点；连线会校验（唯一起点、单前置、无环）。 |
| `RuleStudio` | 画布 + 当前节点的规则列表（按优先级、可排序、启停、删除）+ 单条规则编辑页（因子选择弹窗、处置由你自定义）。 |
| `FactPicker` / `FactPickerDialog` | 可搜索的因子表，按分类、类型、来源筛选；不可用的因子仍可查看原因。 |
| `FactorManager` | 可复用因子，用可视化条件或 JavaScript 定义，代码里写作 `factors.<标识>`；被引用后锁定标识和类型，且不能删除。 |
| `generateRuleCode` | 把条件转成 qjsbox 的 `__rule.all/any/test` 代码。 |
| `evaluateFlow` / `evaluateExpression` | 浏览器内预览，语义与 qjsbox 的 `__rule` 一致，返回每个条件的证据。 |
| `flowEdits`、`validateFlow` | 增删、连线、排序节点和规则的纯函数。 |

界面内置中文和英文，跟随系统深浅色，可通过 `--qs-*` CSS 变量换肤。

## 试用演示

```sh
npm install
npm run dev        # http://127.0.0.1:5179
```

演示是一个"下单风控"规则流：3 个节点、6 条规则、3 个因子，并带有可选示例输入的试算面板。

## 使用

还没有发布到 npm，目前需要从源码构建：`npm run build` 会输出到 `dist/`。用法示例、服务端如何用 qjsbox 执行，以及自定义方式，见英文 [README](README.md)。

要点：

- 规则流是纯数据（`RuleFlow` → `FlowNode` → `Rule`），可以按你自己的方式存储和做版本管理。
- `conditionSource(rule.condition)` 得到要交给 qjsbox 的代码：可视化规则用生成的 `__rule` 代码，JavaScript 规则用它自己的源码。
- 服务端按 `evaluateFlow` 的顺序执行：启用的节点按连线顺序，启用的规则按优先级，首条命中即停；某条规则不可用时停下，不放行。
- 预览与 qjsbox 一致：语义有测试覆盖；演示规则流生成的代码也已在 qjsbox v0.1.1 上逐条执行，所有示例的结果都和预览一致。

## 现状

1.0 之前，数据模型和组件参数可能还会调整。不包含：持久化、草稿和发布流程、权限、服务端执行，这些属于你的应用和 qjsbox。

## 许可证

Apache License 2.0，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。打包的样式里包含 React Flow 的基础样式（MIT），见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
