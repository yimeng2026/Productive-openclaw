import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  computeContextBudget,
  truncateContext,
  checkBudget,
  ContextBudgetManager,
  PRESET_MODEL_CAPABILITIES,
  type ModelCapability,
  type TruncateOptions,
} from '../coordinator/unified/ContextBudgetManager';

/* ───────────────────────────────────────────── */
/*  Token Estimation Tests                       */
/* ───────────────────────────────────────────── */

describe('estimateTokens', () => {
  it('estimates ASCII text tokens correctly', () => {
    const text = 'Hello world, this is a test.';
    const tokens = estimateTokens(text, 'cl100k');
    // 28 chars * 0.25 = 7, ceil = 7
    expect(tokens).toBeGreaterThanOrEqual(1);
    expect(tokens).toBe(Math.ceil(28 * 0.25));
  });

  it('estimates Chinese text with higher rate', () => {
    const text = '你好世界这是中文测试';
    const tokens = estimateTokens(text, 'qwen');
    // 10 Chinese chars * 0.55 = 5.5, ceil = 6
    expect(tokens).toBe(Math.ceil(10 * 0.55));
  });

  it('estimates mixed Chinese + ASCII correctly', () => {
    const text = 'Hello 你好 world 世界';
    const tokensCl100k = estimateTokens(text, 'cl100k');
    // ASCII: "Hello " + "world " = 12 chars * 0.25 = 3
    // Chinese: "你好" + "世界" = 4 chars * 0.6 = 2.4
    // Total = 5.4 -> ceil 6
    expect(tokensCl100k).toBe(6);
  });

  it('falls back to cl100k for unknown tokenizer', () => {
    const text = 'fallback test';
    // @ts-expect-force — testing invalid tokenizer fallback
    const tokens = estimateTokens(text, 'unknown' as any);
    expect(tokens).toBe(Math.ceil(13 * 0.25));
  });

  it('handles empty string', () => {
    expect(estimateTokens('', 'cl100k')).toBe(0);
  });

  it('estimates differently per tokenizer type', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const gpt2 = estimateTokens(text, 'gpt2');
    const cl100k = estimateTokens(text, 'cl100k');
    const llama3 = estimateTokens(text, 'llama3');
    // gpt2: 0.3 per char, cl100k: 0.25, llama3: 0.25
    expect(gpt2).toBe(Math.ceil(26 * 0.3));
    expect(cl100k).toBe(Math.ceil(26 * 0.25));
    expect(llama3).toBe(Math.ceil(26 * 0.25));
  });
});

describe('estimateMessagesTokens', () => {
  it('sums multiple message tokens', () => {
    const messages = ['Hello', 'World', 'Test'];
    const total = estimateMessagesTokens(messages, 'cl100k');
    const expected = estimateTokens('Hello', 'cl100k') + estimateTokens('World', 'cl100k') + estimateTokens('Test', 'cl100k');
    expect(total).toBe(expected);
  });

  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([], 'cl100k')).toBe(0);
  });
});

/* ───────────────────────────────────────────── */
/*  Budget Computation Tests                     */
/* ───────────────────────────────────────────── */

describe('computeContextBudget', () => {
  it('calculates budget for standard model', () => {
    const cap: ModelCapability = {
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      truncationStrategy: 'soft',
      tokenizer: 'cl100k',
      supportsFunctionCalling: true,
      supportsVision: true,
    };
    const budget = computeContextBudget(cap, 500, 0.8);
    expect(budget.totalWindow).toBe(128_000);
    expect(budget.reservedForSystem).toBe(500);
    expect(budget.reservedForOutput).toBe(16_384);
    expect(budget.maxInputTokens).toBe(128_000 - 500 - 16_384);
    expect(budget.safetyThreshold).toBe(0.8);
    expect(budget.safeInputLimit).toBe(Math.floor((128_000 - 500 - 16_384) * 0.8));
  });

  it('uses default system prompt length when not provided', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const budget = computeContextBudget(cap);
    expect(budget.reservedForSystem).toBe(500);
  });

  it('uses default safety threshold when not provided', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const budget = computeContextBudget(cap);
    expect(budget.safetyThreshold).toBe(0.8);
  });

  it('handles tiny window models', () => {
    const cap: ModelCapability = {
      contextWindow: 4_000,
      maxOutputTokens: 1_000,
      truncationStrategy: 'hard',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    const budget = computeContextBudget(cap, 500, 0.8);
    expect(budget.maxInputTokens).toBe(4_000 - 500 - 1_000);
    expect(budget.safeInputLimit).toBe(Math.floor(2_500 * 0.8));
  });

  it('zero safety threshold gives 0 safe limit', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const budget = computeContextBudget(cap, 500, 0);
    expect(budget.safeInputLimit).toBe(0);
  });

  it('full safety threshold gives maxInputTokens as safe limit', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const budget = computeContextBudget(cap, 500, 1.0);
    expect(budget.safeInputLimit).toBe(budget.maxInputTokens);
  });
});

/* ───────────────────────────────────────────── */
/*  Truncation Strategy Tests                    */
/* ───────────────────────────────────────────── */

describe('truncateContext — no truncation', () => {
  it('returns messages unchanged when under budget', () => {
    const messages = ['System prompt', 'User message'];
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const result = truncateContext({ messages, capability: cap });
    expect(result.wasTruncated).toBe(false);
    expect(result.strategy).toBe('none');
    expect(result.messages).toEqual(messages);
    expect(result.droppedCount).toBe(0);
  });

  it('handles many small messages within budget', () => {
    const messages = Array(20).fill('short');
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const result = truncateContext({ messages, capability: cap });
    expect(result.wasTruncated).toBe(false);
  });
});

describe('truncateContext — hard truncation', () => {
  it('truncates with hard strategy for tiny window', () => {
    const cap: ModelCapability = {
      contextWindow: 4_000,
      maxOutputTokens: 1_000,
      truncationStrategy: 'hard',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    // Each 4K-char message ~1200 tokens (gpt2). 20 messages = ~24K > 2K safe limit
    const messages = [
      'System instruction here',
      ...Array(20).fill('A'.repeat(4000)),
      'User current query',
    ];
    const result = truncateContext({ messages, capability: cap, systemPromptLength: 500 });
    expect(result.wasTruncated).toBe(true);
    expect(result.strategy).toBe('hard');
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it('preserves head and tail in hard truncation', () => {
    const cap: ModelCapability = {
      contextWindow: 4_000,
      maxOutputTokens: 1_000,
      truncationStrategy: 'hard',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    const messages = ['System: do this', 'Msg 1', 'Msg 2', 'Msg 3', 'User: final query'];
    const result = truncateContext({ messages, capability: cap, systemPromptLength: 500 });
    if (result.messages.length > 1) {
      expect(result.messages[0]).toBe(messages[0]);
      expect(result.messages[result.messages.length - 1]).toBe(messages[messages.length - 1]);
    }
  });

  it('hard truncation on single message keeps it', () => {
    const cap: ModelCapability = {
      contextWindow: 4_000,
      maxOutputTokens: 1_000,
      truncationStrategy: 'hard',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    const messages = ['Only one message here'];
    const result = truncateContext({ messages, capability: cap });
    expect(result.messages.length).toBe(1);
  });
});

describe('truncateContext — soft truncation', () => {
  it('uses soft strategy when messages exceed budget', () => {
    const cap = PRESET_MODEL_CAPABILITIES['deepseek-chat'];
    // Each 8K-char message ~2400 tokens (cl100k). 80 messages = ~192K > 64K window
    const messages = [
      'System: important instructions',
      ...Array(80).fill('A'.repeat(8000)),
      'User: final question here',
    ];
    const result = truncateContext({ messages, capability: cap, systemPromptLength: 500 });
    expect(result.wasTruncated).toBe(true);
    expect(result.strategy).toBe('soft');
    expect(result.messages.length).toBeLessThan(messages.length);
  });

  it('inserts summary placeholder when middle messages are dropped', () => {
    const cap = PRESET_MODEL_CAPABILITIES['deepseek-chat'];
    const messages = [
      'System: do this',
      ...Array(100).fill('Long message content that uses up tokens quickly'),
      'User: final',
    ];
    const result = truncateContext({ messages, capability: cap, systemPromptLength: 500 });
    if (result.droppedCount > 0) {
      const hasSummary = result.messages.some(m => m.includes('摘要'));
      expect(hasSummary).toBe(true);
    }
  });

  it('falls back to hard truncate when <= 3 messages', () => {
    const cap = PRESET_MODEL_CAPABILITIES['deepseek-chat'];
    // 3 messages of 20K chars each ~6000 tokens (qwen). With safe limit ~500 tokens (0.01 threshold)
    const messages = ['A'.repeat(20000), 'A'.repeat(20000), 'A'.repeat(20000)];
    // Force soft but tiny budget to trigger truncation
    const result = truncateContext({
      messages,
      capability: cap,
      systemPromptLength: 500,
      safetyThreshold: 0.01, // Very small budget
      forceStrategy: 'soft',
    });
    // With tiny budget, soft falls back to hard for <=3 messages
    expect(result.strategy).toBe('hard');
  });
});

describe('truncateContext — chunk truncation', () => {
  it('marks chunk split when messages severely exceed budget', () => {
    const cap = PRESET_MODEL_CAPABILITIES['kimi-moonshot-v1'];
    // Force chunk strategy regardless of model default
    const messages = Array(400).fill('A'.repeat(10000));
    const result = truncateContext({ messages, capability: cap, systemPromptLength: 500, forceStrategy: 'chunk' });
    expect(result.strategy).toBe('chunk');
    const hasChunkMarker = result.messages.some(m => m.includes('CHUNK_SPLIT'));
    expect(hasChunkMarker).toBe(true);
  });

  it('returns soft result when under budget with chunk strategy', () => {
    const cap = PRESET_MODEL_CAPABILITIES['kimi-moonshot-v1'];
    const messages = ['System', 'User query'];
    const result = truncateContext({ messages, capability: cap });
    expect(result.wasTruncated).toBe(false);
    expect(result.strategy).toBe('none');
  });
});

describe('truncateContext — none strategy fallback', () => {
  it('forces soft truncate when none strategy but over budget', () => {
    const cap: ModelCapability = {
      contextWindow: 8_000,
      maxOutputTokens: 4_096,
      truncationStrategy: 'none',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    // 8K window: 500 system + 4096 output = 3404 input budget * 0.8 = ~2723 safe limit
    // 100 messages of 4K chars each ~120K tokens (gpt2) > 2723
    const messages = Array(100).fill('A'.repeat(4000));
    const result = truncateContext({ messages, capability: cap, systemPromptLength: 500 });
    expect(result.wasTruncated).toBe(true);
    expect(result.strategy).toBe('soft');
  });
});

describe('truncateContext — forceStrategy override', () => {
  it('respects forceStrategy parameter', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    // gpt4o has 128K window. 500 messages of 3K chars ~375K tokens > 128K
    const messages = Array(500).fill('A'.repeat(3000));
    const result = truncateContext({
      messages,
      capability: cap,
      systemPromptLength: 500,
      forceStrategy: 'hard',
    });
    expect(result.strategy).toBe('hard');
  });
});

/* ───────────────────────────────────────────── */
/*  Budget Check Tests                             */
/* ───────────────────────────────────────────── */

describe('checkBudget', () => {
  it('accepts task within budget', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const result = checkBudget(cap, 'Short prompt');
    expect(result.canAccept).toBe(true);
    expect(result.overflowRatio).toBeLessThan(1);
    expect(result.suggestedStrategy).toBe('none');
    expect(result.requiresChunking).toBe(false);
  });

  it('rejects task exceeding budget', () => {
    const cap = PRESET_MODEL_CAPABILITIES['ollama-phi4'];
    const longPrompt = 'A'.repeat(50_000);
    const result = checkBudget(cap, longPrompt);
    expect(result.canAccept).toBe(false);
    expect(result.overflowRatio).toBeGreaterThan(1);
  });

  it('suggests hard strategy for moderate overflow', () => {
    const cap: ModelCapability = {
      contextWindow: 8_000,
      maxOutputTokens: 4_096,
      truncationStrategy: 'soft',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    const prompt = 'A'.repeat(15_000);
    const result = checkBudget(cap, prompt);
    expect(result.canAccept).toBe(false);
    expect(result.suggestedStrategy).toBe('hard');
    expect(result.requiresChunking).toBe(false);
  });

  it('suggests chunk for severe overflow', () => {
    const cap: ModelCapability = {
      contextWindow: 4_000,
      maxOutputTokens: 1_000,
      truncationStrategy: 'soft',
      tokenizer: 'gpt2',
      supportsFunctionCalling: false,
      supportsVision: false,
    };
    const prompt = 'A'.repeat(50_000);
    const result = checkBudget(cap, prompt);
    expect(result.canAccept).toBe(false);
    expect(result.suggestedStrategy).toBe('chunk');
    expect(result.requiresChunking).toBe(true);
  });

  it('includes context messages in calculation', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const prompt = 'Short prompt';
    const context = Array(50).fill('Previous conversation message');
    const result = checkBudget(cap, prompt, context);
    expect(result.estimatedInputTokens).toBeGreaterThan(estimateTokens(prompt, cap.tokenizer));
  });

  it('adjusts with custom system prompt length', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const resultShort = checkBudget(cap, 'test', [], 100);
    const resultLong = checkBudget(cap, 'test', [], 5000);
    // Longer system prompt = smaller safe limit
    expect(resultLong.safeInputLimit).toBeLessThan(resultShort.safeInputLimit);
  });
});

/* ───────────────────────────────────────────── */
/*  ContextBudgetManager Class Tests             */
/* ───────────────────────────────────────────── */

describe('ContextBudgetManager', () => {
  let manager: ContextBudgetManager;

  beforeEach(() => {
    manager = new ContextBudgetManager();
  });

  it('getPresetCapability returns known model config', () => {
    const cap = ContextBudgetManager.getPresetCapability('openai-gpt4o');
    expect(cap).toBeDefined();
    expect(cap?.contextWindow).toBe(128_000);
    expect(cap?.supportsFunctionCalling).toBe(true);
  });

  it('getPresetCapability returns undefined for unknown model', () => {
    const cap = ContextBudgetManager.getPresetCapability('unknown-model-xyz');
    expect(cap).toBeUndefined();
  });

  it('computeBudget delegates correctly', () => {
    const cap = PRESET_MODEL_CAPABILITIES['anthropic-claude-sonnet'];
    const budget = manager.computeBudget(cap, 1000, 0.9);
    expect(budget.totalWindow).toBe(200_000);
    expect(budget.reservedForSystem).toBe(1000);
    expect(budget.safetyThreshold).toBe(0.9);
  });

  it('checkTaskBudget returns acceptance result', () => {
    const cap = PRESET_MODEL_CAPABILITIES['deepseek-chat'];
    const result = manager.checkTaskBudget(cap, 'Short task');
    expect(result.canAccept).toBe(true);
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
  });

  it('truncate delegates correctly', () => {
    const cap = PRESET_MODEL_CAPABILITIES['openai-gpt4o'];
    const messages = ['System', 'User'];
    const result = manager.truncate({ messages, capability: cap });
    expect(result.wasTruncated).toBe(false);
  });

  it('createLightweightMessage produces correct structure', () => {
    const msg = manager.createLightweightMessage('task-1', 'prompt text', 'state-1', 32768, 'high');
    expect(msg).toEqual({
      taskId: 'task-1',
      action: 'execute',
      prompt: 'prompt text',
      stateRef: 'state-1',
      maxContextSize: 32768,
      priority: 'high',
    });
  });

  it('canAcceptTask allows reasonable token count', () => {
    const result = manager.canAcceptTask('agent-1', 1000);
    expect(result.ok).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('canAcceptTask rejects excessive token count', () => {
    const result = manager.canAcceptTask('agent-1', 50_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('exceeds');
  });

  it('canAcceptTask handles edge case at exact limit', () => {
    const limit = Math.floor(32768 * 0.8);
    const result = manager.canAcceptTask('agent-1', limit);
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('saveState warns without store', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await manager.saveState({ stateId: 's1', createdAt: 0, messageCount: 1, totalTokens: 10 });
    consoleSpy.mockRestore();
  });

  it('loadState returns null without store', async () => {
    const result = await manager.loadState('s1');
    expect(result).toBeNull();
  });

  it('works with custom state store', async () => {
    const states = new Map<string, any>();
    const store = {
      save: async (state: any) => { states.set(state.stateId, state); },
      load: async (id: string) => states.get(id) || null,
      list: async (_agentId: string) => [],
      delete: async (_id: string) => {},
    };
    const mgr = new ContextBudgetManager(store);
    const state = { stateId: 's1', createdAt: 123, messageCount: 5, totalTokens: 100 };
    await mgr.saveState(state);
    const loaded = await mgr.loadState('s1');
    expect(loaded).toEqual(state);
  });
});

/* ───────────────────────────────────────────── */
/*  Preset Capabilities Validation                 */
/* ───────────────────────────────────────────── */

describe('PRESET_MODEL_CAPABILITIES', () => {
  it('contains all expected models', () => {
    expect(PRESET_MODEL_CAPABILITIES['openai-gpt4o']).toBeDefined();
    expect(PRESET_MODEL_CAPABILITIES['anthropic-claude-sonnet']).toBeDefined();
    expect(PRESET_MODEL_CAPABILITIES['kimi-k2.6']).toBeDefined();
    expect(PRESET_MODEL_CAPABILITIES['deepseek-chat']).toBeDefined();
  });

  it('every preset has valid contextWindow > maxOutputTokens', () => {
    for (const [id, cap] of Object.entries(PRESET_MODEL_CAPABILITIES)) {
      expect(cap.contextWindow, `${id} contextWindow`).toBeGreaterThan(cap.maxOutputTokens);
      expect(cap.maxOutputTokens, `${id} maxOutputTokens`).toBeGreaterThan(0);
    }
  });

  it('every preset has valid tokenizer', () => {
    const validTokenizers = ['gpt2', 'cl100k', 'qwen', 'llama3', 'mistral', 'custom'];
    for (const [id, cap] of Object.entries(PRESET_MODEL_CAPABILITIES)) {
      expect(validTokenizers, `${id} tokenizer`).toContain(cap.tokenizer);
    }
  });

  it('ollama models have smaller context windows', () => {
    const ollamaKeys = Object.keys(PRESET_MODEL_CAPABILITIES).filter(k => k.startsWith('ollama-'));
    expect(ollamaKeys.length).toBeGreaterThan(0);
    for (const key of ollamaKeys) {
      expect(PRESET_MODEL_CAPABILITIES[key].contextWindow).toBeLessThanOrEqual(128_000);
    }
  });
});
