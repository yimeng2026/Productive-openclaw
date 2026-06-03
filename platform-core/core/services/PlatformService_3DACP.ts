/**
 * PlatformService — 3DACP 接入层
 * 平台管理、健康检查、模型列表
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import {
  getPlatformsReal, getPlatformDetail,
  getModelsReal, refreshOllamaModels,
} from '../services/platformService';

export class PlatformService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'platform', supportsStreaming: false });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create': return this.addPlatform(data as Record<string, unknown>);
      case 'read': return this.getPlatform(data as { id?: string });
      case 'update': return this.updatePlatform(data as { id: string } & Record<string, unknown>);
      case 'delete': return this.removePlatform(data as { id: string });
      case 'invoke': return this.refreshModels(data as { id: string });
      case 'list': return this.listPlatforms();
      default: throw new Error(`PlatformService: unsupported action '${action}'`);
    }
  }

  private async addPlatform(data: Record<string, unknown>): Promise<unknown> {
    const { name, provider, tier, baseUri, apiKeyRequired, description, icon, tint } = data;
    if (!name || !provider || !tier) throw new Error('name, provider, tier are required');
    return {
      id: `plat-${Date.now()}`,
      name, provider, tier, baseUri, apiKeyRequired,
      description, icon, tint,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  private async getPlatform(data: { id?: string }): Promise<unknown> {
    if (data.id) {
      const p = await getPlatformDetail(data.id);
      if (!p) throw new Error(`Platform not found: ${data.id}`);
      return p;
    }
    return this.listPlatforms();
  }

  private async updatePlatform(data: { id: string } & Record<string, unknown>): Promise<unknown> {
    return { id: data.id, updated: true, fields: Object.keys(data).filter(k => k !== 'id') };
  }

  private async removePlatform(data: { id: string }): Promise<{ id: string; deleted: boolean }> {
    return { id: data.id, deleted: true };
  }

  private async refreshModels(data: { id: string }): Promise<unknown> {
    const p = await getPlatformDetail(data.id);
    if (!p) throw new Error(`Platform not found: ${data.id}`);
    // 触发模型刷新
    if (p.provider === 'ollama') {
      await refreshOllamaModels();
    }
    const models = await getModelsReal();
    return { platformId: data.id, models, refreshedAt: new Date().toISOString() };
  }

  private async listPlatforms(): Promise<unknown> {
    const platforms = await getPlatformsReal();
    return {
      platforms,
      grouped: {
        cloud: platforms.filter((p: any) => p.tier === 'cloud'),
        local: platforms.filter((p: any) => p.tier === 'local'),
        custom: platforms.filter((p: any) => p.tier === 'custom'),
      },
    };
  }
}

export function createPlatformServiceAdapter(): PlatformService {
  return new PlatformService();
}
