# 08. 并行实现计划（适合 coding agent 协作）

## 8.1 实施原则

这份计划必须从当前仓库出发，而不是假设已经存在一套新的 Rust 内核。

实施顺序已经确认：

1. 现状整合
2. 语义抽象
3. 目标迁移

## 8.2 Phase A：现状整合

目标：先把文档、契约、代码边界统一到当前真实实现。

### Workstream A1：Tree Plan / Tree State

围绕：

- `tree-plan.service.js`
- `tree-state.service.js`
- `plan-patch.service.js`

重点：

- 统一 `TreeNode` / `TreeState` 术语
- 承认 node 状态主要在 `state.json`
- 把 search / observed 节点正式纳入模型

### Workstream A2：Run Lifecycle / Report / Artifacts

围绕：

- `store.js`
- `runner.js`
- `orchestrator.js`
- `runs.js`
- `run-report-view.js`

重点：

- 承认 `Attempt ≈ Run`
- 明确 `RunReport + RunArtifacts` 是当前 evidence 主体
- 统一 cancel / retry / report / artifact 契约

### Workstream A3：Context / Routing / KB

围绕：

- `context-pack.service.js`
- `context-router.service.js`
- `knowledge-assets.service.js`

重点：

- 把 `KnowledgeContextPack` 和 `RoutedRunContext` 明确拆开
- 承认当前上下文是 run-oriented

### Workstream A4：Sessions / Observed Sessions

围绕：

- `interactive-agent.service.js`
- `observed-session.service.js`

重点：

- 把 `AgentSession` 与 `ObservedSession` 明确区分
- 承认当前是弱关联，不是统一 attach 协议

### Workstream A5：Frontend Workbench

围绕：

- `VibeTreeCanvas.jsx`
- `VibeNodeWorkbench.jsx`
- `VibeRecentRunsStrip.jsx`
- `VibeObservedSessionsStrip.jsx`

重点：

- 把前端正式定义为 tree-centered execution workbench
- 去掉把当前 UI 写成 detail drawer / review queue 的描述

## 8.3 Phase B：语义抽象

目标：在不扭曲当前代码的前提下，引入更稳定的上层语义。

### 需要引入的抽象

- `PlanNode` 作为 `TreeNode` 的语义层名称
- `Attempt` 作为 `Run` 的语义层名称
- 广义 `Session` 作为 `AgentSession` / `ObservedSession` 的上位概念

### 验收标准

- 每个语义对象都能明确映射回当前实现对象
- 不再出现“语义层说法”和“代码层对象”互相冲突

## 8.4 Phase C：目标迁移

目标：逐步往更统一的后端内核和更强的 typed API 演进。

可以包括：

- 更统一的状态真相源
- 更清晰的 projection / stream 层
- 更标准化的 compare / review / promotion
- 更强的 runtime 和 isolation 边界

但这部分必须建立在 A、B 两个阶段已经稳定的前提上。

## 8.5 当前推荐并行切分

推荐按当前仓库模块切，而不是按未来 crate 切：

- Tree / State
- Run / Report / Artifacts
- Context / Routing
- Sessions / Observed Sessions
- Frontend Workbench

这样做的好处：

- 边界已经存在
- 文件冲突更少
- 能直接对应仓库里的服务和组件

## 8.6 当前 Definition of Done

### 文档层

- 所有章节都明确区分 current vs target
- 不再把未来接口写成当前事实

### 契约层

- `domain-model.ts`
- `events.ts`
- `openapi.yaml`

这三份契约和当前代码现实一致。

### 实现层

- tree / run / session / context / report 的命名边界清晰
- 前端描述与现有 UI 一致
- review / evidence 描述与 `RunReport + RunArtifacts` 一致
