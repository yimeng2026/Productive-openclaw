import {
  CrossPlatformMessage,
  AgentAddress,
  TaskRequestPayload,
  TaskResultPayload,
  SubTask,
  TaskStatus,
  TaskResult,
} from '../src/types';
import { MockOpenClawPlatform } from '../src/mocks/MockOpenClawPlatform';
import { MockClaudePlatform } from '../src/mocks/MockClaudePlatform';
import { MockHermesPlatform } from '../src/mocks/MockHermesPlatform';
import { ResultMerger } from '../src/ResultMerger';
import { MessageFactory } from '../src/CrossPlatformMessage';

// ============================================================
// WireLogger — shared with paper-writing demo
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
    console.log('');
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
// DemoCoordinator — parallel dispatch variant
// ============================================================

class ParallelDemoCoordinator {
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
   * Decompose code review request into parallel subtasks.
   */
  decompose(request: string): { subtasks: SubTask[]; parallelStage: SubTask[] } {
    const decomposeReq = {
      request,
      taskId: this.taskId,
      timestamp: Date.now(),
    };
    this.logger.log('Coordinator → TaskDecomposer', decomposeReq);

    const sub1: SubTask = {
      id: `${this.taskId}-sub-1`,
      parentId: null,
      description: `Perform static analysis and taint tracking for: "${request}"`,
      role: 'analyst',
      platformPreference: 'hermes',
      platformFallbacks: ['openclaw'],
      inputDependencies: [],
      outputFormat: { type: 'structured', schema: { issues: 'array', dataFlow: 'object', metrics: 'object' } },
      estimatedComplexity: 6,
      timeoutMs: 30000,
      degradationChain: ['full', 'simplified'],
      status: 'pending' as TaskStatus,
      assignedAgentId: 'HM-StaticAnalyzer',
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    const sub2: SubTask = {
      id: `${this.taskId}-sub-2`,
      parentId: null,
      description: `Perform security vulnerability scan for: "${request}"`,
      role: 'security_scanner',
      platformPreference: 'claude',
      platformFallbacks: ['hermes', 'openclaw'],
      inputDependencies: [],
      outputFormat: { type: 'structured', schema: { vulnerabilities: 'array', riskScore: 'number', recommendations: 'array' } },
      estimatedComplexity: 6,
      timeoutMs: 35000,
      degradationChain: ['full', 'simplified'],
      status: 'pending' as TaskStatus,
      assignedAgentId: 'CL-SecurityScanner',
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    const sub3: SubTask = {
      id: `${this.taskId}-sub-3`,
      parentId: null,
      description: `Generate test cases to verify SQL injection risk for: "${request}"`,
      role: 'tester',
      platformPreference: 'openclaw',
      platformFallbacks: ['claude'],
      inputDependencies: [],
      outputFormat: { type: 'structured', schema: { testCases: 'array', coverage: 'number', exploits: 'array' } },
      estimatedComplexity: 6,
      timeoutMs: 40000,
      degradationChain: ['full', 'simplified'],
      status: 'pending' as TaskStatus,
      assignedAgentId: 'OC-TestGenerator',
      result: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    const subtasks = [sub1, sub2, sub3];

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
        { stage: 1, subtaskIds: [sub1.id, sub2.id, sub3.id], canParallel: true },
      ],
      executionMode: 'parallel',
      timestamp: Date.now(),
    };
    this.logger.log('TaskDecomposer → Coordinator', decomposeRes);

    return { subtasks, parallelStage: subtasks };
  }

  /**
   * Dispatch a single subtask.
   */
  async dispatch(subtask: SubTask): Promise<void> {
    const from: AgentAddress = { agentId: 'coordinator', platform: 'openclaw' };
    const to: AgentAddress = {
      agentId: subtask.assignedAgentId!,
      platform: subtask.platformPreference,
    };

    const payload: TaskRequestPayload = {
      subtask,
      context: subtask.description,
      dependencies: {},
    };

    const msg = MessageFactory.taskRequest(this.taskId, from, to, payload, subtask.timeoutMs);

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
   * Merge results using voting_dedup strategy.
   */
  mergeResults(): { mergedOutput: string; finalScore: number; conflicts: unknown[] } {
    const results = Array.from(this.results.values());

    this.logger.log('Coordinator → ResultMerger', {
      strategy: 'voting_dedup',
      resultsCount: results.length,
      resultIds: results.map((r) => r.taskId),
    });

    const merger = new ResultMerger({
      strategy: 'voting_dedup',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.70,
    });

    const merged = merger.merge(results);

    this.logger.log('ResultMerger → Coordinator', {
      finalScore: merged.finalScore,
      contributions: merged.contributions,
      conflicts: merged.conflicts,
      mergedOutputPreview: merged.mergedOutput.slice(0, 300) + '...',
    });

    return {
      mergedOutput: merged.mergedOutput,
      finalScore: merged.finalScore,
      conflicts: merged.conflicts,
    };
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

// ============================================================
// Main Demo: Code Review (Parallel)
// ============================================================

async function demoCodeReview(): Promise<void> {
  console.log('='.repeat(70));
  console.log('  CROSS-PLATFORM SWARM — Wire-Level Demo: Code Review (Parallel)');
  console.log('='.repeat(70));
  console.log('');

  const logger = new WireLogger();
  const taskId = `task-${Date.now()}`;

  const openclaw = new MockOpenClawPlatform({
    gatewayUrl: 'ws://127.0.0.1:18679',
    latencyMs: 1500,
    model: 'kimi-latest',
  });
  const claude = new MockClaudePlatform({
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    latencyMs: 2200,
    model: 'claude-3-opus-20240229',
    maxTokens: 4096,
  });
  const hermes = new MockHermesPlatform({
    brokerUrl: 'tcp://127.0.0.1:9001',
    latencyMs: 1600,
    version: 'acp/2.1',
  });

  const coordinator = new ParallelDemoCoordinator(logger, openclaw, claude, hermes, taskId);

  // 1. User request
  const request = '审查这个函数的 SQL 注入风险';
  logger.logPlain(`User → Coordinator: "${request}"`);

  // 2. Decompose
  const plan = coordinator.decompose(request);

  // 3. Execute ALL in parallel
  logger.logPlain('=== PARALLEL STAGE: dispatching all 3 subtasks simultaneously ===');
  const dispatchPromises = plan.parallelStage.map((subtask) => coordinator.dispatch(subtask));
  await Promise.all(dispatchPromises);

  // 4. Merge with voting_dedup
  logger.logPlain('=== MERGE PHASE (voting_dedup) ===');
  const review = coordinator.mergeResults();

  // 5. Return to user
  logger.logPlain(`Coordinator → User: Code review complete (score: ${(review.finalScore * 100).toFixed(1)}%)`);

  // 6. Print final output
  console.log('');
  console.log('='.repeat(70));
  console.log('  FINAL OUTPUT');
  console.log('='.repeat(70));
  console.log(review.mergedOutput);
  console.log('');
  console.log(`Final quality score: ${(review.finalScore * 100).toFixed(1)}%`);
  if (review.conflicts.length > 0) {
    console.log(`Conflicts detected: ${review.conflicts.length}`);
    for (const c of review.conflicts) {
      console.log(`  - ${JSON.stringify(c)}`);
    }
  }
}

demoCodeReview().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
