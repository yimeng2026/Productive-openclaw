/**
 * SwarmConfig.ts — SYLVA 蜂群系统全局配置
 * 
 * 设计原则：
 * - 集中管理所有蜂群参数
 * - 支持硬件自适应阈值
 * - 层级约束防止无限递归膨胀
 */

export interface SwarmConfig {
  /** 最大递归深度（根节点为0） */
  maxDepth: number;
  /** 每层最大节点数 */
  maxNodesPerLevel: number;
  /** 蜂群总节点数上限 */
  maxTotalNodes: number;
  /** 是否启用自适应深度（根据硬件负载动态调整） */
  adaptiveDepth: boolean;
  /** CPU使用率阈值（超过则不再创建新节点） */
  cpuThreshold: number;
  /** 内存使用率阈值（超过则不再创建新节点） */
  memoryThreshold: number;
  /** 任务超时时间（毫秒） */
  taskTimeoutMs: number;
  /** 重试次数 */
  maxRetries: number;
  /** 消息总线模式：'local' | 'redis' */
  messageBusMode: 'local' | 'redis';
  /** Redis连接配置（仅在messageBusMode='redis'时使用） */
  redisConfig?: {
    host: string;
    port: number;
    password?: string;
  };
  /** 默认执行模式 */
  defaultExecutionMode: 'sequential' | 'parallel' | 'hierarchical' | 'dynamic';
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 默认配置 — 适用于大多数场景的安全保守值
 */
export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxDepth: 5,
  maxNodesPerLevel: 16,
  maxTotalNodes: 64,
  adaptiveDepth: true,
  cpuThreshold: 0.8,
  memoryThreshold: 0.85,
  taskTimeoutMs: 300000,   // 5分钟
  maxRetries: 3,
  messageBusMode: 'local',
  defaultExecutionMode: 'dynamic',
  logLevel: 'info',
};

/**
 * 深度克隆配置（防止运行时修改污染默认值）
 */
export function createConfig(partial?: Partial<SwarmConfig>): SwarmConfig {
  return { ...DEFAULT_SWARM_CONFIG, ...partial };
}

/**
 * 运行时配置验证
 */
export function validateConfig(cfg: SwarmConfig): void {
  if (cfg.maxDepth < 1 || cfg.maxDepth > 10) {
    throw new Error(`SwarmConfig: maxDepth must be 1-10, got ${cfg.maxDepth}`);
  }
  if (cfg.maxNodesPerLevel < 1 || cfg.maxNodesPerLevel > 256) {
    throw new Error(`SwarmConfig: maxNodesPerLevel must be 1-256, got ${cfg.maxNodesPerLevel}`);
  }
  if (cfg.maxTotalNodes < 1 || cfg.maxTotalNodes > 1024) {
    throw new Error(`SwarmConfig: maxTotalNodes must be 1-1024, got ${cfg.maxTotalNodes}`);
  }
  if (cfg.cpuThreshold <= 0 || cfg.cpuThreshold > 1) {
    throw new Error(`SwarmConfig: cpuThreshold must be (0,1], got ${cfg.cpuThreshold}`);
  }
  if (cfg.memoryThreshold <= 0 || cfg.memoryThreshold > 1) {
    throw new Error(`SwarmConfig: memoryThreshold must be (0,1], got ${cfg.memoryThreshold}`);
  }
}
