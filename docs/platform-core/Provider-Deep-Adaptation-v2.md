# 千界花园 LLM Provider 深度适配优化方案

> 类比 Kimi Code API 的深度适配经验，为全部 10 个 Provider 设计统一优化策略

---

## 一、Kimi Code 已验证的 5 个核心优化点

| # | 优化点 | Kimi Code 具体做法 | 效果 |
|---|--------|-------------------|------|
| 1 | **特殊 UA 处理** | `User-Agent: KimiCLI/0.77`，外加 `X-Msh-*` 设备标识头 | 避免风控拦截 |
| 2 | **双字段合并** | `content + reasoning_content` 合并输出 | 防止 content 被截断为空 |
| 3 | **Token 预算分级** | 简单对话 500-1500，普通任务 2000，代码生成 4000+ | 平衡成本与质量 |
| 4 | **Timeout 分级** | 简单 30s，普通 60s，代码生成 120s+ | 避免超时失败 |
| 5 | **流式优先** | 所有生产调用使用 `stream=true`，chunks 稳定 ~400+ | 13秒完成 vs 60秒阻塞 |

---

## 二、其他 9 个 Provider 的类比优化

### 1. OpenAI / Azure

| Kimi Code 经验 | OpenAI 类比做法 |
|----------------|----------------|
| 特殊 UA | `User-Agent: claude-code/0.7.8` 已在使用 ✅，但 OpenAI 无特殊 UA 要求 |
| 双字段合并 | **o1/o3 模型禁用 temperature**，使用 `max_completion_tokens` 而非 `max_tokens` |
| Token 预算 | o1 模型 reasoning 不可见，无需合并；但 `max_completion_tokens` 必须 ≥ `completion_tokens` + `reasoning_tokens` |
| Timeout 分级 | OpenAI 通常 30s 内响应，代码生成建议 60s |
| 流式优先 | `stream=true` 支持完善，**强制启用** |

**新增适配点：**
- `o1/o3` 系列：`temperature` 必须为 1 或省略，`top_p` 必须为 1 或省略
- Azure：动态 URL 拼接 `https://{resource}.openai.azure.com/openai/deployments/{deployment}`
- Azure：`api-key` header 而非 `Authorization: Bearer`

### 2. Anthropic

| Kimi Code 经验 | Anthropic 类比做法 |
|----------------|---------------------|
| 特殊 UA | 无特殊要求 |
| 双字段合并 | **`thinking` 块** + `content` 需要合并。`thinking` 是 Anthropic 的 reasoning_content |
| Token 预算 | `max_tokens` 必须 ≥ 1024（`thinking` 默认占用），建议代码生成 4000+ |
| Timeout 分级 | Claude 3.5 Sonnet 推理快，但 Claude 3 Opus 代码生成可能 60s+ |
| 流式优先 | `stream=true` 支持事件流，`message_start` / `content_block_start` / `content_block_delta` |

**新增适配点：**
- `thinking` 参数：`{"type": "enabled", "budget_tokens": 16000}`
- Computer Use：`content` 数组包含 `type: "tool_use"` 和 `type: "tool_result"`
- 系统提示：顶层 `system` 字段（不是 messages 中的 system role）

### 3. DeepSeek

| Kimi Code 经验 | DeepSeek 类比做法 |
|----------------|------------------|
| 特殊 UA | 无特殊要求 |
| 双字段合并 | **`reasoning_content`** 存在！和 Kimi Code 完全一致，需要合并 |
| Token 预算 | `max_tokens` 需要 4000+ 用于代码生成 |
| Timeout 分级 | DeepSeek-V3 快，R1 推理慢，建议 120s |
| 流式优先 | 支持 `stream=true` |

**新增适配点：**
- API 端点：`https://api.deepseek.com/v1/chat/completions`（注意 `/v1` 后缀）
- `reasoning_content` 在 `message` 中和 `content` 并列
- `thinking` + `tool_calls` 可能冲突，需要检测

### 4. Moonshot / Qwen

| Kimi Code 经验 | Moonshot 类比做法 |
|----------------|------------------|
| 特殊 UA | 无 |
| 双字段合并 | **`enable_thinking=true`** 时返回 `reasoning_content`，和 Kimi Code 一致 |
| Token 预算 | 同 Kimi Code |
| Timeout 分级 | 同 Kimi Code |
| 流式优先 | 支持 |

### 5. Gemini

| Kimi Code 经验 | Gemini 类比做法 |
|----------------|-----------------|
| 特殊 UA | 无 |
| 双字段合并 | **`thinkingBudget`** 控制推理深度，thinking 结果在 `candidates[0].content.parts` 中 |
| Token 预算 | `maxOutputTokens` 默认 2048，建议代码生成 4096 |
| Timeout 分级 | Gemini Pro 快，Flash 极快，代码生成 60s |
| 流式优先 | `streamGenerateContent` 方法 |

**新增适配点：**
- 请求格式完全不同：`contents` 数组而非 `messages`
- 系统提示：`systemInstruction` 顶层字段
- 多模态：`inlineData` base64 编码
- Grounding：`tools: [{ google_search: {} }]`

### 6. GLM

| Kimi Code 经验 | GLM 类比做法 |
|----------------|-------------|
| 特殊 UA | 无 |
| 双字段合并 | 无 reasoning_content，标准 OpenAI 兼容格式 |
| Token 预算 | 标准兼容 |
| Timeout 分级 | 标准 30-60s |
| 流式优先 | 标准兼容 |

**结论**：GLM 最接近标准 OpenAI 格式，**无需特殊适配**，直接透传。

### 7. OpenRouter

| Kimi Code 经验 | OpenRouter 类比做法 |
|----------------|-------------------|
| 特殊 UA | 无 |
| 双字段合并 | **`include_reasoning: true`** 在 extra body 中，reasoning 在 `choices[0].message.reasoning` |
| Token 预算 | 标准兼容 |
| Timeout 分级 | 依赖底层 Provider，建议 120s |
| 流式优先 | 支持，但可能因底层 Provider 不同而有差异 |

**新增适配点：**
- `provider` 排序：`{"provider": {"order": ["DeepSeek", "Moonshot"]}}`
- `fallback` 机制：一个 Provider 失败自动切换
- `include_reasoning` 获取底层 Provider 的 reasoning

---

## 三、统一优化架构设计（类比 Kimi Code → 全 Provider）

```typescript
interface ProviderOptimization {
  // 1. 特殊 Header
  customHeaders: Record<string, string>;
  
  // 2. 字段合并策略
  reasoningField: string | null;        // 'reasoning_content' | 'thinking' | 'reasoning' | null
  mergeStrategy: 'concat' | 'ignore' | 'separate';  // concat=合并到content, ignore=丢弃, separate=保留独立字段
  
  // 3. Token 预算分级
  tokenBudgets: {
    simple: number;      // 问候/简单问答
    normal: number;       // 一般任务
    code: number;         // 代码生成
    long: number;         // 长输出
  };
  
  // 4. Timeout 分级
  timeouts: {
    simple: number;
    normal: number;
    code: number;
    long: number;
  };
  
  // 5. 流式支持
  streamingSupported: boolean;
  streamingPreferred: boolean;  // 是否强制优先使用流式
  
  // 6. 特殊参数限制
  forbiddenParams: string[];    // 如 o1 禁用 temperature
  requiredParams: string[];     // 如 Gemini 需要 systemInstruction
}
```

### 各 Provider 配置实例

```typescript
const PROVIDER_CONFIG: Record<string, ProviderOptimization> = {
  'kimi-code': {
    customHeaders: { 'User-Agent': 'KimiCLI/0.77' },
    reasoningField: 'reasoning_content',
    mergeStrategy: 'concat',
    tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
    timeouts: { simple: 30, normal: 60, code: 120, long: 120 },
    streamingSupported: true,
    streamingPreferred: true,
    forbiddenParams: [],
    requiredParams: [],
  },
  'openai': {
    customHeaders: {},
    reasoningField: null,  // o1/o3 的 reasoning 不可见
    mergeStrategy: 'ignore',
    tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
    timeouts: { simple: 30, normal: 60, code: 60, long: 90 },
    streamingSupported: true,
    streamingPreferred: true,
    forbiddenParams: ['temperature', 'top_p'],  // o1/o3
    requiredParams: [],
  },
  'anthropic': {
    customHeaders: {},
    reasoningField: 'thinking',  // 在 content 块中
    mergeStrategy: 'separate',   // thinking 和 content 分开保留
    tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
    timeouts: { simple: 30, normal: 60, code: 90, long: 120 },
    streamingSupported: true,
    streamingPreferred: true,
    forbiddenParams: [],
    requiredParams: ['system'],  // 顶层 system 字段
  },
  'deepseek': {
    customHeaders: {},
    reasoningField: 'reasoning_content',
    mergeStrategy: 'concat',
    tokenBudgets: { simple: 500, normal: 1500, code: 4000, long: 4000 },
    timeouts: { simple: 30, normal: 60, code: 120, long: 120 },
    streamingSupported: true,
    streamingPreferred: true,
    forbiddenParams: [],
    requiredParams: [],
  },
  'gemini': {
    customHeaders: {},
    reasoningField: null,
    mergeStrategy: 'ignore',
    tokenBudgets: { simple: 500, normal: 1500, code: 4096, long: 4096 },
    timeouts: { simple: 30, normal: 60, code: 60, long: 90 },
    streamingSupported: true,
    streamingPreferred: true,
    forbiddenParams: [],
    requiredParams: ['systemInstruction', 'contents'],
  },
};
```

---

## 四、生产环境建议（来自 GitHub 成熟项目）

### 1. 指数退避重试（来自 Portkey / ResilientLLM）

```typescript
function calculateBackoffDelay(attempt: number): number {
  const baseDelay = 1000;      // 1s
  const maxDelay = 16000;      // 16s
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  // Jitter ±25%
  const jitter = delay * 0.25;
  return delay + (Math.random() * 2 - 1) * jitter;
}

// 重试序列：1s → 2s → 4s → 8s → 16s（累计 31s）
```

### 2. 熔断器模式（来自 ResilientLLM / OpenClaw #74054）

- 连续 5 次失败后，熔断器打开，停止请求 30 秒
- 半开状态：允许 1 个探测请求
- 成功则关闭熔断器，失败则重新打开

### 3. Token 预算预检查（来自 llm-api / Fenic）

```typescript
function estimateTokens(text: string): number {
  // 中文 ~1.5 token/字，英文 ~1 token/字
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 1.5 + otherChars * 1);
}

// 请求前检查：input_tokens + expected_output_tokens < max_tokens
// 否则提前抛出 TokenError，不浪费 API 调用
```

### 4. 流式超时恢复（来自 Claude Code）

```typescript
// 流式输出时，如果中途超时，保留已收到的部分
let partialContent = '';
try {
  for await (const chunk of stream) {
    partialContent += chunk.content;
  }
} catch (e) {
  if (partialContent.length > 0) {
    // 返回部分结果 + 错误提示，而非完全失败
    return { content: partialContent + '\n[生成中断，部分结果]', status: 'partial' };
  }
  throw e; // 完全失败才重试
}
```

---

## 五、实施优先级

| 优先级 | 任务 | 类比 Kimi Code 的哪个优化 |
|--------|------|--------------------------|
| P0 | 为每个 Provider 实现 `ProviderOptimization` 配置 | 特殊 Header + Token 预算 + Timeout 分级 |
| P0 | 统一重试机制（指数退避 + 熔断器） | 避免 T3 超时导致的完全失败 |
| P1 | Token 预算预检查（`estimateTokens`） | 防止 content=0 的 length 截断 |
| P1 | 流式输出默认启用 | 13秒 vs 60秒的响应时间差异 |
| P1 | 流式超时部分恢复 | 用户体验：有总比没有好 |
| P2 | Provider 健康检查 Dashboard | 用量统计（抄 LiteLLM） |

---

**文件位置**：`sylva_platform/docs/Provider-Deep-Adaptation-v2.md`
