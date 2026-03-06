# Research Agent Environment 设计文档包

## 当前状态

这份 `FULL_REPORT.md` 现在改成总览文档，不再保留旧版那种独立展开的长篇全文。  
权威内容以分章文档为准：

1. `README.md`
2. `00-executive-summary.md`
3. `01-design-principles.md`
4. `02-system-architecture.md`
5. `03-domain-model-and-state-machines.md`
6. `04-execution-environment-and-sandbox.md`
7. `05-agent-api-context-and-session-sync.md`
8. `06-frontend-and-interaction-spec.md`
9. `07-review-deliverables-and-observability.md`
10. `08-parallel-implementation-plan.md`
11. `09-repo-layout-and-module-boundaries.md`

如果本文件和分章文档冲突，以分章文档为准。

## 已确认的核心结论

### 1. 核心对象

当前系统应先按现有实现理解：

- `TreeNode`
- `TreeState`
- `Run`
- `AgentSession`
- `ObservedSession`
- `KnowledgeContextPack`
- `RoutedRunContext`
- `RunReport`

语义层仍可保留：

- `PlanNode`
- `Attempt`
- 广义 `Session`

其中已经确认：

- `Attempt` 是语义层对象
- `Run` 是当前实现层对象
- v0 中 `Attempt ≈ Run`

### 2. review / evidence

当前系统不是 bundle-centered review workflow。  
当前 evidence / review 主体是：

- `RunReport`
- `RunArtifacts`
- deliverable artifacts

当前更接近：

**run-centered evidence review**

### 3. session

当前 session 必须明确拆成两类：

- `AgentSession`
- `ObservedSession`

当前 node/run/session 的关联主要是弱关联，而不是统一 attach 协议。

### 4. context

当前上下文不是严格 node-bound immutable pack。  
当前应拆成：

- `KnowledgeContextPack`
- `RoutedRunContext`

并描述为：

**run-oriented, node-informed context**

### 5. 前端

当前前端应被定义为：

**tree-centered execution workbench**

当前真实中心是：

- `VibeTreeCanvas`
- `VibeNodeWorkbench`
- `VibeRecentRunsStrip`
- `VibeObservedSessionsStrip`
- `Run detail / report modal`

### 6. API

当前契约必须围绕真实路由：

- `/projects/:projectId/tree/*`
- `/runs/*`
- dashboard / observed-session 相关接口

未来统一 REST 可以保留，但只能写成 target API。

### 7. 状态架构

这一点按设计目标保留：

- 目标态仍然追求更统一的后端真相源和更清晰的投影层

但当前实现必须先如实承认：

- `plan.yaml`
- `state.json`
- run store
- session store
- observed-session cache

构成了现阶段的混合状态体系。

### 8. 实施路线

实施路线已经确认：

1. 现状整合
2. 语义抽象
3. 目标迁移

## 如何使用这套文档

### 想理解当前系统

优先看：

- `02-system-architecture.md`
- `03-domain-model-and-state-machines.md`
- `05-agent-api-context-and-session-sync.md`
- `06-frontend-and-interaction-spec.md`
- `07-review-deliverables-and-observability.md`

### 想看契约

看：

- `contracts/domain-model.ts`
- `contracts/events.ts`
- `contracts/openapi.yaml`
- `contracts/rust_traits.rs`

### 想看迁移方向

看：

- `01-design-principles.md`
- `08-parallel-implementation-plan.md`
- `09-repo-layout-and-module-boundaries.md`
