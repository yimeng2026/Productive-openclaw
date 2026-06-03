// stubs/orchestrator.d.ts — 类型存根以避免循环依赖
// @sylva/orchestrator 的实际实现由运行时注入

declare module '@sylva/orchestrator' {
  // ── 引擎能力枚举 ──
  export enum EngineCapability {
    INFRA_DEPLOY = 'infra:deploy',
    INFRA_MONITOR = 'infra:monitor',
    INFRA_SCALE = 'infra:scale',
    MEMORY_SCAN = 'memory:scan',
    MEMORY_STORE = 'memory:store',
    MEMORY_RECALL = 'memory:recall',
    MEMORY_CONSOLIDATE = 'memory:consolidate',
    SECURITY_AUDIT = 'security:audit',
    SECURITY_SCAN = 'security:scan',
    SECURITY_VALIDATE = 'security:validate',
    SECURITY_POLICY = 'security:policy',
    CREATIVE_GENERATE = 'creative:generate',
    CREATIVE_REFINE = 'creative:refine',
    CREATIVE_REVIEW = 'creative:review',
    CHAT = 'chat',
    CODE_GENERATE = 'code:generate',
    CODE_REVIEW = 'code:review',
    REASONING = 'reasoning',
    EMBED = 'embed',
    RETRIEVE = 'retrieve',
  }

  // ── 任务类型与优先级 ──
  export type TaskType =
    | 'infra'
    | 'memory'
    | 'security'
    | 'creative'
    | 'chat'
    | 'code'
    | 'general';

  export type SylvaMode = 'solo' | 'combo' | 'auto';

  export type EngineHealth =
    | 'unknown'
    | 'initializing'
    | 'running'
    | 'degraded'
    | 'paused'
    | 'stopped'
    | 'error'
    | 'unregistered';

  export type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

  // ── 引擎接口 ──
  export interface SylvaEngine {
    readonly name: string;
    readonly version: string;
    readonly capabilities: EngineCapability[];
    readonly dependencies?: string[];
    initialize(): Promise<void>;
    execute(task: SylvaTask): Promise<EngineResult>;
    health(): Promise<EngineHealth>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    shutdown(): Promise<void>;
  }

  // ── 任务描述 ──
  export interface SylvaTask {
    id: string;
    type: TaskType;
    name: string;
    payload: Record<string, unknown>;
    priority: TaskPriority;
    targetEngine?: string;
    comboEngines?: string[];
    createdAt: Date;
    deadline?: Date;
    meta?: Record<string, unknown>;
  }

  // ── 执行结果 ──
  export interface EngineResult {
    success: boolean;
    data?: unknown;
    error?: string;
    durationMs: number;
    engine: string;
    meta?: Record<string, unknown>;
  }

  // ── 组合结果 ──
  export interface ComboResult {
    results: EngineResult[];
    bestResult?: EngineResult;
    consensus?: unknown;
    durationMs: number;
  }

  // ── 事件系统 ──
  export interface EngineEvent {
    type: string;
    engine: string;
    timestamp: Date;
    payload?: Record<string, unknown>;
  }

  export type EventListener = (event: EngineEvent) => void | Promise<void>;

  export class EventBus {
    on(eventType: string, listener: EventListener): () => void;
    emit(event: EngineEvent): Promise<void>;
  }

  export class EngineRegistry {
    register(engine: unknown): void;
    unregister(name: string): void;
    get(name: string): unknown | undefined;
    list(): string[];
  }

  export interface OrchestratorConfig {
    enabledEngines: string[];
    defaultMode: string;
    enableEventBus: boolean;
    healthCheckIntervalMs: number;
    taskTimeoutMs: number;
  }

  export class SylvaOrchestrator {
    constructor(config?: Partial<OrchestratorConfig>);
    registerEngine(engine: unknown): void;
    executeTask(task: unknown): Promise<unknown>;
    getStatus(): unknown;
  }
}
