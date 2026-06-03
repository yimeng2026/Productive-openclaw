/**
 * @file HermesEngine.ts
 * @description Sylva × 千界花园 记忆→结构进化引擎核心
 *   核心哲学：记忆不是日志，是种子。每一次交互留下的痕迹，
 *   都应该被分析、提炼、固化，最终长成系统的一部分。
 *   杜绝"灾难性遗忘"——重启不是清零，是继续生长。
 */

import { MemoryScanner } from './MemoryScanner';
import { MemoryFossilizer } from './MemoryFossilizer';
import { CodeGrowth, GrowthAction } from './CodeGrowth';
import { AntiForgetting } from './AntiForgetting';
import { KnowledgeGraph } from './KnowledgeGraph';
import { SkillForge } from './SkillForge';
import { AgentLoop } from '@sylva/security-shield';
import { ContextPipeline } from '@sylva/security-shield';
import { SecurityMonitor } from '@sylva/security-shield';
import { CoordinatorWorker } from '@sylva/security-shield';
import { AgentSwarm, type SwarmTask, type AgentRole } from './AgentSwarm';
import { EventBus, EngineRegistry } from '@sylva/orchestrator';
import {
  type SylvaEngine,
  type SylvaTask,
  type EngineResult,
  type EngineHealth,
  EngineCapability,
} from '@sylva/orchestrator';

export interface HermesConfig {
  /** 记忆扫描间隔（毫秒） */
  scanIntervalMs: number;
  /** 模式提取阈值：最少出现次数 */
  patternThreshold: number;
  /** 化石化触发条件 */
  fossilizeTrigger: 'manual' | 'scheduled' | 'event' | 'auto';
  /** 知识图谱存储路径 */
  knowledgeGraphPath: string;
  /** 技能输出目录 */
  skillOutputDir: string;
  /** 代码生长白名单 */
  codeGrowthWhitelist: string[];
}

export interface HermesState {
  version: string;
  lastScanAt: string;
  totalPatternsFound: number;
  totalSkillsForged: number;
  totalMemoriesFossilized: number;
  knowledgeGraphSize: number;
  growthCyclesCompleted: number;
  // AgentSwarm 状态
  swarmAgentCount: number;
  swarmTaskCount: number;
}

export class HermesEngine implements SylvaEngine {
  readonly name = 'hermes-memory';
  readonly version = '1.1.0-sylva-swarm';
  readonly capabilities = [
    EngineCapability.MEMORY_SCAN,
    EngineCapability.MEMORY_STORE,
    EngineCapability.MEMORY_RECALL,
    EngineCapability.MEMORY_CONSOLIDATE,
    EngineCapability.CREATIVE_GENERATE,
    EngineCapability.CREATIVE_REFINE,
    EngineCapability.CREATIVE_REVIEW,
    EngineCapability.REASONING,
  ];
  readonly dependencies = ['security-shield'];

  private config: HermesConfig;
  private scanner: MemoryScanner;
  private fossilizer: MemoryFossilizer;
  private codeGrowth: CodeGrowth;
  private antiForgetting: AntiForgetting;
  private knowledgeGraph: KnowledgeGraph;
  private skillForge: SkillForge;
  private agentLoop: AgentLoop;
  private contextPipeline: ContextPipeline;
  private securityMonitor: SecurityMonitor;
  private coordinatorWorker: CoordinatorWorker;
  private state: HermesState;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  // ── AgentSwarm：内部多 Agent 协作 ──
  private swarm: AgentSwarm;
  private eventBus: EventBus;

  constructor(config: Partial<HermesConfig> = {}) {
    this.config = {
      scanIntervalMs: 60000,
      patternThreshold: 2,
      fossilizeTrigger: 'auto',
      knowledgeGraphPath: './data/knowledge-graph.jsonl',
      skillOutputDir: './skills/auto-forged',
      codeGrowthWhitelist: ['mega/modules', 'mega/services', 'mega/apps'],
      ...config,
    };

    this.scanner = new MemoryScanner();
    this.fossilizer = new MemoryFossilizer();
    this.codeGrowth = new CodeGrowth(this.config.codeGrowthWhitelist);
    this.antiForgetting = new AntiForgetting();
    this.knowledgeGraph = new KnowledgeGraph(this.config.knowledgeGraphPath);
    this.skillForge = new SkillForge(this.config.skillOutputDir);
    this.agentLoop = new AgentLoop({ maxTurns: 50, checkpointInterval: 5, autoCompactThreshold: 85, scopeCreepThreshold: 0.7 });
    this.contextPipeline = new ContextPipeline(200000);
    this.securityMonitor = new SecurityMonitor();
    this.coordinatorWorker = new CoordinatorWorker();

    // 初始化 AgentSwarm
    this.eventBus = new EventBus();
    this.swarm = new AgentSwarm(this.eventBus, {
      maxAgents: 20,
      maxTasksPerAgent: 5,
      autoScale: true,
      gcIntervalMs: 60000,
      taskTimeoutMs: 300000,
      enableInterAgentMessaging: true,
    });

    this.state = this.loadState();
  }

  // ─── SylvaEngine 生命周期适配 ───

  async initialize(): Promise<void> {
    await this.start();
  }

  async health(): Promise<EngineHealth> {
    if (this.scanTimer) {
      return 'running';
    }
    return this.state.growthCyclesCompleted > 0 ? 'paused' : 'stopped';
  }

  async pause(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  async resume(): Promise<void> {
    if (!this.scanTimer && (this.config.fossilizeTrigger === 'auto' || this.config.fossilizeTrigger === 'scheduled')) {
      this.scanTimer = setInterval(() => {
        this.runCycle().catch(console.error);
      }, this.config.scanIntervalMs);
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
  }

  /** SylvaEngine execute — 根据 task 类型分发到 Hermes 能力 */
  async execute(task: SylvaTask): Promise<EngineResult> {
    const start = Date.now();
    try {
      switch (task.type) {
        case 'memory': {
          const action = task.payload.action as string;
          if (action === 'scan' || action === 'cycle') {
            const state = await this.runCycle();
            return {
              success: true,
              data: state,
              durationMs: Date.now() - start,
              engine: this.name,
              meta: { action: 'runCycle' },
            };
          }
          if (action === 'query') {
            const query = task.payload.query as string;
            const limit = (task.payload.limit as number) ?? 10;
            const results = await this.queryKnowledge(query, limit);
            return {
              success: true,
              data: results,
              durationMs: Date.now() - start,
              engine: this.name,
              meta: { action: 'queryKnowledge', query },
            };
          }
          if (action === 'status') {
            const status = await this.getKnowledgeGraphStatus();
            return {
              success: true,
              data: status,
              durationMs: Date.now() - start,
              engine: this.name,
              meta: { action: 'getKnowledgeGraphStatus' },
            };
          }
          if (action === 'report') {
            const report = await this.scanAndReport();
            return {
              success: true,
              data: report,
              durationMs: Date.now() - start,
              engine: this.name,
              meta: { action: 'scanAndReport' },
            };
          }
          if (action === 'fossilize' && task.payload.memoryId) {
            const ok = await this.fossilizeOne(task.payload.memoryId as string);
            return {
              success: ok,
              data: { fossilized: ok },
              durationMs: Date.now() - start,
              engine: this.name,
              meta: { action: 'fossilizeOne' },
            };
          }
          if (action === 'grow') {
            const growths = await this.forceCodeGrowth();
            return {
              success: true,
              data: growths,
              durationMs: Date.now() - start,
              engine: this.name,
              meta: { action: 'forceCodeGrowth' },
            };
          }
          break;
        }
        case 'creative':
        case 'general': {
          // 提交到 Swarm 处理创意/通用任务
          const payload = task.payload;
          const taskId = this.submitToSwarm(
            task.name,
            payload,
            {
              priority: (task.priority === 'critical' ? 90 : task.priority === 'high' ? 70 : 50),
            }
          );
          return {
            success: true,
            data: { swarmTaskId: taskId },
            durationMs: Date.now() - start,
            engine: this.name,
            meta: { action: 'submitToSwarm' },
          };
        }
        case 'chat': {
          // 查询知识图谱作为对话上下文
          const query = (task.payload.query as string) || (task.payload.content as string) || '';
          const results = await this.queryKnowledge(query, 5);
          return {
            success: true,
            data: { knowledgeContext: results },
            durationMs: Date.now() - start,
            engine: this.name,
            meta: { action: 'queryKnowledgeForChat' },
          };
        }
        default:
          break;
      }
      return {
        success: false,
        error: `Unsupported task type or action: ${task.type} / ${task.payload.action}`,
        durationMs: Date.now() - start,
        engine: this.name,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
        durationMs: Date.now() - start,
        engine: this.name,
      };
    }
  }

  // ─── 原生生命周期（守护进程模式）───

  async start(): Promise<void> {
    console.log('[Hermes] 启动... 版本:', this.state.version);

    // 1. 恢复知识图谱（反遗忘的第一道防线）
    await this.knowledgeGraph.load();

    // 2. 立即执行一次完整扫描
    await this.runCycle();

    // 3. 启动定时扫描
    if (this.config.fossilizeTrigger === 'auto' || this.config.fossilizeTrigger === 'scheduled') {
      this.scanTimer = setInterval(() => {
        this.runCycle().catch(console.error);
      }, this.config.scanIntervalMs);
    }

    console.log('[Hermes] 已启动，扫描间隔:', this.config.scanIntervalMs, 'ms');
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.saveState();
    console.log('[Hermes] 已停止，状态已保存');
  }

  // ─── 核心周期：扫描 → 提取 → 化石化 → 生长 ───

  async runCycle(): Promise<HermesState> {
    const cycleStart = Date.now();
    console.log('[Hermes] 周期 #' + (this.state.growthCyclesCompleted + 1), '开始');

    // Stage 0: Security scan — 参考 Claude Code Security Monitor
    this.securityMonitor.setOriginalScope('Hermes memory-to-structure cycle');
    const memories = await this.scanner.scan();
    const threats = this.securityMonitor.scanInput(JSON.stringify(memories));
    if (threats.some(t => t.autoBlocked)) {
      console.warn('[Hermes] Security threats detected, cycle paused:', threats);
      return { ...this.state };
    }
    console.log('[Hermes] 扫描到', memories.length, '条记忆');

    // Stage 2: 提取模式（重复出现的解决方案、错误、偏好）
    const patterns = this.scanner.extractPatterns(memories, this.config.patternThreshold);
    console.log('[Hermes] 提取到', patterns.length, '个模式');

    // Stage 3: 化石化——将记忆固化为结构
    const fossilized = await this.fossilizer.fossilize(patterns, this.knowledgeGraph);
    this.state.totalMemoriesFossilized += fossilized.length;
    console.log('[Hermes] 化石化', fossilized.length, '个记忆');

    // Stage 4: 锻造技能——将模式转化为可复用技能
    const skills = await this.skillForge.forgeFromPatterns(patterns, this.knowledgeGraph);
    this.state.totalSkillsForged += skills.length;
    console.log('[Hermes] 锻造', skills.length, '个新技能');

    // Stage 5: 代码生长——检测代码模式，自动生成/重构
    const growths = await this.codeGrowth.detectAndGrow(this.knowledgeGraph);
    console.log('[Hermes] 代码生长', growths.length, '处');

    // Stage 6: 反遗忘——同步到持久存储
    await this.antiForgetting.sync(this.knowledgeGraph, this.state);

    // Stage 7: 更新知识图谱
    await this.knowledgeGraph.persist();

    // 更新状态
    this.state.growthCyclesCompleted++;
    this.state.lastScanAt = new Date().toISOString();
    this.state.totalPatternsFound += patterns.length;
    this.state.knowledgeGraphSize = await this.knowledgeGraph.size();
    this.saveState();

    const duration = Date.now() - cycleStart;
    console.log('[Hermes] 周期 #' + this.state.growthCyclesCompleted, '完成，耗时', duration, 'ms');

    return { ...this.state };
  }

  // ─── AgentSwarm 接口：突破 5-slot 限制 ───

  /**
   * 在 Swarm 中孵化一个 Kimi Agent
   * 不占用 sessions_spawn slot，内部逻辑 Agent
   */
  spawnKimiAgent(role: AgentRole, name?: string): string {
    const agent = this.swarm.spawnAgent(role, name ?? `kimi-${role}`, [
      'llm:generate',
      'llm:reason',
      'llm:code',
      ...(role === 'prover' ? ['lean:prove', 'math:verify'] : []),
      ...(role === 'writer' ? ['content:generate', 'doc:write'] : []),
      ...(role === 'reviewer' ? ['quality:check', 'bug:detect'] : []),
      ...(role === 'researcher' ? ['web:search', 'data:analyze'] : []),
    ]);
    this.state.swarmAgentCount = this.swarm.getStats().agentCount;
    this.saveState();
    return agent.id;
  }

  /**
   * 提交任务到 Swarm 中的 Kimi Agent
   */
  submitToSwarm(
    type: string,
    payload: Record<string, unknown>,
    options?: {
      priority?: number;
      preferredRole?: AgentRole;
      dependencies?: string[];
    }
  ): string {
    const task = this.swarm.submitTask(type, payload, {
      priority: options?.priority ?? 50,
      preferredRole: options?.preferredRole,
      dependencies: options?.dependencies,
    });
    this.state.swarmTaskCount = this.swarm.getStats().totalTasks;
    this.saveState();
    return task.id;
  }

  /**
   * 获取 Swarm 状态
   */
  getSwarmStats(): ReturnType<AgentSwarm['getStats']> {
    return this.swarm.getStats();
  }

  /**
   * 销毁 Swarm 中所有 Agent
   */
  destroySwarm(): void {
    this.swarm.destroy();
    this.state.swarmAgentCount = 0;
    this.state.swarmTaskCount = 0;
    this.saveState();
  }

  // ─── 手动触发接口 ───

  /** 手动扫描并报告 */
  async scanAndReport(): Promise<string> {
    const memories = await this.scanner.scan();
    const patterns = this.scanner.extractPatterns(memories, this.config.patternThreshold);
    const report = this.generateReport(memories, patterns);
    return report;
  }

  /** 手动化石化一条记忆 */
  async fossilizeOne(memoryId: string): Promise<boolean> {
    const memory = await this.scanner.getById(memoryId);
    if (!memory) return false;
    const result = await this.fossilizer.fossilizeOne(memory, this.knowledgeGraph);
    await this.knowledgeGraph.persist();
    return result !== null;
  }

  /** 强制代码生长扫描 */
  async forceCodeGrowth(): Promise<GrowthAction[]> {
    return await this.codeGrowth.detectAndGrow(this.knowledgeGraph);
  }

  /** 获取知识图谱状态 */
  async getKnowledgeGraphStatus(): Promise<{
    nodeCount: number;
    edgeCount: number;
    lastUpdated: string;
    topConcepts: string[];
  }> {
    return this.knowledgeGraph.getStatus();
  }

  /** 查询知识图谱 */
  async queryKnowledge(query: string, limit = 10): Promise<Array<{ concept: string; relevance: number }>> {
    return this.knowledgeGraph.query(query, limit);
  }

  // ─── 状态持久化 ───

  private loadState(): HermesState {
    try {
      const fs = require('fs');
      const path = './data/hermes-state.json';
      if (fs.existsSync(path)) {
        const raw = fs.readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...this.defaultState(), ...parsed };
      }
    } catch {
      // ignore
    }
    return this.defaultState();
  }

  private saveState(): void {
    try {
      const fs = require('fs');
      const dir = './data';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync('./data/hermes-state.json', JSON.stringify(this.state, null, 2));
    } catch {
      // ignore
    }
  }

  private defaultState(): HermesState {
    return {
      version: '1.1.0-sylva-swarm',
      lastScanAt: new Date().toISOString(),
      totalPatternsFound: 0,
      totalSkillsForged: 0,
      totalMemoriesFossilized: 0,
      knowledgeGraphSize: 0,
      growthCyclesCompleted: 0,
      swarmAgentCount: 0,
      swarmTaskCount: 0,
    };
  }

  private generateReport(memories: any[], patterns: any[]): string {
    const lines = [
      '=== Hermes 扫描报告 ===',
      `扫描记忆: ${memories.length} 条`,
      `提取模式: ${patterns.length} 个`,
      '',
      '主要模式:',
      ...patterns.slice(0, 5).map((p, i) => `  ${i + 1}. ${p.name} (出现 ${p.frequency} 次, 置信度 ${(p.confidence * 100).toFixed(1)}%)`),
      '',
      `知识图谱节点: ${this.state.knowledgeGraphSize}`,
      `已完成的生长周期: ${this.state.growthCyclesCompleted}`,
      `上次扫描: ${this.state.lastScanAt}`,
    ];
    return lines.join('\n');
  }
}

export default HermesEngine;
