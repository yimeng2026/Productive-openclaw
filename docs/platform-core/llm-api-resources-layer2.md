# LLM API 测试资源汇总 — 第二层搜索成果

## GitHub 官方测试资源

### 1. Gemini (Google)
**仓库**: `google/generative-ai-js`  
**REST API 文档**: https://ai.google.dev/gemini-api/docs  
**免费额度**: 1,500次/天  
**申请**: https://aistudio.google.com/app/apikey  

关键端点:
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"你好"}]}]}'
```

**坑点**: `system` 指令需包装为 `contents` 数组，`model` 在 URL 中而非 body。

---

### 2. OpenRouter
**仓库**: `OpenRouterTeam/openrouter-examples`  
**文档**: https://openrouter.ai/docs  
**免费额度**: 50次/天  
**申请**: https://openrouter.ai/settings/keys  

关键端点:
```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "HTTP-Referer: https://localhost" \
  -H "X-Title: TestApp" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-chat-v3-0324:free","messages":[{"role":"user","content":"你好"}]}'
```

**坑点**: 必须 `HTTP-Referer` + `X-Title`，免费模型后缀 `:free`，`402` 表示 Referer 缺失。

---

### 3. DeepSeek
**仓库**: `deepseek-ai/DeepSeek-V3`  
**官方 API**: https://api-docs.deepseek.com/  
**免费额度**: 新用户 ¥10  
**申请**: https://platform.deepseek.com/api_keys  

关键端点:
```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

**坑点**: 标准 OpenAI 格式，但 `deepseek-coder` 和 `deepseek-reasoner` 模型需分别测试。

---

### 4. Qwen (阿里云百炼)
**仓库**: `QwenLM/Qwen-Agent` / `QwenLM/qwen-code`  
**文档**: https://help.aliyun.com/zh/dashscope/  
**免费额度**: 100万Token（180天）  
**申请**: https://dashscope.console.aliyun.com/apiKey  

**两种端点**:

A. 原生格式:
```bash
curl https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-turbo","input":{"messages":[{"role":"user","content":"你好"}]}}'
```

B. OpenAI 兼容模式:
```bash
curl https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-turbo","messages":[{"role":"user","content":"你好"}]}'
```

**额外**: ModelScope 也提供免费 Qwen API（2,000次/天）
```bash
curl https://api-inference.modelscope.cn/v1/chat/completions \
  -H "Authorization: Bearer $MODELSCOPE_API_KEY" \
  -d '{"model":"Qwen/Qwen3-Coder-480B-A35B-Instruct","messages":[{"role":"user","content":"你好"}]}'
```

**坑点**: 原生格式 body 结构不同（`input` + `parameters`），兼容模式更推荐。

---

## UnifiedAPIClient 适配验证清单

| Provider | 适配器 | 关键差异 | 状态 |
|---------|--------|---------|------|
| Gemini | `GeminiAdapter` | `contents`/`parts` 格式，URL 传 key | ✅ 已实现 |
| OpenRouter | `OpenRouterAdapter` | `HTTP-Referer` + `X-Title` | ✅ 已实现 |
| DeepSeek | `DeepSeekAdapter` | 标准 OpenAI 格式 | ✅ 已实现 |
| Qwen | `QwenAdapter` | 原生 `input` + `parameters` | ✅ 已实现 |
| Qwen 兼容 | `OpenAIAdapter` (fallback) | `/compatible-mode/v1` | ✅ 已覆盖 |

---

## 下一步

用户有 key 的 provider 立即验证，没有的标记为待申请。跑 `node llm-api-test.js` 或 `python test_kimi_layer1.py` 收集实际 latency 和响应格式。

*搜索完成: 2026-05-29*
