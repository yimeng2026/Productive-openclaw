// ContextBudgetManager.ts — 模型上下文预算管理器
// 解决多模型协作中上下文窗口不一致导致的硬截断问题
// 核心原则：每个模型独立管理自己的上下文，TaskRouter 按能力匹配任务

import { logger } from '../../utils/logger';

/* ───────────────────────────────────────────── */
/*  Tokenizer 估算 — 按模型类型选择不同系数        */
/* ───────────────────────────────────────────── */

export type TokenizerType = 'gpt2' | 'cl100k' | 'qwen' | 'llama3' | 'mistral' | 'custom';

const TOKEN_ESTIMATES: Record<TokenizerType, { tokenPerChar: number; tokenPerChineseChar: number }> = {
  gpt2:     { tokenPerChar: 0.3, tokenPerChineseChar: 0.5 },
  cl100k:   { tokenPerChar: 0.25, tokenPerChineseChar: 0.6 },
  qwen:     { tokenPerChar: 0.3, tokenPerChineseChar: 0.55 },
  llama3:   { tokenPerChar: 0.25, tokenPerChineseChar: 0.5 },
  mistral:  { tokenPerChar: 0.28, tokenPerChineseChar: 0.52 },
  custom:   { tokenPerChar: 0.3, tokenPerChineseChar: 0.5 },
};

/**
 * 估算文本的 token 数
 * 简版：按字符类型分别计算后求和
 */
export function estimateTokens(text: string, tokenizer: TokenizerType = 'cl100k'): number {
  const rates = TOKEN_ESTIMATES[tokenizer] || TOKEN_ESTIMATES.cl100k;
  let asciiCount = 0;
  let chineseCount = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      chineseCount++;
    } else {
      asciiCount++;
    }
  }
  return Math.ceil(asciiCount * rates.tokenPerChar + chineseCount * rates.tokenPerChineseChar);
}

/**
 * 批量估算多条消息的 token 数
 */
export function estimateMessagesTokens(messages: string[], tokenizer: TokenizerType): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg, tokenizer), 0);
}

/* ───────────────────────────────────────────── */
/*  模型能力声明                                    */
/* ───────────────────────────────────────────── */

export type TruncationStrategy = 'hard' | 'soft' | 'summarize' | 'chunk' | 'none';

export interface ModelCapability {
  /** 总上下文窗口大小（token） */
  contextWindow: number;
  /** 最大输出 token 数 */
  maxOutputTokens: number;
  /** 截断策略 */
  truncationStrategy: TruncationStrategy;
  /** Tokenizer 类型 */
  tokenizer: TokenizerType;
  /** 是否支持函数调用 */
  supportsFunctionCalling: boolean;
  /** 是否支持视觉 */
  supportsVision: boolean;
  /** 自定义配置 */
  custom?: Record<string, unknown>;
}

/** 预设的常见模型能力配置 */
export const PRESET_MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'openai-gpt4o': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    truncationStrategy: 'soft',
    tokenizer: 'cl100k',
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'openai-gpt4o-mini': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    truncationStrategy: 'soft',
    tokenizer: 'cl100k',
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'anthropic-claude-sonnet': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    truncationStrategy: 'soft',
    tokenizer: 'cl100k',
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'google-gemini-1.5-pro': {
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    truncationStrategy: 'chunk',
    tokenizer: 'cl100k',
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'kimi-k2.6': {
    contextWindow: 2_000_000,
    maxOutputTokens: 8_192,
    truncationStrategy: 'chunk',
    tokenizer: 'qwen',
    supportsFunctionCalling: true,
    supportsVision: true,
  },
  'kimi-moonshot-v1': {
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    truncationStrategy: 'soft',
    tokenizer: 'qwen',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'deepseek-chat': {
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    truncationStrategy: 'soft',
    tokenizer: 'cl100k',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-qwen2.5': {
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'soft',
    tokenizer: 'qwen',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-qwen2.5-72b': {
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'soft',
    tokenizer: 'qwen',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-llama3.1': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'soft',
    tokenizer: 'llama3',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-llama3.1-70b': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'soft',
    tokenizer: 'llama3',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-mistral': {
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'soft',
    tokenizer: 'mistral',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-mistral-large': {
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'soft',
    tokenizer: 'mistral',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-phi4': {
    contextWindow: 16_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'hard',
    tokenizer: 'gpt2',
    supportsFunctionCalling: true,
    supportsVision: false,
  },
  'ollama-gemma2': {
    contextWindow: 8_000,
    maxOutputTokens: 4_096,
    truncationStrategy: 'hard',
    tokenizer: 'gpt2',
    supportsFunctionCalling: false,
    supportsVision: false,
  },
};

/* ───────────────────────────────────────────── */
/*  上下文预算                                      */
/* ───────────────────────────────────────────── */

export interface ContextBudget {
  /** 总窗口大小 */
  totalWindow: number;
  /** 系统提示预留 token */
  reservedForSystem: number;
  /** 输出预留 token */
  reservedForOutput: number;
  /** 实际可用输入 token */
  maxInputTokens: number;
  /** 安全阈值（如 0.8 = 用到 80% 时触发截断） */
  safetyThreshold: number;
  /** 实际安全输入上限 = maxInputTokens * safetyThreshold */
  safeInputLimit: number;
}

/**
 * 根据模型能力计算上下文预算
 */
export function computeContextBudget(
  capability: ModelCapability,
  systemPromptLength: number = 500,
  safetyThreshold: number = 0.8
): ContextBudget {
  const reservedForSystem = systemPromptLength;
  const reservedForOutput = capability.maxOutputTokens;
  const maxInputTokens = capability.contextWindow - reservedForSystem - reservedForOutput;
  return {
    totalWindow: capability.contextWindow,
    reservedForSystem,
    reservedForOutput,
    maxInputTokens,
    safetyThreshold,
    safeInputLimit: Math.floor(maxInputTokens * safetyThreshold),
  };
}

/* ───────────────────────────────────────────── */
/*  截断策略实现                                    */
/* ───────────────────────────────────────────── */

export interface TruncationResult {
  /** 截断后的消息列表 */
  messages: string[];
  /** 被截断/丢弃的消息数量 */
  droppedCount: number;
  /** 截断后的总 token 数 */
  finalTokenCount: number;
  /** 截断策略 */
  strategy: TruncationStrategy;
  /** 是否发生截断 */
  wasTruncated: boolean;
}

/**
 * L1: 硬截断 — 保留头部 N 条，尾部直接丢弃
 * 适用于极端小窗口（< 4K）
 */
function hardTruncate(
  messages: string[],
  maxTokens: number,
  tokenizer: TokenizerType
): TruncationResult {
  const result: string[] = [];
  let total = 0;
  // 保留第一条（通常是指令）和最后一条（用户当前输入）
  const head = messages[0] || '';
  const tail = messages[messages.length - 1] || '';
  const headTokens = estimateTokens(head, tokenizer);
  const tailTokens = estimateTokens(tail, tokenizer);
  
  if (headTokens + tailTokens <= maxTokens) {
    result.push(head);
    total += headTokens;
    // 中间部分能塞多少塞多少
    for (let i = 1; i < messages.length - 1; i++) {
      const t = estimateTokens(messages[i], tokenizer);
      if (total + t + tailTokens <= maxTokens) {
        result.push(messages[i]);
        total += t;
      } else {
        break;
      }
    }
    if (messages.length > 1) {
      result.push(tail);
      total += tailTokens;
    }
  } else {
    // 连头+尾都塞不下，只保留指令
    result.push(head.slice(0, Math.floor(head.length * 0.5)));
    total = estimateTokens(result[0], tokenizer);
  }

  return {
    messages: result,
    droppedCount: messages.length - result.length,
    finalTokenCount: total,
    strategy: 'hard',
    wasTruncated: result.length < messages.length,
  };
}

/**
 * L2: 软截断 — 保留首尾关键信息，中间部分摘要化
 * 适用于中等窗口（4K-32K）
 */
function softTruncate(
  messages: string[],
  maxTokens: number,
  tokenizer: TokenizerType
): TruncationResult {
  if (messages.length <= 3) {
    // 消息太少，退化为硬截断
    return hardTruncate(messages, maxTokens, tokenizer);
  }

  const head = messages[0];
  const tail = messages[messages.length - 1];
  const headTokens = estimateTokens(head, tokenizer);
  const tailTokens = estimateTokens(tail, tokenizer);
  const middle = messages.slice(1, -1);

  // 中间能用的 token 预算
  const middleBudget = maxTokens - headTokens - tailTokens;
  
  if (middleBudget <= 0) {
    return hardTruncate(messages, maxTokens, tokenizer);
  }

  const middleTokens = middle.map((m) => estimateTokens(m, tokenizer));
  const totalMiddleTokens = middleTokens.reduce((a, b) => a + b, 0);

  if (totalMiddleTokens <= middleBudget) {
    // 中间部分完全放得下
    return {
      messages,
      droppedCount: 0,
      finalTokenCount: headTokens + totalMiddleTokens + tailTokens,
      strategy: 'soft',
      wasTruncated: false,
    };
  }

  // 中间部分放不下，需要摘要
  // 策略：保留最近的几条完整消息，更早的消息用摘要替代
  const result: string[] = [head];
  let used = headTokens;
  const summaryPlaceholder = '[... 前文已摘要 ...]';
  const summaryTokens = estimateTokens(summaryPlaceholder, tokenizer);

  // 从尾部往前塞，优先保留最近的对话
  const reversedMiddle = [...middle].reverse();
  const reversedTokens = [...middleTokens].reverse();
  const keptFromTail: string[] = [];
  let tailUsed = 0;

  for (let i = 0; i < reversedMiddle.length; i++) {
    const t = reversedTokens[i];
    if (tailUsed + t + summaryTokens <= middleBudget) {
      keptFromTail.unshift(reversedMiddle[i]);
      tailUsed += t;
    } else {
      break;
    }
  }

  // 如果有被省略的部分，插入摘要占位
  if (keptFromTail.length < middle.length) {
    result.push(summaryPlaceholder);
    used += summaryTokens;
  }

  result.push(...keptFromTail);
  used += tailUsed;
  result.push(tail);
  used += tailTokens;

  return {
    messages: result,
    droppedCount: middle.length - keptFromTail.length,
    finalTokenCount: used,
    strategy: 'soft',
    wasTruncated: true,
  };
}

/**
 * L3: 分片 — 将消息拆成多个子任务，串行处理
 * 适用于大窗口（32K+）但输入仍然超出的场景
 * 返回第一个分片，并标记还有后续
 */
function chunkTruncate(
  messages: string[],
  maxTokens: number,
  tokenizer: TokenizerType
): TruncationResult {
  // 尝试软截断先
  const soft = softTruncate(messages, maxTokens, tokenizer);
  if (!soft.wasTruncated) {
    return soft;
  }

  // 仍然超出，标记需要分片
  const chunkMarker = `[CHUNK_SPLIT: ${messages.length} messages, requires sub-tasks]`;
  const result: string[] = [...soft.messages];
  result.push(chunkMarker);

  return {
    messages: result,
    droppedCount: soft.droppedCount,
    finalTokenCount: soft.finalTokenCount + estimateTokens(chunkMarker, tokenizer),
    strategy: 'chunk',
    wasTruncated: true,
  };
}

/**
 * L4: 全量 — 不做截断
 * 适用于超大窗口且输入在安全范围内
 */
function noTruncate(
  messages: string[],
  tokenizer: TokenizerType
): TruncationResult {
  const total = estimateMessagesTokens(messages, tokenizer);
  return {
    messages,
    droppedCount: 0,
    finalTokenCount: total,
    strategy: 'none',
    wasTruncated: false,
  };
}

/* ───────────────────────────────────────────── */
/*  主截断入口                                      */
/* ───────────────────────────────────────────── */

export interface TruncateOptions {
  messages: string[];
  capability: ModelCapability;
  systemPromptLength?: number;
  safetyThreshold?: number;
  /** 强制使用特定策略，不自动选择 */
  forceStrategy?: TruncationStrategy;
}

/**
 * 智能截断入口
 * 根据模型能力和消息量自动选择截断层级
 */
export function truncateContext(options: TruncateOptions): TruncationResult {
  const {
    messages,
    capability,
    systemPromptLength = 500,
    safetyThreshold = 0.8,
    forceStrategy,
  } = options;

  const budget = computeContextBudget(capability, systemPromptLength, safetyThreshold);
  const totalTokens = estimateMessagesTokens(messages, capability.tokenizer);

  // 在安全范围内，全量传递
  if (totalTokens <= budget.safeInputLimit) {
    return noTruncate(messages, capability.tokenizer);
  }

  // 选择策略
  const strategy = forceStrategy || capability.truncationStrategy;

  logger.info({
    totalTokens,
    safeLimit: budget.safeInputLimit,
    window: capability.contextWindow,
    strategy,
    messageCount: messages.length,
  }, '[ContextBudgetManager] Truncation triggered');

  switch (strategy) {
    case 'hard':
      return hardTruncate(messages, budget.safeInputLimit, capability.tokenizer);
    case 'soft':
      return softTruncate(messages, budget.safeInputLimit, capability.tokenizer);
    case 'summarize':
      // summarize 策略先走 soft，实际摘要由上层 LLM 完成
      return softTruncate(messages, budget.safeInputLimit, capability.tokenizer);
    case 'chunk':
      return chunkTruncate(messages, budget.safeInputLimit, capability.tokenizer);
    case 'none':
      // 策略说不截断，但已经超限了，强制软截断
      logger.warn({ totalTokens, limit: budget.safeInputLimit }, '[ContextBudgetManager] Force soft truncate despite none strategy');
      return softTruncate(messages, budget.safeInputLimit, capability.tokenizer);
    default:
      return softTruncate(messages, budget.safeInputLimit, capability.tokenizer);
  }
}

/* ───────────────────────────────────────────── */
/*  预算检查 — 用于 TaskRouter                    */
/* ───────────────────────────────────────────── */

export interface BudgetCheckResult {
  /** 是否能接受 */
  canAccept: boolean;
  /** 建议的截断策略 */
  suggestedStrategy: TruncationStrategy;
  /** 当前输入 token 数 */
  estimatedInputTokens: number;
  /** 安全输入上限 */
  safeInputLimit: number;
  /** 超出比例 */
  overflowRatio: number;
  /** 是否需要分片 */
  requiresChunking: boolean;
}

/**
 * 检查 Agent 是否能接受某条任务（预算层面）
 */
export function checkBudget(
  capability: ModelCapability,
  prompt: string,
  contextMessages: string[] = [],
  systemPromptLength: number = 500,
  safetyThreshold: number = 0.8
): BudgetCheckResult {
  const budget = computeContextBudget(capability, systemPromptLength, safetyThreshold);
  const promptTokens = estimateTokens(prompt, capability.tokenizer);
  const contextTokens = estimateMessagesTokens(contextMessages, capability.tokenizer);
  const estimatedInputTokens = promptTokens + contextTokens;

  const overflowRatio = estimatedInputTokens / budget.safeInputLimit;
  const canAccept = estimatedInputTokens <= budget.safeInputLimit;

  let suggestedStrategy: TruncationStrategy = 'none';
  let requiresChunking = false;

  if (!canAccept) {
    if (overflowRatio > 3) {
      suggestedStrategy = 'chunk';
      requiresChunking = true;
    } else if (overflowRatio > 1.5) {
      suggestedStrategy = 'hard';
    } else {
      suggestedStrategy = 'soft';
    }
  }

  return {
    canAccept,
    suggestedStrategy,
    estimatedInputTokens,
    safeInputLimit: budget.safeInputLimit,
    overflowRatio,
    requiresChunking,
  };
}

/* ───────────────────────────────────────────── */
/*  状态外置 — 上下文状态管理                       */
/* ───────────────────────────────────────────── */

export interface ContextStateRef {
  /** 状态存储 ID */
  stateId: string;
  /** 创建时间 */
  createdAt: number;
  /** 消息数量 */
  messageCount: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 摘要版本（如果已摘要化） */
  summary?: string;
}

/**
 * 上下文状态存储接口
 * 实际实现可以对接 SQLite/Redis/FileSystem
 */
export interface ContextStateStore {
  save(state: ContextStateRef): Promise<void>;
  load(stateId: string): Promise<ContextStateRef | null>;
  list(agentId: string): Promise<ContextStateRef[]>;
  delete(stateId: string): Promise<void>;
}

/**
 * 轻量消息格式 — 用于进程间通信
 * 不包含全量上下文，只传引用和增量指令
 */
export interface LightweightTaskMessage {
  taskId: string;
  action: 'execute' | 'query_state' | 'continue_chunk';
  /** 增量指令/提示 */
  prompt: string;
  /** 状态引用 */
  stateRef?: string;
  /** 下一个分片索引（chunk 模式） */
  chunkIndex?: number;
  /** 预算约束 */
  maxContextSize: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
  deadline?: string;
}

/* ───────────────────────────────────────────── */
/*  ContextBudgetManager 类                         */
/* ───────────────────────────────────────────── */

export class ContextBudgetManager {
  private store?: ContextStateStore;

  constructor(store?: ContextStateStore) {
    this.store = store;
  }

  /**
   * 为 Agent 注册模型能力
   */
  static getPresetCapability(modelId: string): ModelCapability | undefined {
    return PRESET_MODEL_CAPABILITIES[modelId];
  }

  /**
   * 计算并返回预算
   */
  computeBudget(capability: ModelCapability, systemPromptLength?: number, safetyThreshold?: number): ContextBudget {
    return computeContextBudget(capability, systemPromptLength, safetyThreshold);
  }

  /**
   * 检查任务是否可被接受
   */
  checkTaskBudget(
    capability: ModelCapability,
    prompt: string,
    contextMessages?: string[],
    systemPromptLength?: number,
    safetyThreshold?: number
  ): BudgetCheckResult {
    return checkBudget(capability, prompt, contextMessages, systemPromptLength, safetyThreshold);
  }

  /**
   * 执行智能截断
   */
  truncate(options: TruncateOptions): TruncationResult {
    return truncateContext(options);
  }

  /**
   * 生成轻量消息（用于进程间通信）
   */
  createLightweightMessage(
    taskId: string,
    prompt: string,
    stateRef: string,
    maxContextSize: number,
    priority: 'low' | 'normal' | 'high' | 'critical' = 'normal'
  ): LightweightTaskMessage {
    return {
      taskId,
      action: 'execute',
      prompt,
      stateRef,
      maxContextSize,
      priority,
    };
  }

  /**
   * 检查 Agent 是否能接受某条任务（简版，用于 TaskRouter）
   */
  canAcceptTask(agentId: string, estimatedTokens: number): { ok: boolean; remaining: number; reason?: string } {
    // 简版实现：假设默认 32K 窗口
    const DEFAULT_WINDOW = 32768;
    const safetyLimit = Math.floor(DEFAULT_WINDOW * 0.8);
    if (estimatedTokens > safetyLimit) {
      return {
        ok: false,
        remaining: Math.max(0, safetyLimit - estimatedTokens),
        reason: `Estimated ${estimatedTokens} tokens exceeds safety limit ${safetyLimit}`,
      };
    }
    return {
      ok: true,
      remaining: safetyLimit - estimatedTokens,
    };
  }

  /**
   * 保存上下文状态
   */
  async saveState(state: ContextStateRef): Promise<void> {
    if (!this.store) {
      logger.warn('[ContextBudgetManager] No state store configured, skipping save');
      return;
    }
    await this.store.save(state);
  }

  /**
   * 加载上下文状态
   */
  async loadState(stateId: string): Promise<ContextStateRef | null> {
    if (!this.store) return null;
    return this.store.load(stateId);
  }
}

export default ContextBudgetManager;
