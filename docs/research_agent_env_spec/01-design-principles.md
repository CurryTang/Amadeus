# 01. 设计原则

## 1.1 先描述真实系统，再描述目标系统

这套文档不再把未来架构直接写成当前事实。  
每一章都应明确区分：

- `Current implementation`
- `Target architecture`

## 1.2 图上的主对象仍然是 node

当前 UI 里图上的对象是 `TreeNode`。  
设计语义上可以继续称其为 `PlanNode`，但文档必须说明：

- 当前真实落地对象是 `TreeNode`
- 它不是纯计划对象
- 它混合了计划、执行配置、依赖、资源和 UI 提示

## 1.3 `Attempt` 是语义层，`Run` 是当前实现层

当前代码里主要执行对象是 `Run`。  
设计层保留 `Attempt` 是合理的，但必须明确：

- v0 中 `Attempt ≈ Run`
- 不要把多层 attempt hierarchy 写成已实现事实

## 1.4 当前 review 是 run-centered，不是 bundle-centered

当前系统判断结果是否可接受，主要依赖：

- `RunReport`
- `RunArtifacts`
- `deliverable artifacts`

所以 review 章节必须以 run-centered evidence flow 为主。

## 1.5 当前 session 需要分成内部和外部两类

- `AgentSession`
- `ObservedSession`

不要再把它们强行压平成一个已经统一落地的 session 对象。

## 1.6 当前前端是 tree-centered execution workbench

当前最关键的交互不是“打开 node 详情抽屉做 bundle review”，而是：

- 在 tree 中选 node
- 在 workbench 中看 commands / checks / outputs / deliverables
- 看 recent runs
- 看 observed sessions
- 发起 run-step / run-all / search / promote

## 1.7 当前 API 必须以仓库真实路由为准

当前主 API 是：

- `/projects/:projectId/tree/*`
- `/runs/*`
- observed session / dashboard 相关接口

目标态 REST 可以保留，但必须标成 future。

## 1.8 目标架构仍然可以更统一

在以下方向上，文档可以继续保留演进目标：

- 更统一的状态真相源
- 更 typed 的 command/action 接口
- 更丰富的 review flow
- 更清晰的 context abstraction

但这些都不能再伪装成现状。
