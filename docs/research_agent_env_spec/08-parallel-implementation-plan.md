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

### 当前剩余工作应合并为一个统一步骤

在当前仓库里，最有价值的做法已经不是继续拆很多零散小流，而是把剩余目标态缺口收成一个统一步骤：

**Unified Final Step: Target-State Convergence**

这一统一步骤的目标不是“再补几个 payload”，而是把当前已经铺好的 current-compatible seam 真正推进到目标态可运行边界：

- 把 Rust daemon 从 prototype 提升为长期运行的本地 runtime / session-bridge 管理面
- 把当前 `bridge-context / bridge-run / bridge-report / bridge-note / snapshot capture` 这套 typed bridge flow 接成稳定的 daemon-consumable control plane
- 把 review / compare / observability 从 run-centered current views 提升为更完整的 project-level and node-level review surface
- 把 runtime / snapshot / transport / contract / observability 这些分散信号，进一步汇聚到统一的 execution and review control surface
- 为更强的 container / isolation backend 预留真正可切换的 runtime boundary，而不是仅停留在 payload-level hints

### 统一步骤的验收标准

只有当下面这些结果成立时，才算真正完成 Phase C：

- Rust daemon 不再只是 prototype / smoke target，而是可以被当前系统稳定探测、启动、执行和调试
- bridge workflow 不再只是 capability metadata，而是成为默认可消费、可追踪、可回退的执行路径
- review / compare / observability 不再只存在于 run detail 和零散 strip，而是形成一致的 node/project triage 口径
- runtime backend 的切换点清晰，后续接 container-guarded / microvm-strong 不需要再次推翻当前 read-model 和 UI 结构

### 当前完成度判断

按这份计划的三阶段定义看，当前状态更接近：

- Phase A：基本完成
- Phase B：大部分完成
- Phase C：已越过中段，managed runtime / control-surface 收敛主干已经落地，但 stronger isolation 和默认化运营路径仍未完成

因此后续不再建议把剩余工作拆成很多新的小 phase，而是统一按 **Target-State Convergence** 这一最终步骤推进。

### 当前已经落地的 Target-State Convergence 主干

本轮收敛已经把下面几件事从“payload seam”推进到了真实可运行边界：

- Rust daemon 已经拥有明确的 executor plane，而不是只有 prototype task catalog
- Node 和 Rust 之间已经共享标准化的 execution request / result contract
- 本地 managed runtime 健康状态已经投影成真实 executor readiness（`hostReady`、`containerReady`、`healthState`、`lastFailureReason`）
- `container-fast` / `container-guarded` 已经对应到 Docker-compatible container backend v1 的真实策略
- project-level 和 node-level control surface 已经在 backend aggregate + frontend workbench 中贯通

这意味着后续 Phase C 的重点，不再是“证明这条路径能不能存在”，而是把它继续做成默认、稳定、可恢复的运行面。

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
- managed runtime / bridge / review control surface 已经具备端到端主干：可探测、可管理、可执行、可在 project/node workbench 中消费

## 8.7 下一阶段最值得追的剩余点

- 把 managed Rust daemon 进一步推向默认执行路径，而不是“可选但健康可见”的路径
- 在 container backend v1 之上继续补强更强隔离等级，而不推翻已经落地的 contract/read-model/UI
- 围绕重启、失败恢复、follow-up action 再补操作面细节，减少当前仍需人工判断的部分
