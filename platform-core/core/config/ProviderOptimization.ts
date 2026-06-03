/**
 * ProviderOptimization — 千界花园 LLM Provider 统一优化配置
 * 
 * 设计原则：类比 Kimi Code API 的 5 个核心优化点
 * 1. 特殊 Header 处理
 * 2. 双字段合并（reasoning + content）
 * 3. Token 预算分级
 * 4. Timeout 分级
 * 5. 流式优先
 */

export interface TokenBudgets {
  simple: number;   // 问候/简单问答
  normal: number;   // 一般任务
  code: number;     // 代码生成
  long: number;     // 长输出
}

export interface TimeoutBudgets {
  simple: number;   // 毫秒
  normal: number;
  code: number;
  long: number;
}

export interface RetryConfig {
  maxRetries: number;           // 最大重试次数
  baseDelayMs: number;          // 基础退避延迟
  maxDelayMs: number;           // 最大退避延迟
  jitter: boolean;              // 是否添加 jitter
  retryOnStatusCodes: number[]; // 哪些 HTTP 状态码触发重试
}

export interface ProviderOptimization {
  name: string;
  endpoint: string;
  customHeaders: Record<string, string>;
  
  // 字段合并
  reasoningField: string | null;
  mergeStrategy: 'concat' | 'ignore' | 'separate';
  
  // Token 预算
  tokenBudgets: TokenBudgets;
  
  // Timeout 分级
  timeouts: TimeoutBudgets;
  
  // 流式
  streamingSupported: boolean;
  streamingPreferred: boolean;
  
  // 特殊参数限制
  forbiddenParams: string[];
  requiredParams: string[];
  
  // 重试配置
  retry: RetryConfig;
  
  // 熔断器
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;     // 连续失败次数触发熔断
    recoveryTimeoutMs: number;    // 熔断后等待多久尝试恢复
    halfOpenMaxCalls: number;     // 半开状态允许的最大探测请求
  };
}

// ========== 各 Provider 配置实例 ==========

export const KIMI_CODE_CONFIG: ProviderOptimization = {
  name: 'kimi-code',
  endpoint: 'https://api.kimi.com/coding/v1',
  customHeaders: { 'User-Agent': 'KimiCLI/0.77' },
  reasoningField: 'reasoning_content',
  mergeStrategy: 'concat',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 120000, long: 120000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const OPENAI_CONFIG: ProviderOptimization = {
  name: 'openai',
  endpoint: 'https://api.openai.com/v1',
  customHeaders: {},
  reasoningField: null,
  mergeStrategy: 'ignore',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 60000, long: 90000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: ['temperature', 'top_p'],  // o1/o3 系列禁用
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const AZURE_CONFIG: ProviderOptimization = {
  name: 'azure',
  endpoint: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}',
  customHeaders: {},
  reasoningField: null,
  mergeStrategy: 'ignore',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 60000, long: 90000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: ['temperature', 'top_p'],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const ANTHROPIC_CONFIG: ProviderOptimization = {
  name: 'anthropic',
  endpoint: 'https://api.anthropic.com/v1',
  customHeaders: {},
  reasoningField: 'thinking',
  mergeStrategy: 'separate',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 90000, long: 120000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: ['system'],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const DEEPSEEK_CONFIG: ProviderOptimization = {
  name: 'deepseek',
  endpoint: 'https://api.deepseek.com/v1',
  customHeaders: {},
  reasoningField: 'reasoning_content',
  mergeStrategy: 'concat',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 120000, long: 120000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const MOONSHOT_CONFIG: ProviderOptimization = {
  name: 'moonshot',
  endpoint: 'https://api.moonshot.cn/v1',
  customHeaders: {},
  reasoningField: 'reasoning_content',
  mergeStrategy: 'concat',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 120000, long: 120000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const GEMINI_CONFIG: ProviderOptimization = {
  name: 'gemini',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  customHeaders: {},
  reasoningField: null,
  mergeStrategy: 'ignore',
  tokenBudgets: { simple: 500, normal: 1500, code: 4096, long: 4096 },
  timeouts: { simple: 30000, normal: 60000, code: 60000, long: 90000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: ['systemInstruction', 'contents'],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const GLM_CONFIG: ProviderOptimization = {
  name: 'glm',
  endpoint: 'https://open.bigmodel.cn/api/paas/v4',
  customHeaders: {},
  reasoningField: null,
  mergeStrategy: 'ignore',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 60000, long: 90000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const OPENROUTER_CONFIG: ProviderOptimization = {
  name: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  customHeaders: {},
  reasoningField: 'reasoning',
  mergeStrategy: 'concat',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 120000, long: 120000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

export const QWEN_CONFIG: ProviderOptimization = {
  name: 'qwen',
  endpoint: 'https://dashscope.aliyuncs.com/api/v1',
  customHeaders: {},
  reasoningField: 'reasoning_content',
  mergeStrategy: 'concat',
  tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
  timeouts: { simple: 30000, normal: 60000, code: 120000, long: 120000 },
  streamingSupported: true,
  streamingPreferred: true,
  forbiddenParams: [],
  requiredParams: [],
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    jitter: true,
    retryOnStatusCodes: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxCalls: 1,
  },
};

// ========== 注册表 ==========

export const PROVIDER_REGISTRY: Record<string, ProviderOptimization> = {
  'kimi-code': KIMI_CODE_CONFIG,
  'openai': OPENAI_CONFIG,
  'azure': AZURE_CONFIG,
  'anthropic': ANTHROPIC_CONFIG,
  'deepseek': DEEPSEEK_CONFIG,
  'moonshot': MOONSHOT_CONFIG,
  'gemini': GEMINI_CONFIG,
  'glm': GLM_CONFIG,
  'openrouter': OPENROUTER_CONFIG,
  'qwen': QWEN_CONFIG,
};

// ========== 工具函数 ==========

/**
 * 根据任务类型获取推荐的 max_tokens
 */
export function getTokenBudget(provider: string, taskType: 'simple' | 'normal' | 'code' | 'long'): number {
  const config = PROVIDER_REGISTRY[provider];
  if (!config) return 2000;
  return config.tokenBudgets[taskType];
}

/**
 * 根据任务类型获取推荐的 timeout（毫秒）
 */
export function getTimeout(provider: string, taskType: 'simple' | 'normal' | 'code' | 'long'): number {
  const config = PROVIDER_REGISTRY[provider];
  if (!config) return 60000;
  return config.timeouts[taskType];
}

/**
 * 估算文本 token 数（简化版）
 * 中文 ~1.5 token/字，英文 ~1 token/字
 */
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars * 1);
}

/**
 * 检查请求是否会超出 token 预算
 * @throws 如果预估 token 不足
 */
export function checkTokenBudget(
  provider: string,
  taskType: 'simple' | 'normal' | 'code' | 'long',
  inputText: string,
  expectedOutputLength: number
): void {
  const config = PROVIDER_REGISTRY[provider];
  if (!config) return;
  
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens('x'.repeat(expectedOutputLength)); // 粗略估计
  const budget = config.tokenBudgets[taskType];
  
  if (inputTokens + outputTokens > budget) {
    throw new Error(
      `Token budget exceeded for ${provider}/${taskType}: ` +
      `input=${inputTokens} + output~=${outputTokens} > budget=${budget}. ` +
      `Suggestion: increase budget or shorten input.`
    );
  }
}

/**
 * 计算指数退避延迟（带 jitter）
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs = 1000, maxDelayMs = 16000, jitter = true): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  if (!jitter) return delay;
  const jitterRange = delay * 0.25;
  return delay + (Math.random() * 2 - 1) * jitterRange;
}

/**
 * 判断 HTTP 状态码是否应该触发重试
 */
export function shouldRetry(statusCode: number, provider: string): boolean {
  const config = PROVIDER_REGISTRY[provider];
  if (!config) return [429, 500, 502, 503, 504].includes(statusCode);
  return config.retry.retryOnStatusCodes.includes(statusCode);
}

/**
 * 获取 Provider 的完整请求头
 */
export function getProviderHeaders(provider: string, apiKey: string): Record<string, string> {
  const config = PROVIDER_REGISTRY[provider];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config?.customHeaders,
  };
  
  if (provider === 'azure') {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  return headers;
}

export default PROVIDER_REGISTRY;
