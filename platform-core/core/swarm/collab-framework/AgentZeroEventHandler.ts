/**
 * AgentZeroEventHandler.ts — SYLVA AgentZero 指令事件监听器
 *
 * 核心职责:
 * 1. 监听 MessageBus 上的 AgentZero 指令事件
 * 2. 解析指令格式: { type: 'AGENT_ZERO_COMMAND', target, action, params }
 * 3. 调用 AgentZeroController 执行操作
 * 4. 回发执行结果: { type: 'AGENT_ZERO_RESULT', target, success, data }
 *
 * 设计原则:
 * - 完全基于事件驱动，松耦合
 * - 指令验证和过滤（防止非法指令）
 * - 结果回发保证调用方收到反馈
 * - 支持指令链和批量指令
 */

import { AgentZeroController, AgentZeroCommand, AgentZeroResultMessage, AgentZeroAgentAction, AgentZeroGroupAction } from './AgentZeroBridge';
import { IMessageBus, MessageType, SwarmMessage } from './SwarmMessageBus';

// ──────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────

/** 指令验证结果 */
interface CommandValidation {
  valid: boolean;
  error?: string;
  commandId: string;
}

/** 事件处理器配置 */
export interface EventHandlerConfig {
  /** 是否自动启用 */
  autoEnable: boolean;
  /** 指令来源白名单（空数组 = 接受所有来源） */
  allowedIssuers: string[];
  /** 最大并发指令数 */
  maxConcurrentCommands: number;
  /** 指令超时时间（毫秒） */
  commandTimeoutMs: number;
  /** 是否记录所有指令日志 */
  logAllCommands: boolean;
}

/** 指令执行记录 */
interface CommandExecutionRecord {
  commandId: string;
  command: AgentZeroCommand;
  startedAt: number;
  completedAt?: number;
  result?: AgentZeroResultMessage;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
}

// ──────────────────────────────────────────
// AgentZeroEventHandler 实现
// ──────────────────────────────────────────

export class AgentZeroEventHandler {
  private controller: AgentZeroController;
  private messageBus: IMessageBus;
  private config: EventHandlerConfig;
  private subscriptionIds: string[] = [];
  private commandHistory: Map<string, CommandExecutionRecord> = new Map();
  private runningCommands = 0;
  private enabled = false;

  constructor(
    controller: AgentZeroController,
    messageBus: IMessageBus,
    config?: Partial<EventHandlerConfig>
  ) {
    this.controller = controller;
    this.messageBus = messageBus;
    this.config = {
      autoEnable: true,
      allowedIssuers: [],
      maxConcurrentCommands: 10,
      commandTimeoutMs: 30000,
      logAllCommands: true,
      ...config,
    };

    if (this.config.autoEnable) {
      this.enable();
    }
  }

  // ═══════════════════════════════════════════
  // 生命周期管理
  // ═══════════════════════════════════════════

  /** 启用事件监听 */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    // 订阅 AgentZero 指令频道
    const subId = this.messageBus.subscribe(
      'agentzero.command',
      (msg: SwarmMessage) => this.handleCommandMessage(msg)
    );
    this.subscriptionIds.push(subId);

    // 订阅通配符频道（备用）
    const wildcardSubId = this.messageBus.subscribe('*', (msg: SwarmMessage) => {
      if (msg.payload && (msg.payload as any).type === 'AGENT_ZERO_COMMAND') {
        this.handleCommandMessage(msg);
      }
    });
    this.subscriptionIds.push(wildcardSubId);

    console.log('[AgentZeroEventHandler] Enabled — listening on agentzero.command');
  }

  /** 禁用事件监听 */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    for (const subId of this.subscriptionIds) {
      this.messageBus.unsubscribe(subId);
    }
    this.subscriptionIds = [];

    console.log('[AgentZeroEventHandler] Disabled');
  }

  /** 是否已启用 */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ═══════════════════════════════════════════
  // 指令处理核心
  // ═══════════════════════════════════════════

  /**
   * 处理接收到的指令消息
   */
  private async handleCommandMessage(msg: SwarmMessage): Promise<void> {
    const payload = msg.payload as any;

    // 验证指令格式
    if (!payload || payload.type !== 'AGENT_ZERO_COMMAND') {
      return; // 不是AgentZero指令，忽略
    }

    const command: AgentZeroCommand = {
      type: 'AGENT_ZERO_COMMAND',
      target: payload.target,
      action: payload.action,
      params: payload.params,
      issuedBy: payload.issuedBy || msg.sender || 'unknown',
      issuedAt: payload.issuedAt || msg.timestamp || Date.now(),
    };

    const commandId = this.generateCommandId(command);

    // 并发控制
    if (this.runningCommands >= this.config.maxConcurrentCommands) {
      await this.sendResult({
        type: 'AGENT_ZERO_RESULT',
        target: command.target,
        action: command.action,
        success: false,
        error: `Max concurrent commands reached (${this.config.maxConcurrentCommands})`,
        commandId,
        processedAt: Date.now(),
      });
      return;
    }

    // 验证指令
    const validation = this.validateCommand(command, commandId);
    if (!validation.valid) {
      await this.sendResult({
        type: 'AGENT_ZERO_RESULT',
        target: command.target,
        action: command.action,
        success: false,
        error: validation.error,
        commandId,
        processedAt: Date.now(),
      });
      return;
    }

    // 记录开始执行
    this.runningCommands++;
    this.commandHistory.set(commandId, {
      commandId,
      command,
      startedAt: Date.now(),
      status: 'running',
    });

    if (this.config.logAllCommands) {
      console.log(`[AgentZero] Command received: ${command.action} → ${command.target} (from ${command.issuedBy})`);
    }

    // 设置超时
    const timeoutHandle = setTimeout(() => {
      this.handleCommandTimeout(commandId);
    }, this.config.commandTimeoutMs);

    try {
      // 区分Agent操作和Group操作
      const isGroupAction = this.isGroupAction(command.action);

      let resultData: any;
      let success: boolean;
      let error: string | undefined;

      if (isGroupAction) {
        const results = await this.controller.controlGroup(
          command.target,
          command.action as AgentZeroGroupAction,
          command.params
        );
        success = results.every((r) => r.success);
        error = results.find((r) => !r.success)?.error;
        resultData = { results };
      } else {
        const result = await this.controller.controlAgent(
          command.target,
          command.action as AgentZeroAgentAction,
          command.params
        );
        success = result.success;
        error = result.error;
        resultData = result.data;
      }

      clearTimeout(timeoutHandle);

      // 更新记录
      const record = this.commandHistory.get(commandId);
      if (record) {
        record.status = success ? 'completed' : 'failed';
        record.completedAt = Date.now();
      }

      // 回发结果
      await this.sendResult({
        type: 'AGENT_ZERO_RESULT',
        target: command.target,
        action: command.action,
        success,
        data: resultData,
        error,
        commandId,
        processedAt: Date.now(),
      });

    } catch (err) {
      clearTimeout(timeoutHandle);

      const record = this.commandHistory.get(commandId);
      if (record) {
        record.status = 'failed';
        record.completedAt = Date.now();
      }

      await this.sendResult({
        type: 'AGENT_ZERO_RESULT',
        target: command.target,
        action: command.action,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        commandId,
        processedAt: Date.now(),
      });
    } finally {
      this.runningCommands--;
    }
  }

  /**
   * 处理指令超时
   */
  private async handleCommandTimeout(commandId: string): Promise<void> {
    const record = this.commandHistory.get(commandId);
    if (!record || record.status !== 'running') return;

    record.status = 'timeout';
    record.completedAt = Date.now();

    await this.sendResult({
      type: 'AGENT_ZERO_RESULT',
      target: record.command.target,
      action: record.command.action,
      success: false,
      error: `Command timed out after ${this.config.commandTimeoutMs}ms`,
      commandId,
      processedAt: Date.now(),
    });

    this.runningCommands--;
  }

  /**
   * 发送结果回 MessageBus
   */
  private async sendResult(result: AgentZeroResultMessage): Promise<void> {
    await this.messageBus.publish('agentzero.result', {
      type: MessageType.CUSTOM,
      sender: 'AgentZeroEventHandler',
      topic: 'agentzero.result',
      payload: result,
      target: result.target,
    });

    if (this.config.logAllCommands) {
      const status = result.success ? '✓' : '✗';
      console.log(`[AgentZero] Result sent: ${status} ${result.action} → ${result.target} (${result.error || 'OK'})`);
    }
  }

  // ═══════════════════════════════════════════
  // 验证与工具
  // ═══════════════════════════════════════════

  /**
   * 验证指令合法性
   */
  private validateCommand(command: AgentZeroCommand, commandId: string): CommandValidation {
    // 检查来源白名单
    if (this.config.allowedIssuers.length > 0) {
      if (!this.config.allowedIssuers.includes(command.issuedBy)) {
        return {
          valid: false,
          error: `Issuer ${command.issuedBy} not in allowed list`,
          commandId,
        };
      }
    }

    // 检查必要字段
    if (!command.target || command.target.trim() === '') {
      return { valid: false, error: 'Missing target', commandId };
    }
    if (!command.action || command.action.trim() === '') {
      return { valid: false, error: 'Missing action', commandId };
    }

    // 检查 action 是否合法
    const validAgentActions: AgentZeroAgentAction[] = [
      'spawn', 'kill', 'pause', 'resume', 'reassign',
      'inspect', 'updateConfig', 'triggerEvolution',
    ];
    const validGroupActions: AgentZeroGroupAction[] = [
      'pauseAll', 'resumeAll', 'inspectAll', 'rebalance', 'compress',
    ];

    const allValidActions = [...validAgentActions, ...validGroupActions];
    if (!allValidActions.includes(command.action as any)) {
      return { valid: false, error: `Invalid action: ${command.action}`, commandId };
    }

    return { valid: true, commandId };
  }

  /**
   * 判断是否为Group级别操作
   */
  private isGroupAction(action: string): boolean {
    const groupActions: AgentZeroGroupAction[] = [
      'pauseAll', 'resumeAll', 'inspectAll', 'rebalance', 'compress',
    ];
    return groupActions.includes(action as AgentZeroGroupAction);
  }

  /**
   * 生成指令唯一ID
   */
  private generateCommandId(command: AgentZeroCommand): string {
    return `az-cmd-${command.issuedBy}-${command.action}-${command.target}-${Date.now()}`;
  }

  // ═══════════════════════════════════════════
  // 公共API
  // ═══════════════════════════════════════════

  /**
   * 手动发送指令（不通过MessageBus）
   */
  async sendCommand(
    target: string,
    action: AgentZeroAgentAction | AgentZeroGroupAction,
    params?: Record<string, any>,
    issuedBy = 'manual'
  ): Promise<AgentZeroResultMessage> {
    const commandId = this.generateCommandId({
      type: 'AGENT_ZERO_COMMAND',
      target,
      action,
      params,
      issuedBy,
      issuedAt: Date.now(),
    });

    // 直接通过MessageBus发布
    await this.messageBus.publish('agentzero.command', {
      type: MessageType.CUSTOM,
      sender: issuedBy,
      topic: 'agentzero.command',
      payload: {
        type: 'AGENT_ZERO_COMMAND',
        target,
        action,
        params,
        issuedBy,
        issuedAt: Date.now(),
      },
    });

    // 等待结果（轮询）
    return this.waitForResult(commandId, this.config.commandTimeoutMs);
  }

  /**
   * 等待指令结果
   */
  private async waitForResult(commandId: string, timeoutMs: number): Promise<AgentZeroResultMessage> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const record = this.commandHistory.get(commandId);
      if (record && record.status !== 'pending' && record.status !== 'running') {
        return record.result || {
          type: 'AGENT_ZERO_RESULT',
          target: '',
          action: '',
          success: false,
          error: 'No result recorded',
          commandId,
          processedAt: Date.now(),
        };
      }
      await this.sleep(100);
    }

    return {
      type: 'AGENT_ZERO_RESULT',
      target: '',
      action: '',
      success: false,
      error: `Wait timeout after ${timeoutMs}ms`,
      commandId,
      processedAt: Date.now(),
    };
  }

  /**
   * 获取指令历史
   */
  getCommandHistory(limit = 100): CommandExecutionRecord[] {
    return Array.from(this.commandHistory.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * 获取当前运行中的指令数
   */
  getRunningCommandCount(): number {
    return this.runningCommands;
  }

  /** 辅助：sleep */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default AgentZeroEventHandler;
