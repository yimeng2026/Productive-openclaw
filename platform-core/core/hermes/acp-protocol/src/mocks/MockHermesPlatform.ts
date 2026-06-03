// ============================================================
// MockHermesPlatform.ts
// Simulates the Hermes platform (ACP — Agent Communication Protocol)
// ============================================================
// Wire protocol:
//   HermesAdapter → Hermes ACP Broker (tcp://127.0.0.1:9001)
//   ACP Frame: { version, type, sender, recipient, payload, signature }
//   Hermes ACP Broker → HermesAdapter
//   ACP Frame: { version, type, sender, recipient, payload, signature }

import {
  CrossPlatformMessage,
  AgentAddress,
  TaskResult,
  TaskRequestPayload,
  TaskResultPayload,
  ResultMetadata,
} from '../types';

export interface AcpFrame {
  version: string;
  type: 'TASK_ASSIGN' | 'TASK_RESULT' | 'HEARTBEAT' | 'ERROR';
  sender: { agentId: string; nodeId: string };
  recipient: { agentId: string; nodeId: string };
  payload: Record<string, unknown>;
  signature: string;
  timestamp: number;
}

export interface MockHermesConfig {
  brokerUrl: string;
  latencyMs: number;
  version: string;
}

export class MockHermesPlatform {
  private config: MockHermesConfig;

  constructor(config: MockHermesConfig = {
    brokerUrl: 'tcp://127.0.0.1:9001',
    latencyMs: 1800,
    version: 'acp/2.1',
  }) {
    this.config = config;
  }

  get platformName(): string {
    return 'hermes';
  }

  get brokerUrl(): string {
    return this.config.brokerUrl;
  }

  /**
   * Simulate sending a task_request via ACP and receiving a task_result.
   */
  async executeTask(
    inboundMsg: CrossPlatformMessage,
    onWireLog: (direction: string, frame: unknown) => void
  ): Promise<CrossPlatformMessage> {
    const payload = inboundMsg.payload as TaskRequestPayload;
    const subtask = payload.subtask;

    // ---- Wire Frame 1: HermesAdapter → ACP Broker ----
    const reqFrame: AcpFrame = {
      version: this.config.version,
      type: 'TASK_ASSIGN',
      sender: { agentId: 'HermesAdapter', nodeId: 'coordinator-node-1' },
      recipient: { agentId: subtask.assignedAgentId ?? 'HM-Agent', nodeId: 'hermes-worker-pool' },
      payload: {
        taskId: inboundMsg.taskId,
        subtaskId: subtask.id,
        role: subtask.role,
        description: subtask.description,
        context: payload.context,
        dependencies: Object.keys(payload.dependencies),
        timeoutMs: subtask.timeoutMs,
        priority: inboundMsg.priority,
        assignedAt: Date.now(),
      },
      signature: `sha256-${this.randomHex(64)}`,
      timestamp: Date.now(),
    };
    onWireLog(
      `HermesAdapter → Hermes ACP Broker (${this.config.brokerUrl})`,
      reqFrame
    );

    // Simulate network latency
    await this.sleep(this.config.latencyMs);

    // Generate result based on role
    const result = this.generateResult(subtask.role, subtask.description);

    // ---- Wire Frame 2: ACP Broker → HermesAdapter ----
    const resFrame: AcpFrame = {
      version: this.config.version,
      type: 'TASK_RESULT',
      sender: { agentId: subtask.assignedAgentId ?? 'HM-Agent', nodeId: 'hermes-worker-pool' },
      recipient: { agentId: 'HermesAdapter', nodeId: 'coordinator-node-1' },
      payload: {
        taskId: inboundMsg.taskId,
        subtaskId: subtask.id,
        status: 'COMPLETED',
        output: result.output,
        qualityScore: result.qualityScore,
        metadata: result.metadata,
        completedAt: Date.now(),
        workerNode: 'hermes-worker-3',
      },
      signature: `sha256-${this.randomHex(64)}`,
      timestamp: Date.now(),
    };
    onWireLog('Hermes ACP Broker → HermesAdapter', resFrame);

    // ---- Build CrossPlatformMessage task_result ----
    const from: AgentAddress = {
      agentId: subtask.assignedAgentId ?? 'HM-Review',
      platform: 'hermes',
      endpoint: this.config.brokerUrl,
    };
    const to: AgentAddress = {
      agentId: 'coordinator',
      platform: 'openclaw',
    };

    const taskResult: TaskResult = {
      taskId: subtask.id,
      agentId: from.agentId,
      status: 'completed',
      output: result.output,
      metadata: result.metadata,
      qualityScore: result.qualityScore,
      timestamp: Date.now(),
    };

    const resultPayload: TaskResultPayload = { result: taskResult };

    return {
      id: `msg-res-hermes-${Date.now()}`,
      taskId: inboundMsg.taskId,
      from,
      to,
      type: 'task_result',
      payload: resultPayload,
      timestamp: Date.now(),
      deadline: Date.now() + 30000,
      retryCount: 0,
      priority: 6,
    };
  }

  // ---- Preset response data ----

  private generateResult(
    role: string,
    description: string
  ): { output: string; metadata: ResultMetadata; qualityScore: number } {
    if ((role === 'reviewer' || description.includes('审查') || description.includes('review')) && !description.includes('static') && !description.includes('taint') && !description.includes('analysis')) {
      return {
        output: JSON.stringify({
          verdict: 'APPROVED_WITH_REVISIONS',
          overallScore: 0.87,
          dimensions: {
            accuracy: 0.92,
            completeness: 0.85,
            clarity: 0.88,
            originality: 0.82,
            citationQuality: 0.89,
          },
          comments: [
            {
              id: 'REV-001',
              section: '§1 Introduction',
              lineRef: 'paragraph 2',
              type: 'clarity',
              severity: 'minor',
              comment: 'The phrase "transitioning the field from purely theoretical to experimentally competitive" is slightly vague. Specify which experiments (Google 2019, USTC 2020, Xanadu 2022) support this claim.',
              suggestedEdit: '...transitioning the field from purely theoretical to experimentally competitive, with demonstrations by Google (2019), USTC (BosonSampling 2020), and Xanadu (Gaussian boson sampling 2022).',
            },
            {
              id: 'REV-002',
              section: '§2.3 Quantum Algorithms',
              lineRef: 'Table 1',
              type: 'accuracy',
              severity: 'major',
              comment: 'HHL algorithm is listed as "exponential" speedup. This is misleading — the speedup is polylogarithmic in the matrix dimension N, but requires strong assumptions (s-sparse, well-conditioned, quantum RAM).',
              suggestedEdit: 'Add footnote: "Exponential speedup contingent on QRAM and s-sparse, well-conditioned matrix assumptions. Classical randomized algorithms achieve comparable performance for many practical cases."',
            },
            {
              id: 'REV-003',
              section: '§3.2 Trapped Ions',
              lineRef: 'paragraph 3',
              type: 'completeness',
              severity: 'minor',
              comment: 'Missing mention of Quantinuum H2 (32 qubits, 2023) and the recent achievement of "three 9s" two-qubit gate fidelity.',
              suggestedEdit: 'Add: "Quantinuum\'s H2 system (2023) has demonstrated two-qubit gate fidelities exceeding 99.9% (three 9s), a benchmark for fault-tolerant thresholds."',
            },
            {
              id: 'REV-004',
              section: '§4.2 Surface Codes',
              lineRef: 'paragraph 2',
              type: 'accuracy',
              severity: 'minor',
              comment: 'The overhead estimate "~10^3–10^4 physical qubits per logical qubit" is correct for conservative surface code implementations. However, recent lattice surgery protocols (Litinski 2019) have reduced this to ~10^3 for logical Clifford gates.',
              suggestedEdit: 'Add citation: Litinski, M. E. (2019). "A game of surface codes: Large-scale quantum computing with lattice surgery." Quantum, 3, 128.',
            },
            {
              id: 'REV-005',
              section: '§5 Challenges',
              lineRef: 'Challenge 3',
              type: 'originality',
              severity: 'suggestion',
              comment: 'The statement about "shortage of rigorously proven quantum speedups" is accurate but could be strengthened by citing recent negative results (e.g., Babbush et al. 2023 on QAOA limitations).',
            },
          ],
          criticalIssues: [
            'HHL speedup claim needs nuance (REV-002)',
          ],
          summary: 'The paper is well-researched and clearly written. Two issues require attention before publication: (1) the HHL algorithm speedup claim needs qualification, and (2) the hardware table should be updated with IBM Heron. All other comments are minor and optional. Overall quality: B+.',
        }, null, 2),
        metadata: {
          tokensUsed: 4500,
          latencyMs: this.config.latencyMs,
          toolCalls: ['review_document', 'fact_check', 'suggest_edits', 'score_dimensions'],
          reasoningTrace: 'Performed multi-dimensional quality assessment. Cross-referenced all numerical claims against latest literature (2023-2024). Suggested edits preserve author voice while improving accuracy.',
        },
        qualityScore: 0.87,
      };
    }

    if (role === 'coder' || role === 'analyst' || description.includes('代码') || description.includes('code') || description.includes('static') || description.includes('taint') || description.includes('analysis')) {
      return {
        output: 'Static analysis of function queryUser revealed critical SQL injection vulnerability. The function uses raw string interpolation which is vulnerable to SQL injection. Data flow analysis traced user input from req.params.id through userId variable into the SQL query string without any sanitization. The fix is to use parameterized queries instead of template strings. There is no type validation on userId before the database call.',
        metadata: {
          tokensUsed: 2800,
          latencyMs: this.config.latencyMs,
          toolCalls: ['ast_parse', 'taint_analysis', 'pattern_match', 'generate_fix'],
          reasoningTrace: 'Built AST from source. Tracked data flow from req.params.id (source) to db.query() (sink). No sanitizers detected on path. Pattern-matched against SQL injection signatures. Generated fixes preserving function semantics.',
        },
        qualityScore: 0.92,
      };
    }

    // Default fallback
    return {
      output: `{"status":"completed","note":"Generic Hermes result for role=${role}"}`,
      metadata: {
        tokensUsed: 600,
        latencyMs: this.config.latencyMs,
        toolCalls: [],
      },
      qualityScore: 0.71,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private randomHex(len: number): string {
    const chars = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }
}
