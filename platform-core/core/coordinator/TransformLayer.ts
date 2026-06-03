/**
 * TransformLayer — 旧接口兼容转换层
 * 将现有后端 routes/services 批量封装为 ModuleHandler，接入 3DACP
 */

import type { AxisMessage, AxisMessageReply, AxisStreamChunk } from './AxisMessage';
import type { ModuleHandler } from '../middleware/AxisGateway';
import { ServiceAdapter, createCrudAdapter } from './ServiceAdapter';

// ──────────── 转换层入口 ────────────

export interface TransformLayerConfig {
  /** 需要转换的 Service 映射：moduleId → Service 实例 */
  services: Record<string, unknown>;
  /** Service 元数据：每个 Service 支持的 action 和 streaming 能力 */
  metadata: Record<string, ServiceMetadata>;
}

export interface ServiceMetadata {
  moduleId: string;
  supportsStreaming: boolean;
  /** 每个 action 对应的 Service 方法名 */
  actionMap: Record<string, string>;
  /** 流式 action 列表 */
  streamActions?: string[];
}

export class TransformLayer {
  private adapters = new Map<string, ModuleHandler>();

  constructor(private config: TransformLayerConfig) {
    this.buildAdapters();
  }

  /** 获取所有适配后的 ModuleHandler */
  getHandlers(): Map<string, ModuleHandler> {
    return this.adapters;
  }

  /** 获取单个 handler */
  getHandler(moduleId: string): ModuleHandler | undefined {
    return this.adapters.get(moduleId);
  }

  // ──────────── 内部构建 ────────────

  private buildAdapters(): void {
    for (const [moduleId, service] of Object.entries(this.config.services)) {
      const meta = this.config.metadata[moduleId];
      if (!meta) {
        console.warn(`[TransformLayer] No metadata for service: ${moduleId}, skipping`);
        continue;
      }

      const adapter = this.buildAdapter(moduleId, service, meta);
      this.adapters.set(moduleId, adapter);
      console.log(`[TransformLayer] Adapted service: ${moduleId}`);
    }
  }

  private buildAdapter(
    moduleId: string,
    service: unknown,
    meta: ServiceMetadata
  ): ModuleHandler {
    // 如果 Service 已经是 ServiceAdapter 子类，直接使用
    if (service instanceof ServiceAdapter) {
      return service;
    }

    // 否则用动态代理包装
    const svc = service as Record<string, (...args: unknown[]) => Promise<unknown>>;

    return new (class extends ServiceAdapter {
      constructor() {
        super({
          moduleId,
          supportsStreaming: meta.supportsStreaming,
        });
      }

      async handleAction(action: string, data: unknown): Promise<unknown> {
        const methodName = meta.actionMap[action];
        if (!methodName) {
          throw new Error(`Action '${action}' not mapped for module '${moduleId}'`);
        }

        const method = svc[methodName];
        if (typeof method !== 'function') {
          throw new Error(`Method '${methodName}' not found on service '${moduleId}'`);
        }

        return method.call(svc, data);
      }

      async handleStreamingAction(
        action: string,
        data: unknown,
        _msg: AxisMessage,
        onChunk: (chunk: AxisStreamChunk) => void
      ): Promise<void> {
        const methodName = meta.actionMap[action];
        if (!methodName) {
          throw new Error(`Streaming action '${action}' not mapped for module '${moduleId}'`);
        }

        const method = svc[methodName];
        if (typeof method !== 'function') {
          throw new Error(`Method '${methodName}' not found on service '${moduleId}'`);
        }

        // 假设流式方法返回 AsyncIterable 或接受 callback
        const result = await method.call(svc, data, (chunk: unknown) => {
          onChunk({
            streamId: `${moduleId}-${Date.now()}`,
            sequence: 0,
            isLast: false,
            chunk,
          });
        });

        // 如果是 AsyncIterable，逐个消费
        if (result && typeof result[Symbol.asyncIterator] === 'function') {
          let seq = 0;
          for await (const item of result as AsyncIterable<unknown>) {
            onChunk({
              streamId: `${moduleId}-${Date.now()}`,
              sequence: seq++,
              isLast: false,
              chunk: item,
            });
          }
          onChunk({
            streamId: `${moduleId}-${Date.now()}`,
            sequence: seq,
            isLast: true,
            chunk: null,
          });
        }
      }
    })();
  }
}

// ──────────── 快捷批量转换 ────────────

/** 批量转换多个 Service */
export function transformServices(
  services: Record<string, unknown>,
  metadata: Record<string, ServiceMetadata>
): Map<string, ModuleHandler> {
  const layer = new TransformLayer({ services, metadata });
  return layer.getHandlers();
}

/** 标准 CRUD Service 元数据模板 */
export function createCrudMetadata(moduleId: string): ServiceMetadata {
  return {
    moduleId,
    supportsStreaming: false,
    actionMap: {
      create: 'create',
      read: 'findById',
      update: 'update',
      delete: 'delete',
      list: 'findAll',
      invoke: 'invoke',
    },
  };
}

/** Dialog Service 元数据 */
export function createDialogMetadata(): ServiceMetadata {
  return {
    moduleId: 'dialog',
    supportsStreaming: true,
    actionMap: {
      create: 'createDialog',
      read: 'getDialog',
      update: 'updateDialog',
      delete: 'deleteDialog',
      list: 'listDialogs',
      invoke: 'sendMessage',
      stream: 'sendMessageStream',
    },
    streamActions: ['stream', 'invoke'],
  };
}

/** Agent Service 元数据 */
export function createAgentMetadata(): ServiceMetadata {
  return {
    moduleId: 'agent',
    supportsStreaming: false,
    actionMap: {
      create: 'createAgent',
      read: 'getAgent',
      update: 'updateAgent',
      delete: 'deleteAgent',
      list: 'listAgents',
      invoke: 'invokeAgent',
    },
  };
}

/** Group Service 元数据 */
export function createGroupMetadata(): ServiceMetadata {
  return {
    moduleId: 'group',
    supportsStreaming: true,
    actionMap: {
      create: 'createGroup',
      read: 'getGroup',
      update: 'updateGroup',
      delete: 'deleteGroup',
      list: 'listGroups',
      invoke: 'orchestrate',
      stream: 'orchestrateStream',
    },
    streamActions: ['stream', 'invoke'],
  };
}

/** Knowledge Service 元数据 */
export function createKnowledgeMetadata(): ServiceMetadata {
  return {
    moduleId: 'knowledge',
    supportsStreaming: false,
    actionMap: {
      create: 'createKnowledgeBase',
      read: 'getKnowledgeBase',
      update: 'updateKnowledgeBase',
      delete: 'deleteKnowledgeBase',
      list: 'listKnowledgeBases',
      invoke: 'uploadDocument',
    },
  };
}

/** Skill Service 元数据 */
export function createSkillMetadata(): ServiceMetadata {
  return {
    moduleId: 'skill',
    supportsStreaming: false,
    actionMap: {
      create: 'registerSkill',
      read: 'getSkill',
      update: 'updateSkill',
      delete: 'unregisterSkill',
      list: 'listSkills',
      invoke: 'invokeSkill',
    },
  };
}

/** Monitor Service 元数据 */
export function createMonitorMetadata(): ServiceMetadata {
  return {
    moduleId: 'monitor',
    supportsStreaming: true,
    actionMap: {
      read: 'getMetrics',
      invoke: 'getLogs',
      subscribe: 'subscribeMetrics',
      stream: 'subscribeMetricsStream',
    },
    streamActions: ['subscribe', 'stream'],
  };
}
