// backend/src/services/UniversalPlatformAdapter.ts
// 通用平台适配器 — 从配置动态注册任何 OpenAI 兼容平台
// 覆盖 58 个平台中的通用 OpenAI 兼容类

import { logger } from '../utils/logger';
import { executeChatCompletion } from '../coordinator/bridges/ProviderAdapters';

export interface PlatformConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: 'openai' | 'anthropic';
  model: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════
//  从环境变量自动加载平台配置
// ═══════════════════════════════════════════════════════════════

const PLATFORM_REGISTRY: PlatformConfig[] = [
  // Kimi Code — 已验证有效
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/v1',
    apiKey: process.env.KIMICODE_API_KEY || process.env.KIMI_CODE_API_KEY_1 || '',
    apiFormat: 'openai',
    model: 'kimi-for-coding',
    headers: { 'User-Agent': 'KimiCLI/0.77' },
    enabled: !!(process.env.KIMICODE_API_KEY || process.env.KIMI_CODE_API_KEY_1),
  },
  // Moonshot
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: process.env.MOONSHOT_API_KEY || '',
    apiFormat: 'openai',
    model: 'moonshot-v1-8k',
    enabled: !!process.env.MOONSHOT_API_KEY,
  },
  // OpenAI
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || '',
    apiFormat: 'openai',
    model: 'gpt-4o',
    enabled: !!process.env.OPENAI_API_KEY,
  },
  // Claude (Anthropic)
  {
    id: 'claude',
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    apiFormat: 'anthropic',
    model: 'claude-3-5-sonnet',
    enabled: !!process.env.ANTHROPIC_API_KEY,
  },
  // DeepSeek
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    apiFormat: 'openai',
    model: 'deepseek-chat',
    enabled: !!process.env.DEEPSEEK_API_KEY,
  },
  // Mistral
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: process.env.MISTRAL_API_KEY || '',
    apiFormat: 'openai',
    model: 'mistral-large',
    enabled: !!process.env.MISTRAL_API_KEY,
  },
  // Qwen (阿里云)
  {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    apiKey: process.env.QWEN_API_KEY || '',
    apiFormat: 'anthropic',
    model: 'qwen-coder',
    enabled: !!process.env.QWEN_API_KEY,
  },
];

// ═══════════════════════════════════════════════════════════════
//  动态添加自定义平台
// ═══════════════════════════════════════════════════════════════

export function registerPlatform(config: PlatformConfig): void {
  const existing = PLATFORM_REGISTRY.find(p => p.id === config.id);
  if (existing) {
    Object.assign(existing, config);
    logger.info(`[UniversalAdapter] Updated platform: ${config.id}`);
  } else {
    PLATFORM_REGISTRY.push(config);
    logger.info(`[UniversalAdapter] Registered platform: ${config.id}`);
  }
}

export function getPlatforms(): PlatformConfig[] {
  return PLATFORM_REGISTRY.filter(p => p.enabled);
}

export function getPlatform(id: string): PlatformConfig | undefined {
  return PLATFORM_REGISTRY.find(p => p.id === id && p.enabled);
}

// ═══════════════════════════════════════════════════════════════
//  统一对话调用
// ═══════════════════════════════════════════════════════════════

export async function chatWithPlatform(
  platformId: string,
  messages: Array<{ role: string; content: string }>,
  stream = false
) {
  const platform = getPlatform(platformId);
  if (!platform) {
    throw new Error(`Platform ${platformId} not found or not enabled`);
  }

  return executeChatCompletion(
    platform.apiFormat,
    platform.baseUrl,
    platform.apiKey,
    platform.id,
    {
      model: platform.model,
      messages: messages.map(m => ({
        role: m.role as any,
        content: m.content,
      })),
      stream,
      temperature: 0.7,
    }
  );
}

// ═══════════════════════════════════════════════════════════════
//  健康检查
// ═══════════════════════════════════════════════════════════════

export async function checkPlatformHealth(platformId: string): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const platform = getPlatform(platformId);
  if (!platform) {
    return { healthy: false, latencyMs: 9999, error: 'Platform not configured' };
  }

  const start = Date.now();
  try {
    // 简单 GET /models 检查连通性
    const url = platform.baseUrl.replace(/\/$/, '') + '/models';
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${platform.apiKey}`,
        ...platform.headers,
      },
      signal: AbortSignal.timeout(10000),
    });

    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { healthy: true, latencyMs };
    } else {
      return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  一键检测所有平台
// ═══════════════════════════════════════════════════════════════

export async function detectAllPlatforms(): Promise<
  Array<{ id: string; name: string; healthy: boolean; latencyMs: number; error?: string }>
> {
  const results = [];
  for (const platform of PLATFORM_REGISTRY) {
    const health = await checkPlatformHealth(platform.id);
    results.push({
      id: platform.id,
      name: platform.name,
      ...health,
    });
  }
  return results;
}

logger.info(`[UniversalAdapter] Loaded ${PLATFORM_REGISTRY.filter(p => p.enabled).length}/${PLATFORM_REGISTRY.length} platforms`);
