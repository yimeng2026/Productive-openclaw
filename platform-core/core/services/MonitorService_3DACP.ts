/**
 * MonitorService — 3DACP 接入层
 * 监控指标、实时推送、告警
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import type { AxisStreamChunk } from '../coordinator/AxisMessage';
import {
  getMonitorData, getAgentStatuses, getTaskStatuses,
  getPlatformHealth, getSkillHealth,
} from '../services/monitorService';

export class MonitorService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'monitor', supportsStreaming: true });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'read': return this.getMetrics(data as { type?: string });
      case 'invoke': return this.getLogs(data as { limit?: number });
      case 'list': return this.getAlerts();
      default: throw new Error(`MonitorService: unsupported action '${action}'`);
    }
  }

  protected async handleStreamingAction(
    action: string, _data: unknown, _msg: any,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    if (action === 'subscribe') {
      return this.subscribeMetrics(onChunk);
    }
    throw new Error(`MonitorService: streaming action '${action}' not supported`);
  }

  private async getMetrics(data: { type?: string }): Promise<unknown> {
    const all = await getMonitorData();
    switch (data.type) {
      case 'system': return all.system;
      case 'platforms': return getPlatformHealth();
      case 'agents': return getAgentStatuses();
      case 'tasks': return getTaskStatuses();
      case 'skills': return getSkillHealth();
      case 'alerts': return all.alerts;
      default: return all;
    }
  }

  private async getLogs(data: { limit?: number }): Promise<unknown> {
    return { logs: [], limit: data.limit || 100 };
  }

  private async getAlerts(): Promise<unknown> {
    const data = await getMonitorData();
    return data.alerts || [];
  }

  private async subscribeMetrics(onChunk: (chunk: AxisStreamChunk) => void): Promise<void> {
    let seq = 0;
    const interval = setInterval(async () => {
      try {
        const data = await getMonitorData();
        onChunk({
          streamId: 'monitor-metrics',
          sequence: seq++,
          isLast: false,
          chunk: { system: data.system, timestamp: new Date().toISOString() },
        });
      } catch { /* ignore */ }
    }, 5000);

    // 60秒后自动结束
    await new Promise((resolve) => {
      setTimeout(() => {
        clearInterval(interval);
        onChunk({
          streamId: 'monitor-metrics',
          sequence: seq,
          isLast: true,
          chunk: { status: 'subscription_ended' },
        });
        resolve(undefined);
      }, 60000);
    });
  }
}

export function createMonitorServiceAdapter(): MonitorService {
  return new MonitorService();
}
