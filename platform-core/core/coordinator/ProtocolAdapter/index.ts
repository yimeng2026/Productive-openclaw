/**
 * ProtocolAdapter — 3DACP 协议适配器统一入口
 * 导出所有协议适配器实现
 */

export * from './RESTAdapter';
export * from './SSEAdapter';
export * from './WSAdapter';
export * from './InternalAdapter';
export * from './BridgeAdapter';
export * from './ExternalAdapter';

// 适配器工厂
import type { ProtocolAdapter } from './BaseAdapter';
import { RestAdapter } from './RESTAdapter';
import { SseAdapter } from './SSEAdapter';
import { WsAdapter } from './WSAdapter';
import { InternalAdapter } from './InternalAdapter';
import { BridgeAdapter } from './BridgeAdapter';
import { ExternalAdapter } from './ExternalAdapter';
import type { ProtocolLevel } from '../AxisMessage';

export function createAdapter(protocol: ProtocolLevel): ProtocolAdapter {
  switch (protocol) {
    case 'rest':
      return new RestAdapter();
    case 'sse':
      return new SseAdapter();
    case 'ws':
      return new WsAdapter();
    case 'internal':
      return new InternalAdapter();
    case 'bridge':
      return new BridgeAdapter();
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
}

export function createExternalAdapter(): ExternalAdapter {
  return new ExternalAdapter();
}

// 自动选择最优适配器（REST 优先，流式场景用 SSE/WS）
export function selectOptimalAdapter(
  prefersStreaming: boolean,
  supportsWs: boolean
): ProtocolAdapter {
  if (prefersStreaming && supportsWs) {
    return new WsAdapter();
  }
  if (prefersStreaming) {
    return new SseAdapter();
  }
  return new RestAdapter();
}
