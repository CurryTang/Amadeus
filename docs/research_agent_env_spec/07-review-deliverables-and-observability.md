# 07. Review、Deliverable 与可观测性设计

## 7.1 当前 review 模型

当前系统是：

**run-centered evidence review**

当前更真实的查看路径：

- recent runs
- run detail
- run report
- deliverable artifacts

当前不是：

- bundle queue
- bundle review workflow
- node review aggregation service

## 7.2 当前 review 主体

当前 review / evidence 主体是：

- `RunReport`
- `RunArtifacts`
- deliverable artifacts

当前系统真正关心的是：

- 这次 run 有没有产出可用结果
- checks / contracts 是否满足
- evidence 是否足以支撑结论
- 是否需要人工 approve
- 是否需要 follow-up node

因此本章不再把 `DeliverableBundle` 写成当前主对象。

## 7.3 当前 gate

当前 gate 更接近：

- run status
- checks / output contract
- `manualApproved`
- tree state 里的人工确认

这里最重要的边界是：

- `Run.succeeded` 不等于 node 已完成
- 人工 gate 仍然是当前工作流的重要组成部分

## 7.4 当前 deliverable 结构

当前 deliverable 更适合写成一组与 run 绑定的产物，而不是 bundle：

- run summary markdown
- final output artifact
- metrics / tables / figures
- notes / claims / diffs

这些内容通过 `RunReport + RunArtifacts` 汇总给前端和人工 reviewer。

## 7.5 当前 observability 分层

### 原始层

- stdout / stderr
- 原始文件
- metrics 文件

### 结构化层

- run events
- step summaries
- artifact manifests
- error signatures

### 消费层

- run detail
- run report
- recent runs strip
- deliverable artifacts

当前人和 agent 主要消费的是最上层，而不是直接 review 原始日志。

## 7.6 当前 compare / follow-up 语义

当前虽然没有完整 review workflow，但已经有足够多的“继续研究”入口：

- 查看不同 run 的结果
- 从 search trial 中 promote
- 根据 report 决定 follow-up node
- 在 tree 上继续拆分问题

因此本章应把 compare 和 follow-up 描述为当前能力的一部分，而不是依赖未来 bundle service。

## 7.7 目标 review 模型

未来可以演进到更丰富的 review 结构，例如：

- 更标准化的 deliverable bundle
- 更明确的 review record
- 更稳定的 compare schema
- 更系统化的 human + auto review pipeline

但这必须写成 target model，不再冒充当前实现。
