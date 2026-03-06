# Research Agent Environment 设计文档包

这组文档现在分成两层：

1. **Current implementation**
   基于仓库现有 `researchops` 代码，总结真实对象、真实 API、真实 UI 和当前约束。
2. **Target architecture**
   保留少量明确的演进方向，例如更统一的状态内核、typed actions、richer review flow。

本轮修订的原则是：**先对齐代码，再谈目标态**。

## 当前实现的关键结论

### 1. 当前系统是 tree-centered，不是 domain-kernel-centered
当前一等公民是：
- `Project`
- `TreePlan`（`plan.yaml`）
- `TreeState`（`state.json`）
- `Run`
- `AgentSession`
- `ObservedSession`
- `ContextPack`
- `RunReport + deliverable artifacts`

### 2. `Attempt` 保留为语义层对象，但 v0 中 `Attempt ≈ Run`
设计语义上仍保留 “attempt” 这个概念。  
但在当前代码中，真正被创建、存储、调度和展示的对象是 `Run`。

### 3. 图上的节点在当前实现里是 `TreeNode`
文档中可以继续用 `PlanNode` 这个术语来表达研究工作单元。  
但当前代码落地的是 `TreeNode`，它是：
- 计划定义
- 执行入口
- 证据依赖
- 资源提示
- UI 元数据

的混合对象，而不是纯计划对象。

### 4. session 当前分成两类
- `AgentSession`：系统内部会话
- `ObservedSession`：从外部 agent 会话文件观测到的对象

### 5. 当前 review / evidence 以 run 为中心
当前主要证据载体是：
- `RunReport`
- `RunArtifacts`
- `deliverable artifacts`

而不是独立的 `DeliverableBundle` 工作流。

### 6. 当前前端是 tree-centered execution workbench
主结构是：
- `VibeTreeCanvas`
- `VibeNodeWorkbench`
- `VibeRecentRunsStrip`
- `VibeObservedSessionsStrip`
- run detail / modal

### 7. 当前 API 以 tree 和 run 路由为主
核心 API 是：
- `/projects/:projectId/tree/*`
- `/runs/*`
- observed session / dashboard 相关接口

## 建议阅读顺序

1. `00-executive-summary.md`
2. `02-system-architecture.md`
3. `03-domain-model-and-state-machines.md`
4. `05-agent-api-context-and-session-sync.md`
5. `06-frontend-and-interaction-spec.md`
6. `07-review-deliverables-and-observability.md`
7. `09-repo-layout-and-module-boundaries.md`

## 合同文件

- `contracts/domain-model.ts`
  当前实现导向的共享对象定义
- `contracts/events.ts`
  当前 `Run` 事件与状态流相关契约
- `contracts/rust_traits.rs`
  目标态后端边界的过渡草案
- `contracts/openapi.yaml`
  当前 tree/run-oriented API 草案

## 一句话总结

**当前系统先是一个 tree-centered execution workbench，然后才逐步演进为更统一的 research environment。**
