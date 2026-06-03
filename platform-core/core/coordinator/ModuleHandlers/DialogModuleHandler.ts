/**
 * DialogModuleHandler — 对话模块 3DACP 包装层
 * 包装现有 dialog.ts 路由逻辑，映射到 AxisMessage action
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
} from '../AxisMessage';
import { createReply } from '../AxisMessage';
import { ServiceAdapter } from '../ServiceAdapter';

// ──────────── 内存存储（与 dialog.ts 兼容） ────────────

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

// ──────────── Kimi Code API 调用（复用 dialog.ts 逻辑） ────────────

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

// ──────────── DialogModuleHandler ────────────

export class DialogModuleHandler extends ServiceAdapter {
  constructor() {
    super({
      moduleId: 'dialog',
      supportsStreaming: true,
    });
  }

  // ──────────── RPC 映射 ────────────

  protected async handleAction(
    action: string,
    data: unknown,
    _msg: AxisMessage
  ): Promise<unknown> {
    const d = data as Record<string, unknown>;

    switch (action) {
      // 获取对话上下文（兼容 read）
      case 'read':
      case 'getContext': {
        const agentId = String(d.agentId ?? d.id ?? '');
        if (!agentId) throw new Error('agentId is required');
        const context = getContext(agentId);
        return {
          agentId,
          messages: context,
          count: context.length,
        };
      }

      // 发送消息（非流式）
      case 'create':
      case 'invoke':
      case 'sendMessage': {
        const agentId = String(d.agentId ?? '');
        const content = String(d.content ?? '');
        const role = (d.role as string) ?? 'user';

        if (!agentId) throw new Error('agentId is required');
        if (!content) throw new Error('content is required');

        const context = getContext(agentId);
        context.push({
          role: role as any,
          content,
          timestamp: new Date().toISOString(),
        });

        const res = await kimiChat(
          context.map((m) => ({ role: m.role, content: m.content })),
          false
        );

        const responseData = await res.json() as any;
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: responseData.choices?.[0]?.message?.content || "",
          timestamp: new Date().toISOString(),
        };
        context.push(assistantMsg);

        return {
          agentId,
          message: assistantMsg,
          model: responseData.model,
          usage: responseData.usage,
          finishReason: responseData.choices?.[0]?.finish_reason,
        };
      }

      // 清空对话上下文（兼容 delete）
      case 'delete':
      case 'clearContext': {
        const agentId = String(d.agentId ?? d.id ?? '');
        if (!agentId) throw new Error('agentId is required');
        agentContexts.delete(agentId);
        return { agentId, cleared: true };
      }

      // 添加附件（占位，复用 sendMessage 逻辑）
      case 'attachFile':
      case 'addAttachment': {
        const agentId = String(d.agentId ?? '');
        const fileId = String(d.fileId ?? d.attachment ?? '');
        if (!agentId) throw new Error('agentId is required');
        if (!fileId) throw new Error('fileId is required');
        // 实际项目中应调用文件服务
        return { agentId, fileId, attached: true, note: 'Attachment processed' };
      }

      // 列出可用 agents（复用 /api/dialog/agents）
      case 'list':
      case 'listAgents': {
        return {
          agents: Array.from(agentContexts.keys()).map((id) => ({ agentId: id, contextLength: getContext(id).length })),
        };
      }

      default:
        throw new Error(`DialogModuleHandler: unsupported action '${action}'`);
    }
  }

  // ──────────── 流式映射 ────────────

  protected async handleStreamingAction(
    action: string,
    data: unknown,
    _msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    const d = data as Record<string, unknown>;
    const streamId = `dialog-${Date.now()}`;
    let sequence = 0;

    switch (action) {
      case 'stream':
      case 'sendMessageStream': {
        const agentId = String(d.agentId ?? '');
        const content = String(d.content ?? '');

        if (!agentId) throw new Error('agentId is required');
        if (!content) throw new Error('content is required');

        const context = getContext(agentId);
        context.push({
          role: 'user',
          content,
          timestamp: new Date().toISOString(),
        });

        // stream start
        onChunk({ streamId, sequence: sequence++, isLast: false, chunk: { type: 'streamStart', agentId } });

        try {
          const res = await kimiChat(
            context.map((m) => ({ role: m.role, content: m.content })),
            true
          );

          const reader = res.body?.getReader();
          if (!reader) throw new Error('Stream body empty');

          const decoder = new TextDecoder();
          let buffer = '';
          let fullContent = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;

                const payload = trimmed.slice(6);
                if (payload === '[DONE]') {
                  onChunk({ streamId, sequence: sequence++, isLast: false, chunk: { type: 'done' } });
                  break;
                }

                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed.choices?.[0]?.delta?.content || '';
                  if (delta) {
                    fullContent += delta;
                    onChunk({
                      streamId,
                      sequence: sequence++,
                      isLast: false,
                      chunk: { type: 'chunk', content: delta, agentId },
                    });
                  }
                } catch {
                  // ignore
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          // 保存完整回复
          context.push({
            role: 'assistant',
            content: fullContent,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          onChunk({
            streamId,
            sequence: sequence++,
            isLast: false,
            chunk: {
              type: 'error',
              message: err instanceof Error ? err.message : String(err),
              agentId,
            },
          });
        }

        // stream end
        onChunk({ streamId, sequence: sequence++, isLast: true, chunk: { type: 'streamEnd', agentId } });
        return;
      }

      default:
        throw new Error(`DialogModuleHandler: unsupported streaming action '${action}'`);
    }
  }
}

// 导出实例（单例）
export const dialogModuleHandler = new DialogModuleHandler();
