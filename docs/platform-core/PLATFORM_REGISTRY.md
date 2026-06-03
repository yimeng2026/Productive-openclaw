# Sylva Platform Registry — 平台适配清单与安装指南

> **Document ID**: `SYLVA-PLATFORM-REGISTRY`  
> **Version**: `v1.0.0`  
> **Last Updated**: `2026-05-18`  
> **Maintainer**: `Sylva Platform Team`  

---

## 目录

1. [概览与优先级策略](#概览与优先级策略)
2. [CLI / Coding 工具](#cli--coding-工具)
3. [API 模型服务](#api-模型服务)
4. [聊天通道](#聊天通道)
5. [适配状态图例](#适配状态图例)
6. [快速安装脚本](#快速安装脚本)

---

## 概览与优先级策略

| 优先级 | 含义 | 目标完成时间 |
|--------|------|-------------|
| **P0** | 核心基础设施，必须优先完成 | 2026-Q2 |
| **P1** | 高频使用工具，尽快适配 | 2026-Q3 |
| **P2** | 中等优先级，逐步推进 | 2026-Q4 |
| **P3** | 长尾/研究性质，按需集成 | 2027 待定 |

### 适配状态定义

| 状态 | 含义 |
|------|------|
| ✅ **已集成** | 已完成适配，可在 Sylva 中直接使用 |
| ⏳ **待集成** | 已纳入路线图，等待开发 |
| 🔬 **研究中** | 技术方案评估中，尚未开始开发 |
| ⚠️ **部分集成** | 基础功能可用，高级功能待完善 |

---

## CLI / Coding 工具

### Tier 1: 云订阅（P1 及以上）

| # | 名称 | 安装命令 | 官网 URL | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 2 | Claude Code | `npm install -g @anthropic-ai/claude-code` | [anthropic.com](https://www.anthropic.com/claude-code) | 云订阅 | **P0** | ⏳ 待集成 |
| 4 | Codex CLI | `npm install -g @openai/codex` | [openai.com](https://openai.com/codex) | 云订阅 | **P0** | ⏳ 待集成 |
| 8 | Gemini CLI | `npm install -g @google/gemini-cli` | [ai.google.dev](https://ai.google.dev/gemini-api/docs/cli) | 免费 | **P0** | ⏳ 待集成 |
| 1 | Cursor | 官网下载安装包 | [cursor.com](https://www.cursor.com) | 云订阅 | **P1** | ⏳ 待集成 |
| 3 | Windsurf | 官网下载安装包 | [windsurf.com](https://www.windsurf.com) | 云订阅 | **P1** | 🔬 研究中 |
| 5 | Antigravity | 官网注册下载 | [antigravity.ai](https://antigravity.ai) | 云订阅 | **P1** | 🔬 研究中 |
| 6 | Mistral Vibe | 官网注册下载 | [mistral.ai](https://mistral.ai) | 云订阅 | **P1** | 🔬 研究中 |
| 7 | Amp (Sourcegraph) | 官网注册 | [sourcegraph.com](https://sourcegraph.com) | 云订阅 | **P1** | 🔬 研究中 |

### Tier 2: 免费（P1）

| # | 名称 | 安装命令 | 官网 URL | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 9 | GitHub Copilot CLI | `gh copilot`（需安装 GitHub CLI） | [github.com/features/copilot](https://github.com/features/copilot) | 免费 | **P1** | ⏳ 待集成 |
| 10 | Amazon Q Developer | 安装 AWS Toolkit 扩展 | [aws.amazon.com/q/developer](https://aws.amazon.com/q/developer/) | 免费 | **P1** | ⏳ 待集成 |
| 11 | Kiro CLI | 安装 AWS Toolkit 扩展 | [aws.amazon.com/kiro](https://aws.amazon.com/kiro/) | 免费 | **P1** | 🔬 研究中 |
| 12 | Qwen Code | `npm install -g @alibaba/qwen-code` | [qwen.ai](https://qwen.ai) | 免费 | **P1** | ⏳ 待集成 |

### Tier 3: 开源 BYOK（P0-P1）

| # | 名称 | 安装命令 | 官网 URL | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 13 | OpenCode | `npm install -g @opencode/opencode` | [github.com/opencode-ai](https://github.com/opencode-ai/opencode) | 开源 BYOK | **P0** | ⏳ 待集成 |
| 14 | Aider | `pip install aider-chat` | [aider.chat](https://aider.chat) | 开源 BYOK | **P0** | ⏳ 待集成 |
| 15 | Cline | VS Code 扩展市场搜索 "Cline" | [github.com/cline](https://github.com/cline/cline) | 开源 BYOK | **P1** | ⏳ 待集成 |
| 16 | Continue.dev | VS Code / JetBrains 扩展市场 | [continue.dev](https://continue.dev) | 开源 BYOK | **P1** | ⏳ 待集成 |
| 17 | Goose | `npm install -g @block/goose` | [block.github.io/goose](https://block.github.io/goose/) | 开源 BYOK | **P1** | ⏳ 待集成 |
| 18 | Roo Code | VS Code 扩展市场搜索 "Roo Code" | [github.com/RooVetGit](https://github.com/RooVetGit/Roo-Code) | 开源 BYOK | **P1** | ⏳ 待集成 |
| 19 | OpenClaw | GitHub Release 下载 | [github.com/openclaw](https://github.com/openclaw/openclaw) | 开源 BYOK | **P0** | ✅ **已集成** |
| 20 | Zed | 官网下载安装包 | [zed.dev](https://zed.dev) | 开源 BYOK | **P1** | ⏳ 待集成 |
| 21 | iFlow | `npm install -g iflow` | [github.com/iflow](https://github.com/iflow) | 开源 BYOK | **P2** | 🔬 研究中 |
| 22 | Kimi Code CLI | Moonshot 官网下载 | [moonshot.cn](https://www.moonshot.cn) | 开源 BYOK | **P0** | ⚠️ **部分集成** |
| 23 | BLACKBOX | 官网注册使用 | [blackbox.ai](https://www.blackbox.ai) | 开源 BYOK | **P2** | 🔬 研究中 |

### Tier 4: 本地（P0 核心）

| # | 名称 | 安装命令 | 官网 URL | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 24 | Ollama | `ollama.com` 下载安装包 或 `brew install ollama` | [ollama.com](https://ollama.com) | 本地 | **P0** | ⏳ 待集成 |
| 25 | llama.cpp | GitHub 克隆编译：`git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make` | [github.com/ggerganov/llama.cpp](https://github.com/ggerganov/llama.cpp) | 本地 | **P1** | ⏳ 待集成 |
| 26 | LM Studio | 官网下载安装包 | [lmstudio.ai](https://lmstudio.ai) | 本地 | **P1** | ⏳ 待集成 |
| 27 | vLLM | `pip install vllm` | [docs.vllm.ai](https://docs.vllm.ai) | 本地 | **P1** | 🔬 研究中 |
| 28 | Tabby | `docker run -it -p 8080:8080 tabbyml/tabby` | [tabby.tabbyml.com](https://tabby.tabbyml.com) | 本地 | **P2** | 🔬 研究中 |

### Tier 5: 路由（P2）

| # | 名称 | 安装命令 | 官网 URL | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 29 | 9router | `git clone https://github.com/9router/9router` | [github.com/9router](https://github.com/9router/9router) | 路由 | **P2** | 🔬 研究中 |
| 30 | CLIProxyAPI | `git clone https://github.com/cli-proxy/cli-proxy-api` | [github.com/cli-proxy](https://github.com/cli-proxy/cli-proxy-api) | 路由 | **P2** | 🔬 研究中 |
| 31 | OpenRouter | `npm install -g openrouter` | [openrouter.ai](https://openrouter.ai) | 路由 | **P2** | ⏳ 待集成 |

---

## API 模型服务

> 仅提供 HTTP API 端点的模型服务，需通过 Sylva 后端统一调用。无独立 CLI 工具。

### Tier 1: 高频核心（P0）

| # | 名称 | 官网 URL | API 端点 | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 32 | **Grok** (xAI) | [x.ai](https://x.ai) | `api.x.ai` | 云API | **P0** | ⏳ 待集成 |
| 34 | **DeepSeek API** | [deepseek.com](https://deepseek.com) | `api.deepseek.com` | 云API | **P0** | ⏳ 待集成 |
| 40 | **Groq** | [groq.com](https://groq.com) | `api.groq.com` | 云API | **P0** | ⏳ 待集成 |
| 50 | **月之暗面** (Kimi API) | [moonshot.cn](https://moonshot.cn) | `api.moonshot.cn` | 云API | **P0** | ⏳ 待集成 |

### Tier 2: 中频主流（P1）

| # | 名称 | 官网 URL | API 端点 | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 33 | **Perplexity** | [perplexity.ai](https://perplexity.ai) | `api.perplexity.ai` | 云API | **P1** | ⏳ 待集成 |
| 35 | **Cohere** | [cohere.com](https://cohere.com) | `api.cohere.com` | 云API | **P1** | ⏳ 待集成 |
| 37 | **Together AI** | [together.ai](https://together.ai) | `api.together.ai` | 云API | **P1** | ⏳ 待集成 |
| 41 | **Mistral API** | [mistral.ai](https://mistral.ai) | `api.mistral.ai` | 云API | **P1** | ⏳ 待集成 |
| 42 | **通义千问** (阿里云) | [tongyi.aliyun.com](https://tongyi.aliyun.com) | `dashscope.aliyuncs.com` | 云API | **P1** | ⏳ 待集成 |
| 45 | **智谱 GLM** | [zhipu.ai](https://zhipu.ai) | `open.bigmodel.cn` | 云API | **P1** | ⏳ 待集成 |

### Tier 3: 低频/研究（P2）

| # | 名称 | 官网 URL | API 端点 | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 36 | **AI21 Labs** | [ai21.com](https://ai21.com) | `api.ai21.com` | 云API | **P2** | ⏳ 待集成 |
| 38 | **Replicate** | [replicate.com](https://replicate.com) | `api.replicate.com` | 平台API | **P2** | ⏳ 待集成 |
| 39 | **Fireworks AI** | [fireworks.ai](https://fireworks.ai) | `api.fireworks.ai` | 云API | **P2** | ⏳ 待集成 |
| 43 | **文心一言** (百度) | [yiyan.baidu.com](https://yiyan.baidu.com) | `aip.baidubce.com` | 云API | **P2** | ⏳ 待集成 |
| 44 | **讯飞星火** (科大讯飞) | [xinghuo.xfyun.cn](https://xinghuo.xfyun.cn) | `spark-api.xf-yun.com` | 云API | **P2** | ⏳ 待集成 |
| 46 | **MiniMax** | [minimax.chat](https://minimax.chat) | `api.minimax.chat` | 云API | **P2** | ⏳ 待集成 |
| 47 | **百川智能** | [baichuan-ai.com](https://baichuan-ai.com) | `api.baichuan-ai.com` | 云API | **P2** | ⏳ 待集成 |
| 48 | **阶跃星辰** | [stepfun.com](https://stepfun.com) | `api.stepfun.com` | 云API | **P2** | ⏳ 待集成 |
| 49 | **零一万物** | [01.ai](https://01.ai) | `api.01.ai` | 云API | **P2** | ⏳ 待集成 |
| 51 | **商汤日日新** | [sensechat.sensetime.com](https://sensechat.sensetime.com) | `api.sensetime.com` | 云API | **P2** | ⏳ 待集成 |
| 52 | **华为盘古** | [pangu.huaweicloud.com](https://pangu.huaweicloud.com) | — | 云API | **P2** | ⏳ 待集成 |
| 53 | **腾讯混元** | [hunyuan.tencent.com](https://hunyuan.tencent.com) | — | 云API | **P2** | ⏳ 待集成 |
| 54 | **360 智脑** | [ai.360.cn](https://ai.360.cn) | — | 云API | **P2** | ⏳ 待集成 |
| 55 | **昆仑天工** (天工 AI) | [tiangong.cn](https://tiangong.cn) | — | 云API | **P2** | ⏳ 待集成 |
| 56 | **京东言犀** | [yanxi.jd.com](https://yanxi.jd.com) | — | 云API | **P2** | ⏳ 待集成 |
| 57 | **网易伏羲** | [fuxi.163.com](https://fuxi.163.com) | — | 云API | **P2** | ⏳ 待集成 |
| 58 | **中科闻歌** | [wenge.com](https://wenge.com) | — | 云API | **P2** | ⏳ 待集成 |
| 59 | **思必驰** | [aispeech.com](https://aispeech.com) | — | 云API | **P2** | ⏳ 待集成 |
| 60 | **云从科技** | [cloudwalk.cn](https://cloudwalk.cn) | — | 云API | **P2** | ⏳ 待集成 |
| 61 | **澜舟科技** | [langboat.com](https://langboat.com) | — | 云API | **P2** | ⏳ 待集成 |
| 62 | **Poe** (Quora) | [poe.com](https://poe.com) | — | 平台API | **P2** | ⏳ 待集成 |
| 63 | **HuggingFace Inference API** | [huggingface.co](https://huggingface.co) | — | 开源API | **P2** | ⏳ 待集成 |
| 64 | **Cloudflare Workers AI** | [workers.cloudflare.com](https://workers.cloudflare.com) | — | 边缘API | **P2** | ⏳ 待集成 |

### Tier 4: 云平台（P3）

| # | 名称 | 官网 URL | API 端点 | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 65 | **AWS Bedrock** | [aws.amazon.com/bedrock](https://aws.amazon.com/bedrock) | — | 云平台 | **P3** | ⏳ 待集成 |
| 66 | **Azure OpenAI** | [azure.microsoft.com](https://azure.microsoft.com) | — | 云平台 | **P3** | ⏳ 待集成 |
| 67 | **Google Vertex AI** | [cloud.google.com/vertex-ai](https://cloud.google.com/vertex-ai) | — | 云平台 | **P3** | ⏳ 待集成 |

---

## 聊天通道

| # | 名称 | 接入方式 | 官网 URL | 类型 | 优先级 | 状态 |
|---|------|----------|----------|------|--------|------|
| 1 | **Kimi Claw** | OpenClaw 内置通道 | [moonshot.cn](https://www.moonshot.cn) | 即时通讯 | **P0** | ✅ **已集成** |
| 2 | **WebSocket** | `ws://` / `wss://` 原生支持 | [RFC 6455](https://tools.ietf.org/html/rfc6455) | 协议 | **P0** | ✅ **已集成** |
| 3 | **REST API** | HTTP/HTTPS JSON API | [wikipedia.org/wiki/REST](https://en.wikipedia.org/wiki/Representational_state_transfer) | 协议 | **P0** | ✅ **已集成** |
| 4 | **Telegram** | Bot API：`https://api.telegram.org/bot<token>` | [telegram.org](https://telegram.org) | 即时通讯 | **P1** | ⏳ 待集成 |
| 5 | **Telegram Bot API** | `npm install node-telegram-bot-api` | [core.telegram.org/bots/api](https://core.telegram.org/bots/api) | 协议 | **P1** | ⏳ 待集成 |
| 6 | **Discord** | `npm install discord.js` | [discord.com](https://discord.com) | 即时通讯 | **P1** | ⏳ 待集成 |
| 7 | **Slack** | `npm install @slack/bolt` | [slack.com](https://slack.com) | 即时通讯 | **P1** | ⏳ 待集成 |
| 8 | **微信** | 企业微信 API / 微信测试号 | [weixin.qq.com](https://weixin.qq.com) | 即时通讯 | **P1** | 🔬 研究中 |
| 9 | **钉钉** | 钉钉开放平台 API | [dingtalk.com](https://www.dingtalk.com) | 即时通讯 | **P1** | 🔬 研究中 |
| 10 | **企业微信** | 企业微信 API | [work.weixin.qq.com](https://work.weixin.qq.com) | 即时通讯 | **P1** | 🔬 研究中 |
| 11 | **飞书** | 飞书开放平台 API | [feishu.cn](https://www.feishu.cn) | 即时通讯 | **P1** | 🔬 研究中 |
| 12 | **WhatsApp** | WhatsApp Business API | [whatsapp.com](https://www.whatsapp.com) | 即时通讯 | **P1** | 🔬 研究中 |
| 13 | **QQ** | go-cqhttp / OneBot 协议 | [qq.com](https://www.qq.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 14 | **Signal** | Signal CLI / libsignal | [signal.org](https://signal.org) | 即时通讯 | **P2** | 🔬 研究中 |
| 15 | **Matrix** | `npm install matrix-js-sdk` | [matrix.org](https://matrix.org) | 即时通讯 | **P2** | 🔬 研究中 |
| 16 | **IRC** | `npm install irc` | [ircv3.net](https://ircv3.net) | 即时通讯 | **P2** | 🔬 研究中 |
| 17 | **Line** | Line Messaging API | [line.me](https://line.me) | 即时通讯 | **P2** | 🔬 研究中 |
| 18 | **KakaoTalk** | Kakao Open API | [kakao.com](https://www.kakao.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 19 | **Messenger** | Meta Messenger Platform | [developers.facebook.com](https://developers.facebook.com/products/messenger/) | 即时通讯 | **P2** | 🔬 研究中 |
| 20 | **Instagram DM** | Instagram Graph API | [developers.facebook.com/docs/instagram-api](https://developers.facebook.com/docs/instagram-api) | 即时通讯 | **P2** | 🔬 研究中 |
| 21 | **Twitter/X DM** | Twitter API v2 | [developer.twitter.com](https://developer.twitter.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 22 | **小红书** | 小红书开放平台 | [xiaohongshu.com](https://www.xiaohongshu.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 23 | **微博** | 微博开放平台 API | [weibo.com](https://www.weibo.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 24 | **抖音私信** | 抖音开放平台 | [developer.open-douyin.com](https://developer.open-douyin.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 25 | **Microsoft Teams** | `npm install @microsoft/teams-js` | [teams.microsoft.com](https://teams.microsoft.com) | 即时通讯 | **P2** | 🔬 研究中 |
| 26 | **Google Chat** | Google Chat API | [developers.google.com/chat](https://developers.google.com/chat) | 即时通讯 | **P2** | 🔬 研究中 |
| 27 | **SSE** | `EventSource` 原生支持 | [developer.mozilla.org/SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) | 协议 | **P0** | ✅ **已集成** |

---

## 适配状态图例

### 按状态统计

| 状态 | CLI/Coding 工具 | API 模型服务 | 聊天通道 | 合计 |
|------|----------------|-------------|----------|------|
| ✅ 已集成 | 1 (OpenClaw) | 0 | 3 (Kimi Claw, WebSocket, REST API, SSE) | **4** |
| ⚠️ 部分集成 | 1 (Kimi Code CLI) | 0 | 0 | **1** |
| ⏳ 待集成 | 14 | 36 | 6 | **56** |
| 🔬 研究中 | 15 | 0 | 18 | **33** |
| **总计** | **31** | **36** | **27** | **94** |

### 按优先级统计

| 优先级 | CLI/Coding 工具 | API 模型服务 | 聊天通道 | 合计 |
|--------|----------------|-------------|----------|------|
| P0 | 8 | 4 | 4 | **16** |
| P1 | 17 | 6 | 9 | **32** |
| P2 | 6 | 23 | 14 | **43** |
| P3 | 0 | 3 | 0 | **3** |
| **总计** | **31** | **36** | **27** | **94** |

---

## 快速安装脚本

### 一键安装 Tier 1-3 核心工具

```bash
#!/bin/bash
# sylva_install_core.sh
# 安装 Sylva 核心依赖工具

echo "=== Sylva Core Toolchain Installer ==="

# Node.js 工具（需先安装 Node.js 20+）
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
npm install -g @google/gemini-cli
npm install -g @opencode/opencode
npm install -g @block/goose
npm install -g openrouter

# Python 工具（需先安装 Python 3.10+）
pip install aider-chat
pip install vllm

# GitHub CLI（用于 Copilot）
# macOS: brew install gh
# Ubuntu: sudo apt install gh
# Windows: winget install GitHub.cli

# 本地模型
# Ollama: 访问 https://ollama.com 下载安装包
# LM Studio: 访问 https://lmstudio.ai 下载安装包

echo "=== Core installation complete ==="
echo "Next steps:"
echo "  1. Configure API keys in ~/.sylva/config.yaml"
echo "  2. Run 'sylva doctor' to verify setup"
echo "  3. Run 'sylva platform init' to initialize adapters"
```

### Docker 快速启动（Tabby / vLLM）

```bash
# Tabby 代码补全服务器
docker run -it \
  -p 8080:8080 \
  -v "$HOME/.tabby:/data" \
  tabbyml/tabby \
  serve --model StarCoder-2B

# vLLM 推理服务器
docker run --runtime nvidia --gpus all \
  -p 8000:8000 \
  vllm/vllm-openai:latest \
  --model mistralai/Mistral-7B-Instruct-v0.2
```

---

## 附录：平台类型说明

| 类型 | 说明 |
|------|------|
| **云订阅** | 需付费订阅的云服务，提供托管模型和高级功能 |
| **免费** | 基础功能免费，可能有速率限制或功能限制 |
| **开源 BYOK** | 开源工具，Bring Your Own Key（自带 API Key） |
| **本地** | 完全本地运行的模型和工具，无需联网 |
| **路由** | LLM 路由/代理层，统一调度多个后端 |
| **云API** | 云端模型推理 API 服务，HTTP 调用 |
| **开源API** | 开源模型托管推理 API（如 HuggingFace） |
| **平台API** | 第三方聚合平台 API（如 Poe、Replicate） |
| **边缘API** | 边缘计算节点模型推理（如 Cloudflare Workers AI） |
| **云平台** | 大云厂商托管 AI 服务（AWS/Azure/Google Cloud） |
| **即时通讯** | 聊天应用和社交平台 |
| **协议** | 底层通信协议（WebSocket、REST、SSE） |

---

*本清单由 Sylva Platform 自动生成，将持续更新。发现问题请提交 Issue 或联系维护团队。*

<!-- EOF -->
