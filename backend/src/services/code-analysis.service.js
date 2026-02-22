const { getDb } = require('../db');
const config = require('../config');
const geminiCliService = require('./gemini-cli.service');
const s3Service = require('./s3.service');
const processingProxyService = require('./processing-proxy.service');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { cleanLLMResponse } = require('../utils/clean-llm-response');

/**
 * Code Analysis Service
 *
 * Handles deep code analysis triggered by user.
 * Rate limited: 3 analyses per hour, rest queued.
 * Uses Gemini CLI with gemini-3-flash-preview model.
 * Performs 3-round analysis for comprehensive overview.
 */

const RATE_LIMIT_COUNT = 3;
const RATE_LIMIT_HOURS = 1; // 3 per hour
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per round

// Round 1: Overview and structure analysis
const ROUND_1_PROMPT = `你是一位专业的代码分析专家。请分析这个代码仓库的整体结构和概况。

请用中文输出，格式如下：

## 仓库概览

### 基本信息
- **语言/框架**: [主要编程语言和框架]
- **项目类型**: [如: 深度学习、数据处理、API服务等]
- **依赖管理**: [如: pip, npm, cargo等]
- **代码规模**: [文件数量、主要模块数]

### 目录结构说明
\`\`\`
[用文本形式画出关键目录树，最多3层]
例如:
project/
├── src/
│   ├── models/      # 模型定义
│   ├── data/        # 数据处理
│   └── utils/       # 工具函数
├── configs/         # 配置文件
└── scripts/         # 运行脚本
\`\`\`

### 关键文件列表
| 文件 | 用途 |
|------|------|
| [文件路径] | [简要说明] |

### 架构图 (文本)
\`\`\`
[用ASCII字符画出系统架构]
例如:
Input --> Encoder --> Transformer --> Decoder --> Output
              |                           |
              +---- Attention Mechanism ---+
\`\`\``;

// Round 2: Core implementation deep dive
const ROUND_2_PROMPT = `你是一位专业的代码分析专家。请深入分析这个代码仓库的核心实现。

请用中文输出，格式如下：

## 核心实现分析

### 入口文件
- **训练入口**: [文件路径] - [说明]
- **推理入口**: [文件路径] - [说明]
- **评估入口**: [文件路径] - [说明]

### 核心模块详解

#### 模块1: [名称]
- **位置**: [文件路径]
- **功能**: [详细说明]
- **关键类/函数**:
  - \`ClassName\`: [作用]
  - \`function_name()\`: [作用]

#### 模块2: [名称]
[同上格式]

### 算法实现

#### 核心算法流程
\`\`\`
[用文本流程图展示]
例如:
Step 1: 数据预处理
    |
    v
Step 2: 特征提取
    |
    v
Step 3: 模型计算
    |
    +---> 分支A: xxx
    |
    +---> 分支B: xxx
    |
    v
Step 4: 输出结果
\`\`\`

#### 关键代码片段
[展示最核心的代码实现，并加注释说明]

### 数据流
\`\`\`
[数据流向图，用ASCII表示]
Input Data --> Preprocessing --> Model --> Postprocessing --> Output
     |              |              |              |
  [格式说明]    [处理说明]    [计算说明]    [输出说明]
\`\`\``;

// Round 3: Reproducibility and practical guide
const ROUND_3_PROMPT = `你是一位专业的代码分析专家。请提供这个代码仓库的复现指南和实用信息。

请用中文输出，格式如下：

## 环境配置

### 系统要求
- **操作系统**: [推荐的OS]
- **Python版本**: [版本要求]
- **GPU要求**: [如有]
- **内存要求**: [如有]

### 安装步骤
\`\`\`bash
# 1. 克隆仓库
git clone [url]
cd [project]

# 2. 创建环境
[具体命令]

# 3. 安装依赖
[具体命令]

# 4. 其他配置
[如有]
\`\`\`

### 关键依赖说明
| 依赖包 | 版本 | 用途 |
|--------|------|------|
| [包名] | [版本] | [说明] |

## 复现指南

### 快速开始 (5分钟上手)
\`\`\`bash
[最简单的运行命令]
\`\`\`

### 完整训练流程
\`\`\`bash
# Step 1: 数据准备
[命令和说明]

# Step 2: 开始训练
[命令和说明]

# Step 3: 评估结果
[命令和说明]
\`\`\`

### 参数说明
| 参数 | 默认值 | 说明 |
|------|--------|------|
| [参数名] | [默认值] | [说明] |

## 常见问题 (FAQ)

### Q1: [常见问题]
**A**: [解决方案]

### Q2: [常见问题]
**A**: [解决方案]

## 代码评估

### 优点
- [优点1]
- [优点2]

### 可改进之处
- [建议1]
- [建议2]

### 与论文对应
| 论文章节 | 代码位置 | 说明 |
|----------|----------|------|
| [章节] | [文件:行号] | [对应说明] |`;

class CodeAnalysisService {
  constructor() {
    this.processingDir = config.reader?.tmpDir || path.join(__dirname, '..', '..', 'processing');
    this.isProcessing = false;
    this.processingInterval = null;
  }

  /**
   * Start the code analysis processor
   */
  startProcessor() {
    if (this.processingInterval) return;

    // Check queue every minute
    this.processingInterval = setInterval(() => {
      this.processNextInQueue();
    }, 60 * 1000);

    console.log('[CodeAnalysis] Processor started');
  }

  /**
   * Stop the code analysis processor
   */
  stopProcessor() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Check if we can process more analyses (rate limiting)
   * @returns {Promise<{canProcess: boolean, remaining: number, nextAvailable: Date|null}>}
   */
  async checkRateLimit() {
    const db = getDb();
    const sixHoursAgo = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

    const result = await db.execute({
      sql: `SELECT COUNT(*) as count FROM code_analysis_history
            WHERE started_at > ? AND status IN ('completed', 'processing')`,
      args: [sixHoursAgo]
    });

    const count = result.rows[0].count;
    const remaining = Math.max(0, RATE_LIMIT_COUNT - count);
    const canProcess = remaining > 0;

    // Find when next slot becomes available
    let nextAvailable = null;
    if (!canProcess) {
      const oldestResult = await db.execute({
        sql: `SELECT started_at FROM code_analysis_history
              WHERE started_at > ? AND status IN ('completed', 'processing')
              ORDER BY started_at ASC LIMIT 1`,
        args: [sixHoursAgo]
      });

      if (oldestResult.rows.length > 0) {
        const oldestTime = new Date(oldestResult.rows[0].started_at);
        nextAvailable = new Date(oldestTime.getTime() + RATE_LIMIT_HOURS * 60 * 60 * 1000);
      }
    }

    return { canProcess, remaining, nextAvailable };
  }

  /**
   * Add a document to the code analysis queue
   * @param {number} documentId
   * @returns {Promise<{success: boolean, position: number|null, message: string}>}
   */
  async queueAnalysis(documentId) {
    const db = getDb();

    // Check if document exists and has code
    const doc = await db.execute({
      sql: `SELECT id, title, code_url, has_code FROM documents WHERE id = ?`,
      args: [documentId]
    });

    if (doc.rows.length === 0) {
      return { success: false, position: null, message: 'Document not found' };
    }

    const document = doc.rows[0];
    if (!document.has_code || !document.code_url) {
      return { success: false, position: null, message: 'Document has no code URL' };
    }

    // Check if already in queue or completed
    const existing = await db.execute({
      sql: `SELECT status FROM code_analysis_queue WHERE document_id = ?`,
      args: [documentId]
    });

    if (existing.rows.length > 0) {
      const status = existing.rows[0].status;
      if (status === 'processing') {
        return { success: false, position: 0, message: 'Analysis is already in progress' };
      }
      if (status === 'completed') {
        return { success: false, position: null, message: 'Analysis already completed' };
      }
      // If pending or failed, update the entry
      await db.execute({
        sql: `UPDATE code_analysis_queue SET status = 'pending', scheduled_at = CURRENT_TIMESTAMP, error_message = NULL WHERE document_id = ?`,
        args: [documentId]
      });
    } else {
      // Insert new queue entry
      await db.execute({
        sql: `INSERT INTO code_analysis_queue (document_id, status) VALUES (?, 'pending')`,
        args: [documentId]
      });
    }

    // Update document status
    await db.execute({
      sql: `UPDATE documents SET code_analysis_status = 'queued' WHERE id = ?`,
      args: [documentId]
    });

    // Get queue position
    const position = await this.getQueuePosition(documentId);

    // Try to process immediately if possible
    this.processNextInQueue();

    return { success: true, position, message: 'Added to analysis queue' };
  }

  /**
   * Get queue position for a document
   * @param {number} documentId
   * @returns {Promise<number>}
   */
  async getQueuePosition(documentId) {
    const db = getDb();

    const result = await db.execute({
      sql: `SELECT COUNT(*) as position FROM code_analysis_queue
            WHERE status = 'pending'
            AND scheduled_at <= (SELECT scheduled_at FROM code_analysis_queue WHERE document_id = ?)`,
      args: [documentId]
    });

    return result.rows[0].position || 0;
  }

  /**
   * Get queue status
   * @returns {Promise<object>}
   */
  async getQueueStatus() {
    const db = getDb();
    const rateLimit = await this.checkRateLimit();

    const pending = await db.execute(`SELECT COUNT(*) as count FROM code_analysis_queue WHERE status = 'pending'`);
    const processing = await db.execute(`SELECT COUNT(*) as count FROM code_analysis_queue WHERE status = 'processing'`);

    const queue = await db.execute(`
      SELECT caq.document_id, caq.status, caq.scheduled_at, d.title
      FROM code_analysis_queue caq
      JOIN documents d ON d.id = caq.document_id
      WHERE caq.status IN ('pending', 'processing')
      ORDER BY caq.status DESC, caq.scheduled_at ASC
      LIMIT 10
    `);

    return {
      rateLimit: {
        limit: RATE_LIMIT_COUNT,
        remaining: rateLimit.remaining,
        resetHours: RATE_LIMIT_HOURS,
        nextAvailable: rateLimit.nextAvailable,
      },
      queue: {
        pending: pending.rows[0].count,
        processing: processing.rows[0].count,
        items: queue.rows,
      }
    };
  }

  /**
   * Process the next item in queue (if rate limit allows)
   */
  async processNextInQueue() {
    if (this.isProcessing) {
      console.log('[CodeAnalysis] Already processing, skipping');
      return;
    }

    const rateLimit = await this.checkRateLimit();
    if (!rateLimit.canProcess) {
      console.log(`[CodeAnalysis] Rate limit reached. Next available: ${rateLimit.nextAvailable}`);
      return;
    }

    const db = getDb();

    // Get next pending item
    const next = await db.execute(`
      SELECT caq.id, caq.document_id, d.title, d.code_url
      FROM code_analysis_queue caq
      JOIN documents d ON d.id = caq.document_id
      WHERE caq.status = 'pending'
      ORDER BY caq.priority DESC, caq.scheduled_at ASC
      LIMIT 1
    `);

    if (next.rows.length === 0) {
      return;
    }

    const item = next.rows[0];
    this.isProcessing = true;

    console.log(`[CodeAnalysis] Processing: ${item.title} (${item.code_url})`);

    try {
      // Update queue status
      await db.execute({
        sql: `UPDATE code_analysis_queue SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [item.id]
      });

      // Update document status
      await db.execute({
        sql: `UPDATE documents SET code_analysis_status = 'processing' WHERE id = ?`,
        args: [item.document_id]
      });

      // Record in history
      const historyResult = await db.execute({
        sql: `INSERT INTO code_analysis_history (document_id, status, started_at) VALUES (?, 'processing', CURRENT_TIMESTAMP)`,
        args: [item.document_id]
      });
      const historyId = historyResult.lastInsertRowid;

      // Perform analysis
      const startTime = Date.now();
      const result = await this.performAnalysis(item.document_id, item.code_url, item.title);
      const duration = Date.now() - startTime;

      // Update queue status
      await db.execute({
        sql: `UPDATE code_analysis_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [item.id]
      });

      // Update document
      await db.execute({
        sql: `UPDATE documents SET code_analysis_status = 'completed', code_notes_s3_key = ? WHERE id = ?`,
        args: [result.s3Key, item.document_id]
      });

      // Update history
      await db.execute({
        sql: `UPDATE code_analysis_history SET status = 'completed', completed_at = CURRENT_TIMESTAMP, duration_ms = ? WHERE id = ?`,
        args: [duration, historyId]
      });

      console.log(`[CodeAnalysis] Completed: ${item.title} (${duration}ms)`);

    } catch (error) {
      console.error(`[CodeAnalysis] Failed: ${item.title}`, error.message);

      // Update queue status
      await db.execute({
        sql: `UPDATE code_analysis_queue SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [error.message, item.id]
      });

      // Update document status
      await db.execute({
        sql: `UPDATE documents SET code_analysis_status = 'failed' WHERE id = ?`,
        args: [item.document_id]
      });

      // Update history
      await db.execute({
        sql: `UPDATE code_analysis_history SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE document_id = ? AND status = 'processing'`,
        args: [error.message, item.document_id]
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Perform the actual code analysis (3 rounds)
   * @param {number} documentId
   * @param {string} codeUrl
   * @param {string} title
   * @returns {Promise<{s3Key: string, notes: string}>}
   */
  async performAnalysis(documentId, codeUrl, title) {
    // Check if desktop processing is available
    const desktopAvailable = await processingProxyService.isDesktopAvailable();

    if (desktopAvailable) {
      console.log(`[CodeAnalysis] Forwarding to desktop: ${title}`);
      try {
        return await processingProxyService.analyzeCode(documentId, codeUrl, title);
      } catch (error) {
        console.error('[CodeAnalysis] Desktop processing failed, falling back to local:', error.message);
        // Continue to local processing
      }
    }

    console.log(`[CodeAnalysis] Processing locally: ${title}`);

    const repoDir = path.join(this.processingDir, `code_${documentId}`);
    const notesPath = path.join(this.processingDir, `${documentId}_code_analysis.md`);

    try {
      // Ensure processing directory exists
      await fs.mkdir(this.processingDir, { recursive: true });

      // Clone repository
      console.log(`[CodeAnalysis] Cloning: ${codeUrl}`);
      await this.cloneRepository(codeUrl, repoDir);

      // Run 3 rounds of analysis
      const rounds = [
        { name: 'Round 1: Overview', prompt: ROUND_1_PROMPT },
        { name: 'Round 2: Core Implementation', prompt: ROUND_2_PROMPT },
        { name: 'Round 3: Reproducibility', prompt: ROUND_3_PROMPT },
      ];

      const results = [];
      for (let i = 0; i < rounds.length; i++) {
        const round = rounds[i];
        console.log(`[CodeAnalysis] ${round.name} (${i + 1}/${rounds.length})...`);

        try {
          const result = await geminiCliService.analyzeRepository(repoDir, round.prompt, {
            timeout: PROCESSING_TIMEOUT_MS,
            model: 'gemini-3-flash-preview',
          });
          results.push({ round: round.name, content: cleanLLMResponse(result.text) });
          console.log(`[CodeAnalysis] ${round.name} completed (${result.text.length} chars)`);
        } catch (error) {
          console.error(`[CodeAnalysis] ${round.name} failed:`, error.message);
          results.push({ round: round.name, content: `*分析失败: ${error.message}*` });
        }
      }

      // Build final notes combining all rounds
      const now = new Date();
      const notes = `---
title: ${title} - 代码深度分析
document_id: ${documentId}
code_url: ${codeUrl}
generated_at: ${now.toISOString()}
analysis_type: deep_3_rounds
model: gemini-3-flash-preview
---

# ${title} - 代码深度分析

**仓库地址**: [${codeUrl}](${codeUrl})

**分析时间**: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

---

${results.map(r => r.content).join('\n\n---\n\n')}
`;

      // Upload to S3
      const timestamp = Date.now();
      const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      const s3Key = `default_user/notes/${timestamp}-${documentId}-${sanitizedTitle}_code_analysis.md`;

      const buffer = Buffer.from(notes, 'utf-8');
      await s3Service.uploadBuffer(buffer, s3Key, 'text/markdown');

      return { s3Key, notes };

    } finally {
      // Cleanup
      try {
        await fs.rm(repoDir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }
      try {
        await fs.unlink(notesPath);
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * Clone a repository (skip LFS)
   */
  async cloneRepository(url, targetDir) {
    // Remove existing directory if exists
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }

    return new Promise((resolve, reject) => {
      const proc = spawn('git', [
        'clone',
        '--depth', '1',
        '--single-branch',
        url,
        targetDir,
      ], {
        env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
        timeout: 60000, // 1 minute timeout for clone
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get repository structure using tree command
   */
  async getRepoStructure(repoDir) {
    return new Promise((resolve) => {
      const treeProc = spawn('tree', ['-L', '3', '--noreport'], {
        cwd: repoDir,
      });

      let treeOutput = '';
      let treeError = false;

      treeProc.stdout.on('data', (data) => {
        treeOutput += data.toString();
      });

      treeProc.on('error', () => {
        treeError = true;
      });

      treeProc.on('close', (code) => {
        if (code === 0 && !treeError && treeOutput) {
          resolve(treeOutput.substring(0, 5000));
          return;
        }

        // Fallback to find
        const proc = spawn('find', ['.', '-type', 'f', '(',
          '-name', '*.py', '-o',
          '-name', '*.js', '-o',
          '-name', '*.ts', '-o',
          '-name', '*.json', '-o',
          '-name', '*.yaml', '-o',
          '-name', '*.yml', '-o',
          '-name', '*.md', '-o',
          '-name', 'requirements*.txt',
          ')', '-not', '-path', '*/.*'], {
          cwd: repoDir,
        });

        let output = '';
        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', () => {
          const files = output.trim().split('\n').slice(0, 100);
          resolve(files.join('\n'));
        });

        proc.on('error', () => {
          resolve('Could not read repository structure');
        });
      });
    });
  }

  /**
   * Get analysis status for a document
   * @param {number} documentId
   * @returns {Promise<object>}
   */
  async getAnalysisStatus(documentId) {
    const db = getDb();

    const queueResult = await db.execute({
      sql: `SELECT status, scheduled_at, started_at, completed_at, error_message
            FROM code_analysis_queue WHERE document_id = ?`,
      args: [documentId]
    });

    if (queueResult.rows.length === 0) {
      return { status: 'not_queued', position: null };
    }

    const queue = queueResult.rows[0];
    const position = queue.status === 'pending' ? await this.getQueuePosition(documentId) : null;

    return {
      status: queue.status,
      position,
      scheduledAt: queue.scheduled_at,
      startedAt: queue.started_at,
      completedAt: queue.completed_at,
      error: queue.error_message,
    };
  }
}

module.exports = new CodeAnalysisService();
