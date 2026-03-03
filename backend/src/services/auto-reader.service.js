const { getDb } = require('../db');
const config = require('../config');
const pdfService = require('./pdf.service');
const geminiCliService = require('./gemini-cli.service');
const codexCliService = require('./codex-cli.service');
const googleApiService = require('./google-api.service');
const claudeCodeService = require('./claude-code.service');
const s3Service = require('./s3.service');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { cleanLLMResponse } = require('../utils/clean-llm-response');

/**
 * Auto Reader Service - Multi-pass deep reading mode
 *
 * Based on docs/skill.md and docs/note_templates.md
 *
 * Paper Reading (3 passes):
 * 1. 鸟瞰扫描: Basic info, filter pages, 5C evaluation
 * 2. 内容理解: Method overview, experiments, key figures
 * 3. 深度理解: Math framework, method details, generate figures
 *
 * Code Analysis (if has code, 3 rounds):
 * 1. 仓库概览: Structure, entry points, dependencies
 * 2. 数据接口: Data format, data flow, config system
 * 3. 核心实现: Key methods, implementation details, reproduce guide
 */

// ============== TEXT FIGURE RULES ==============
const TEXT_FIGURE_RULES = `
## 图表绘制规则（必须严格遵守）

**禁止使用Mermaid**。所有图表必须使用纯文本/ASCII字符画，放在 \`\`\` 代码块中。

绘制规则：
1. 使用 Unicode box-drawing 字符：┌ ┐ └ ┘ │ ─ ├ ┤ ┬ ┴ ┼ ▶ ▼ ◀ ▲
2. 用箭头表示数据流：────▶  ····▶（虚线）  ════▶（粗线）
3. 用方框表示模块：┌──────┐ │ 模块 │ └──────┘
4. 可以使用中文标签
5. 保持对齐和美观
6. 图表宽度不超过80字符

示例：
\`\`\`
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Input   │────▶│ Process  │────▶│  Output  │
└──────────┘     └────┬─────┘     └──────────┘
                      │
                      ▼
                ┌──────────┐
                │ Side Eff │
                └──────────┘
\`\`\`
`;

// ============== PROMPTS FOR PAPER READING ==============

const PAPER_PASS_1_PROMPT = `你是一位专业的学术论文阅读助手。这是第一轮阅读（快速概览）。

## 任务
1. 读取标题、摘要、引言
2. 扫描章节标题（不读内容）
3. 读结论
4. 扫描参考文献

## 输出要求
- 只输出JSON代码块，不要包含任何开场白或说明性文字
- 不要说"我已完成..."之类的话
- summary 字段用中文撰写，200-300字，概括论文的问题、方法、核心结果

请直接按以下JSON格式输出：

\`\`\`json
{
  "title": "论文完整标题",
  "paper_type": "实证/理论/系统/综述",
  "venue": "发表venue（如果能识别）",
  "has_code": true/false,
  "code_url": "https://github.com/... 或 null",
  "core_contribution": "用1-2句话概括核心贡献",
  "summary": "200-300字的中文摘要，涵盖论文要解决的问题、采用的方法、主要实验结果和关键结论",
  "key_pages": "如 p3-5方法, p6-8实验",
  "skip_pages": "如 p9-10附录, p2相关工作详细",
  "key_figures": [1, 3, 5]
}
\`\`\``;

const PAPER_PASS_2_PROMPT = `你是一位专业的学术论文阅读助手。这是第二轮阅读（内容理解）。

## 背景信息
第一轮笔记：
{previous_notes}

## 任务
聚焦阅读第一轮标记的关键页面，把握论文内容但不深入细节。

## 输出要求
- 直接输出Markdown内容，不要包含任何开场白或说明性文字
- 不要使用<details>或<summary>标签
- 不要说"我已完成..."之类的话
- **重要**: 必须为论文中的关键图表绘制可视化图，帮助读者理解

${TEXT_FIGURE_RULES}

请直接输出以下Markdown格式：

### 核心问题
[论文要解决什么问题？为什么这个问题重要？]

### 方法概述
[用自己的话描述方法，不超过一段]

### 关键图表复现

对于论文中每个重要的图表，请按以下格式输出其可视化复现：

**Figure X: [图标题]**

[这个图说明了什么，1-2句话]

使用ASCII字符画复现流程图/架构图：
\`\`\`
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Input   │────▶│ Process  │────▶│  Output  │
└──────────┘     └──────────┘     └──────────┘
\`\`\`

**Table Y: [表标题]**

[这个表的关键发现]

使用Markdown表格复现关键数据：
| Method | Metric1 | Metric2 | Metric3 |
|--------|---------|---------|---------|
| Baseline | 32.1 | 45.2 | 38.5 |
| **Ours** | **45.3** | **58.7** | **51.2** |

### 方法流程图

使用ASCII字符画绘制论文核心方法的流程：

\`\`\`
┌──────────┐
│ Raw Input│
└────┬─────┘
     ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│  Step 1  │────▶│  Step 2  │────▶│  Step 3  │
└──────────┘     └──────────┘     └────┬─────┘
                                       ▼
                                 ┌──────────┐
                                 │  Output  │
                                 └──────────┘
\`\`\`

### 实验设置
- **数据集**: [名称和规模]
- **基线方法**: [对比方法列表]
- **评估指标**: [指标及其含义]

### 主要结果
[结果总结，关键数字，最好用表格呈现]

### 存疑点
- [ ] [不理解的点1]
- [ ] [不理解的点2]

### 待追读文献
- [ ] [重要参考文献1] - [为什么重要]
- [ ] [重要参考文献2] - [为什么重要]`;

const PAPER_PASS_3_PROMPT = `你是一位专业的学术论文阅读助手。这是第三轮阅读（深度理解）。

## 背景信息
之前的笔记：
{previous_notes}

## 任务
深入方法细节，构建数学框架，绘制详细的系统图。

## 输出要求
- 直接输出Markdown内容，不要包含任何开场白或说明性文字
- 不要使用<details>或<summary>标签
- 不要说"我已完成..."之类的话
- 数学公式使用 $...$ 或 $$...$$ 格式
- **重要**: 必须绘制多个详细的架构图来帮助读者理解论文

${TEXT_FIGURE_RULES}

请直接输出以下Markdown格式：

---

## 深度解析

### 数学框架

**问题形式化**

设输入空间 $\\mathcal{X}$，输出空间 $\\mathcal{Y}$，目标是学习映射...
[具体问题定义]

**关键公式**

$$
[核心公式，使用 LaTeX 格式]
$$

公式解读：[逐项解释公式中的符号含义]

### 系统架构总览

使用ASCII字符画绘制论文的整体系统架构：

\`\`\`
┌─────────────────────────────────────────────────┐
│                  System Overview                 │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐                                    │
│  │  Input   │                                    │
│  └────┬─────┘                                    │
│       ▼                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Module 1 │─▶│ Module 2 │─▶│ Module 3 │       │
│  └──────────┘  └──────────┘  └────┬─────┘       │
│       :                           ▼              │
│       ·····················▶┌──────────┐         │
│                             │  Output  │         │
│                             └──────────┘         │
└─────────────────────────────────────────────────┘
\`\`\`

### 核心算法流程

使用ASCII字符画绘制核心算法的详细步骤：

\`\`\`
  ┌─────────┐
  │  Start  │
  └────┬────┘
       ▼
  ┌──────────────┐
  │ Step 1: Desc │
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │ Step 2: Desc │
  └──────┬───────┘
         ▼
    ┌─────────┐
    │Condition│
    └──┬───┬──┘
   Yes │   │ No
       ▼   ▼
  ┌──────┐ ┌──────┐
  │Brch A│ │Brch B│
  └──┬───┘ └──┬───┘
     └────┬───┘
          ▼
     ┌─────────┐
     │  Merge  │
     └────┬────┘
          ▼
     ┌─────────┐
     │   End   │
     └─────────┘
\`\`\`

### 数据流图

展示数据在系统中的流动过程：

\`\`\`
[ Data Preprocessing ]          [ Model Processing ]          [ Post-processing ]
┌──────┐  ┌────────┐  ┌────────┐  ┌─────────┐  ┌────────┐  ┌─────────┐  ┌────────┐
│ Raw  │─▶│ Clean  │─▶│Feature │─▶│ Encoder │─▶│  Core  │─▶│ Decoder │─▶│ Output │
│ Data │  │        │  │Extract │  │         │  │Compute │  │         │  │        │
└──────┘  └────────┘  └────────┘  └─────────┘  └────────┘  └─────────┘  └────────┘
\`\`\`

### 方法深度解析

[详细方法描述，每个组件的作用，关键设计选择]

### 创新点分析

1. **[创新点1]**: [意义和价值]
2. **[创新点2]**: [意义和价值]

### 局限性与假设

- **隐含假设**: [论文未明说但必须成立的假设]
- **适用范围**: [方法在什么条件下有效]
- **潜在问题**: [可能的失效场景]

### 相关工作对比

- **[相关工作1]**: [区别和联系]
- **[相关工作2]**: [区别和联系]

### 未来工作想法

1. [想法1]
2. [想法2]

### 核心流程总结

用一段文字描述论文的核心流程：从输入到输出，经过哪些关键步骤，每步做什么。`;

// ============== V3 PROMPTS: 2-PASS DEEP ANALYSIS ==============

const V3_PASS_1_PROMPT = `你是一位资深的学术论文分析专家。这是第一轮分析（表层分析）。

## 任务
仔细阅读论文，完成以下分析：

1. **任务定义**：这篇论文解决什么问题/任务？
2. **领域现状**：这个问题所在领域的发展状况如何？简述相关工作
3. **输入定义**：这个任务的输入是什么？格式、维度、语义
4. **输出定义**：这个任务的输出是什么？格式、维度、语义
5. **方法概览**：用一张文本图描述论文的整体方法流程

## 输出要求
- 直接输出Markdown内容，不要包含任何开场白或说明性文字
- 不要说"我已完成..."之类的话
- 使用中文输出

${TEXT_FIGURE_RULES}

请直接按以下格式输出：

## 任务定义

**核心问题**：[一句话描述论文要解决的核心问题]

**问题背景**：
[2-3句话解释为什么这个问题重要，有什么实际应用场景]

**形式化定义**：
- 给定：[输入的形式化描述]
- 目标：[需要学习/优化的目标]
- 约束：[如果有的话]

## 领域现状

**发展阶段**：[萌芽期/成长期/成熟期/变革期]

**主流方法派系**：
1. **[派系1名称]**：[核心思想]，代表作：[论文名]
2. **[派系2名称]**：[核心思想]，代表作：[论文名]
3. **[派系3名称]**：[核心思想]，代表作：[论文名]

**当前瓶颈**：
- [瓶颈1]
- [瓶颈2]

**本文定位**：[本文属于哪个派系，或开创了什么新方向]

## 输入规格

**数据类型**：[文本/图像/表格/多模态/...]

**形式化表示**：
\`\`\`
输入 X ∈ [维度描述]
- 字段1: [类型] - [语义说明]
- 字段2: [类型] - [语义说明]
\`\`\`

**示例**：
\`\`\`
[一个具体的输入示例]
\`\`\`

## 输出规格

**输出类型**：[分类/回归/生成/检索/...]

**形式化表示**：
\`\`\`
输出 Y ∈ [维度描述]
- 字段1: [类型] - [语义说明]
\`\`\`

**示例**：
\`\`\`
[对应输入的输出示例]
\`\`\`

## 方法概览图

\`\`\`
┌─────────────────────────────────────────────────────────────────┐
│                        [论文方法名称]                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Input]                                                         │
│     │                                                            │
│     ▼                                                            │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                 │
│  │ Stage 1  │────▶│ Stage 2  │────▶│ Stage 3  │                 │
│  │ [描述]   │     │ [描述]   │     │ [描述]   │                 │
│  └──────────┘     └──────────┘     └──────────┘                 │
│                         │                │                       │
│                         ▼                ▼                       │
│                   ┌──────────┐     ┌──────────┐                 │
│                   │ [辅助]   │     │ [Output] │                 │
│                   └──────────┘     └──────────┘                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
\`\`\`

**流程说明**：
1. **[阶段1]**：[做什么，为什么]
2. **[阶段2]**：[做什么，为什么]
3. **[阶段3]**：[做什么，为什么]

## 关键技术点

- **[技术点1]**：[一句话解释]
- **[技术点2]**：[一句话解释]
- **[技术点3]**：[一句话解释]`;

const V3_PASS_2_PROMPT = `你是一位资深的学术论文分析专家和算法工程师。这是第二轮分析（深层分析）。

## 背景信息
第一轮分析结果：
{previous_notes}

## 任务
基于第一轮的表层分析，进行更深入的分析：

1. **最小复现**：设计一个简化版的代码实现，展示论文核心方法
2. **数学框架**：用第一性原理思考这个问题的数学本质
3. **批判性分析**：找出论文的潜在问题和局限
4. **未来方向**：基于你的分析，提出可能的改进方向

## 输出要求
- 直接输出Markdown内容，不要包含任何开场白或说明性文字
- 代码使用 Python，追求简洁可运行
- 使用中文输出
- 数学公式使用 $...$ 或 $$...$$ 格式

请直接按以下格式输出：

---

## 最小复现实现

### 设计思路

[用2-3句话解释你的简化策略：保留了什么核心，省略了什么细节]

### 模拟数据

\`\`\`python
import numpy as np
import torch
import torch.nn as nn

# 模拟输入数据
def generate_mock_data(batch_size=4):
    """
    生成模拟数据，符合论文输入格式
    """
    # [根据论文输入规格设计]
    return {
        'input_field1': ...,
        'input_field2': ...,
    }

# 示例
mock_data = generate_mock_data()
print("Input shape:", ...)
\`\`\`

### 核心方法实现

\`\`\`python
class SimplifiedMethod(nn.Module):
    """
    [论文方法名] 的简化实现

    简化点：
    - [省略了什么]
    - [简化了什么]

    保留点：
    - [保留的核心机制1]
    - [保留的核心机制2]
    """

    def __init__(self, ...):
        super().__init__()
        # [核心组件初始化]

    def forward(self, x):
        # Step 1: [阶段1名称]
        # [实现]

        # Step 2: [阶段2名称]
        # [实现]

        return output

# 运行示例
model = SimplifiedMethod(...)
output = model(mock_data)
print("Output shape:", output.shape)
\`\`\`

### 完整运行脚本

\`\`\`python
# 完整的可运行脚本
if __name__ == "__main__":
    # 1. 准备数据
    data = generate_mock_data(batch_size=4)

    # 2. 初始化模型
    model = SimplifiedMethod(...)

    # 3. 前向传播
    output = model(data)

    # 4. 验证输出
    print(f"Input: {data}")
    print(f"Output: {output}")
    print(f"Output shape: {output.shape}")
\`\`\`

---

## 数学框架分析

### 问题的数学本质

**抽象形式化**：

$$
[用最抽象的数学语言描述这个问题]
$$

其中：
- $[符号1]$：[含义]
- $[符号2]$：[含义]

### 优化目标分解

**论文的损失函数**：

$$
\\mathcal{L} = [论文的损失函数]
$$

**分解分析**：
- **项1** $[L_1]$：[作用] - [优化什么]
- **项2** $[L_2]$：[作用] - [优化什么]

### 本文在框架中的位置

\`\`\`
                    [问题空间的维度划分]

        维度1：[某个技术选择维度]
        ─────────────────────────────────────────▶
        │
        │   ┌───────┐       ┌───────┐
        │   │ 方法A │       │ 方法B │
        │   └───────┘       └───────┘
维度2   │              ┌─────────┐
[某个   │              │ 本文方法 │ ★
技术    │              └─────────┘
选择]   │
        │       ┌───────┐
        │       │ 方法C │
        ▼       └───────┘
\`\`\`

**定位分析**：
- 本文在 [维度1] 上选择了 [选项]，因为 [原因]
- 本文在 [维度2] 上选择了 [选项]，因为 [原因]

---

## 批判性分析

### 从第一性原理看问题

**这个问题的本质是什么？**
[用一段话从最基本的原理出发分析这个问题]

**论文的假设是否合理？**
1. **假设1**：[论文隐含的假设] - [是否合理，为什么]
2. **假设2**：[论文隐含的假设] - [是否合理，为什么]

### 潜在问题

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| [问题1] | 🔴/🟡/🟢 | [具体说明] |
| [问题2] | 🔴/🟡/🟢 | [具体说明] |
| [问题3] | 🔴/🟡/🟢 | [具体说明] |

### 实验设计的局限

- **数据集偏差**：[如果有]
- **评估指标盲区**：[如果有]
- **对比方法选择**：[如果有]

---

## 未来方向

### 短期改进（工程层面）

1. **[改进1标题]**
   - 现状：[当前问题]
   - 方案：[改进方法]
   - 预期：[预期效果]

2. **[改进2标题]**
   - 现状：[当前问题]
   - 方案：[改进方法]
   - 预期：[预期效果]

### 长期方向（研究层面）

1. **[方向1]**：[为什么重要，大致思路]
2. **[方向2]**：[为什么重要，大致思路]

### 跨领域启发

- **可借鉴到 [领域1]**：[如何借鉴]
- **可借鉴到 [领域2]**：[如何借鉴]

---

## 一句话总结

> [用一句话概括这篇论文的核心贡献和你的评价]`;

// ============== PROMPT FOR CODE ANALYSIS (SINGLE ROUND) ==============

const CODE_ANALYSIS_PROMPT = `You are a code analysis assistant. Analyze the repository content provided below.

IMPORTANT RULES:
- DO NOT use any tools or function calls
- DO NOT try to read additional files
- ONLY analyze the content already provided in this prompt
- Respond in Chinese
- Keep your response under 500 words

Based on the file contents provided below, output your analysis in this format:

## 基本信息
- 语言/框架: [from README or code files]
- 入口文件: [main entry point]
- 核心目录: [key directories]

## 运行命令
- 安装: [installation command]
- 训练: [training command if ML project]

## 核心模型
- 模型类: [main model class and file]
- 关键实现: [1-2 key technical points]

## 复现注意
- [1-2 important notes for reproduction]`;

class AutoReaderService {
  constructor() {
    this.processingDir = config.reader?.tmpDir || path.join(__dirname, '..', '..', 'processing');
    this._currentOptions = {};
    this.ensureProcessingDir();
  }

  async ensureProcessingDir() {
    try {
      await fs.mkdir(this.processingDir, { recursive: true });
    } catch (e) {
      // Directory exists or cannot be created
    }
  }

  /**
   * Process a document in auto_reader mode (multi-pass)
   */
  async processDocument(item, options = {}) {
    const { documentId, s3Key, title, analysisProvider } = item;
    // Use provided codeUrl if available (from request or document)
    let providedCodeUrl = item.codeUrl;
    let tempFilePath = null;
    const notesFilePath = path.join(this.processingDir, `${documentId}_notes.md`);
    // Resolve which provider service to use
    this._currentProvider = this._resolveProvider(analysisProvider);
    this._currentOptions = { model: item.analysisModel || null, thinkingBudget: item.thinkingBudget || 0 };

    try {
      await this.ensureProcessingDir();
      console.log(`[AutoReader] Starting multi-pass processing: ${title} (ID: ${documentId})`);

      // Step 1: Prepare PDF
      const pdfInfo = await pdfService.preparePdfForProcessing(s3Key);
      tempFilePath = pdfInfo.filePath;

      console.log(`[AutoReader] PDF prepared: ${pdfInfo.pageCount} pages`);

      // Initialize notes file with template header
      await this.initNotesFile(notesFilePath, title, documentId);

      // Step 2: Pass 1 - 鸟瞰扫描
      console.log('[AutoReader] === 第一轮：鸟瞰扫描 ===');
      const pass1Result = await this.executePass(tempFilePath, PAPER_PASS_1_PROMPT, notesFilePath, 1);

      // Parse pass 1 result and format according to template
      const pass1Data = this.parsePass1Result(pass1Result.text);
      await this.appendPass1Notes(notesFilePath, pass1Data, pass1Result.text);

      // Use detected code URL or provided one
      let hasCode = pass1Data.has_code || !!providedCodeUrl;
      let codeUrl = pass1Data.code_url || providedCodeUrl;

      // Step 3: Pass 2 - 内容理解
      console.log('[AutoReader] === 第二轮：内容理解 ===');
      const currentNotes = await fs.readFile(notesFilePath, 'utf-8');
      const pass2Prompt = PAPER_PASS_2_PROMPT.replace('{previous_notes}', currentNotes);
      const pass2Result = await this.executePass(tempFilePath, pass2Prompt, notesFilePath, 2);
      await this.appendToNotesFile(notesFilePath, '\n\n---\n\n## 第二轮笔记\n\n' + cleanLLMResponse(pass2Result.text));

      // Step 4: Pass 3 - 深度理解
      console.log('[AutoReader] === 第三轮：深度理解 ===');
      const updatedNotes = await fs.readFile(notesFilePath, 'utf-8');
      const pass3Prompt = PAPER_PASS_3_PROMPT.replace('{previous_notes}', updatedNotes);
      const pass3Result = await this.executePass(tempFilePath, pass3Prompt, notesFilePath, 3);
      await this.appendToNotesFile(notesFilePath, '\n\n' + cleanLLMResponse(pass3Result.text));

      // Step 5: Generate final paper notes
      let finalNotes = await fs.readFile(notesFilePath, 'utf-8');

      // Step 8: If has code, fetch README and summarize it (non-fatal)
      if (hasCode && codeUrl) {
        console.log(`[AutoReader] === 获取并摘要代码README: ${codeUrl} ===`);
        try {
          const codeReadme = await this.fetchGitHubReadme(codeUrl);
          if (codeReadme) {
            // Summarize README using Gemini CLI
            const readmeSummary = await this.summarizeReadme(codeReadme, codeUrl, title);
            if (readmeSummary) {
              finalNotes += '\n\n---\n\n## 代码仓库概览\n\n';
              finalNotes += `**仓库地址**: [${codeUrl}](${codeUrl})\n\n`;
              finalNotes += readmeSummary;
              finalNotes += '\n\n*点击"代码分析"按钮获取详细的代码解读*\n';
            }
          }
        } catch (readmeError) {
          console.log(`[AutoReader] README processing failed (non-fatal):`, readmeError.message);
        }
      }

      // Step 6: Upload paper notes to S3
      const paperNotesS3Key = await this.uploadNotesToS3(finalNotes, documentId, title, 'paper_notes');
      console.log(`[AutoReader] Paper notes uploaded to S3: ${paperNotesS3Key}`);
      console.log(`[AutoReader] Processing complete for: ${title}`);

      return {
        notesS3Key: paperNotesS3Key,
        codeNotesS3Key: null,  // Code notes only available via manual trigger
        pageCount: pdfInfo.pageCount,
        hasCode,
        codeUrl,
        readerMode: 'auto_reader',
      };
    } finally {
      // Cleanup
      if (tempFilePath) {
        await pdfService.cleanupTmpFile(tempFilePath);
      }
      try {
        await fs.unlink(notesFilePath);
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * Process document in v2 mode: same 3-pass reading with text figures (no mermaid)
   */
  async processDocumentV2(item, options = {}) {
    const { documentId, s3Key, title, analysisProvider } = item;
    let providedCodeUrl = item.codeUrl;
    let tempFilePath = null;
    const notesFilePath = path.join(this.processingDir, `${documentId}_notes.md`);
    this._currentProvider = this._resolveProvider(analysisProvider);
    this._currentOptions = { model: item.analysisModel || null, thinkingBudget: item.thinkingBudget || 0 };

    try {
      await this.ensureProcessingDir();
      console.log(`[AutoReaderV2] Starting multi-pass processing: ${title} (ID: ${documentId})`);

      // Step 1: Prepare PDF
      const pdfInfo = await pdfService.preparePdfForProcessing(s3Key);
      tempFilePath = pdfInfo.filePath;
      console.log(`[AutoReaderV2] PDF prepared: ${pdfInfo.pageCount} pages`);

      // Initialize notes file
      await this.initNotesFile(notesFilePath, title, documentId);

      // Step 2: Pass 1
      console.log('[AutoReaderV2] === 第一轮：快速概览 ===');
      const pass1Result = await this.executePass(tempFilePath, PAPER_PASS_1_PROMPT, notesFilePath, 1);
      const pass1Data = this.parsePass1Result(pass1Result.text);
      await this.appendPass1Notes(notesFilePath, pass1Data, pass1Result.text);

      let hasCode = pass1Data.has_code || !!providedCodeUrl;
      let codeUrl = pass1Data.code_url || providedCodeUrl;

      // Step 3: Pass 2
      console.log('[AutoReaderV2] === 第二轮：内容理解 ===');
      const currentNotes = await fs.readFile(notesFilePath, 'utf-8');
      const pass2Prompt = PAPER_PASS_2_PROMPT.replace('{previous_notes}', currentNotes);
      const pass2Result = await this.executePass(tempFilePath, pass2Prompt, notesFilePath, 2);
      await this.appendToNotesFile(notesFilePath, '\n\n---\n\n## 第二轮笔记\n\n' + cleanLLMResponse(pass2Result.text));

      // Step 4: Pass 3
      console.log('[AutoReaderV2] === 第三轮：深度理解 ===');
      const updatedNotes = await fs.readFile(notesFilePath, 'utf-8');
      const pass3Prompt = PAPER_PASS_3_PROMPT.replace('{previous_notes}', updatedNotes);
      const pass3Result = await this.executePass(tempFilePath, pass3Prompt, notesFilePath, 3);
      await this.appendToNotesFile(notesFilePath, '\n\n' + cleanLLMResponse(pass3Result.text));

      let finalNotes = await fs.readFile(notesFilePath, 'utf-8');

      // Step 5: Fetch README if has code
      if (hasCode && codeUrl) {
        console.log(`[AutoReaderV2] === 获取并摘要代码README: ${codeUrl} ===`);
        try {
          const codeReadme = await this.fetchGitHubReadme(codeUrl);
          if (codeReadme) {
            const readmeSummary = await this.summarizeReadme(codeReadme, codeUrl, title);
            if (readmeSummary) {
              finalNotes += '\n\n---\n\n## 代码仓库概览\n\n';
              finalNotes += `**仓库地址**: [${codeUrl}](${codeUrl})\n\n`;
              finalNotes += readmeSummary;
              finalNotes += '\n\n*点击"代码分析"按钮获取详细的代码解读*\n';
            }
          }
        } catch (readmeError) {
          console.log(`[AutoReaderV2] README processing failed (non-fatal):`, readmeError.message);
        }
      }

      // Step 7: Upload notes to S3
      const paperNotesS3Key = await this.uploadNotesToS3(finalNotes, documentId, title, 'paper_notes');
      console.log(`[AutoReaderV2] Paper notes uploaded to S3: ${paperNotesS3Key}`);
      console.log(`[AutoReaderV2] Processing complete for: ${title}`);

      return {
        notesS3Key: paperNotesS3Key,
        codeNotesS3Key: null,
        pageCount: pdfInfo.pageCount,
        hasCode,
        codeUrl,
        readerMode: 'auto_reader_v2',
      };
    } finally {
      if (tempFilePath) {
        await pdfService.cleanupTmpFile(tempFilePath);
      }
      try {
        await fs.unlink(notesFilePath);
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * Process document in v3 mode: 2-pass deep analysis with minimal implementation
   *
   * Pass 1 - 表层分析:
   *   - 任务定义、领域现状、输入输出规格、方法概览图
   *
   * Pass 2 - 深层分析:
   *   - 最小复现代码、数学框架、批判性分析、未来方向
   */
  async processDocumentV3(item, options = {}) {
    const { documentId, s3Key, title, analysisProvider } = item;
    let providedCodeUrl = item.codeUrl;
    let tempFilePath = null;
    const notesFilePath = path.join(this.processingDir, `${documentId}_notes.md`);
    this._currentProvider = this._resolveProvider(analysisProvider);
    this._currentOptions = { model: item.analysisModel || null, thinkingBudget: item.thinkingBudget || 0 };

    try {
      await this.ensureProcessingDir();
      console.log(`[AutoReaderV3] Starting 2-pass deep analysis: ${title} (ID: ${documentId})`);

      // Step 1: Prepare PDF
      const pdfInfo = await pdfService.preparePdfForProcessing(s3Key);
      tempFilePath = pdfInfo.filePath;
      console.log(`[AutoReaderV3] PDF prepared: ${pdfInfo.pageCount} pages`);

      // Initialize notes file
      await this.initNotesFile(notesFilePath, title, documentId);

      // Step 2: Pass 1 - 表层分析
      console.log('[AutoReaderV3] === 第一轮：表层分析 ===');
      const pass1Result = await this.executePass(tempFilePath, V3_PASS_1_PROMPT, notesFilePath, 1);
      await this.appendToNotesFile(notesFilePath, cleanLLMResponse(pass1Result.text));

      // Try to extract code URL from the analysis if mentioned
      let hasCode = !!providedCodeUrl;
      let codeUrl = providedCodeUrl;

      // Check if code URL is mentioned in pass 1 result
      const codeUrlMatch = pass1Result.text.match(/github\.com\/[^\s\)]+/i);
      if (codeUrlMatch && !codeUrl) {
        codeUrl = 'https://' + codeUrlMatch[0];
        hasCode = true;
      }

      // Step 3: Pass 2 - 深层分析
      console.log('[AutoReaderV3] === 第二轮：深层分析 ===');
      const currentNotes = await fs.readFile(notesFilePath, 'utf-8');
      const pass2Prompt = V3_PASS_2_PROMPT.replace('{previous_notes}', currentNotes);
      const pass2Result = await this.executePass(tempFilePath, pass2Prompt, notesFilePath, 2);
      await this.appendToNotesFile(notesFilePath, '\n\n' + cleanLLMResponse(pass2Result.text));

      let finalNotes = await fs.readFile(notesFilePath, 'utf-8');

      // Step 4: If has code, fetch README and summarize it (non-fatal)
      if (hasCode && codeUrl) {
        console.log(`[AutoReaderV3] === 获取并摘要代码README: ${codeUrl} ===`);
        try {
          const codeReadme = await this.fetchGitHubReadme(codeUrl);
          if (codeReadme) {
            const readmeSummary = await this.summarizeReadme(codeReadme, codeUrl, title);
            if (readmeSummary) {
              finalNotes += '\n\n---\n\n## 代码仓库概览\n\n';
              finalNotes += `**仓库地址**: [${codeUrl}](${codeUrl})\n\n`;
              finalNotes += readmeSummary;
              finalNotes += '\n\n*点击"代码分析"按钮获取详细的代码解读*\n';
            }
          }
        } catch (readmeError) {
          console.log(`[AutoReaderV3] README processing failed (non-fatal):`, readmeError.message);
        }
      }

      // Step 5: Upload notes to S3
      const paperNotesS3Key = await this.uploadNotesToS3(finalNotes, documentId, title, 'paper_notes');
      console.log(`[AutoReaderV3] Paper notes uploaded to S3: ${paperNotesS3Key}`);
      console.log(`[AutoReaderV3] Processing complete for: ${title}`);

      return {
        notesS3Key: paperNotesS3Key,
        codeNotesS3Key: null,
        pageCount: pdfInfo.pageCount,
        hasCode,
        codeUrl,
        readerMode: 'auto_reader_v3',
      };
    } finally {
      if (tempFilePath) {
        await pdfService.cleanupTmpFile(tempFilePath);
      }
      try {
        await fs.unlink(notesFilePath);
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * Parse pass 1 JSON result
   */
  parsePass1Result(text) {
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
    } catch (e) {
      console.warn('[AutoReader] Could not parse pass 1 JSON:', e.message);
    }
    return {
      title: '',
      paper_type: '未知',
      venue: '未知',
      has_code: false,
      code_url: null,
      core_contribution: '',
      key_pages: '',
      skip_pages: '',
      key_figures: [],
      five_c: {
        category: '',
        context: '',
        correctness: '',
        contributions: '',
        clarity: '',
      },
      initial_impression: '',
    };
  }

  /**
   * Append pass 1 notes in template format
   */
  async appendPass1Notes(filePath, data, rawText) {
    const notes = `
## 概览

- **类型**: ${data.paper_type || '未知'} | ${data.venue || ''}
- **代码**: ${data.has_code ? `[${data.code_url || '有'}](${data.code_url || '#'})` : '无'}
- **关键图表**: ${data.key_figures?.length > 0 ? 'Figure ' + data.key_figures.join(', ') : '待分析'}

### 核心贡献

${data.core_contribution || ''}

### 论文摘要

${data.summary || ''}

`;
    await this.appendToNotesFile(filePath, notes);
  }

  /**
   * Append reading log to notes (disabled - no longer needed)
   */
  async appendReadingLog(filePath) {
    // Reading log disabled - not useful for users
  }

  /**
   * Execute a single reading pass
   */
  /**
   * Resolve provider service from provider name
   */
  _resolveProvider(providerName) {
    switch (providerName) {
      case 'codex-cli': return codexCliService;
      case 'google-api': return googleApiService;
      case 'claude-code': return claudeCodeService;
      case 'gemini-cli':
      default: return geminiCliService;
    }
  }

  async executePass(pdfPath, prompt, notesFilePath, passNumber) {
    const provider = this._currentProvider || geminiCliService;
    const providerName = this._currentProvider === codexCliService ? 'Codex CLI'
      : this._currentProvider === googleApiService ? 'Google API'
      : this._currentProvider === claudeCodeService ? 'Claude Code'
      : 'Gemini CLI';
    console.log(`[AutoReader] Executing pass ${passNumber} with ${providerName}...`);

    const result = await provider.readDocument(pdfPath, prompt, this._currentOptions || {});

    console.log(`[AutoReader] Pass ${passNumber} complete, output: ${result.text.length} chars`);

    return result;
  }

  /**
   * Initialize the notes file with template header
   */
  async initNotesFile(filePath, title, documentId) {
    const header = `# ${title}

`;
    await fs.writeFile(filePath, header, 'utf-8');
  }

  /**
   * Append content to notes file
   */
  async appendToNotesFile(filePath, content) {
    await fs.appendFile(filePath, content, 'utf-8');
  }

  /**
   * Extract excalidraw figures and convert to PNG
   */
  async extractAndConvertFigures(text, documentId) {
    const figures = [];
    // Match both naming conventions: excalidraw-name and excalidraw-paper_name/code_name
    const excalidrawPattern = /```excalidraw-(\w+)\s*([\s\S]*?)\s*```/g;
    let match;

    while ((match = excalidrawPattern.exec(text)) !== null) {
      const figureName = match[1];
      let figureJson = match[2].trim();

      // Try to parse as JSON
      try {
        // Sometimes the JSON is wrapped in code blocks
        if (figureJson.startsWith('{')) {
          const parsed = JSON.parse(figureJson);

          const excalidrawPath = path.join(this.processingDir, `${documentId}_${figureName}.excalidraw`);
          const pngPath = path.join(this.processingDir, `${documentId}_${figureName}.png`);

          await fs.writeFile(excalidrawPath, JSON.stringify(parsed, null, 2), 'utf-8');

          // Convert to PNG using the convert.py script
          const converted = await this.convertExcalidrawToPng(excalidrawPath, pngPath);

          figures.push({
            name: figureName,
            excalidrawPath,
            pngPath: converted ? pngPath : null,
            json: parsed,
          });
        }
      } catch (e) {
        console.warn(`[AutoReader] Could not parse excalidraw figure ${figureName}:`, e.message);
        figures.push({
          name: figureName,
          excalidrawPath: null,
          pngPath: null,
          json: null,
          error: e.message,
        });
      }
    }

    return figures;
  }

  /**
   * Convert excalidraw file to PNG
   */
  async convertExcalidrawToPng(excalidrawPath, pngPath) {
    return new Promise((resolve) => {
      const convertScript = path.join(__dirname, '..', '..', '..', 'docs', 'convert.py');

      const proc = spawn('python3', [convertScript, excalidrawPath, pngPath]);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[AutoReader] Converted figure: ${pngPath}`);
          resolve(true);
        } else {
          console.warn(`[AutoReader] Figure conversion failed: ${stderr}`);
          resolve(false);
        }
      });

      proc.on('error', (err) => {
        console.warn(`[AutoReader] Figure conversion error: ${err.message}`);
        resolve(false);
      });
    });
  }

  /**
   * Generate final paper notes with embedded figures
   */
  async generateFinalPaperNotes(notesFilePath, figures, title, documentId) {
    let notes = await fs.readFile(notesFilePath, 'utf-8');

    // Add figure references section (only for successful conversions)
    const successfulFigures = figures.filter(f => f.pngPath);
    if (successfulFigures.length > 0) {
      notes += '\n\n---\n\n## 图表\n\n';
      for (const figure of successfulFigures) {
        const figureTitle = this.getFigureTitle(figure.name);
        notes += `### ${figureTitle}\n\n`;
        notes += `![${figureTitle}](figures/${documentId}_${figure.name}.png)\n\n`;
      }
    }

    return notes;
  }

  /**
   * Get human-readable figure title
   */
  getFigureTitle(name) {
    const titles = {
      'paper_outline': '论文结构图',
      'paper_method': '方法流程图',
      'repo_structure': '仓库结构图',
      'code_method': '代码架构图',
      // Legacy names
      'outline': '论文大纲图',
      'method': '方法流程图',
      'structure': '代码架构图',
      'implementation': '实现流程图',
    };
    return titles[name] || name;
  }

  /**
   * Analyze code repository
   */
  async analyzeCodeRepository(codeUrl, documentId, title) {
    const repoDir = path.join(this.processingDir, `repo_${documentId}`);
    const codeNotesPath = path.join(this.processingDir, `${documentId}_code_notes.md`);

    try {
      // Clone repository (skip LFS)
      console.log(`[AutoReader] Cloning repository: ${codeUrl}`);
      await this.cloneRepository(codeUrl, repoDir);
      console.log(`[AutoReader] Repository cloned to: ${repoDir}`);

      const now = new Date();
      // Initialize code notes with template header (no blockquote)
      await fs.writeFile(codeNotesPath, `---
title: ${title} - 代码分析
document_id: ${documentId}
code_url: ${codeUrl}
generated_at: ${now.toISOString()}
---

# ${title} - 代码笔记

**仓库地址**: [${codeUrl}](${codeUrl})

`, 'utf-8');

      // Use Claude Code CLI for code analysis (single comprehensive round)
      console.log('[AutoReader] Using Claude Code CLI for code analysis');

      // Single round: Comprehensive analysis
      console.log('[AutoReader] === 代码分析 ===');
      const repoStructure = await this.getRepoStructure(repoDir);
      const analysisPrompt = CODE_ANALYSIS_PROMPT + '\n\n## 代码目录结构:\n```\n' + repoStructure + '\n```';
      const analysisResult = await claudeCodeService.analyzeRepository(repoDir, analysisPrompt);
      await this.appendToNotesFile(codeNotesPath, '---\n\n' + analysisResult.text);

      // Extract and convert code figures
      const allText = analysisResult.text;
      const codeFigures = await this.extractAndConvertFigures(allText, `${documentId}_code`);

      // Add reading log
      const dateStr = new Date().toISOString().split('T')[0];
      await this.appendToNotesFile(codeNotesPath, `
---

## 阅读日志

| 日期 | 备注 |
|-----|------|
| ${dateStr} | 自动处理完成 |
`);

      // Generate final code notes
      const finalCodeNotes = await this.generateFinalCodeNotes(codeNotesPath, codeFigures, title, documentId);

      return finalCodeNotes;
    } finally {
      // Cleanup repo directory
      try {
        await fs.rm(repoDir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }
      try {
        await fs.unlink(codeNotesPath);
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * Clone a repository (skip LFS)
   */
  async cloneRepository(url, targetDir) {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', [
        'clone',
        '--depth', '1',
        '--single-branch',
        url,
        targetDir,
      ], {
        env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
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
      // Try tree first for better output
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
          // Limit to first 100 files
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
   * Fetch README from GitHub repository
   * @param {string} codeUrl - GitHub repository URL
   * @returns {Promise<string|null>} - README content in markdown
   */
  async fetchGitHubReadme(codeUrl) {
    try {
      // Parse GitHub URL to get owner/repo
      const match = codeUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) {
        console.log(`[AutoReader] Not a GitHub URL: ${codeUrl}`);
        return null;
      }

      const owner = match[1];
      const repo = match[2].replace(/\.git$/, '');

      // Try to fetch README via GitHub API
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/readme`;

      const https = require('https');

      return new Promise((resolve) => {
        const req = https.get(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3.raw',
            'User-Agent': 'auto-researcher'
          },
          timeout: 10000
        }, (res) => {
          if (res.statusCode !== 200) {
            console.log(`[AutoReader] README fetch failed: ${res.statusCode}`);
            resolve(null);
            return;
          }

          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            // Truncate if too long
            const maxLen = 3000;
            if (data.length > maxLen) {
              data = data.substring(0, maxLen) + '\n\n... (README 已截断)';
            }
            resolve(data);
          });
        });

        req.on('error', (err) => {
          console.log(`[AutoReader] README fetch error: ${err.message}`);
          resolve(null);
        });

        req.on('timeout', () => {
          req.destroy();
          console.log(`[AutoReader] README fetch timeout`);
          resolve(null);
        });
      });
    } catch (e) {
      console.log(`[AutoReader] README fetch exception: ${e.message}`);
      return null;
    }
  }

  /**
   * Summarize README content using Gemini CLI
   * @param {string} readmeContent - Raw README content
   * @param {string} codeUrl - Repository URL
   * @param {string} paperTitle - Paper title for context
   * @returns {Promise<string|null>} - Summarized README
   */
  async summarizeReadme(readmeContent, codeUrl, paperTitle) {
    try {
      const prompt = `你是一位代码仓库分析专家。请根据以下README内容，为这个与论文"${paperTitle}"相关的代码仓库生成一个简洁但信息丰富的概览。

## README内容：
${readmeContent}

## 输出要求：
- 用中文输出
- 直接输出Markdown内容，不要包含任何开场白
- 提取最关键的信息，不要冗余

请按以下格式输出：

### 项目简介
[1-2句话描述项目是什么，解决什么问题]

### 核心特性
- [特性1]
- [特性2]
- [特性3]

### 快速开始
\`\`\`bash
[最简单的安装和运行命令，如果README中有的话]
\`\`\`

### 架构概览
\`\`\`
[用ASCII字符画出项目的核心架构，根据README内容推断]
例如:
Input --> Module A --> Module B --> Output
           |              |
           +-- SubModule --+
\`\`\`

### 与论文的关系
[说明这个代码仓库与论文的对应关系，哪些部分实现了论文中的方法]`;

      // Write prompt to temp file
      const promptPath = path.join(this.processingDir, `readme_prompt_${Date.now()}.txt`);
      await fs.writeFile(promptPath, prompt, 'utf-8');

      try {
        // Use current provider to summarize
        const provider = this._currentProvider || geminiCliService;
        const result = provider.runWithPromptFile
          ? await provider.runWithPromptFile(promptPath, { timeout: 60000 })
          : await provider.readMarkdown(prompt, '', { timeout: 60000 });
        return cleanLLMResponse(result.text);
      } finally {
        // Cleanup prompt file
        try {
          await fs.unlink(promptPath);
        } catch (e) { /* ignore */ }
      }
    } catch (error) {
      console.log(`[AutoReader] README summarization failed: ${error.message}`);
      // Fall back to truncated raw README
      return readmeContent.length > 1500
        ? readmeContent.substring(0, 1500) + '\n\n... (README 已截断)'
        : readmeContent;
    }
  }

  /**
   * Generate final code notes with embedded figures
   */
  async generateFinalCodeNotes(notesFilePath, figures, title, documentId) {
    let notes = await fs.readFile(notesFilePath, 'utf-8');

    if (figures.length > 0) {
      notes += '\n\n---\n\n## 图表\n\n';
      for (const figure of figures) {
        const figureTitle = this.getFigureTitle(figure.name);
        if (figure.pngPath) {
          notes += `### ${figureTitle}\n\n`;
          notes += `![${figureTitle}](figures/${documentId}_code_${figure.name}.png)\n\n`;
        }
      }
    }

    return notes;
  }

  /**
   * Upload notes to S3
   */
  async uploadNotesToS3(notes, documentId, title, type) {
    const timestamp = Date.now();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const s3Key = `default_user/notes/${timestamp}-${documentId}-${sanitizedTitle}_${type}.md`;

    const buffer = Buffer.from(notes, 'utf-8');
    await s3Service.uploadBuffer(buffer, s3Key, 'text/markdown');

    return s3Key;
  }

  /**
   * Upload figure to S3
   */
  async uploadFigureToS3(pngPath, documentId, figureName) {
    try {
      const buffer = await fs.readFile(pngPath);
      const s3Key = `default_user/figures/${documentId}_${figureName}.png`;
      await s3Service.uploadBuffer(buffer, s3Key, 'image/png');
      return s3Key;
    } catch (e) {
      console.warn(`[AutoReader] Could not upload figure ${figureName}:`, e.message);
      return null;
    }
  }

  async processDocumentCustomRounds(item, options = {}) {
    const { documentId, s3Key, title, analysisProvider, refinementRounds } = item;
    let tempFilePath = null;
    const notesFilePath = path.join(this.processingDir, `${documentId}_notes.md`);
    this._currentProvider = this._resolveProvider(analysisProvider);
    this._currentOptions = { model: item.analysisModel || null, thinkingBudget: item.thinkingBudget || 0 };

    try {
      await this.ensureProcessingDir();
      console.log(`[AutoReaderCustom] Starting ${refinementRounds.length}-round processing: ${title} (ID: ${documentId})`);

      const pdfInfo = await pdfService.preparePdfForProcessing(s3Key);
      tempFilePath = pdfInfo.filePath;
      console.log(`[AutoReaderCustom] PDF prepared: ${pdfInfo.pageCount} pages`);

      await this.initNotesFile(notesFilePath, title, documentId);

      let previousNotes = '';
      for (let i = 0; i < refinementRounds.length; i++) {
        const round = refinementRounds[i];
        const roundNum = i + 1;
        console.log(`[AutoReaderCustom] === Round ${roundNum}/${refinementRounds.length} ===`);

        const prompt = previousNotes
          ? `${round.prompt}\n\n---\nPrevious notes for context:\n${previousNotes}`
          : round.prompt;

        const result = await this.executePass(tempFilePath, prompt, notesFilePath, roundNum);
        const cleaned = cleanLLMResponse(result.text);

        if (i === 0) {
          await this.appendToNotesFile(notesFilePath, cleaned);
        } else {
          await this.appendToNotesFile(notesFilePath, `\n\n---\n\n## Round ${roundNum}\n\n${cleaned}`);
        }
        previousNotes = await fs.readFile(notesFilePath, 'utf-8');
      }

      const finalNotes = await fs.readFile(notesFilePath, 'utf-8');
      const notesS3Key = await s3Service.uploadNotes(documentId, finalNotes);

      const db = getDb();
      await db.execute({
        sql: `UPDATE documents SET notes_s3_key = ?, processing_status = 'completed',
              processing_completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [notesS3Key, documentId],
      });

      return { notesS3Key, pageCount: pdfInfo.pageCount };
    } catch (error) {
      console.error(`[AutoReaderCustom] Error processing ${title}:`, error);
      throw error;
    } finally {
      if (tempFilePath) await fs.unlink(tempFilePath).catch(() => {});
      await fs.unlink(notesFilePath).catch(() => {});
    }
  }
}

module.exports = new AutoReaderService();
