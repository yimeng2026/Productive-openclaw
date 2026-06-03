# Unified Skills Package — 全平台技能清单

> **扫描时间**: 2026-05-22  
> **总技能数**: 82  
> **来源**: workspace/skills/ (72) + .stepfun/skills/ (10)  
> **统一接口**: SkillBridge (nodejs/python/shell 三运行时)  

---

## 一、按类别统计

| 类别 | 数量 | 技能 |
|------|------|------|
| **搜索** | 1 | brave-search |
| **媒体/图表** | 5 | chart, chart-image, chart-maker, mermaid-diagrams, powerpoint-pptx |
| **OCR/文档** | 11 | image-ocr, ocr-local, ocr-python, paddleocr-doc-parsing, paddleocr-text-recognition, super-ocr, tesseract-ocr, document-converter-pro, document-pro, markdown, markdown-converter, pandoc, word-docx |
| **数据/计算** | 5 | data-analysis, math-solver, sqlite, wolfram-alpha, python |
| **运维/监控** | 8 | auto-monitor, self-monitor, system-auto-repair, openclaw-diag, config-diagnose, claw-problem-diagnoser, openclaw-intelligent-repair, kimi-overload-guardian |
| **通信** | 3 | telegram-bot, slack, web-scraper |
| **Agent/编排** | 8 | agent-collab, cross-platform-agent-orchestration, deepseek-reasoner-lite-agent, elite-longterm-memory, emergence-codex-openclaw, local-model-swarm, multi-agent-coordinator, recursive-swarm |
| **记忆/优化** | 4 | hermes, memory-tiering, recursive-self-improvement, rsi-loop |
| **平台集成** | 6 | api-gateway, clawhub, kimi-desktop-gateway-policy, kimi-webbridge-desktop, sylva-platform, skillhub-preference |
| **工具/其他** | 21 | academic-writing, auto-forged, chart, claw-ops, download-file, engineering, file-manager, find-skills, kimiim, mermaid-diagrams, notion, physics, skills, sqlite, time-awareness, weather, worker-safety, word-docx |
| **StepFun** | 10 | contract-review, creating-financial-models, docx, find-skill, market-research-reports, pdf, pptx, repair-stepclaw, skill-creator, xlsx |

---

## 二、Workspace Skills (72个)

### 2.1 搜索类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| brave-search | nodejs | index.ts | Web 搜索 |

### 2.2 媒体/图表类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| chart | nodejs | index.ts | 图表生成 |
| chart-image | nodejs | index.ts | 图表图像 |
| chart-maker | nodejs | index.ts | 图表制作 |
| mermaid-diagrams | nodejs | index.ts | Mermaid 流程图 |
| powerpoint-pptx | nodejs | index.ts | PPT 生成 |

### 2.3 OCR/文档类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| image-ocr | python | main.py | 图像 OCR |
| ocr-local | nodejs | index.ts | 本地 OCR |
| ocr-python | python | main.py | Python OCR |
| paddleocr-doc-parsing | python | main.py | 文档解析 |
| paddleocr-text-recognition | python | main.py | 文字识别 |
| super-ocr | python | main.py | Super OCR |
| tesseract-ocr | python | main.py | Tesseract OCR |
| document-converter-pro | nodejs | index.ts | 文档转换 |
| document-pro | nodejs | index.ts | 文档处理 |
| markdown | nodejs | index.ts | Markdown 处理 |
| markdown-converter | nodejs | index.ts | Markdown 转换 |
| pandoc | nodejs | index.ts | Pandoc 转换 |
| word-docx | nodejs | index.ts | Word 文档 |

### 2.4 数据/计算类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| data-analysis | nodejs | index.ts | 数据分析 |
| math-solver | nodejs | index.ts | 数学求解 |
| sqlite | nodejs | index.ts | SQLite 数据库 |
| wolfram-alpha | nodejs | index.ts | Wolfram Alpha |
| python | python | main.py | Python 执行 |

### 2.5 运维/监控类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| auto-monitor | nodejs | index.ts | 自动监控 |
| self-monitor | nodejs | index.ts | 自我监控 |
| system-auto-repair | nodejs | index.ts | 系统自动修复 |
| openclaw-diag | nodejs | index.ts | OpenClaw 诊断 |
| config-diagnose | nodejs | index.ts | 配置诊断 |
| claw-problem-diagnoser | nodejs | index.ts | 问题诊断器 |
| openclaw-intelligent-repair | nodejs | index.ts | 智能修复 |
| kimi-overload-guardian | nodejs | index.ts | 过载保护 |

### 2.6 通信类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| telegram-bot | nodejs | index.ts | Telegram Bot |
| slack | nodejs | index.ts | Slack 集成 |
| web-scraper | nodejs | index.ts | Web 爬虫 |

### 2.7 Agent/编排类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| agent-collab | nodejs | index.ts | Agent 协作 |
| cross-platform-agent-orchestration | nodejs | index.ts | 跨平台编排 |
| deepseek-reasoner-lite-agent | nodejs | index.ts | DeepSeek 推理 Agent |
| elite-longterm-memory | nodejs | index.ts | 精英长期记忆 |
| emergence-codex-openclaw | nodejs | index.ts | Emergence Codex |
| local-model-swarm | nodejs | index.ts | 本地模型 Swarm |
| multi-agent-coordinator | nodejs | index.ts | 多 Agent 协调 |
| recursive-swarm | nodejs | index.ts | 递归 Swarm |

### 2.8 记忆/优化类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| hermes | nodejs | hermes-cli.ts | 记忆-模式-锻造 |
| memory-tiering | nodejs | index.ts | 记忆分层 |
| recursive-self-improvement | nodejs | index.ts | 递归自我改进 |
| rsi-loop | nodejs | index.ts | RSI 循环 |

### 2.9 平台集成类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| api-gateway | nodejs | index.ts | API 网关 |
| clawhub | nodejs | index.ts | ClawHub 市场 |
| kimi-desktop-gateway-policy | nodejs | index.ts | Kimi 桌面网关策略 |
| kimi-webbridge-desktop | nodejs | index.ts | Kimi WebBridge |
| sylva-platform | nodejs | index.ts | Sylva 平台 |
| skillhub-preference | nodejs | index.ts | SkillHub 偏好 |

### 2.10 工具/其他类

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| academic-writing | nodejs | index.ts | 学术写作 |
| auto-forged | nodejs | index.ts | 自动锻造 |
| claw-ops | nodejs | index.ts | OpenClaw 运维 |
| download-file | nodejs | index.ts | 文件下载 |
| engineering | nodejs | index.ts | 工程 |
| file-manager | nodejs | index.ts | 文件管理 |
| find-skills | nodejs | index.ts | 技能查找 |
| kimiim | nodejs | index.ts | Kimi IM |
| notion | nodejs | index.ts | Notion 集成 |
| physics | nodejs | index.ts | 物理 |
| skills | nodejs | index.ts | 技能管理 |
| time-awareness | nodejs | index.ts | 时间感知 |
| weather | nodejs | index.ts | 天气查询 |
| worker-safety | nodejs | index.ts | 工作安全 |

---

## 三、StepFun Skills (10个)

| ID | 运行时 | 入口 | 能力 |
|----|--------|------|------|
| contract-review | nodejs | index.ts | 合同审查 |
| creating-financial-models | nodejs | index.ts | 财务模型 |
| docx | nodejs | index.ts | Word 处理 |
| find-skill | nodejs | index.ts | 技能查找 |
| market-research-reports | nodejs | index.ts | 市场研究 |
| pdf | nodejs | index.ts | PDF 处理 |
| pptx | nodejs | index.ts | PPT 处理 |
| repair-stepclaw | nodejs | index.ts | StepClaw 修复 |
| skill-creator | nodejs | index.ts | 技能创建 |
| xlsx | nodejs | index.ts | Excel 处理 |

---

## 四、统一调用接口

```typescript
// 通过 SkillBridge 统一调用任何技能
interface SkillCallRequest {
  skillId: string;              // 如: "brave-search", "image-ocr", "hermes"
  params: Record<string, unknown>;  // 技能参数
  context?: {
    agentId?: string;
    sessionId?: string;
    memory?: unknown[];
  };
}

// 调用示例
const result = await skillBridge.callSkill({
  skillId: "brave-search",
  params: { query: "OpenClaw agent framework" },
});

const result2 = await skillBridge.callSkill({
  skillId: "image-ocr",
  params: { imagePath: "/path/to/image.png" },
});

const result3 = await skillBridge.callSkill({
  skillId: "hermes",
  params: { action: "cycle" },
});
```

---

## 五、运行时分布

| 运行时 | 数量 | 代表 |
|--------|------|------|
| **nodejs** | 72 | 大多数技能 |
| **python** | 8 | OCR/文档处理/计算 |
| **shell** | 0 | （当前无） |

---

## 六、健康状态

| 状态 | 数量 | 说明 |
|------|------|------|
| **可用** | 82 | 入口文件存在，可直接调用 |
| **需配置** | ~40 | 需要 API Key 或环境变量 |
| **需验证** | 全部 | 建议逐个执行测试 |

---

*本文档由 SYLVA 自动生成，基于 SkillBridge 扫描结果。*
*所有技能通过统一接口 `skillBridge.callSkill()` 调用。*
