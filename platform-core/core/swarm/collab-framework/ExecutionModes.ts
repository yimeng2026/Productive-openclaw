/**
 * ExecutionModes.ts — SYLVA 蜂群四种执行模式
 * 
 * 四种模式覆盖从线性流水线到完全自适应的全谱系调度策略：
 * - Sequential: 确定性流水线，适合有严格依赖关系的子任务
 * - Parallel: 最大吞吐并发，适合无依赖子任务
 * - Hierarchical: 树形递归，适合需要分层治理的复杂任务
 * - Dynamic: 运行时决策，根据实时负载和结果自适应选择模式
 */

export type ExecutionMode = 'sequential' | 'parallel' | 'hierarchical' | 'dynamic';

/** 单个任务的执行结果包装 */
export interface TaskResult<T = unknown> {
  taskId: string;
  status: 'success' | 'failure' | 'timeout' | 'skipped';
  data?: T;
  error?: string;
  durationMs: number;
  nodeId?: string;       // 执行节点的ID
  depth?: number;        // 执行时的递归深度
}

/** 子任务定义 */
export interface SubTask {
  id: string;
  name: string;
  description: string;
  payload: unknown;
  /** 依赖的其他子任务ID（Sequential模式下必须等依赖完成） */
  dependencies?: string[];
  /** 推荐执行模式（Dynamic模式下可被覆盖） */
  preferredMode?: ExecutionMode;
  /** 超时时间（毫秒，覆盖全局配置） */
  timeoutMs?: number;
  /** 优先级（数值越大越优先） */
  priority?: number;
  /** 任务元数据 */
  meta?: Record<string, unknown>;
}

/** 模式执行上下文 */
export interface ExecutionContext {
  mode: ExecutionMode;
  depth: number;
  parentTaskId?: string;
  startTime: number;
  config: { timeoutMs: number; maxRetries: number };
}

// ──────────────────────────────────────────
// Sequential: 流水线 A → B → C
// ──────────────────────────────────────────

/**
 * 顺序执行：严格按照依赖链逐个执行
 * - 依赖解析使用拓扑排序
 * - 每个任务完成后才会启动下一个
 * - 适合编译链、数据流处理、审批流程等
 */
export async function executeSequential<T = unknown>(
  subTasks: SubTask[],
  executeFn: (task: SubTask) => Promise<TaskResult<T>>,
  context: ExecutionContext
): Promise<TaskResult<T>[]> {
  // 拓扑排序：构建依赖图
  const pending = new Set(subTasks.map(t => t.id));
  const completed = new Map<string, TaskResult<T>>();
  const results: TaskResult<T>[] = [];

  while (pending.size > 0) {
    // 找到所有依赖已满足的任务
    const ready: SubTask[] = [];
    for (const task of subTasks) {
      if (!pending.has(task.id)) continue;
      const deps = task.dependencies ?? [];
      const depsMet = deps.every(d => completed.has(d) && completed.get(d)!.status === 'success');
      if (depsMet) ready.push(task);
    }

    if (ready.length === 0 && pending.size > 0) {
      // 循环依赖或所有剩余任务都有失败依赖
      const stuck = Array.from(pending).join(', ');
      throw new Error(`Sequential deadlock: cannot resolve dependencies for tasks [${stuck}]`);
    }

    // 按优先级排序，同优先级按原序
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // 串行执行（一次只执行一个，严格流水线）
    for (const task of ready) {
      const start = Date.now();
      try {
        const result = await executeFn(task);
        result.durationMs = Date.now() - start;
        completed.set(task.id, result);
        results.push(result);
        pending.delete(task.id);
      } catch (err) {
        const failResult: TaskResult<T> = {
          taskId: task.id,
          status: 'failure',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
          nodeId: context.parentTaskId,
          depth: context.depth,
        };
        completed.set(task.id, failResult);
        results.push(failResult);
        pending.delete(task.id);
      }
    }
  }

  return results;
}

// ──────────────────────────────────────────
// Parallel: 并发 Promise.all
// ──────────────────────────────────────────

/**
 * 并行执行：所有无依赖任务同时启动
 * - 使用 Promise.allSettled 确保单个失败不影响整体
 * - 适合独立子任务、批量处理、探索性计算
 */
export async function executeParallel<T = unknown>(
  subTasks: SubTask[],
  executeFn: (task: SubTask) => Promise<TaskResult<T>>,
  context: ExecutionContext
): Promise<TaskResult<T>[]> {
  // 先处理有依赖的任务：并行执行所有依赖已满足的任务
  const pending = new Set(subTasks.map(t => t.id));
  const completed = new Map<string, TaskResult<T>>();
  const results: TaskResult<T>[] = [];

  while (pending.size > 0) {
    const ready: SubTask[] = [];
    for (const task of subTasks) {
      if (!pending.has(task.id)) continue;
      const deps = task.dependencies ?? [];
      const depsMet = deps.every(d => {
        const r = completed.get(d);
        return r !== undefined && r.status === 'success';
      });
      if (depsMet) ready.push(task);
    }

    if (ready.length === 0 && pending.size > 0) {
      const stuck = Array.from(pending).join(', ');
      throw new Error(`Parallel deadlock: cannot resolve dependencies for tasks [${stuck}]`);
    }

    // 按优先级排序后批量并发
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // 并发执行这一轮所有就绪任务
    const batchResults = await Promise.allSettled(
      ready.map(async (task) => {
        const start = Date.now();
        try {
          const result = await executeFn(task);
          result.durationMs = Date.now() - start;
          return { taskId: task.id, result };
        } catch (err) {
          return {
            taskId: task.id,
            result: {
              taskId: task.id,
              status: 'failure' as const,
              error: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - start,
              nodeId: context.parentTaskId,
              depth: context.depth,
            } as TaskResult<T>,
          };
        }
      })
    );

    for (const br of batchResults) {
      if (br.status === 'fulfilled') {
        completed.set(br.value.taskId, br.value.result);
        results.push(br.value.result);
        pending.delete(br.value.taskId);
      }
    }
  }

  return results;
}

// ──────────────────────────────────────────
// Hierarchical: 树形递归
// ──────────────────────────────────────────

/**
 * 层次执行：递归树形分解
 * - 每个任务执行后可选择继续分解为子-子任务
 * - 结果从叶子节点向上聚合
 * - 适合需要逐层细化的分析任务、决策树
 */
export interface HierarchicalNode<T = unknown> {
  task: SubTask;
  children: HierarchicalNode<T>[];
  result?: TaskResult<T>;
}

export async function executeHierarchical<T = unknown>(
  rootTask: SubTask,
  executeFn: (task: SubTask) => Promise<TaskResult<T>>,
  decomposeFn: (result: TaskResult<T>) => SubTask[] | null,
  context: ExecutionContext,
  maxDepth: number = 5
): Promise<{ result: TaskResult<T>; tree: HierarchicalNode<T> }> {
  const start = Date.now();

  // 执行当前节点
  const result = await executeFn(rootTask);
  result.durationMs = Date.now() - start;

  const node: HierarchicalNode<T> = {
    task: rootTask,
    children: [],
    result,
  };

  // 达到最大深度则停止递归
  if (context.depth >= maxDepth) {
    return { result, tree: node };
  }

  // 根据结果决定是否继续分解
  const subTasks = result.status === 'success' ? decomposeFn(result) : null;

  if (subTasks && subTasks.length > 0) {
    // 子任务使用并行模式执行（同一层的兄弟节点互相独立）
    const childCtx: ExecutionContext = {
      ...context,
      depth: context.depth + 1,
      parentTaskId: rootTask.id,
    };

    const childResults = await Promise.all(
      subTasks.map(async (sub) => {
        return executeHierarchical(sub, executeFn, decomposeFn, childCtx, maxDepth);
      })
    );

    node.children = childResults.map(cr => cr.tree);
  }

  return { result, tree: node };
}

// ──────────────────────────────────────────
// Dynamic: 运行时决策
// ──────────────────────────────────────────

/**
 * Dynamic执行模式 — 运行时根据负载和任务特征自适应选择执行策略
 * 
 * 决策逻辑：
 * 1. 如果子任务数量 ≤ 2 → Sequential（避免并发开销）
 * 2. 如果子任务间有复杂依赖链 → Sequential
 * 3. 如果子任务全部独立 → Parallel
 * 4. 如果当前深度 < maxDepth/2 且任务复杂度高 → Hierarchical
 * 5. 否则根据硬件负载选择：CPU高则Sequential，内存高则减少并发数
 */
export async function executeDynamic<T = unknown>(
  subTasks: SubTask[],
  executeFn: (task: SubTask) => Promise<TaskResult<T>>,
  context: ExecutionContext,
  hardwareSnapshot: { cpuLoad: number; memoryLoad: number },
  maxDepth: number = 5
): Promise<TaskResult<T>[]> {
  const { cpuLoad, memoryLoad } = hardwareSnapshot;

  // 决策：选择最适合的执行模式
  let chosenMode: ExecutionMode;

  if (subTasks.length <= 2) {
    // 任务太少，并发收益为负
    chosenMode = 'sequential';
  } else if (subTasks.every(t => (t.dependencies ?? []).length === 0)) {
    // 全部独立 → 并行，但受硬件限制
    if (cpuLoad > 0.9 || memoryLoad > 0.9) {
      chosenMode = 'sequential'; // 资源紧张，降速
    } else if (cpuLoad > 0.7 || memoryLoad > 0.7) {
      // 中等负载：限制并发度，拆成批次
      chosenMode = 'parallel';
      // 通过减少批次大小来间接限制并发（在调用方实现）
    } else {
      chosenMode = 'parallel';
    }
  } else {
    // 有依赖关系
    const hasDeepChain = subTasks.some(t =>
      (t.dependencies ?? []).some(d => subTasks.find(st => st.id === d))
    );
    if (hasDeepChain) {
      chosenMode = 'sequential';
    } else {
      chosenMode = 'parallel'; // 部分依赖可以分批并行
    }
  }

  // 递归深度过半且任务复杂度高 → 启用层次分解
  if (context.depth < maxDepth / 2 && subTasks.length > 8) {
    chosenMode = 'hierarchical';
  }

  // 执行
  switch (chosenMode) {
    case 'sequential':
      return executeSequential(subTasks, executeFn, context);
    case 'parallel': {
      // 高负载时限制批次大小
      const batchSize = cpuLoad > 0.7 || memoryLoad > 0.7
        ? Math.max(2, Math.floor(subTasks.length / 3))
        : subTasks.length;

      if (batchSize >= subTasks.length) {
        return executeParallel(subTasks, executeFn, context);
      }

      // 分批并行
      const allResults: TaskResult<T>[] = [];
      for (let i = 0; i < subTasks.length; i += batchSize) {
        const batch = subTasks.slice(i, i + batchSize);
        const batchResults = await executeParallel(batch, executeFn, context);
        allResults.push(...batchResults);
      }
      return allResults;
    }
    case 'hierarchical': {
      // 将任务列表转化为层次执行
      const results: TaskResult<T>[] = [];
      for (const task of subTasks) {
        const { result } = await executeHierarchical(
          task, executeFn,
          () => null, // 子任务不再自动分解，由协调器控制
          context,
          maxDepth
        );
        results.push(result);
      }
      return results;
    }
    default:
      return executeSequential(subTasks, executeFn, context);
  }
}

// ──────────────────────────────────────────
// 统一调度入口
// ──────────────────────────────────────────

/**
 * 执行调度器 — 根据指定模式路由到对应的执行函数
 */
export async function executeTasks<T = unknown>(
  mode: ExecutionMode,
  tasks: SubTask | SubTask[],
  executeFn: (task: SubTask) => Promise<TaskResult<T>>,
  context: ExecutionContext,
  options?: {
    hardwareSnapshot?: { cpuLoad: number; memoryLoad: number };
    decomposeFn?: (result: TaskResult<T>) => SubTask[] | null;
    maxDepth?: number;
  }
): Promise<TaskResult<T>[] | { result: TaskResult<T>; tree: HierarchicalNode<T> }> {
  const taskList = Array.isArray(tasks) ? tasks : [tasks];

  switch (mode) {
    case 'sequential':
      return executeSequential(taskList, executeFn, context);
    case 'parallel':
      return executeParallel(taskList, executeFn, context);
    case 'hierarchical': {
      if (taskList.length !== 1) {
        throw new Error('Hierarchical mode requires exactly one root task');
      }
      return executeHierarchical(
        taskList[0], executeFn,
        options?.decomposeFn ?? (() => null),
        context,
        options?.maxDepth ?? 5
      );
    }
    case 'dynamic': {
      if (!options?.hardwareSnapshot) {
        throw new Error('Dynamic mode requires hardwareSnapshot');
      }
      return executeDynamic(taskList, executeFn, context, options.hardwareSnapshot, options?.maxDepth ?? 5);
    }
    default:
      throw new Error(`Unknown execution mode: ${mode}`);
  }
}
