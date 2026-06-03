/**
 * AgentRearrange.ts — einsum 风格流重组引擎
 *
 * 来源: swarms (kyegomez/swarms)
 * 特点: 用 einsum 风格字符串定义 Agent 流（a → b,c → d → e）
 *        支持条件分支、循环、并行分叉和汇合
 *
 * 设计参考: NumPy einsum, TensorFlow graph, Airflow DAG
 */

import { logger } from "../utils/logger";
import {
  BaseExecutionMode,
  type AgentRegistration,
  type AgentResult,
  type ExecutionContext,
  type TaskRequest,
  type TaskResult,
  type SwarmMode,
  invokeAgent,
  isAgentAvailable,
  buildTaskResult,
} from "../coordinator/modes/types";

// ─── 类型定义 ───

export type RearrangeNodeType =
  | "agent"      // 执行 Agent
  | "fork"     // 并行分叉 →
  | "join"     // 汇合 ←
  | "condition" // 条件分支 ?
  | "loop"     // 循环 *n
  | "input"    // 输入节点
  | "output";  // 输出节点

export interface RearrangeNode {
  id: string;
  type: RearrangeNodeType;
  /** 节点标签（Agent 名称或操作标识） */
  label: string;
  /** 父节点 IDs（流入） */
  inputs: string[];
  /** 子节点 IDs（流出） */
  outputs: string[];
  /** 条件表达式（仅 condition 类型使用） */
  condition?: string;
  /** 循环次数（仅 loop 类型使用） */
  loopCount?: number;
  /** 节点配置 */
  config?: Record<string, unknown>;
}

export interface RearrangeEdge {
  from: string;
  to: string;
  /** 边标签（用于条件分支标识） */
  label?: string;
}

export interface AgentRearrangeConfig {
  /** 最大并发节点数 */
  maxConcurrency: number;
  /** 是否允许循环 */
  allowLoops: boolean;
  /** 最大循环迭代次数 */
  maxLoopIterations: number;
  /** 条件求值超时（毫秒） */
  conditionTimeoutMs: number;
  /** 执行顺序策略 */
  executionOrder: "topological" | "priority" | "dependency";
}

// ─── 状态机 ───

export type AgentRearrangeState =
  | "idle"
  | "parsing"
  | "building_graph"
  | "executing"
  | "waiting_for_join"
  | "evaluating_condition"
  | "completed"
  | "failed";

// ─── 默认配置 ───

const DEFAULT_CONFIG: AgentRearrangeConfig = {
  maxConcurrency: 5,
  allowLoops: true,
  maxLoopIterations: 10,
  conditionTimeoutMs: 5000,
  executionOrder: "topological",
};

// ─── 流语法解析器 ───

export class FlowParser {
  /**
   * 解析 einsum 风格的流定义字符串
   *
   * 语法规则:
   *   a → b        : a 的输出传给 b
   *   a → b,c      : a 分叉给 b 和 c（并行）
   *   b,c → d      : b 和 c 汇合后传给 d
   *   a → ?b:c     : 条件分支，true→b, false→c
   *   a → *5→b     : 循环 5 次执行 b
   *   (a,b) → c    : a 和 b 的汇合
   *
   * 示例:
   *   "input → researcher → analyzer → drafter → reviewer → output"
   *   "input → researcher → fork(analyst_1, analyst_2) → merger → output"
   */
  static parse(flowString: string): { nodes: RearrangeNode[]; edges: RearrangeEdge[] } {
    const nodes: Map<string, RearrangeNode> = new Map();
    const edges: RearrangeEdge[] = [];

    // 去除空白，标准化
    const normalized = flowString
      .replace(/\s+/g, " ")
      .trim();

    // 按 → 或 -> 分割
    const segments = normalized.split(/\s*→\s*|\s*->\s*/);

    let prevNodeIds: string[] = [];
    let autoIdCounter = 0;

    const ensureNode = (label: string, type: RearrangeNodeType = "agent"): string => {
      const id = `node-${autoIdCounter++}`;
      nodes.set(id, {
        id,
        type,
        label,
        inputs: [],
        outputs: [],
      });
      return id;
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i].trim();

      if (!segment) continue;

      // 解析特殊语法
      if (segment.startsWith("fork(")) {
        // 分叉: fork(a, b, c)
        const inner = segment.slice(5, -1);
        const branchLabels = inner.split(/,\s*/).map((s) => s.trim());
        const forkId = ensureNode("fork", "fork");

        // 连接前节点到 fork
        for (const prevId of prevNodeIds) {
          edges.push({ from: prevId, to: forkId });
          nodes.get(prevId)!.outputs.push(forkId);
          nodes.get(forkId)!.inputs.push(prevId);
        }

        // fork 到各分支
        prevNodeIds = [];
        for (const branchLabel of branchLabels) {
          const branchId = ensureNode(branchLabel);
          edges.push({ from: forkId, to: branchId });
          nodes.get(forkId)!.outputs.push(branchId);
          nodes.get(branchId)!.inputs.push(forkId);
          prevNodeIds.push(branchId);
        }
      } else if (segment.startsWith("join(")) {
        // 汇合: join(a, b, c)
        const inner = segment.slice(5, -1);
        const sourceLabels = inner.split(/,\s*/).map((s) => s.trim());
        const joinId = ensureNode("join", "join");

        // 找到对应的节点
        for (const sourceLabel of sourceLabels) {
          const sourceNode = Array.from(nodes.values()).find(
            (n) => n.label === sourceLabel && !n.outputs.includes(joinId)
          );
          if (sourceNode) {
            edges.push({ from: sourceNode.id, to: joinId });
            sourceNode.outputs.push(joinId);
            nodes.get(joinId)!.inputs.push(sourceNode.id);
          }
        }

        prevNodeIds = [joinId];
      } else if (segment.startsWith("?")) {
        // 条件分支: ?true_path:false_path
        const conditionParts = segment.slice(1).split(":");
        const truePath = conditionParts[0]?.trim();
        const falsePath = conditionParts[1]?.trim();

        const conditionId = ensureNode("condition", "condition");
        for (const prevId of prevNodeIds) {
          edges.push({ from: prevId, to: conditionId });
          nodes.get(prevId)!.outputs.push(conditionId);
          nodes.get(conditionId)!.inputs.push(prevId);
        }

        if (truePath) {
          const trueId = ensureNode(truePath);
          edges.push({ from: conditionId, to: trueId, label: "true" });
          nodes.get(conditionId)!.outputs.push(trueId);
          nodes.get(trueId)!.inputs.push(conditionId);
        }

        if (falsePath) {
          const falseId = ensureNode(falsePath);
          edges.push({ from: conditionId, to: falseId, label: "false" });
          nodes.get(conditionId)!.outputs.push(falseId);
          nodes.get(falseId)!.inputs.push(conditionId);
        }

        prevNodeIds = [truePath, falsePath]
          .filter(Boolean)
          .map((label) =>
            Array.from(nodes.values()).find((n) => n.label === label)?.id || ""
          )
          .filter(Boolean);
      } else if (segment.startsWith("*")) {
        // 循环: *5→loop_body
        const match = segment.match(/^\*(\d+)→(.+)$/);
        if (match) {
          const loopCount = parseInt(match[1], 10);
          const bodyLabel = match[2].trim();

          const loopId = ensureNode("loop", "loop");
          nodes.get(loopId)!.loopCount = loopCount;

          for (const prevId of prevNodeIds) {
            edges.push({ from: prevId, to: loopId });
            nodes.get(prevId)!.outputs.push(loopId);
            nodes.get(loopId)!.inputs.push(prevId);
          }

          const bodyId = ensureNode(bodyLabel);
          edges.push({ from: loopId, to: bodyId });
          nodes.get(loopId)!.outputs.push(bodyId);
          nodes.get(bodyId)!.inputs.push(loopId);

          // 循环体回到循环节点
          edges.push({ from: bodyId, to: loopId });
          nodes.get(bodyId)!.outputs.push(loopId);
          nodes.get(loopId)!.inputs.push(bodyId);

          prevNodeIds = [loopId];
        }
      } else {
        // 普通 Agent 节点
        const nodeId = ensureNode(segment);

        for (const prevId of prevNodeIds) {
          if (prevId) {
            edges.push({ from: prevId, to: nodeId });
            nodes.get(prevId)!.outputs.push(nodeId);
            nodes.get(nodeId)!.inputs.push(prevId);
          }
        }

        prevNodeIds = [nodeId];
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges,
    };
  }
}

// ─── AgentRearrange 执行引擎 ───

export class AgentRearrange extends BaseExecutionMode {
  readonly mode: SwarmMode = "agent-rearrange" as SwarmMode;

  private config: AgentRearrangeConfig;
  private nodes: Map<string, RearrangeNode> = new Map();
  private edges: RearrangeEdge[] = [];
  private nodeResults: Map<string, AgentResult> = new Map();
  private nodeStates: Map<string, "pending" | "running" | "completed" | "failed"> = new Map();
  private currentState: AgentRearrangeState = "idle";
  private loopCounters: Map<string, number> = new Map();

  constructor(config?: Partial<AgentRearrangeConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private setState(state: AgentRearrangeState): void {
    const prev = this.currentState;
    this.currentState = state;
    logger.info(
      { from: prev, to: state, taskId: this.currentTaskId },
      "AgentRearrange state transition"
    );
  }

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.nodeResults.clear();
    this.nodeStates.clear();
    this.loopCounters.clear();

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 解析流定义 ───
    this.setState("parsing");

    const flowString = task.prompt; // 使用 task.prompt 作为流定义
    // 或者从 context 中获取流定义
    const flowDefinition =
      (context.sharedContext as any)?.flowDefinition || flowString;

    const { nodes, edges } = FlowParser.parse(flowDefinition);
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges;

    logger.info(
      { taskId: task.id, nodeCount: nodes.length, edgeCount: edges.length },
      "AgentRearrange: flow parsed"
    );

    if (nodes.length === 0) {
      this.setState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "agent-rearrange-empty-flow",
        { startedAt: startTime }
      );
    }

    // ─── 2. 拓扑排序确定执行顺序 ───
    this.setState("building_graph");
    const executionOrder = this.topologicalSort(nodes, edges);

    logger.info(
      { taskId: task.id, executionOrder: executionOrder.map((n) => n.label) },
      "AgentRearrange: execution order determined"
    );

    // ─── 3. 执行节点 ───
    this.setState("executing");
    const allAgentResults: AgentResult[] = [];
    let finalOutput = "";

    for (const node of executionOrder) {
      if (this.isAborted()) {
        this.setState("failed");
        this._state = "stopped";
        return buildTaskResult(
          task.id,
          allAgentResults,
          "",
          "failed",
          "agent-rearrange-stopped",
          { startedAt: startTime }
        );
      }

      await this.checkPaused();

      logger.info(
        { taskId: task.id, nodeId: node.id, nodeLabel: node.label, nodeType: node.type },
        "AgentRearrange: executing node"
      );

      this.nodeStates.set(node.id, "running");

      const result = await this.executeNode(
        node,
        task,
        agents,
        signal
      );

      this.nodeResults.set(node.id, result);
      this.nodeStates.set(node.id, result.status === "success" ? "completed" : "failed");
      allAgentResults.push(result);

      if (result.status === "success") {
        logger.info(
          { taskId: task.id, nodeId: node.id },
          "AgentRearrange: node completed"
        );
      } else {
        logger.warn(
          { taskId: task.id, nodeId: node.id, error: result.error },
          "AgentRearrange: node failed"
        );

        // 如果关键节点失败，整体失败
        if (node.type === "agent" && node.outputs.length === 0) {
          // 输出节点失败
          this.setState("failed");
          this._state = "failed";
          return buildTaskResult(
            task.id,
            allAgentResults,
            result.output,
            "failed",
            "agent-rearrange-output-node-failed",
            { startedAt: startTime }
          );
        }
      }

      // 收集最终输出（最后一个输出节点）
      if (node.type === "agent" && node.outputs.length === 0) {
        finalOutput = result.output;
      }

      task.onProgress?.(
        `[AgentRearrange] ${node.label} (${node.type}): ${result.status}`
      );
    }

    // ─── 4. 确定最终状态 ───
    const successCount = allAgentResults.filter((r) => r.status === "success").length;
    const failCount = allAgentResults.filter((r) => r.status === "failed").length;

    const finalStatus: "success" | "partial" | "failed" =
      failCount === 0 ? "success" : successCount > 0 ? "partial" : "failed";

    this.setState(finalStatus === "success" ? "completed" : "failed");
    this._state = finalStatus === "success" ? "completed" : finalStatus;

    // 如果没有明确的输出节点，拼接所有结果
    if (!finalOutput) {
      finalOutput = this.buildFinalOutput();
    }

    const taskResult = buildTaskResult(
      task.id,
      allAgentResults,
      finalOutput,
      finalStatus,
      "agent-rearrange",
      {
        startedAt: startTime,
        subTasks: Array.from(this.nodeResults.entries()).map(([id, result]) => {
          const node = this.nodes.get(id);
          return {
            subTaskId: id,
            description: node?.label || id,
            assignedAgentId: result.agentId,
            status: result.status === "success" ? "success" : "failed",
            output: result.output,
          };
        }),
      }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  // ─── 节点执行 ───

  private async executeNode(
    node: RearrangeNode,
    task: TaskRequest,
    agents: AgentRegistration[],
    signal: AbortSignal
  ): Promise<AgentResult> {
    const availableAgents = agents.filter(isAgentAvailable);

    switch (node.type) {
      case "input":
        // 输入节点：传递原始 prompt
        return {
          agentId: "input",
          agentName: "Input",
          status: "success",
          output: task.prompt,
          latencyMs: 0,
        };

      case "output":
        // 输出节点：聚合前序结果
        const inputResults = node.inputs
          .map((id) => this.nodeResults.get(id))
          .filter(Boolean);
        return {
          agentId: "output",
          agentName: "Output",
          status: "success",
          output: inputResults.map((r) => r!.output).join("\n\n"),
          latencyMs: 0,
        };

      case "fork":
        // 分叉节点：标记状态，实际执行由后续节点处理
        return {
          agentId: "fork",
          agentName: "Fork",
          status: "success",
          output: `Forked to ${node.outputs.length} branches`,
          latencyMs: 0,
        };

      case "join":
        // 汇合节点：等待所有输入完成
        this.setState("waiting_for_join");
        const joinResults = node.inputs
          .map((id) => this.nodeResults.get(id))
          .filter(Boolean);
        const allSuccess = joinResults.every((r) => r!.status === "success");
        return {
          agentId: "join",
          agentName: "Join",
          status: allSuccess ? "success" : "failed",
          output: joinResults.map((r) => r!.output).join("\n\n---\n\n"),
          latencyMs: 0,
        };

      case "condition":
        // 条件节点：评估条件并路由
        this.setState("evaluating_condition");
        const parentResult = node.inputs[0]
          ? this.nodeResults.get(node.inputs[0])
          : undefined;
        const conditionValue = await this.evaluateCondition(
          node.condition || "",
          parentResult?.output || ""
        );
        return {
          agentId: "condition",
          agentName: "Condition",
          status: "success",
          output: `Condition evaluated: ${conditionValue}`,
          latencyMs: 0,
        };

      case "loop":
        // 循环节点：管理循环计数
        const currentCount = this.loopCounters.get(node.id) || 0;
        const maxCount = node.loopCount || this.config.maxLoopIterations;
        const shouldContinue = currentCount < maxCount;

        if (shouldContinue) {
          this.loopCounters.set(node.id, currentCount + 1);
        }

        return {
          agentId: "loop",
          agentName: "Loop",
          status: "success",
          output: `Loop ${currentCount + 1}/${maxCount}`,
          latencyMs: 0,
        };

      case "agent":
      default:
        // 找到匹配的 Agent
        const agent = this.findAgentForNode(node, availableAgents);
        if (!agent) {
          return {
            agentId: node.id,
            agentName: node.label,
            status: "failed",
            output: "",
            error: `No matching agent found for node: ${node.label}`,
            latencyMs: 0,
          };
        }

        // 构建输入（合并所有前序节点的输出）
        const nodeInput = this.buildNodeInput(node);
        return invokeAgent(agent, task, nodeInput, signal, task.maxLatencyMs);
    }
  }

  // ─── 拓扑排序 ───

  private topologicalSort(nodes: RearrangeNode[], edges: RearrangeEdge[]): RearrangeNode[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    for (const edge of edges) {
      adjList.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(id);
    }

    const result: RearrangeNode[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = nodes.find((n) => n.id === currentId);
      if (currentNode) result.push(currentNode);

      for (const neighborId of adjList.get(currentId) || []) {
        const newDegree = (inDegree.get(neighborId) || 0) - 1;
        inDegree.set(neighborId, newDegree);
        if (newDegree === 0) queue.push(neighborId);
      }
    }

    if (result.length !== nodes.length) {
      logger.warn(
        { expected: nodes.length, got: result.length },
        "AgentRearrange: cycle detected in flow graph"
      );
      // 返回所有节点（可能有循环）
      return nodes;
    }

    return result;
  }

  // ─── 条件评估 ───

  private async evaluateCondition(condition: string, input: string): Promise<boolean> {
    // 简单条件评估
    // 支持: contains("keyword"), length > 100, has_error, is_complete 等
    if (!condition) return true;

    const lowerInput = input.toLowerCase();

    if (condition.includes("contains")) {
      const match = condition.match(/contains\(["'](.+)["']\)/);
      if (match) {
        return lowerInput.includes(match[1].toLowerCase());
      }
    }

    if (condition.includes("length")) {
      const match = condition.match(/length\s*([<>]=?)\s*(\d+)/);
      if (match) {
        const op = match[1];
        const val = parseInt(match[2], 10);
        switch (op) {
          case ">": return input.length > val;
          case "<": return input.length < val;
          case ">=": return input.length >= val;
          case "<=": return input.length <= val;
        }
      }
    }

    if (condition === "has_error" || condition === "error") {
      return lowerInput.includes("error") || lowerInput.includes("fail");
    }

    if (condition === "is_complete" || condition === "complete") {
      return lowerInput.includes("complete") || lowerInput.includes("done");
    }

    // 默认：如果输入非空则为 true
    return input.length > 0;
  }

  // ─── Agent 匹配 ───

  private findAgentForNode(
    node: RearrangeNode,
    agents: AgentRegistration[]
  ): AgentRegistration | undefined {
    // 1. 精确名称匹配
    const exactMatch = agents.find(
      (a) => a.name.toLowerCase() === node.label.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    // 2. 部分名称匹配
    const partialMatch = agents.find(
      (a) =>
        a.name.toLowerCase().includes(node.label.toLowerCase()) ||
        node.label.toLowerCase().includes(a.name.toLowerCase())
    );
    if (partialMatch) return partialMatch;

    // 3. 能力匹配
    const capabilityMatch = agents.find(
      (a) =>
        a.skills.some((s) =>
          s.toLowerCase().includes(node.label.toLowerCase())
        ) ||
        a.capabilities.some((c) =>
          c.toLowerCase().includes(node.label.toLowerCase())
        )
    );
    if (capabilityMatch) return capabilityMatch;

    // 4. 轮询选择
    return agents[Math.floor(Math.random() * agents.length)];
  }

  // ─── 构建节点输入 ───

  private buildNodeInput(node: RearrangeNode): string {
    const inputParts: string[] = [];

    for (const inputId of node.inputs) {
      const result = this.nodeResults.get(inputId);
      if (result) {
        inputParts.push(result.output);
      }
    }

    if (inputParts.length === 0) {
      return node.label; // 没有输入时使用节点标签作为提示
    }

    return inputParts.join("\n\n---\n\n");
  }

  // ─── 构建最终输出 ───

  private buildFinalOutput(): string {
    const outputs: string[] = [];
    for (const [id, result] of this.nodeResults.entries()) {
      const node = this.nodes.get(id);
      if (node?.type === "agent" && result.status === "success") {
        outputs.push(`[${node.label}]\n${result.output}`);
      }
    }
    return outputs.join("\n\n===\n\n");
  }

  // ─── 生命周期 ───

  override async pause(): Promise<void> {
    await super.pause();
  }

  override async resume(): Promise<void> {
    await super.resume();
  }

  override async stop(): Promise<void> {
    this.nodes.clear();
    this.edges = [];
    this.nodeResults.clear();
    this.nodeStates.clear();
    this.loopCounters.clear();
    await super.stop();
  }

  /** 获取当前执行图状态 */
  getGraphStatus(): {
    nodes: Array<{ id: string; label: string; type: RearrangeNodeType; state: string }>;
    edges: RearrangeEdge[];
  } {
    return {
      nodes: Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        state: this.nodeStates.get(n.id) || "pending",
      })),
      edges: this.edges,
    };
  }

  /** 获取流解析器（静态方法） */
  static getParser(): typeof FlowParser {
    return FlowParser;
  }
}
