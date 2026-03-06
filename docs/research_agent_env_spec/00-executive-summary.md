# 00. 执行摘要

## 0.1 目标

这组文档的目标已经从“纯目标架构设计”调整为两件事同时成立：

- 先准确描述当前仓库里的 `researchops` 真实实现
- 再在此基础上保留合理的演进方向

## 0.2 系统一句话定义

当前系统更准确的定义是：

**一个以 research tree 为中心、围绕 run 执行、上下文路由、observed session 接入和 run report 产物组织起来的 ResearchOps workbench。**

## 0.3 当前实现的核心对象

### A. `TreeNode`
当前图上的真实对象是 `TreeNode`。  
设计语义上可以继续把它理解成 `PlanNode`，但需要承认它不是纯计划对象。

### B. `Attempt` 与 `Run`
设计语义上保留 `Attempt`。  
但在当前实现中，**`Attempt ≈ Run`**：
- 被真正创建和持久化的是 `Run`
- 前端展示和后端调度也主要围绕 `Run`

### C. `AgentSession` 与 `ObservedSession`
当前 session 模型不是单一对象，而是两类：
- `AgentSession`：系统内部交互会话
- `ObservedSession`：从外部 agent session 文件观测到并可 materialize 的对象

### D. `RunReport + deliverable artifacts`
当前 evidence / review 主体不是 `DeliverableBundle`。  
当前更接近：
- `RunReport`
- `RunArtifacts`
- 其中被归类出的 `deliverable artifacts`

### E. `ContextPack`
当前上下文也不是严格 node-bound。  
真实实现更像两层：
- `KnowledgeContextPack`
- `RoutedRunContext`

即 **run-oriented, node-informed**。

## 0.4 当前后端架构结论

### 当前实现
当前后端是一个混合架构：
- tree 结构主要来自 `plan.yaml`
- tree 执行状态主要来自 `state.json`
- run / run events / artifacts / agent sessions 主要来自 store
- observed session 通过 cache / materialization 接入

### 目标方向
文档仍保留更统一的后端状态架构作为目标，但不会再把它误写成当前已实现的事实。

## 0.5 当前前端架构结论

当前前端不是理想化的 node console，而是：

- `VibeTreeCanvas`
- `VibeNodeWorkbench`
- `VibeRecentRunsStrip`
- `VibeObservedSessionsStrip`
- run detail / modal

所以更准确的定位是：

**tree-centered execution workbench**

## 0.6 当前最重要的用户动作

- 编辑或 patch tree plan
- 选择一个 tree node
- 对 node 发起 `run-step`
- 查看 node 对应的 run、logs、artifacts、report
- 刷新或 materialize observed session
- 查看 node search 状态并 promote trial
- 使用 `RunReport + deliverables` 判断结果是否可接受

## 0.7 实施路线

### Phase A：先对齐现有系统
- 统一文档术语
- 统一 current API
- 统一前端/后端/上下文/证据模型描述

### Phase B：再抽象语义层
- 保留 `Attempt` 等更通用语义
- 明确 `Run` 是当前实现载体
- 明确 current vs target

### Phase C：最后再迁移目标态
- 更统一的状态内核
- 更 typed 的 actions / APIs
- 更成熟的 review / projection / context framework

## 0.8 最后一句话

**当前系统先是一个 tree-centered execution workbench；目标才是更统一的 research environment。**
