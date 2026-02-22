/**
 * Clean LLM response text by removing agent thinking/preamble text
 * that leaks into the output before the actual markdown content.
 *
 * Common patterns:
 * - "I will read the provided PDF file to extract..."
 * - "I will list the contents of the processing/ directory..."
 * - "Let me analyze this paper..."
 * - Chinese equivalents like "我将阅读..." "让我来分析..."
 */

function cleanLLMResponse(text) {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text;

  // Remove thinking blocks (e.g. <think>...</think>, <thinking>...</thinking>)
  cleaned = cleaned.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');

  // Find the first markdown heading (## or ###) — content before it is likely preamble
  const firstHeadingMatch = cleaned.match(/^([\s\S]*?)((?:^|\n)#{1,6}\s+.+)/m);

  if (firstHeadingMatch) {
    const preamble = firstHeadingMatch[1];
    // Check if the preamble looks like agent thinking/planning
    const thinkingPatterns = [
      /I will (read|list|analyze|extract|examine|check|use|process|scan|look|open|verify|start|begin|provide|review)/i,
      /Let me (read|analyze|extract|examine|check|look|start|begin|provide|review)/i,
      /I('ll| am going to) (read|analyze|extract|examine|list|process|scan|look|verify|start|begin|provide|review)/i,
      /我(将|会|要|来)(阅读|分析|提取|检查|查看|读取|处理|扫描|开始|列出)/,
      /让我(来|先)?(阅读|分析|提取|检查|查看|读取|处理|扫描|开始|列出)/,
      /^(Okay|OK|Sure|Alright|Now|First|Here),?\s/im,
      /processing\/ directory/i,
      /confirm the .* file/i,
      /the PDF file/i,
    ];

    const looksLikeThinking = thinkingPatterns.some(p => p.test(preamble));
    if (looksLikeThinking) {
      cleaned = firstHeadingMatch[2] + cleaned.slice(firstHeadingMatch[0].length);
      // Trim leading newlines
      cleaned = cleaned.replace(/^\n+/, '');
    }
  }

  // Also remove trailing agent sign-offs
  cleaned = cleaned.replace(/\n+(I hope this|Let me know if|Feel free to|Is there anything|如果.*问题|希望.*帮助|如有.*请)[\s\S]{0,200}$/i, '');

  return cleaned.trim();
}

module.exports = { cleanLLMResponse };
