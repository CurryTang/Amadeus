# 09. 仓库结构与模块边界建议

## 9.1 当前模块边界

当前仓库最清晰的边界不是未来的 monorepo crates，而是现有 `researchops` 模块。

### Tree

- `backend/src/services/researchops/tree-plan.service.js`
- `backend/src/services/researchops/tree-state.service.js`
- `backend/src/services/researchops/plan-patch.service.js`

### Run

- `backend/src/services/researchops/store.js`
- `backend/src/services/researchops/runner.js`
- `backend/src/services/researchops/orchestrator.js`
- `backend/src/routes/researchops/runs.js`
- `backend/src/services/researchops/run-report-view.js`

### Context

- `backend/src/services/researchops/context-pack.service.js`
- `backend/src/services/researchops/context-router.service.js`
- `backend/src/services/researchops/knowledge-assets.service.js`

### Session

- `backend/src/services/researchops/interactive-agent.service.js`
- `backend/src/services/researchops/observed-session.service.js`

### Frontend Workbench

- `frontend/src/components/vibe/VibeTreeCanvas.jsx`
- `frontend/src/components/vibe/VibeNodeWorkbench.jsx`
- `frontend/src/components/vibe/VibeRecentRunsStrip.jsx`
- `frontend/src/components/vibe/VibeObservedSessionsStrip.jsx`

## 9.2 当前边界原则

### tree 边界

负责：

- `plan.yaml`
- `state.json`
- node patch / validate / approve / search

### run 边界

负责：

- enqueue
- execute
- cancel / retry
- events / artifacts / report

### context 边界

负责：

- knowledge pack 生成
- routed context 选择
- 为 run 提供上下文切片

### session 边界

负责：

- 内部 agent session
- observed external session
- dashboard / strip 可见性

### frontend 边界

负责：

- tree-centered workbench
- node workbench
- recent runs / observed sessions
- run detail / report 展示

## 9.3 当前不合理的抽象方式

以下做法不应再作为当前仓库的模块边界：

- 把当前系统写成已经拆好的 Rust crates
- 把 review queue / bundle service 写成现有模块
- 把 projection service 写成已实现基础设施

这些最多只能作为未来方向。

## 9.4 目标边界

未来如果系统真的演进成更统一的控制面，可以再收敛成：

- 语义 contracts
- typed API
- 更统一的状态真相源
- 更清晰的 projection / compare / review 服务

但迁移时必须保持一条原则：

**任何未来边界都必须先说明它如何映射回当前 `researchops` 模块。**
