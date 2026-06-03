import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";

const router: Router = Router();

// ═══════════════════════════════════════════════════════════════
//  Kimi Code API 直接调用（绕过 ProviderAdapters 的复杂逻辑）
// ═══════════════════════════════════════════════════════════════

const KIMI_BASE_URL = "https://api.kimi.com/coding/v1";

async function kimiChat(
  messages: Array<{ role: string; content: string }>,
  stream = false
) {
  const apiKey = process.env.KIMICODE_API_KEY || process.env.KIMI_CODE_API_KEY_1 || "";
  const body = {
    model: "kimi-for-coding",
    messages,
    stream,
    temperature: 0.7,
    max_tokens: 4096,
  };

  const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "KimiCLI/0.77",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  return res;
}

// ═══════════════════════════════════════════════════════════════
//  对话上下文存储（内存）
// ═══════════════════════════════════════════════════════════════

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

const agentContexts = new Map<string, ChatMessage[]>();

function getContext(agentId: string): ChatMessage[] {
  if (!agentContexts.has(agentId)) {
    agentContexts.set(agentId, [
      {
        role: "system",
        content: "你是千界花园的智能助手，帮助用户完成各种任务。",
        timestamp: new Date().toISOString(),
      },
    ]);
  }
  return agentContexts.get(agentId)!;
}

// ═══════════════════════════════════════════════════════════════
//  POST /api/dialog/:agentId/chat — 非流式对话
// ═══════════════════════════════════════════════════════════════

router.post("/:agentId/chat", async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const context = getContext(agentId);
    context.push({
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    });

    logger.info({ agentId, content: content.slice(0, 50) }, "[Dialog] Chat request");

    // 调用 Kimi Code API（直接 fetch，和 test-kimi-code.js 完全一致）
    const response = await kimiChat(
      context.map((m) => ({ role: m.role, content: m.content })),
      false
    );

    const data: any = await response.json();
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: data.choices?.[0]?.message?.content || "",
      timestamp: new Date().toISOString(),
    };
    context.push(assistantMsg);

    res.json({
      agentId,
      message: assistantMsg,
      model: data.model,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
    });
  } catch (err: any) {
    logger.error({ err: err.message, agentId }, "[Dialog] Chat failed");
    res.status(502).json({ error: "LLM API error", detail: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/dialog/:agentId/stream — SSE 流式对话
// ═══════════════════════════════════════════════════════════════

router.get("/:agentId/stream", async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { content } = req.query;

  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content query parameter is required" });
    return;
  }

  // SSE 响应头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const context = getContext(agentId);
    context.push({
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    });

    logger.info({ agentId, content: content.slice(0, 50) }, "[Dialog] Stream request");

    // 调用 Kimi Code API 流式输出（直接 fetch）
    const res = await kimiChat(
      context.map((m) => ({ role: m.role, content: m.content })),
      true
    );

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Stream body empty");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            (res as any).write(`data: ${JSON.stringify({ type: "done", finishReason: "stop" })}\n\n`);
            break;
          }

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              fullContent += delta;
              (res as any).write(`data: ${JSON.stringify({ type: "chunk", content: delta })}\n\n`);
            }
            if (parsed.choices?.[0]?.finish_reason) {
              (res as any).write(`data: ${JSON.stringify({ type: "done", finishReason: parsed.choices[0].finish_reason })}\n\n`);
            }
          } catch {
            // 忽略解析失败的行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 保存完整回复到上下文
    context.push({
      role: "assistant",
      content: fullContent,
      timestamp: new Date().toISOString(),
    });

    (res as any).write(`data: ${JSON.stringify({ type: "end" })}\n\n`);
    (res as any).end();
  } catch (err: any) {
    logger.error({ err: err.message, agentId }, "[Dialog] Stream failed");
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
    res.end();
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/dialog/:agentId/history — 获取对话历史
// ═══════════════════════════════════════════════════════════════

router.get("/:agentId/history", (req: Request, res: Response) => {
  const { agentId } = req.params;
  const context = getContext(agentId);
  res.json({
    agentId,
    messages: context,
    count: context.length,
  });
});

// ═══════════════════════════════════════════════════════════════
//  DELETE /api/dialog/:agentId/history — 清空对话历史
// ═══════════════════════════════════════════════════════════════

router.delete("/:agentId/history", (req: Request, res: Response) => {
  const { agentId } = req.params;
  agentContexts.delete(agentId);
  res.json({ agentId, cleared: true });
});

export default router;
