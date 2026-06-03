// ============================================================
// MockOpenClawPlatform.ts
// Simulates the OpenClaw platform (WebSocket gateway)
// ============================================================
// Wire protocol:
//   OpenClawAdapter → Gateway (ws://127.0.0.1:18679)
//   Frame: type="req" | header={fn, model, ...} | body={...}
//   Gateway → OpenClawAdapter
//   Frame: type="res" | header={status, sessionKey, ...} | body={...}

import {
  CrossPlatformMessage,
  AgentAddress,
  TaskResult,
  TaskRequestPayload,
  TaskResultPayload,
  ResultMetadata,
} from '../types';

export interface OpenClawWireFrame {
  type: 'req' | 'res';
  header: Record<string, unknown>;
  body: Record<string, unknown>;
}

export interface MockOpenClawConfig {
  gatewayUrl: string;
  latencyMs: number;
  model: string;
}

export class MockOpenClawPlatform {
  private config: MockOpenClawConfig;

  constructor(config: MockOpenClawConfig = {
    gatewayUrl: 'ws://127.0.0.1:18679',
    latencyMs: 1200,
    model: 'kimi-latest',
  }) {
    this.config = config;
  }

  get platformName(): string {
    return 'openclaw';
  }

  get gatewayUrl(): string {
    return this.config.gatewayUrl;
  }

  /**
   * Simulate sending a task_request to OpenClaw and receiving a task_result.
   * Returns the wire frames for logging, plus the final CrossPlatformMessage.
   */
  async executeTask(
    inboundMsg: CrossPlatformMessage,
    onWireLog: (direction: string, frame: unknown) => void
  ): Promise<CrossPlatformMessage> {
    const payload = inboundMsg.payload as TaskRequestPayload;
    const subtask = payload.subtask;

    // ---- Wire Frame 1: Adapter → Gateway (request) ----
    const reqFrame: OpenClawWireFrame = {
      type: 'req',
      header: {
        fn: 'sessions_spawn',
        model: this.config.model,
        sessionKey: `agent:main:subagent:${this.randomId()}`,
        priority: inboundMsg.priority,
        timestamp: Date.now(),
      },
      body: {
        taskId: inboundMsg.taskId,
        subtaskId: subtask.id,
        role: subtask.role,
        description: subtask.description,
        context: payload.context,
        dependencies: Object.keys(payload.dependencies),
        timeoutMs: subtask.timeoutMs,
      },
    };
    onWireLog(
      `OpenClawAdapter → OpenClaw Gateway (${this.config.gatewayUrl})`,
      reqFrame
    );

    // Simulate network latency
    await this.sleep(this.config.latencyMs);

    // Generate result based on role
    const result = this.generateResult(subtask.role, subtask.description);

    // ---- Wire Frame 2: Gateway → Adapter (response) ----
    const resFrame: OpenClawWireFrame = {
      type: 'res',
      header: {
        status: 'ok',
        sessionKey: reqFrame.header.sessionKey as string,
        model: this.config.model,
        tokensUsed: result.metadata.tokensUsed,
        latencyMs: this.config.latencyMs,
        timestamp: Date.now(),
      },
      body: {
        taskId: inboundMsg.taskId,
        subtaskId: subtask.id,
        status: 'completed',
        output: result.output,
        qualityScore: result.qualityScore,
        metadata: result.metadata,
      },
    };
    onWireLog('OpenClaw Gateway → OpenClawAdapter', resFrame);

    // ---- Build CrossPlatformMessage task_result ----
    const from: AgentAddress = {
      agentId: subtask.assignedAgentId ?? 'OC-Research',
      platform: 'openclaw',
      endpoint: this.config.gatewayUrl,
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
      id: `msg-res-${Date.now()}`,
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
    if (role === 'researcher' || description.includes('研究') || description.includes('research')) {
      return {
        output: JSON.stringify({
          sources: [
            {
              title: 'Quantum Computation and Quantum Information',
              authors: ['Nielsen', 'Chuang'],
              year: 2010,
              relevance: 'Foundational text covering all aspects of quantum computing',
            },
            {
              title: 'Fault-tolerant quantum computation with high threshold in two dimensions',
              authors: ['Raussendorf', 'Harrington', 'Goyal'],
              year: 2007,
              relevance: 'Surface code architecture for fault-tolerant quantum computing',
            },
            {
              title: 'Superconducting qubits: Current state of play',
              authors: ['Kjaergaard et al.'],
              year: 2020,
              relevance: 'Review of superconducting qubit platforms (IBM, Google)',
            },
            {
              title: 'Quantum supremacy using a programmable superconducting processor',
              authors: ['Arute et al. (Google)'],
              year: 2019,
              relevance: 'Experimental demonstration of quantum computational advantage',
            },
          ],
          summary: 'Quantum computing has progressed from theoretical foundations (Nielsen & Chuang) to experimental demonstrations of quantum supremacy (Google 2019). Key challenges include: (1) Decoherence and noise limiting qubit lifetimes, (2) Error correction overhead requiring ~1000 physical qubits per logical qubit, (3) Scalable control electronics. Current leading platforms: superconducting circuits (IBM, Google), trapped ions (IonQ, Quantinuum), photonic systems (Xanadu, PsiQuantum).',
          keyConcepts: [
            'Qubit: two-level quantum system |0⟩ and |1⟩',
            'Superposition: α|0⟩ + β|1⟩',
            'Entanglement: non-separable multi-qubit states',
            'Quantum gate: unitary operations (Hadamard, CNOT, T-gate)',
            'Quantum circuit: sequence of gates applied to qubits',
            'Decoherence: loss of quantum information due to environment',
            'Quantum error correction: encoding logical qubits across many physical qubits',
            'Surface code: 2D lattice stabilizer code with high error threshold (~1%)',
          ],
        }, null, 2),
        metadata: {
          tokensUsed: 4200,
          latencyMs: this.config.latencyMs,
          toolCalls: ['search_arxiv', 'search_semantic_scholar', 'summarize'],
          reasoningTrace: 'Searched arXiv for "quantum computing" AND "review" from 2019-2024. Filtered by citation count > 100. Cross-referenced with Semantic Scholar for impact metrics.',
        },
        qualityScore: 0.91,
      };
    }

    if (role === 'writer' || description.includes('写作') || description.includes('draft')) {
      return {
        output: `# 量子计算：原理、进展与挑战

## 1. 引言

量子计算是一种利用量子力学原理（叠加态与纠缠态）进行信息处理的新型计算范式。与经典计算机使用比特（0或1）不同，量子计算机使用量子比特（qubit），可以同时处于0和1的叠加状态。这一特性使得量子计算机在特定问题上具有潜在的指数级加速能力。

## 2. 量子计算基础

### 2.1 量子比特
量子比特是量子信息的基本单位，其状态可以表示为：
$$|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle$$
其中 $\\alpha, \\beta \\in \\mathbb{C}$ 且 $|\\alpha|^2 + |\\beta|^2 = 1$。

### 2.2 量子门
常见的单量子比特门包括：
- **Hadamard门 (H)**: 创建叠加态
- **Pauli-X门**: 量子非门
- **相位门 (S, T)**: 引入相对相位

双量子比特门：
- **CNOT门**: 受控非门，实现纠缠

### 2.3 量子算法
| 算法 | 提出者 | 加速类型 | 应用领域 |
|------|--------|----------|----------|
| Shor算法 | Shor (1994) | 指数级 | 大整数分解、RSA破解 |
| Grover算法 | Grover (1996) | 二次方 | 无序数据库搜索 |
| QAOA | Farhi et al. (2014) | 启发式 | 组合优化 |
| VQE | Peruzzo et al. (2014) | 启发式 | 分子模拟 |

## 3. 硬件平台现状

### 3.1 超导量子比特
IBM、Google 等公司采用超导电路实现量子比特。Google 于 2019 年实现了「量子霸权」——其 53 量子比特处理器 Sycamore 在 200 秒内完成了经典超级计算机需要 10000 年才能完成的特定采样任务。

### 3.2 离子阱
IonQ 和 Quantinuum 使用捕获离子技术，具有较长的相干时间（秒量级）和高保真度的量子门（>99.9%）。

### 3.3 光子量子计算
Xanadu 和 PsiQuantum 探索光子路径，PsiQuantum 计划构建百万量子比特的光子系统。

## 4. 量子纠错

当前量子比特的错误率约在 0.1%–1% 之间，远低于容错计算所需的阈值。表面码（Surface Code）是一种有前景的二维拓扑纠错码，其错误阈值约为 1%，且只需要最近邻相互作用。

$$d_{\\text{logical}} \\approx d_{\\text{physical}} / \\alpha$$
其中 $\\alpha \\approx 1000$ 为纠错开销。

## 5. 挑战与展望

1. **规模化**: 从数百量子比特扩展到数百万
2. **纠错开销**: 每个逻辑量子比特需要约 1000 个物理量子比特
3. **控制电子学**: 低温环境下的高密度信号布线
4. **算法发现**: 更多具有实用量子加速的问题

## 6. 结论

量子计算正处于从NISQ（含噪声中等规模量子）时代向容错量子计算时代过渡的关键阶段。虽然通用量子计算机仍需10-20年才能实现，但专用量子优化和模拟应用已在药物发现、材料科学和金融建模领域展现出潜力。
`,
        metadata: {
          tokensUsed: 3800,
          latencyMs: this.config.latencyMs,
          toolCalls: ['generate_text', 'format_markdown'],
        },
        qualityScore: 0.88,
      };
    }

    if ((role === 'reviewer' || description.includes('审查') || description.includes('review')) && !description.includes('test') && !description.includes('测试') && !description.includes('用例')) {
      return {
        output: JSON.stringify({
          overallScore: 0.85,
          comments: [
            {
              section: '§2.1 量子比特',
              severity: 'minor',
              comment: '建议在公式后加入一个数值示例，帮助读者直观理解叠加态',
            },
            {
              section: '§2.3 量子算法',
              severity: 'minor',
              comment: 'QAOA 和 VQE 属于 NISQ 算法，建议明确标注其启发式特性',
            },
            {
              section: '§3.1 超导量子比特',
              severity: 'major',
              comment: '"量子霸权"一词存在争议，建议使用更中性的"量子计算优势"（Quantum Computational Advantage）',
            },
            {
              section: '§4 量子纠错',
              severity: 'minor',
              comment: '建议补充 LDPC 量子码的最新进展（2023-2024），这是表面码之外的重要方向',
            },
            {
              section: '§5 挑战与展望',
              severity: 'suggestion',
              comment: '可增加"量子-经典混合计算"作为第5个挑战，这是当前工业界的主流范式',
            },
          ],
          citations: {
            missing: [
              'Bravyi, S. & Gosset, D. (2016). Quantum advantage with shallow circuits.',
              'Campbell, E. T. (2017). Roads towards fault-tolerant universal quantum computation.',
            ],
            formatIssues: [
              'Table in §2.3 uses Chinese column headers — consistent with body but ensure arXiv compatibility',
            ],
          },
          style: {
            tone: '学术中性，适合 arXiv',
            clarity: 0.87,
            technicalDepth: 0.82,
          },
        }, null, 2),
        metadata: {
          tokensUsed: 2100,
          latencyMs: this.config.latencyMs,
          toolCalls: ['review_text', 'check_citations', 'score_quality'],
        },
        qualityScore: 0.85,
      };
    }

    if (role === 'tester' || description.includes('test') || description.includes('测试') || description.includes('用例')) {
      return {
        output: 'Generated 4 test cases for SQL injection verification. TC-001: basic injection via userId. TC-002: union-based injection. TC-003: boolean-based blind injection. TC-004: valid integer input. The function uses raw string interpolation which is vulnerable to SQL injection. The fix is to use parameterized queries instead of template strings.',
        metadata: {
          tokensUsed: 1800,
          latencyMs: this.config.latencyMs,
          toolCalls: ['generate_test_cases', 'mutate_payloads'],
        },
        qualityScore: 0.88,
      };
    }

    // Default fallback
    return {
      output: `{"status":"completed","note":"Generic result for role=${role}"}`,
      metadata: {
        tokensUsed: 500,
        latencyMs: this.config.latencyMs,
        toolCalls: [],
      },
      qualityScore: 0.70,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private randomId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}
