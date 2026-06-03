import type {
  AxisMessage,
  AxisMessageReply,
  AxisStreamChunk,
  ProtocolLevel,
} from '../AxisMessage';
import type { AxisCoordinate } from '../AxisMessage';

export interface SendResult {
  reply?: AxisMessageReply;
  stream?: AsyncIterable<AxisStreamChunk>;
}

export abstract class BaseProtocolAdapter {
  abstract readonly protocol: ProtocolLevel;

  protected abstract doSend(msg: AxisMessage): Promise<AxisMessageReply | undefined>;
  protected abstract doSendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void>;

  async send(msg: AxisMessage): Promise<AxisMessageReply | undefined> {
    msg.transport.protocol = this.protocol;
    return this.doSend(msg);
  }

  async sendStream(
    msg: AxisMessage,
    onChunk: (chunk: AxisStreamChunk) => void
  ): Promise<void> {
    msg.transport.protocol = this.protocol;
    return this.doSendStream(msg, onChunk);
  }

  abstract isAvailable(target: AxisCoordinate): Promise<boolean>;

  /** 构造目标 URL */
  protected buildUrl(msg: AxisMessage, basePath = '/axis'): string {
    const endpoint = msg.header.target.x;
    return `${endpoint}${basePath}`;
  }

  /** 通用 HTTP headers */
  protected getHeaders(msg: AxisMessage): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Axis-Version': msg.version,
      'X-Axis-MsgId': msg.header.msgId,
      ...(msg.header.correlationId ? { 'X-Axis-CorrelationId': msg.header.correlationId } : {}),
    };
  }
}
