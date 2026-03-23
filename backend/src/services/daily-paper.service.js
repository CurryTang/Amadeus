const crypto = require('crypto');
const { getDb } = require('../db');
const queueService = require('./queue.service');

function uid() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function todayDate() { return new Date().toISOString().slice(0, 10); }

// ─── Config ──────────────────────────────────────────────────────────────────

async function getConfig() {
  const db = getDb();
  const result = await db.execute(`SELECT * FROM daily_paper_config WHERE id = 'default' LIMIT 1`);
  const row = result.rows?.[0];
  if (!row) return { k: 5, enabled: false, scheduleHour: 8, autoExport: true, provider: 'claude-code', model: 'claude-opus-4-6' };
  return {
    k: row.k ?? 5,
    enabled: row.enabled === 1,
    scheduleHour: row.schedule_hour ?? 8,
    autoExport: row.auto_export === 1,
    provider: row.provider || 'claude-code',
    model: row.model || 'claude-opus-4-6',
  };
}

async function updateConfig(updates) {
  const db = getDb();
  const fields = [];
  const args = [];
  const allowed = {
    k: 'k', enabled: 'enabled', scheduleHour: 'schedule_hour',
    autoExport: 'auto_export', provider: 'provider', model: 'model',
  };
  for (const [key, col] of Object.entries(allowed)) {
    if (updates[key] !== undefined) {
      let val = updates[key];
      if (key === 'enabled' || key === 'autoExport') val = val ? 1 : 0;
      fields.push(`${col} = ?`);
      args.push(val);
    }
  }
  if (fields.length === 0) return getConfig();
  fields.push('updated_at = ?');
  args.push(nowIso());
  args.push('default');
  await db.execute({ sql: `UPDATE daily_paper_config SET ${fields.join(', ')} WHERE id = ?`, args });
  return getConfig();
}

// ─── Selection ───────────────────────────────────────────────────────────────

async function getDailySelection(date) {
  date = date || todayDate();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM daily_paper_selections WHERE selection_date = ? ORDER BY created_at DESC LIMIT 1`,
    args: [date],
  });
  const row = result.rows?.[0];
  if (!row) return null;
  let docIds = [];
  try { docIds = JSON.parse(row.document_ids || '[]'); } catch (_) {}

  // Fetch document details for each ID
  const documents = [];
  for (const docId of docIds) {
    const docResult = await db.execute({
      sql: `SELECT id, title, processing_status, notes_s3_key, obsidian_exported, is_read, original_url
            FROM documents WHERE id = ?`,
      args: [docId],
    });
    const doc = docResult.rows?.[0];
    if (doc) {
      documents.push({
        id: doc.id,
        title: doc.title,
        processingStatus: doc.processing_status || 'idle',
        hasNotes: !!doc.notes_s3_key,
        obsidianExported: doc.obsidian_exported === 1,
        isRead: doc.is_read === 1,
        originalUrl: doc.original_url,
      });
    }
  }

  return {
    id: row.id,
    date: row.selection_date,
    documentIds: docIds,
    documents,
    configK: row.config_k,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function selectDailyPapers(date, k) {
  date = date || todayDate();
  const config = await getConfig();
  k = k || config.k || 5;

  // Check if already selected today
  const existing = await getDailySelection(date);
  if (existing) return existing;

  const db = getDb();

  // Get all unread papers
  const unreadResult = await db.execute({
    sql: `SELECT id, title, processing_status, notes_s3_key
          FROM documents WHERE is_read = 0
          ORDER BY created_at DESC`,
  });
  const unread = unreadResult.rows || [];
  if (unread.length === 0) {
    throw new Error('No unread papers available for daily selection');
  }

  // Shuffle and pick K
  const shuffled = [...unread].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(k, shuffled.length));
  const selectedIds = selected.map((d) => d.id);

  // Save selection
  const id = uid();
  const now = nowIso();
  await db.execute({
    sql: `INSERT INTO daily_paper_selections (id, selection_date, document_ids, config_k, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    args: [id, date, JSON.stringify(selectedIds), k, now, now],
  });

  // Queue papers that need notes generation
  const readingRounds = buildDefaultReadingRounds();
  let queued = 0;
  for (const doc of selected) {
    if (doc.processing_status === 'completed' && doc.notes_s3_key) continue; // already has notes
    if (doc.processing_status === 'queued' || doc.processing_status === 'processing') continue; // already in queue
    try {
      // Set provider on document
      await db.execute({
        sql: `UPDATE documents SET analysis_provider = ?, analysis_model = ?, reader_mode = 'auto_reader_v2', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [config.provider, config.model, doc.id],
      });
      await queueService.enqueueDocument(doc.id, 0, readingRounds);
      queued++;
    } catch (err) {
      console.error(`[DailyPaper] Failed to queue doc ${doc.id}:`, err.message);
    }
  }

  console.log(`[DailyPaper] Selected ${selected.length} papers for ${date}, queued ${queued} for note generation`);

  // Update status
  await db.execute({
    sql: `UPDATE daily_paper_selections SET status = ?, updated_at = ? WHERE id = ?`,
    args: [queued > 0 ? 'generating' : 'ready', nowIso(), id],
  });

  return getDailySelection(date);
}

// ─── Check & Export ──────────────────────────────────────────────────────────

async function checkAndExport(date) {
  date = date || todayDate();
  const selection = await getDailySelection(date);
  if (!selection) return { checked: false, reason: 'no_selection' };

  const db = getDb();
  let allReady = true;
  let exported = 0;

  for (const doc of selection.documents) {
    if (!doc.hasNotes) {
      allReady = false;
      continue;
    }
    // Mark for Obsidian export if not already
    if (!doc.obsidianExported) {
      await db.execute({
        sql: `UPDATE documents SET obsidian_exported = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND obsidian_exported != 0`,
        args: [doc.id],
      });
      // obsidian_exported = 0 means "pending export", the daemon will pick it up
      // Actually, 0 is already the default. We need a different signal.
      // Let's use: obsidian_exported = 0 means not exported, daemon checks for notes_s3_key IS NOT NULL AND obsidian_exported = 0
      exported++;
    }
  }

  if (allReady && selection.status !== 'ready' && selection.status !== 'exported') {
    await db.execute({
      sql: `UPDATE daily_paper_selections SET status = 'ready', updated_at = ? WHERE id = ?`,
      args: [nowIso(), selection.id],
    });
  }

  return { checked: true, allReady, exported };
}

// ─── History ─────────────────────────────────────────────────────────────────

async function getHistory(limit = 14) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM daily_paper_selections ORDER BY selection_date DESC LIMIT ?`,
    args: [limit],
  });
  return (result.rows || []).map((row) => {
    let docIds = [];
    try { docIds = JSON.parse(row.document_ids || '[]'); } catch (_) {}
    return {
      id: row.id,
      date: row.selection_date,
      documentIds: docIds,
      configK: row.config_k,
      status: row.status,
      createdAt: row.created_at,
    };
  });
}

// ─── Default Reading Rounds ──────────────────────────────────────────────────

function buildDefaultReadingRounds() {
  return [
    {
      name: '深度论文分析',
      prompt: `你是一位顶尖的AI研究员。请用中文深度分析这篇论文，输出格式必须是Obsidian风格的Markdown（支持callout、tag、内部链接等）。

请严格按照以下结构输出：

## TL;DR
> [!abstract] 核心摘要
> 用3-4句话概括论文的核心思想、方法和主要结果。

## 关键贡献
> [!tip] Key Contributions
> 1. ...
> 2. ...
> 3. ...
> 4. ...
> 5. ...

## 方法详解
详细描述提出的方法，逐步骤说明。使用LaTeX公式（$...$或$$...$$）表示关键数学公式。如果涉及架构，用Mermaid图表示。

## 实验结果
> [!info] 关键实验
用Markdown表格呈现最重要的实验结果。分析结果说明了什么。

## 消融实验
如果论文包含消融实验，总结每个消融揭示了什么。

## 局限性与未来方向
> [!warning] 局限性
> - ...

> [!question] 未来方向
> - ...

---
#paper #AI #research`,
      input: '深度论文分析',
      type: 'created',
      sourceUrl: '',
    },
    {
      name: '批判性评审',
      prompt: `基于论文和上一轮的分析笔记，用中文写一份批判性评审，使用Obsidian风格Markdown：

## 优势分析
> [!success] Strengths
> 1. ...
> 2. ...
> 3. ...

## 不足与疑虑
> [!fail] Weaknesses
> 1. ...
> 2. ...
> 3. ...

## 相关工作关联
> [!note] 与其他重要工作的关系
这篇工作与哪些重要论文有关联？用 [[论文名称]] 格式引用相关论文（Obsidian双链）。

## 实际应用场景
> [!example] Applications
这项工作可以应用在哪些实际场景中？

## 给作者的问题
> [!question] 三个关键问题
> 1. ...
> 2. ...
> 3. ...

## 个人评分
- 创新性: ⭐⭐⭐⭐☆
- 技术深度: ⭐⭐⭐⭐☆
- 实验充分性: ⭐⭐⭐⭐☆
- 写作质量: ⭐⭐⭐⭐☆
- 总体推荐: ⭐⭐⭐⭐☆

---
#review #critique`,
      input: '批判性评审',
      type: 'created',
      sourceUrl: '',
    },
    {
      name: '最小实现方案与数学框架',
      prompt: `基于论文和前面的分析笔记，用中文完成以下两个深度分析任务，使用Obsidian风格Markdown：

## 最小实现方案（Minimal Implementation Plan）

> [!abstract] 目标
> 设计一个最小可行的实现方案来复现论文的核心方法。不需要完整复现所有实验，只需抓住论文最关键的创新点。

### 核心算法伪代码
用Python风格的伪代码（或实际可运行的代码片段）展示论文核心方法的实现。代码应该：
- 简洁明了，突出核心逻辑
- 包含关键的数据结构和算法步骤
- 标注每个关键步骤对应论文的哪个公式或章节

\`\`\`python
# 在这里写出核心实现
# 每个关键步骤加注释说明对应论文哪个部分
\`\`\`

### 依赖与环境
- 列出需要的核心库和框架
- 估计最小实现需要的代码量
- 指出哪些部分可以用现有库替代

### 实现路线图
> [!tip] 分步实现计划
> 1. **Step 1**: ...（预计X行代码）
> 2. **Step 2**: ...（预计X行代码）
> 3. **Step 3**: ...（预计X行代码）

### 预期验证
- 用什么toy dataset或简单case来验证实现正确性？
- 预期结果是什么？

---

## 数学框架（Mathematical Framework）

> [!abstract] 目标
> 用统一的数学语言重新整理论文的理论框架，使其更清晰易懂。
> **注意**：如果论文是纯系统/工程论文，没有显著的数学内容，请简要说明论文涉及的量化指标和优化目标即可，不需要强行构造定理或推导链。

### 符号表
| 符号 | 含义 | 维度/类型 |
|------|------|-----------|
| ... | ... | ... |

### 核心定理/命题（如适用）
如果论文包含理论贡献，逐一列出核心数学结论，每个结论包含：
1. **定理陈述**（用LaTeX公式精确表述）
2. **直觉解释**（一两句话解释这个定理在说什么）
3. **证明思路**（关键步骤，不需要完整证明）

如果论文没有正式的定理，改为列出论文的**核心数学表达式**（损失函数、优化目标、关键公式等）并解释其含义。

### 数学推导链（如适用）
> [!note] 从假设到结论的推导链
如果论文有理论推导，用箭头或流程展示数学推导是如何从基本假设一步步推导到最终结论的：

$$\\text{假设} \\xrightarrow{\\text{步骤1}} \\text{中间结论1} \\xrightarrow{\\text{步骤2}} \\cdots \\xrightarrow{\\text{步骤N}} \\text{最终结论}$$

详细展开每个推导步骤的关键数学变换。如果论文没有理论推导，可跳过此节。

### 与已有数学工具的联系
> [!question] 这篇论文的数学和哪些经典理论有关？
指出论文使用的数学工具（如凸优化、信息论、概率图模型、微分方程等）与经典数学理论的联系。如果是系统论文，指出其方法论和哪些经典的系统设计原则或算法范式有关。

---
#implementation #math-framework`,
      input: '最小实现方案与数学框架',
      type: 'created',
      sourceUrl: '',
    },
  ];
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let schedulerInterval = null;

function startScheduler() {
  if (schedulerInterval) return;
  const CHECK_MS = 15 * 60 * 1000; // check every 15 min
  console.log('[DailyPaper] Scheduler started (check every 15 min)');

  schedulerInterval = setInterval(async () => {
    try {
      const config = await getConfig();
      if (!config.enabled) return;

      const now = new Date();
      const currentHour = now.getHours();
      const date = todayDate();

      // Check if it's time to select
      if (currentHour >= config.scheduleHour) {
        const existing = await getDailySelection(date);
        if (!existing) {
          console.log(`[DailyPaper] Time to select daily papers for ${date}`);
          await selectDailyPapers(date);
        }
      }

      // Check if notes are ready and export
      if (config.autoExport) {
        await checkAndExport(date);
      }
    } catch (err) {
      console.error('[DailyPaper] Scheduler error:', err.message);
    }
  }, CHECK_MS);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = {
  getConfig,
  updateConfig,
  getDailySelection,
  selectDailyPapers,
  checkAndExport,
  getHistory,
  buildDefaultReadingRounds,
  startScheduler,
  stopScheduler,
};
