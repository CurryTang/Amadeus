# 05. Agent API、Context Pack 与 Session 同步设计

## 5.1 当前 API Surface

当前文档必须先对齐仓库里的真实路由。

### Tree API

- `GET /projects/:projectId/tree/plan`
- `PUT /projects/:projectId/tree/plan`
- `POST /projects/:projectId/tree/plan/validate`
- `POST /projects/:projectId/tree/plan/patches`
- `POST /projects/:projectId/tree/plan/impact-preview`
- `GET /projects/:projectId/tree/state`
- `POST /projects/:projectId/tree/nodes/:nodeId/run-step`
- `POST /projects/:projectId/tree/nodes/:nodeId/approve`
- `POST /projects/:projectId/tree/run-all`
- `POST /projects/:projectId/tree/control/pause`
- `POST /projects/:projectId/tree/control/resume`
- `POST /projects/:projectId/tree/control/abort`
- `GET /projects/:projectId/tree/nodes/:nodeId/search`
- `POST /projects/:projectId/tree/nodes/:nodeId/promote/:trialId`
- `POST /projects/:projectId/tree/nodes/:nodeId/run-clarify`

### Run API

- `GET /runs`
- `POST /runs/enqueue-v2`
- `GET /runs/:runId`
- `GET /runs/:runId/events`
- `GET /runs/:runId/steps`
- `GET /runs/:runId/artifacts`
- `GET /runs/:runId/report`
- `GET /runs/:runId/context-pack`
- `POST /runs/:runId/context-pack/preview`
- `POST /runs/:runId/cancel`
- `POST /runs/:runId/retry`

### Dashboard / Session 相关

- `GET /dashboard`
- observed session 和 interactive session 当前通过 dashboard / project 聚合接口暴露

当前不应把 `/nodes/{nodeId}/runs`、`/review-queue`、`/sessions/{sessionId}/attach` 之类 future API 当作现状。

## 5.2 当前 API 设计原则

### 统一语义，接受当前落地差异

文档语义层可以继续谈：

- `PlanNode`
- `Attempt`
- 广义 `Session`

但 API 契约必须承认当前现实：

- 当前执行主对象是 `Run`
- 当前 node 路由以 `/projects/:projectId/tree/*` 为中心
- 当前 session 没有统一 attach/detach/heartbeat 协议

### 现状优先

`contracts/openapi.yaml` 应只描述当前真实 API。  
未来统一 REST 另列为 target API，不和现状混写。

## 5.3 当前 Context Pack 语义

当前 `ContextPack` 不是严格 node-bound，而是：

- knowledge-oriented
- run-oriented
- node-informed

当前输入通常来自：

- project knowledge groups / documents / assets
- 当前 run 的 metadata
- tree node 提供的 title / target / checks / resources
- context router 的 selected items 和 role budgets

当前输出通常分为两层：

- `KnowledgeContextPack`
- `RoutedRunContext`

因此当前应该把 `/runs/:runId/context-pack` 看成主入口，而不是假设所有上下文都由 `/nodes/:nodeId/context-pack` 统一生成。

## 5.4 当前 Session 同步语义

当前会话分两类：

- `AgentSession`
- `ObservedSession`

当前同步方式不是统一 attach 协议，而是弱关联：

- `Run.metadata.treeNodeId`
- `treeState.nodes[nodeId].lastRunId`
- `observed_agent` node 对 `ObservedSession` 的 materialization
- dashboard / strip 级别的聚合展示

当前文档不应要求：

- 所有 session 必须 attach 才能工作
- 所有 run 必须从 session 触发
- 所有 session 必须提供 heartbeat endpoint

这些可以保留为未来目标。

## 5.5 当前 run flow

当前主执行流程：

1. 前端选择 `TreeNode`。
2. 调用 `run-step`、`run-all` 或 `runs/enqueue-v2`。
3. 后端创建 `Run`。
4. `runner.js` / `orchestrator.js` 执行任务。
5. run events、artifacts、report 持续生成。
6. 前端再通过 `/runs/:runId/*` 读取结果。

这里的核心是：

- 语义上可以认为发起了一个 `Attempt`
- 实现上真实创建的是 `Run`

也就是已经确认的关系：

**v0 中 `Attempt ≈ Run`**

## 5.6 当前 API 对前端的支持

当前前端真实依赖的是：

- tree plan / state
- recent runs
- run detail / report / artifacts
- observed sessions
- clarify / search / promote

因此 API 文档应优先支持这些场景，而不是优先支持未来的 review queue 或 bundle-first flow。

## 5.7 目标 API

未来如果要抽象成更统一的语义接口，可以单列 target API，例如：

- node detail query
- attempt compare
- typed session attach
- richer review endpoints
- projection / stream endpoints

但这部分必须标记为 future API，不进入当前 OpenAPI 契约。

## 5.8 当前到目标的迁移要求

迁移时必须保持两点：

1. 不能破坏当前 `/projects/:projectId/tree/*` 和 `/runs/*` 的工作流。
2. 任何新的语义层接口都必须先说明与 `Run`、`TreeNode`、`AgentSession`、`ObservedSession` 的映射关系。
