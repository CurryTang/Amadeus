const config = require('../config');
const processingProxyService = require('./processing-proxy.service');

/**
 * Base class for LLM providers
 */
class BaseLLMProvider {
  constructor(name, apiKey, model) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async complete(content, prompt) {
    throw new Error('Not implemented');
  }
}

/**
 * Google Gemini API provider
 */
class GeminiProvider extends BaseLLMProvider {
  constructor() {
    super(
      'gemini',
      config.llm?.gemini?.apiKey,
      config.llm?.gemini?.model || 'gemini-1.5-pro'
    );
  }

  async complete(content, prompt) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: this.model });

    const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${content}`;
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;

    return {
      text: response.text(),
      model: this.model,
      provider: this.name,
    };
  }
}

/**
 * Anthropic Claude API provider
 */
class AnthropicProvider extends BaseLLMProvider {
  constructor() {
    super(
      'anthropic',
      config.llm?.anthropic?.apiKey,
      config.llm?.anthropic?.model || 'claude-3-sonnet-20240229'
    );
  }

  async complete(content, prompt) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    const message = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n\nDocument content:\n\n${content}`,
        },
      ],
    });

    return {
      text: message.content[0].text,
      model: this.model,
      provider: this.name,
    };
  }
}

/**
 * OpenAI API provider
 */
class OpenAIProvider extends BaseLLMProvider {
  constructor() {
    super(
      'openai',
      config.llm?.openai?.apiKey,
      config.llm?.openai?.model || 'gpt-4-turbo'
    );
  }

  async complete(content, prompt) {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n---\n\nDocument content:\n\n${content}`,
        },
      ],
      max_tokens: 4096,
    });

    return {
      text: response.choices[0].message.content,
      model: this.model,
      provider: this.name,
    };
  }
}

/**
 * Qwen API provider (Alibaba Cloud)
 */
class QwenProvider extends BaseLLMProvider {
  constructor() {
    super(
      'qwen',
      config.llm?.qwen?.apiKey,
      config.llm?.qwen?.model || 'qwen-max'
    );
    this.baseUrl = config.llm?.qwen?.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
  }

  async complete(content, prompt) {
    const response = await fetch(`${this.baseUrl}/services/aigc/text-generation/generation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          messages: [
            {
              role: 'user',
              content: `${prompt}\n\n---\n\nDocument content:\n\n${content}`,
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qwen API error: ${error}`);
    }

    const result = await response.json();

    return {
      text: result.output.text,
      model: this.model,
      provider: this.name,
    };
  }
}

/**
 * DeepSeek API provider
 */
class DeepSeekProvider extends BaseLLMProvider {
  constructor() {
    super(
      'deepseek',
      config.llm?.deepseek?.apiKey,
      config.llm?.deepseek?.model || 'deepseek-chat'
    );
    this.baseUrl = config.llm?.deepseek?.baseUrl || 'https://api.deepseek.com';
  }

  async complete(content, prompt) {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\n---\n\nDocument content:\n\n${content}`,
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API error: ${error}`);
    }

    const result = await response.json();

    return {
      text: result.choices[0].message.content,
      model: this.model,
      provider: this.name,
    };
  }
}

/**
 * LLM Service - manages multiple LLM providers
 */
class LLMService {
  constructor() {
    this.providers = {
      gemini: new GeminiProvider(),
      anthropic: new AnthropicProvider(),
      openai: new OpenAIProvider(),
      qwen: new QwenProvider(),
      deepseek: new DeepSeekProvider(),
    };
  }

  /**
   * Get list of configured providers
   * @returns {string[]}
   */
  getConfiguredProviders() {
    return Object.entries(this.providers)
      .filter(([_, provider]) => provider.isConfigured())
      .map(([name]) => name);
  }

  /**
   * Check if a specific provider is configured
   * @param {string} providerName
   * @returns {boolean}
   */
  isProviderConfigured(providerName) {
    return this.providers[providerName]?.isConfigured() || false;
  }

  /**
   * Generate completion using a specific provider
   * @param {string} content - Document content (markdown or text)
   * @param {string} prompt - The prompt to use
   * @param {string} providerName - Provider name (gemini, anthropic, openai, qwen, deepseek)
   * @returns {Promise<{text: string, model: string, provider: string}>}
   */
  async generateCompletion(content, prompt, providerName = 'gemini') {
    // Try desktop processing first if available
    const desktopAvailable = await processingProxyService.isDesktopAvailable();

    if (desktopAvailable) {
      console.log(`[LLM Service] Forwarding to desktop: ${providerName}`);
      try {
        return await processingProxyService.generateCompletion(content, prompt, providerName);
      } catch (error) {
        console.error('[LLM Service] Desktop processing failed, falling back to local:', error.message);
        // Continue to local processing
      }
    }

    console.log(`[LLM Service] Processing locally: ${providerName}`);

    const provider = this.providers[providerName];

    if (!provider) {
      throw new Error(`Unknown LLM provider: ${providerName}`);
    }

    if (!provider.isConfigured()) {
      throw new Error(`LLM provider ${providerName} is not configured. Set the API key in environment variables.`);
    }

    return provider.complete(content, prompt);
  }

  /**
   * Try multiple providers in order until one succeeds
   * @param {string} content - Document content
   * @param {string} prompt - The prompt to use
   * @param {string[]} providers - List of providers to try in order
   * @returns {Promise<{text: string, model: string, provider: string}>}
   */
  async generateWithFallback(content, prompt, providers = ['gemini', 'anthropic', 'openai']) {
    const errors = [];

    for (const providerName of providers) {
      if (!this.isProviderConfigured(providerName)) {
        continue;
      }

      try {
        console.log(`[LLM Service] Trying provider: ${providerName}`);
        return await this.generateCompletion(content, prompt, providerName);
      } catch (error) {
        console.error(`[LLM Service] Provider ${providerName} failed:`, error.message);
        errors.push({ provider: providerName, error: error.message });
      }
    }

    throw new Error(`All LLM providers failed: ${JSON.stringify(errors)}`);
  }
}

module.exports = new LLMService();
