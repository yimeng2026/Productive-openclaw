/**
 * ServiceAdapter — 将现有后端 Service 封装为 ModuleHandler 的基类
 */

import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
  createReply,
} from './AxisMessage';
import type { ModuleHandler } from '../middleware/AxisGateway';

export interface ServiceAdapterConfig {
  /** 模块 ID */
  moduleId: string;
  /** 是否支持流式 */
  supportsStreaming: boolean;
  /** 自定义错误转换 */
  errorTransformer?: (err: unknown) => { code: string; message: string };
}

export abstract class ServiceAdapter implements ModuleHandler {
  protected config: ServiceAdapterConfig;

  constructor(config: ServiceAdapterConfig) {
    this.config = config;
  }

  // ──────────── ModuleHandler 接口 ────────────

  async handleRpc(msg: AxisMessage): Promise<AxisMessageReply> {
    try {
      const { createReply: makeReply } = await import('./AxisMessage');
      const result = await this.handleAction(msg.payload.action, msg.payload.data, msg);
      return makeReply(msg, 'ok', result);
    } catch (err) {
      const { createReply: makeReply } = await import('./AxisMessage');
      const errorInfo = this.transformError(err);
      return makeReply(msg, 'error', null, errorInfo);
    }
  }

  async handleStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    if (!this.config.supportsStreaming) {
      throw new Error(`Module ${this.config.moduleId} does not support streaming`);
    }
    await this.handleStreamingAction(msg.payload.action, msg.payload.data, msg, onChunk);
  }

  async handleEmit(msg: AxisMessage): Promise<void> {
    try {
      await this.handleAction(msg.payload.action, msg.payload.data, msg);
    } catch (err) {
      console.error(`[ServiceAdapter:${this.config.moduleId}] Emit error:`, err);
    }
  }

  // ──────────── 子类必须实现 ────────────

  /** 处理具体 action */
  protected abstract handleAction(
    action: string,
    data: unknown,
    msg: AxisMessage
  ): Promise<unknown>;

  /** 处理流式 action（可选实现） */
  protected async handleStreamingAction(
    action: string,
    data: unknown,
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    throw new Error(`Streaming not implemented for module: ${this.config.moduleId}`);
  }

  // ──────────── 错误转换 ────────────

  private transformError(err: unknown): { code: string; message: string } {
    if (this.config.errorTransformer) {
      return this.config.errorTransformer(err);
    }
    if (err instanceof Error) {
      return { code: 'INTERNAL_ERROR', message: err.message };
    }
    return { code: 'UNKNOWN_ERROR', message: String(err) };
  }
}

// ──────────── 快捷工厂 ────────────

/** 为简单 CRUD Service 快速生成适配器 */
export function createCrudAdapter(
  moduleId: string,
  service: {
    create?: (data: unknown) => Promise<unknown>;
    get?: (data: unknown) => Promise<unknown>;
    list?: (data: unknown) => Promise<unknown>;
    update?: (data: unknown) => Promise<unknown>;
    delete?: (data: unknown) => Promise<unknown>;
    invoke?: (action: string, data: unknown) => Promise<unknown>;
  }
): ServiceAdapter {
  return new (class extends ServiceAdapter {
    constructor() {
      super({ moduleId, supportsStreaming: !!service.invoke });
    }

    async handleAction(action: string, data: unknown): Promise<unknown> {
      switch (action) {
        case 'create':
          if (!service.create) throw new Error('Create not supported');
          return service.create(data);
        case 'read':
          if (!service.get && !service.list) throw new Error('Read not supported');
          // 如果 data 有 id 用 get，否则用 list
          const d = data as Record<string, unknown>;
          if (d?.id && service.get) return service.get(data);
          if (service.list) return service.list(data);
          if (service.get) return service.get(data);
          throw new Error('Read not supported');
        case 'update':
          if (!service.update) throw new Error('Update not supported');
          return service.update(data);
        case 'delete':
          if (!service.delete) throw new Error('Delete not supported');
          return service.delete(data);
        case 'invoke':
          if (!service.invoke) throw new Error('Invoke not supported');
          return service.invoke(action, data);
        default:
          throw new Error(`Unsupported action: ${action}`);
      }
    }
  })();
}
