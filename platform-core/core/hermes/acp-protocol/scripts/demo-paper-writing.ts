import {
  CrossPlatformMessage,
  AgentAddress,
  TaskRequestPayload,
  TaskResultPayload,
  SubTask,
  TaskStatus,
  OutputFormat,
  DegradationLevel,
  TaskResult,
} from '../src/types';
import { MockOpenClawPlatform } from '../src/mocks/MockOpenClawPlatform';
import { MockClaudePlatform } from '../src/mocks/MockClaudePlatform';
import { MockHermesPlatform } from '../src/mocks/MockHermesPlatform';
import { ResultMerger } from '../src/ResultMerger';
import { MessageFactory } from '../src/CrossPlatformMessage';

// ============================================================
// WireLogger — formats and outputs wire-level messages
// ============================================================

class WireLogger {
  private startTime: number;
  private logs: string[] = [];

  constructor() {
    this.startTime = Date.now();
  }

  private elapsed(): number {
    return Date.now() - this.startTime;
  }

  log(direction: string, payload: unknown): void {
    const ts = `[T+${this.elapsed()}ms]`;
    const line = `${ts} ${direction}:\n${JSON.stringify(payload, null, 2)}`;
    this.logs.push(line);
    console.log(line);
    console.log(''); // blank line for readability
  }

  logPlain(text: string): void {
    const ts = `[T+${this.elapsed()}ms]`;
    const line = `${ts} ${text}`;
    this.logs.push(line);
    console.log(line);
    console.log('');
  }

  getLogs(): string {
    return this.logs.join('\n\n');
  }
}

// ============================================================
// DemoCoordinator — lightweight orchestrator for the demo
// ============================================================

class DemoCoordinator {
  private logger: WireLogger;
  private openclaw: MockOpenClawPlatform;
  private claude: MockClaudePlatform;
  private hermes: MockHermesPlatform;
  private results: Map<string, TaskResult> = new Map();
  private taskId: string;

  constructor(
    logger: WireLogger,
    openclaw: MockOpenClawPlatform,
    claude: MockClaudePlatform,
    hermes: MockHermesPlatform,
    taskId: string
  ) {
    this.logger = logger;
    this.openclaw = openclaw;
    this.claude = claude;
    this.hermes = hermes;
    this.taskId = taskId;
  }

  /**
   * Decompose user request into subtasks + execution plan.
   */
  decompose(request: string): { subtasks: SubTask[]; stages: ExecutionStage[] } {
    // ---- Coordinator → TaskDecomposer ----
    const decomposeReq = {
      request,
      taskId: this.taskId,
      timestamp: Date.now(),
    };
    this.logger.log('Coordinator → TaskDecomposer', decomposeReq);

    // Simulate decomposition delay
    const complexity = this.estimateComplexity(request);

    // Build subtasks
    const sub1: SubTask = {
      id: `${this.taskId}-sub-1`,
      parentId: null,
      description: `Research and gather sources for: "${request}"`,
      role: 'researcher',
      platformPreference: 'openclaw',
      platformFallbacks: ['claude'],
      inputDependencies: [],
      outputFormat: { type: 'structured', schema: { sources: 'array', summary: 'string', keyConcepts: 'array' } },
      estimatedComplexity: complexity,
      timeoutMs: 60000,
      degradationChain: ['full', 'simplified', 'placeholder'],
      status: 'pending' as TaskStatus,
      assignedAgentId: 'OC-Research',
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    const sub2: SubTask = {
      id: `${this.taskId}-sub-2`,
      parentId: null,
      description: `Draft academic paper sections for: "${request}"`,
      role: 'writer',
      platformPreference: 'claude',
      platformFallbacks: ['openclaw'],
      inputDependencies: [`${this.taskId}-sub-1`],
      outputFormat: { type: 'markdown' },
      estimatedComplexity: complexity,
      timeoutMs: 45000,
      degradationChain: ['full', 'simplified', 'placeholder'],
      status: 'pending' as TaskStatus,
      assignedAgentId: 'CL-Write',
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    const sub3: SubTask = {
      id: `${this.taskId}-sub-3`,
      parentId: null,
      description: `Review and critique the drafted paper for: "${request}"`,
      role: 'reviewer',
      platformPreference: 'hermes',
      platformFallbacks: ['claude', 'openclaw'],
      inputDependencies: [`${this.taskId}-sub-2`],
      outputFormat: { type: 'structured', schema: { overallScore: 'number', comments: 'array', citations: 'object' } },
      estimatedComplexity: complexity,
      timeoutMs: 30000,
      degradationChain: ['full', 'simplified'],
      status: 'pending' as TaskStatus,
      assignedAgentId: 'HM-Review',
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    const subtasks = [sub1, sub2, sub3];

    // ---- TaskDecomposer → Coordinator ----
    const decomposeRes = {
      taskId: this.taskId,
      subtasks: subtasks.map((s) => ({
        id: s.id,
        role: s.role,
        description: s.description,
        platformPreference: s.platformPreference,
        inputDependencies: s.inputDependencies,
        timeoutMs: s.timeoutMs,
        estimatedComplexity: s.estimatedComplexity,
      })),
      plan: [
        { stage: 1, subtaskIds: [sub1.id], canParallel: false },
        { stage: 2, subtaskIds: [sub2.id], canParallel: false },
        { stage: 3, subtaskIds: [sub3.id], canParallel: false },
      ],
      complexity,
      timestamp: Date.now(),
    };
    this.logger.log('TaskDecomposer → Coordinator', decomposeRes);

    return {
      subtasks,
      stages: [
        { stage: 1, subtasks: [sub1] },
        { stage: 2, subtasks: [sub2] },
        { stage: 3, subtasks: [sub3] },
      ],
    };
  }

  /**
   * Dispatch a single subtask to the appropriate platform.
   */
  async dispatch(subtask: SubTask, deps: Record<string, TaskResult>): Promise<void> {
    const from: AgentAddress = { agentId: 'coordinator', platform: 'openclaw' };
    const to: AgentAddress = {
      agentId: subtask.assignedAgentId!,
      platform: subtask.platformPreference,
    };

    const payload: TaskRequestPayload = {
      subtask,
      context: subtask.description,
      dependencies: deps,
    };

    const msg = MessageFactory.taskRequest(this.taskId, from, to, payload, subtask.timeoutMs);

    // ---- Coordinator → Platform Adapter ----
    this.logger.log(
      `Coordinator → ${this.capitalize(subtask.platformPreference)}Adapter`,
      {
        type: msg.type,
        taskId: msg.taskId,
        from: msg.from,
        to: msg.to,
        priority: msg.priority,
        payload: {
          subtask: {
            id: subtask.id,
            role: subtask.role,
            description: subtask.description,
            timeoutMs: subtask.timeoutMs,
            platformPreference: subtask.platformPreference,
          },
          context: payload.context,
          dependencyIds: Object.keys(payload.dependencies),
        },
      }
    );

    // Route to mock platform
    let resultMsg: CrossPlatformMessage;
    const wireCallback = (direction: string, frame: unknown) => {
      this.logger.log(direction, frame);
    };

    if (subtask.platformPreference === 'openclaw') {
      resultMsg = await this.openclaw.executeTask(msg, wireCallback);
    } else if (subtask.platformPreference === 'claude') {
      resultMsg = await this.claude.executeTask(msg, wireCallback);
    } else if (subtask.platformPreference === 'hermes') {
      resultMsg = await this.hermes.executeTask(msg, wireCallback);
    } else {
      throw new Error(`Unknown platform: ${subtask.platformPreference}`);
    }

    // ---- Platform Adapter → Coordinator ----
    const resultPayload = resultMsg.payload as TaskResultPayload;
    this.logger.log(
      `${this.capitalize(subtask.platformPreference)}Adapter → Coordinator`,
      {
        type: resultMsg.type,
        taskId: resultMsg.taskId,
        from: resultMsg.from,
        to: resultMsg.to,
        payload: {
          result: {
            taskId: resultPayload.result.taskId,
            agentId: resultPayload.result.agentId,
            status: resultPayload.result.status,
            qualityScore: resultPayload.result.qualityScore,
            outputPreview: resultPayload.result.output.slice(0, 200) + '...',
            metadata: resultPayload.result.metadata,
          },
        },
      }
    );

    this.results.set(subtask.id, resultPayload.result);
  }

  /**
   * Merge all collected results.
   */
  mergeResults(): { mergedOutput: string; finalScore: number } {
    const results = Array.from(this.results.values());

    // ---- Coordinator → ResultMerger ----
    this.logger.log('Coordinator → ResultMerger', {
      strategy: 'sequential_append',
      resultsCount: results.length,
      resultIds: results.map((r) => r.taskId),
    });

    const merger = new ResultMerger({
      strategy: 'sequential_append',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.70,
    });

    const merged = merger.merge(results);

    // ---- ResultMerger → Coordinator ----
    this.logger.log('ResultMerger → Coordinator', {
      finalScore: merged.finalScore,
      contributions: merged.contributions,
      conflicts: merged.conflicts,
      mergedOutputPreview: merged.mergedOutput.slice(0, 300) + '...',
    });

    return {
      mergedOutput: merged.mergedOutput,
      finalScore: merged.finalScore,
    };
  }

  private estimateComplexity(request: string): number {
    let score = 5;
    if (request.length > 200) score += 1;
    if (request.length > 500) score += 1;
    const keywords = ['quantum', 'relativity', 'cryptography', 'formal proof', '论文'];
    for (const kw of keywords) {
      if (request.toLowerCase().includes(kw.toLowerCase())) score += 1;
    }
    return Math.min(10, score);
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

interface ExecutionStage {
  stage: number;
  subtasks: SubTask[];
}

// ============================================================
// Main Demo: Paper Writing
// ============================================================

async function demoPaperWriting(): Promise<void> {
  console.log('='.repeat(70));
  console.log('  CROSS-PLATFORM SWARM — Wire-Level Demo: Paper Writing');
  console.log('='.repeat(70));
  console.log('');

  const logger = new WireLogger();
  const taskId = `task-${Date.now()}`;

  // 1. Initialize platforms
  const openclaw = new MockOpenClawPlatform({
    gatewayUrl: 'ws://127.0.0.1:18679',
    latencyMs: 1200,
    model: 'kimi-latest',
  });
  const claude = new MockClaudePlatform({
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    latencyMs: 2500,
    model: 'claude-3-opus-20240229',
    maxTokens: 4096,
  });
  const hermes = new MockHermesPlatform({
    brokerUrl: 'tcp://127.0.0.1:9001',
    latencyMs: 1800,
    version: 'acp/2.1',
  });

  const coordinator = new DemoCoordinator(logger, openclaw, claude, hermes, taskId);

  // 2. User request
  const request = '帮我写一篇关于量子计算的论文';
  logger.logPlain(`User → Coordinator: "${request}"`);

  // 3. Task decomposition
  const plan = coordinator.decompose(request);

  // 4. Execute stages sequentially
  for (const stage of plan.stages) {
    logger.logPlain(`=== STAGE ${stage.stage} ===`);

    for (const subtask of stage.subtasks) {
      // Gather dependencies
      const deps: Record<string, TaskResult> = {};
      for (const depId of subtask.inputDependencies) {
        const dep = plan.subtasks.find((s) => s.id === depId);
        if (dep) {
          const depResult = coordinator['results'].get(depId);
          if (depResult) deps[depId] = depResult;
        }
      }

      await coordinator.dispatch(subtask, deps);
    }
  }

  // 5. Merge results
  logger.logPlain('=== MERGE PHASE ===');
  const paper = coordinator.mergeResults();

  // 6. Return to user
  logger.logPlain(`Coordinator → User: Final paper (score: ${(paper.finalScore * 100).toFixed(1)}%)`);

  // 7. Print final output
  console.log('');
  console.log('='.repeat(70));
  console.log('  FINAL OUTPUT');
  console.log('='.repeat(70));
  console.log(paper.mergedOutput);
  console.log('');
  console.log(`Final quality score: ${(paper.finalScore * 100).toFixed(1)}%`);

  // Write wire log to file (optional, for documentation)
  // In a real script you might write to fs; here we just console.log
}

demoPaperWriting().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
