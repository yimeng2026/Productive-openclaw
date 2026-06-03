/**
 * ForestSwarm.ts — 多叉树 Agent 选择器
 *
 * 来源: swarms (kyegomez/swarms)
 * 特点: 将 Agents 组织为多叉树，根据任务特征动态选择最优路径
 *        每个节点评估子节点适用性，选择最佳分支执行
 *        支持回溯和剪枝优化
 *
 * 设计参考: Decision Tree, Monte Carlo Tree Search, A* Search
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

export interface ForestNode {
  id: string;
  /** 节点标签 */
  label: string;
  /** 节点类型: root | internal | leaf */
  nodeType: "root" | "internal" | "leaf";
  /** 子节点 IDs */
  children: string[];
  /** 父节点 ID */
  parent?: string;
  /** 节点深度 */
  depth: number;
  /** 节点评分（动态计算） */
  score: number;
  /** 节点元数据 */
  metadata?: {
    capabilities?: string[];
    specialties?: string[];
    avgLatency?: number;
    successRate?: number;
  };
  /** 绑定的 Agent ID（leaf 节点） */
  agentId?: string;
}

export interface ForestSwarmConfig {
  /** 最大深度 */
  maxDepth: number;
  /** 分支因子（每个节点的最大子节点数） */
  maxBranchFactor: number;
  /** 选择策略: best_score | round_robin | random | ucb */
  selectionStrategy: "best_score" | "round_robin" | "random" | "ucb";
  /** 评分权重 */
  scoreWeights: {
    capabilityMatch: number;  // 能力匹配度
    latency: number;         // 延迟权重（越低越好）
    successRate: number;      // 成功率
    depthPenalty: number;    // 深度惩罚（防止过深）
  };
  /** 是否启用剪枝 */
  enablePruning: boolean;
  /** 剪枝阈值（低于此分数的分支被剪除） */
  pruneThreshold: number;
  /** 是否启用回溯 */
  enableBacktrack: boolean;
  /** 回溯最大次数 */
  maxBacktracks: number;
  /** 探索-利用平衡参数（UCB） */
  explorationConstant: number;
}

export type ForestSwarmState =
  | "idle"
  | "tree_building"
  | "root_selection"
  | "traversing"
  | "evaluating"
  | "executing_leaf"
  | "backtracking"
  | "pruning"
  | "completed"
  | "failed"
  | "stopped";

// ─── 默认配置 ───

const DEFAULT_CONFIG: ForestSwarmConfig = {
  maxDepth: 5,
  maxBranchFactor: 4,
  selectionStrategy: "ucb",
  scoreWeights: {
    capabilityMatch: 0.4,
    latency: 0.2,
    successRate: 0.3,
    depthPenalty: 0.1,
  },
  enablePruning: true,
  pruneThreshold: 0.3,
  enableBacktrack: true,
  maxBacktracks: 3,
  explorationConstant: 1.414, // sqrt(2)
};

// ─── ForestSwarm 实现 ───

export class ForestSwarm extends BaseExecutionMode {
  readonly mode: SwarmMode = "forest-swarm" as SwarmMode;

  private config: ForestSwarmConfig;
  private nodes: Map<string, ForestNode> = new Map();
  private rootId: string | null = null;
  private currentPath: string[] = [];
  private backtrackCount = 0;
  private executionHistory: Array<{
    nodeId: string;
    result: AgentResult;
    timestamp: number;
  }> = [];
  private nodeVisitCounts: Map<string, number> = new Map();
  private nodeTotalScores: Map<string, number> = new Map();
  private swarmState: ForestSwarmState = "idle";

  constructor(config?: Partial<ForestSwarmConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private setState(state: ForestSwarmState): void {
    const prev = this.swarmState;
    this.swarmState = state;
    logger.info({ from: prev, to: state, taskId: this.currentTaskId }, "ForestSwarm state transition");
  }

  async execute(
    task: TaskRequest,
    agents: AgentRegistration[],
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    this._state = "running";
    this.currentTaskId = task.id;
    this.currentPath = [];
    this.backtrackCount = 0;
    this.executionHistory = [];
    this.nodeVisitCounts.clear();
    this.nodeTotalScores.clear();

    const abortCtrl = this.createAbortController();
    const signal = abortCtrl.signal;

    // ─── 1. 构建 Agent 树 ───
    this.setState("tree_building");
    this.buildAgentTree(agents);

    if (!this.rootId || this.nodes.size === 0) {
      this.setState("failed");
      this._state = "failed";
      return buildTaskResult(
        task.id,
        [],
        "",
        "failed",
        "forest-swarm-empty-tree",
        { startedAt: startTime }
      );
    }

    logger.info(
      { taskId: task.id, nodeCount: this.nodes.size, rootId: this.rootId },
      "ForestSwarm: agent tree built"
    );

    // ─── 2. 根节点评估与选择 ───
    this.setState("root_selection");
    const rootNode = this.nodes.get(this.rootId)!;
    const taskKeywords = this.extractTaskKeywords(task.prompt);

    logger.info(
      { taskId: task.id, keywords: taskKeywords },
      "ForestSwarm: task keywords extracted"
    );

    // ─── 3. 树遍历执行 ───
    this.setState("traversing");
    const allAgentResults: AgentResult[] = [];
    let currentNodeId = this.rootId;
    let finalOutput = "";
    let leafExecuted = false;

    while (currentNodeId && !leafExecuted && !this.isAborted()) {
      await this.checkPaused();

      const node = this.nodes.get(currentNodeId);
      if (!node) break;

      logger.info(
        { taskId: task.id, nodeId: node.id, nodeType: node.nodeType, depth: node.depth },
        "ForestSwarm: visiting node"
      );

      // 更新访问计数
      this.nodeVisitCounts.set(node.id, (this.nodeVisitCounts.get(node.id) || 0) + 1);

      if (node.nodeType === "leaf" || node.children.length === 0) {
        // ─── 叶子节点：执行 Agent ───
        this.setState("executing_leaf");

        const agent = agents.find((a) => a.id === node.agentId);
        if (!agent || !isAgentAvailable(agent)) {
          logger.warn(
            { taskId: task.id, nodeId: node.id, agentId: node.agentId },
            "ForestSwarm: leaf agent unavailable"
          );

          if (this.config.enableBacktrack && this.backtrackCount < this.config.maxBacktracks) {
            this.setState("backtracking");
            const backtrackResult = this.backtrack(currentNodeId);
            if (backtrackResult) {
              currentNodeId = backtrackResult;
              this.backtrackCount++;
              continue;
            }
          }

          this.setState("failed");
          this._state = "failed";
          return buildTaskResult(
            task.id,
            allAgentResults,
            "",
            "failed",
            "forest-swarm-leaf-unavailable",
            { startedAt: startTime }
          );
        }

        const result = await invokeAgent(agent, task, task.prompt, signal, task.maxLatencyMs);
        allAgentResults.push(result);

        // 记录执行历史
        this.executionHistory.push({
          nodeId: node.id,
          result,
          timestamp: Date.now(),
        });

        // 更新节点分数
        const nodeScore = this.calculateNodeScore(node, result, taskKeywords);
        this.nodeTotalScores.set(node.id, (this.nodeTotalScores.get(node.id) || 0) + nodeScore);

        if (result.status === "success") {
          logger.info(
            { taskId: task.id, nodeId: node.id, agentId: agent.id },
            "ForestSwarm: leaf execution successful"
          );
          finalOutput = result.output;
          leafExecuted = true;
        } else {
          logger.warn(
            { taskId: task.id, nodeId: node.id, error: result.error },
            "ForestSwarm: leaf execution failed"
          );

          // 尝试回溯
          if (this.config.enableBacktrack && this.backtrackCount < this.config.maxBacktracks) {
            this.setState("backtracking");
            const backtrackResult = this.backtrack(currentNodeId);
            if (backtrackResult) {
              currentNodeId = backtrackResult;
              this.backtrackCount++;
              continue;
            }
          }

          // 回溯失败，尝试兄弟节点
          const sibling = this.findBestSibling(currentNodeId);
          if (sibling) {
            currentNodeId = sibling;
            continue;
          }

          // 所有路径都失败
          this.setState("failed");
          this._state = "failed";
          return buildTaskResult(
            task.id,
            allAgentResults,
            "",
            "failed",
            "forest-swarm-all-paths-failed",
            { startedAt: startTime }
          );
        }

        task.onProgress?.(
          `[ForestSwarm] Leaf ${node.label} (${agent.name}): ${result.status}`
        );
      } else {
        // ─── 内部节点：评估子节点并选择最优路径 ───
        this.setState("evaluating");

        const scoredChildren = node.children
          .map((childId) => ({
            childId,
            child: this.nodes.get(childId)!,
            score: this.evaluateChild(node, childId, taskKeywords),
          }))
          .filter((item) => item.child && (!this.config.enablePruning || item.score >= this.config.pruneThreshold));

        if (scoredChildren.length === 0) {
          logger.warn(
            { taskId: task.id, nodeId: node.id },
            "ForestSwarm: no viable children after pruning"
          );

          if (this.config.enableBacktrack && this.backtrackCount < this.config.maxBacktracks) {
            const backtrackResult = this.backtrack(currentNodeId);
            if (backtrackResult) {
              currentNodeId = backtrackResult;
              this.backtrackCount++;
              continue;
            }
          }

          this.setState("failed");
          this._state = "failed";
          return buildTaskResult(
            task.id,
            allAgentResults,
            "",
            "failed",
            "forest-swarm-no-viable-children",
            { startedAt: startTime }
          );
        }

        // 按分数排序
        scoredChildren.sort((a, b) => b.score - a.score);

        // 选择策略
        const selectedChild = this.selectChild(scoredChildren);
        if (selectedChild) {
          this.currentPath.push(currentNodeId);
          currentNodeId = selectedChild.childId;

          logger.info(
            {
              taskId: task.id,
              fromNode: node.id,
              toNode: selectedChild.childId,
              score: selectedChild.score,
            },
            "ForestSwarm: selected child path"
          );
        } else {
          break;
        }
      }
    }

    if (this.isAborted()) {
      this.setState("stopped");
      this._state = "stopped";
      return buildTaskResult(
        task.id,
        allAgentResults,
        "",
        "failed",
        "forest-swarm-stopped",
        { startedAt: startTime }
      );
    }

    // ─── 4. 构建最终结果 ───
    const successCount = allAgentResults.filter((r) => r.status === "success").length;
    const finalStatus: "success" | "partial" | "failed" =
      successCount > 0 ? "success" : "failed";

    this.setState(finalStatus === "success" ? "completed" : "failed");
    this._state = finalStatus === "success" ? "completed" : finalStatus;

    // 构建路径描述
    const pathDescription = this.currentPath
      .map((id) => this.nodes.get(id)?.label || id)
      .join(" → ");

    const enhancedOutput = finalOutput
      ? `[ForestSwarm Path: ${pathDescription}]\n\n${finalOutput}`
      : "";

    const taskResult = buildTaskResult(
      task.id,
      allAgentResults,
      enhancedOutput,
      finalStatus,
      "forest-swarm",
      {
        startedAt: startTime,
        subTasks: this.executionHistory.map((h) => ({
          subTaskId: h.nodeId,
          description: this.nodes.get(h.nodeId)?.label || h.nodeId,
          assignedAgentId: h.result.agentId,
          status: h.result.status === "success" ? "success" : "failed",
          output: h.result.output,
        })),
      }
    );

    task.onComplete?.(taskResult);
    return taskResult;
  }

  // ─── 构建 Agent 树 ───

  private buildAgentTree(agents: AgentRegistration[]): void {
    this.nodes.clear();
    const availableAgents = agents.filter(isAgentAvailable);

    if (availableAgents.length === 0) return;

    // 创建根节点
    const rootId = `forest-root`;
    this.rootId = rootId;
    this.nodes.set(rootId, {
      id: rootId,
      label: "Root",
      nodeType: "root",
      children: [],
      depth: 0,
      score: 1.0,
    });

    // 按能力分组构建层级
    const agentGroups = this.groupAgentsByCapability(availableAgents);
    let currentLevelIds = [rootId];
    let autoIdCounter = 0;

    for (let depth = 1; depth <= this.config.maxDepth; depth++) {
      const nextLevelIds: string[] = [];

      for (const parentId of currentLevelIds) {
        const parent = this.nodes.get(parentId);
        if (!parent) continue;

        // 为每个父节点选择子节点
        const childrenForParent = Math.min(
          this.config.maxBranchFactor,
          availableAgents.length
        );

        for (let i = 0; i < childrenForParent; i++) {
          const agent = availableAgents[autoIdCounter % availableAgents.length];
          autoIdCounter++;

          const isLeaf = depth === this.config.maxDepth || agentGroups.size <= 1;
          const nodeId = `forest-${depth}-${i}-${agent.id}`;

          const node: ForestNode = {
            id: nodeId,
            label: agent.name,
            nodeType: isLeaf ? "leaf" : "internal",
            children: [],
            parent: parentId,
            depth,
            score: 0.5, // 初始分数
            agentId: isLeaf ? agent.id : undefined,
            metadata: {
              capabilities: agent.capabilities,
              specialties: agent.skills,
            },
          };

          this.nodes.set(nodeId, node);
          parent.children.push(nodeId);
          nextLevelIds.push(nodeId);
        }
      }

      currentLevelIds = nextLevelIds;
      if (currentLevelIds.length === 0) break;
    }

    // 确保所有末端节点都是 leaf
    for (const node of this.nodes.values()) {
      if (node.children.length === 0 && node.nodeType !== "root") {
        node.nodeType = "leaf";
        if (!node.agentId) {
          // 从可用 agents 中找一个绑定
          const agent = availableAgents.find(
            (a) => a.name.toLowerCase().includes(node.label.toLowerCase())
          ) || availableAgents[0];
          node.agentId = agent?.id;
        }
      }
    }
  }

  // ─── Agent 按能力分组 ───

  private groupAgentsByCapability(
    agents: AgentRegistration[]
  ): Map<string, AgentRegistration[]> {
    const groups = new Map<string, AgentRegistration[]>();

    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        if (!groups.has(cap)) {
          groups.set(cap, []);
        }
        groups.get(cap)!.push(agent);
      }
    }

    return groups;
  }

  // ─── 提取任务关键词 ───

  private extractTaskKeywords(prompt: string): string[] {
    // 简单关键词提取（基于常见技术词汇）
    const techKeywords = [
      "code", "analysis", "review", "test", "debug", "design",
      "document", "search", "write", "translate", "summarize",
      "math", "data", "visualization", "deploy", "security",
    ];

    const lowerPrompt = prompt.toLowerCase();
    return techKeywords.filter((kw) => lowerPrompt.includes(kw));
  }

  // ─── 评估子节点 ───

  private evaluateChild(
    parentNode: ForestNode,
    childId: string,
    taskKeywords: string[]
  ): number {
    const child = this.nodes.get(childId);
    if (!child) return 0;

    const weights = this.config.scoreWeights;

    // 1. 能力匹配度
    const childCaps = child.metadata?.capabilities || [];
    const matchingCaps = childCaps.filter((c) =>
      taskKeywords.some((kw) => c.toLowerCase().includes(kw))
    );
    const capabilityScore =
      childCaps.length > 0 ? matchingCaps.length / childCaps.length : 0.5;

    // 2. UCB 评分（探索-利用平衡）
    const visitCount = this.nodeVisitCounts.get(childId) || 0;
    const totalScore = this.nodeTotalScores.get(childId) || 0;
    const parentVisits = this.nodeVisitCounts.get(parentNode.id) || 1;

    let ucbScore = 0;
    if (visitCount > 0) {
      const avgScore = totalScore / visitCount;
      const exploration =
        this.config.explorationConstant * Math.sqrt(Math.log(parentVisits) / visitCount);
      ucbScore = avgScore + exploration;
    } else {
      // 未访问过的节点给予高探索值
      ucbScore = 1.0 + this.config.explorationConstant * Math.sqrt(Math.log(parentVisits));
    }

    // 3. 深度惩罚
    const depthPenalty = child.depth * weights.depthPenalty;

    // 4. 成功率（如果有历史数据）
    const successRate = child.metadata?.successRate || 0.8;

    // 综合评分
    const score =
      capabilityScore * weights.capabilityMatch +
      ucbScore * 0.2 +
      successRate * weights.successRate -
      depthPenalty;

    return Math.max(0, Math.min(1, score));
  }

  // ─── 选择子节点 ───

  private selectChild(
    scoredChildren: Array<{ childId: string; child: ForestNode; score: number }>
  ): { childId: string; child: ForestNode; score: number } | null {
    if (scoredChildren.length === 0) return null;

    switch (this.config.selectionStrategy) {
      case "best_score":
        return scoredChildren[0];

      case "round_robin":
        // 轮询选择（基于路径长度）
        const index = this.currentPath.length % scoredChildren.length;
        return scoredChildren[index];

      case "random":
        return scoredChildren[Math.floor(Math.random() * scoredChildren.length)];

      case "ucb":
      default:
        // UCB 已经包含在评分中，选择最高分
        return scoredChildren[0];
    }
  }

  // ─── 回溯 ───

  private backtrack(fromNodeId: string): string | null {
    logger.info(
      { taskId: this.currentTaskId, fromNode: fromNodeId, backtrackCount: this.backtrackCount },
      "ForestSwarm: backtracking"
    );

    // 从当前路径中移除当前节点
    const pathIndex = this.currentPath.indexOf(fromNodeId);
    if (pathIndex >= 0) {
      this.currentPath = this.currentPath.slice(0, pathIndex);
    }

    // 找父节点
    const node = this.nodes.get(fromNodeId);
    if (node?.parent) {
      const parent = this.nodes.get(node.parent);
      if (parent) {
        // 标记当前分支为失败，尝试其他分支
        const remainingSiblings = parent.children.filter(
          (cid) => cid !== fromNodeId && !this.currentPath.includes(cid)
        );
        if (remainingSiblings.length > 0) {
          // 返回父节点，下次会重新评估
          return node.parent;
        }
      }
    }

    // 回溯到路径上一个节点
    if (this.currentPath.length > 0) {
      return this.currentPath[this.currentPath.length - 1];
    }

    return null;
  }

  // ─── 查找最佳兄弟节点 ───

  private findBestSibling(nodeId: string): string | null {
    const node = this.nodes.get(nodeId);
    if (!node?.parent) return null;

    const parent = this.nodes.get(node.parent);
    if (!parent) return null;

    const siblings = parent.children.filter((cid) => cid !== nodeId);
    if (siblings.length === 0) return null;

    // 选择得分最高的兄弟
    const scoredSiblings = siblings
      .map((cid) => ({
        id: cid,
        score: this.nodeTotalScores.get(cid) || 0.5,
      }))
      .sort((a, b) => b.score - a.score);

    return scoredSiblings[0]?.id || null;
  }

  // ─── 计算节点分数 ───

  private calculateNodeScore(
    node: ForestNode,
    result: AgentResult,
    taskKeywords: string[]
  ): number {
    let score = 0.5;

    if (result.status === "success") {
      score += 0.3;

      // 输出长度奖励
      const outputLength = result.output.length;
      if (outputLength > 100) score += 0.1;
      if (outputLength > 500) score += 0.1;

      // 关键词匹配奖励
      const lowerOutput = result.output.toLowerCase();
      const keywordMatches = taskKeywords.filter((kw) => lowerOutput.includes(kw)).length;
      score += (keywordMatches / Math.max(taskKeywords.length, 1)) * 0.2;
    } else {
      score -= 0.3;
    }

    // 延迟惩罚
    const latencyPenalty = Math.min(result.latencyMs / 30000, 0.2);
    score -= latencyPenalty;

    return Math.max(0, Math.min(1, score));
  }

  // ─── 生命周期 ───

  override async pause(): Promise<void> {
    if (this.swarmState === "traversing" || this.swarmState === "executing_leaf") {
      this.setState("idle"); // 回溯到可恢复状态
    }
    await super.pause();
  }

  override async resume(): Promise<void> {
    if (this.currentPath.length > 0) {
      this.setState("traversing");
    }
    await super.resume();
  }

  override async stop(): Promise<void> {
    this.setState("idle");
    this.nodes.clear();
    this.rootId = null;
    this.currentPath = [];
    this.backtrackCount = 0;
    this.executionHistory = [];
    await super.stop();
  }

  /** 获取树的当前状态 */
  getTreeStatus(): {
    nodes: ForestNode[];
    rootId: string | null;
    currentPath: string[];
    swarmState: ForestSwarmState;
  } {
    return {
      nodes: Array.from(this.nodes.values()),
      rootId: this.rootId,
      currentPath: [...this.currentPath],
      swarmState: this.swarmState,
    };
  }

  /** 获取节点统计 */
  getNodeStats(): Array<{
    nodeId: string;
    label: string;
    visits: number;
    totalScore: number;
    avgScore: number;
  }> {
    return Array.from(this.nodes.values()).map((node) => {
      const visits = this.nodeVisitCounts.get(node.id) || 0;
      const totalScore = this.nodeTotalScores.get(node.id) || 0;
      return {
        nodeId: node.id,
        label: node.label,
        visits,
        totalScore,
        avgScore: visits > 0 ? totalScore / visits : 0,
      };
    });
  }
}
