# 千界花园 — 各平台 LLM API 官方测试资源汇总

> 搜索时间: 2026-05-28 | 来源: GitHub/官方文档/社区

---

## 一、免费测试额度排名（2026年5月）

| 排名 | 平台 | 免费额度 | Playground | 需信用卡 | 永久免费 |
|------|------|---------|------------|---------|---------|
| 🥇 | **Google Gemini** | Flash: 15 RPM / 1,500 RPD | AI Studio ✅ | ❌ 否 | ✅ 是 |
| 🥈 | **OpenAI** | GPT-4o-mini: 500 RPM 无限 RPD | Playground ✅ | ❌ 否（但需绑定） | ❌ 否 |
| 🥉 | **Anthropic** | ~$5 试用额度 | Console ✅ | ❌ 否 | ❌ 否 |
| 4 | **Moonshot/Kimi** | ¥15 免费额度 | 无官方 Playground | ❌ 否 | ❌ 否 |
| 5 | **DeepSeek** | 有免费测试额度 | 无官方 Playground | ❌ 否 | ❌ 否 |
| 6 | **OpenRouter** | 免费模型 20 RPM | 有 Playground | ❌ 否 | ✅ 是 |
| 7 | **GLM** | 有免费额度 | 无官方 Playground | ❌ 否 | ❌ 否 |
| 8 | **Qwen** | 有免费额度 | 无官方 Playground | ❌ 否 | ❌ 否 |

> ⚠️ **注意**: "永久免费"指平台承诺长期维持免费 tier，但额度可能调整。

---

## 二、各平台详细测试信息

### 1. Google Gemini ⭐ 最推荐

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://generativelanguage.googleapis.com/v1beta` |
| **免费模型** | `gemini-2.5-flash` |
| **免费额度** | 15 RPM, 1,500 RPD |
| **Playground** | [aistudio.google.com](https://aistudio.google.com) ✅ 无代码测试 |
| **获取 Key** | Google账号 → AI Studio → Get API Key |
| **需信用卡** | ❌ 否 |
| **特殊限制** | 免费 tier 数据用于训练；Pro 无免费 API tier |
| **SDK** | `@google/generative-ai` (npm) |
| **测试 cURL** | 见下方 |

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

### 2. OpenAI

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://api.openai.com/v1` |
| **免费模型** | `gpt-4o-mini` |
| **免费额度** | 新用户 $5（3个月过期）；GPT-4o-mini 500 RPM |
| **Playground** | [platform.openai.com/playground](https://platform.openai.com/playground/chat) ✅ |
| **获取 Key** | 注册 → Settings → API Keys → Create |
| **需信用卡** | ⚠️ 需预付费最低 $5 才能持续使用 |
| **特殊限制** | o1/o3 禁用 temperature；$5 额度仅够测试 |
| **SDK** | `openai` (npm) |

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'
```

### 3. Anthropic / Claude

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://api.anthropic.com/v1` |
| **免费模型** | 无专门免费模型，但所有模型可用试用额度 |
| **免费额度** | ~$5 试用额度 |
| **Playground** | [console.anthropic.com](https://console.anthropic.com) ✅ |
| **获取 Key** | 注册 → 手机号验证 → Settings → API Keys |
| **需信用卡** | ❌ 否（但额度用完需充值） |
| **特殊限制** | API key 只显示一次；thinking 需 max_tokens ≥ 1024 |
| **SDK** | `@anthropic-ai/sdk` (npm) |

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"Hello"}]}'
```

### 4. DeepSeek

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://api.deepseek.com/v1` |
| **免费模型** | `deepseek-chat`, `deepseek-reasoner` |
| **免费额度** | 有免费测试额度（具体数额官网查询） |
| **Playground** | ❌ 无官方 Playground |
| **获取 Key** | 官网注册 → API Keys |
| **需信用卡** | ❌ 否 |
| **特殊限制** | 返回 `reasoning_content`；V3 快，R1 推理慢 |
| **SDK** | 标准 OpenAI 兼容格式 |

```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'
```

### 5. Moonshot / Kimi

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://api.moonshot.cn/v1` (通用) / `https://api.kimi.com/coding/v1` (Code) |
| **免费模型** | `moonshot-v1-8k` 等 |
| **免费额度** | 新用户 ¥15 |
| **Playground** | ❌ 无官方 Playground |
| **获取 Key** | 官网注册 → 开发者中心 → API Keys |
| **需信用卡** | ❌ 否 |
| **特殊限制** | Code API 需特殊 UA (`KimiCLI/0.77`)；返回 `reasoning_content` |

```bash
# 通用 API
curl https://api.moonshot.cn/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOONSHOT_API_KEY" \
  -d '{"model":"moonshot-v1-8k","messages":[{"role":"user","content":"Hello"}]}'

# Kimi Code API
curl https://api.kimi.com/coding/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KIMI_API_KEY" \
  -H "User-Agent: KimiCLI/0.77" \
  -d '{"model":"kimi-for-coding","messages":[{"role":"user","content":"Hello"}]}'
```

### 6. OpenRouter

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://openrouter.ai/api/v1` |
| **免费模型** | 部分模型免费（如 DeepSeek 通过 OpenRouter） |
| **免费额度** | 免费模型 20 RPM |
| **Playground** | [openrouter.ai](https://openrouter.ai) ✅ |
| **获取 Key** | 注册 → Keys |
| **需信用卡** | ❌ 否（免费模型） |
| **特殊限制** | 需 `HTTP-Referer` 和 `X-Title` header；provider 排序可选 |

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "HTTP-Referer: https://your-site.com" \
  -H "X-Title: Your App" \
  -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'
```

### 7. GLM (智谱)

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://api.z.ai/api/paas/v4` (新版) / `https://open.bigmodel.cn/api/paas/v4` (旧版) |
| **免费模型** | `glm-4` 等 |
| **免费额度** | 有免费测试额度 |
| **Playground** | ❌ 无官方 Playground |
| **获取 Key** | [bigmodel.cn](https://bigmodel.cn) 注册 → API Keys |
| **需信用卡** | ❌ 否 |
| **特殊限制** | 标准 OpenAI 兼容格式 |

### 8. Qwen (通义千问)

| 项目 | 详情 |
|------|------|
| **API 端点** | `https://dashscope.aliyuncs.com/api/v1` |
| **免费模型** | `qwen-turbo`, `qwen-plus` |
| **免费额度** | 有免费测试额度 |
| **Playground** | ❌ 无官方 Playground |
| **获取 Key** | [dashscope.aliyun.com](https://dashscope.aliyun.com) 注册 |
| **需信用卡** | ❌ 否 |
| **特殊限制** | 返回 `reasoning_content`；兼容 OpenAI 格式 |

---

## 三、统一测试脚本框架

```javascript
// llm-api-test.js — 多平台 LLM API 统一测试脚本
// 使用: node llm-api-test.js

const PROVIDERS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (msg) => ({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: msg }],
      max_tokens: 100,
    }),
    extract: (json) => json.choices?.[0]?.message?.content,
  },

  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: (msg) => ({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{ role: 'user', content: msg }],
    }),
    extract: (json) => json.content?.[0]?.text,
  },

  gemini: {
    endpoint: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (msg) => ({
      contents: [{ parts: [{ text: msg }] }],
    }),
    extract: (json) => json.candidates?.[0]?.content?.parts?.[0]?.text,
  },

  deepseek: {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (msg) => ({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: msg }],
      max_tokens: 100,
    }),
    extract: (json) => json.choices?.[0]?.message?.content,
  },

  kimi: {
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    body: (msg) => ({
      model: 'moonshot-v1-8k',
      messages: [{ role: 'user', content: msg }],
      max_tokens: 100,
    }),
    extract: (json) => json.choices?.[0]?.message?.content,
  },

  kimiCode: {
    endpoint: 'https://api.kimi.com/coding/v1/chat/completions',
    model: 'kimi-for-coding',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'User-Agent': 'KimiCLI/0.77',
    }),
    body: (msg) => ({
      model: 'kimi-for-coding',
      messages: [{ role: 'user', content: msg }],
      max_tokens: 100,
    }),
    extract: (json) => json.choices?.[0]?.message?.content,
  },
};

const TEST_PROMPT = 'Hello! Please reply with a single word.';

async function testProvider(name, config, apiKey) {
  const start = Date.now();
  try {
    const endpoint = typeof config.endpoint === 'function' ? config.endpoint(apiKey) : config.endpoint;
    const headers = config.headers(apiKey);
    const body = config.body(TEST_PROMPT);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const latency = Date.now() - start;
    
    if (!res.ok) {
      const txt = await res.text();
      return { name, status: 'FAIL', error: `HTTP ${res.status}: ${txt.slice(0, 200)}`, latency };
    }

    const json = await res.json();
    const content = config.extract(json);
    
    return {
      name,
      status: content ? 'PASS' : 'EMPTY',
      content: content?.slice(0, 100),
      latency,
      model: config.model,
    };
  } catch (e) {
    return { name, status: 'ERROR', error: e.message, latency: Date.now() - start };
  }
}

async function main() {
  const results = [];
  
  for (const [name, config] of Object.entries(PROVIDERS)) {
    const envKey = name.toUpperCase() + '_API_KEY';
    const key = process.env[envKey];
    
    if (!key) {
      results.push({ name, status: 'SKIP', error: `Env var ${envKey} not set` });
      continue;
    }
    
    const result = await testProvider(name, config, key);
    results.push(result);
    console.log(`${result.status} ${result.name} ${result.latency ? result.latency + 'ms' : ''} ${result.error || result.content || ''}`);
  }

  // 汇总
  const passed = results.filter(r => r.status === 'PASS').length;
  const total = results.filter(r => r.status !== 'SKIP').length;
  console.log(`\nSummary: ${passed}/${total} passed`);
}

main();
```

**运行方式：**
```bash
# 设置环境变量
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
export DEEPSEEK_API_KEY="sk-..."
export MOONSHOT_API_KEY="sk-..."
export KIMI_API_KEY="sk-..."

# 运行测试
node llm-api-test.js
```

---

## 四、免费额度最大化策略

### 组合方案 A：零成本全平台测试
1. **Google Gemini** — 主力测试（1,500 RPD，永久免费）
2. **OpenAI GPT-4o-mini** — 辅助测试（500 RPM）
3. **OpenRouter 免费模型** — 兜底（20 RPM）
4. **各平台 $5 试用额度** — 深度测试（用完即止）

### 组合方案 B：生产环境低成本
1. **Google Gemini Flash** — 日常调用（最便宜）
2. **OpenRouter** — 多模型聚合 + 自动降级
3. **本地 Ollama** — 私有数据/高频调用（零 API 成本）

### 额度监控建议
- 使用 `SpendTracker.ts`（已写入项目）追踪各平台用量
- 设置每日/每周告警阈值
- 自动降级到免费 tier 或 OpenRouter

---

## 五、API Key 获取清单

| 平台 | 注册地址 | 获取 Key 路径 | 预计时间 |
|------|---------|--------------|---------|
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) | Get API Key | 2分钟 |
| OpenAI | [platform.openai.com](https://platform.openai.com) | Settings → API Keys | 5分钟 |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Settings → API Keys | 5分钟 |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | API Keys | 3分钟 |
| Moonshot | [platform.moonshot.cn](https://platform.moonshot.cn) | 开发者中心 → API Keys | 3分钟 |
| OpenRouter | [openrouter.ai](https://openrouter.ai) | Keys | 2分钟 |
| GLM | [bigmodel.cn](https://bigmodel.cn) | API Keys | 3分钟 |
| Qwen | [dashscope.aliyun.com](https://dashscope.aliyun.com) | 开通 → API Keys | 3分钟 |

---

**文件位置**: `sylva_platform/docs/LLM-API-Testing-Guide.md`
