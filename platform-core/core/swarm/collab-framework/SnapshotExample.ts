/**
 * SnapshotExample.ts — SYLVA 快照系统使用示例
 *
 * 演示场景:
 * 1. 基础快照: 创建 → 保存 → 恢复
 * 2. 快照继承: 父战车 → 子战车（自动继承状态）
 * 3. 快照合并: 多战车合并为超级战车
 * 4. 快照差异: 对比两个时间点的状态变化
 * 5. 血缘追溯: 从子快照追溯到根
 * 6. 自动清理: 配置保留策略
 */

import { SwarmCoordinator, CoordinatorConfig } from './SwarmCoordinator';
import { SwarmNode, AgentConfig } from './SwarmNode';
import { SnapshotEngine, Snapshot } from './SnapshotEngine';
import { SnapshotStorage, StorageConfig } from './SnapshotStorage';
import { IMessageBus } from './SwarmMessageBus';

// ──────────────────────────────────────────
// 辅助：Mock 消息总线
// ──────────────────────────────────────────

const createMockBus = (): IMessageBus => ({
  publish: async () => {},
  subscribe: () => {},
  unsubscribe: () => {},
});

// ──────────────────────────────────────────
// 辅助：创建测试 Agent
// ──────────────────────────────────────────

const createMockAgent = (
  id: string,
  role: string,
  expertise: string[],
): SwarmNode => {
  const config: AgentConfig = {
    modelId: 'gpt-4',
    expertise,
    temperature: 0.7,
    maxTokens: 4000,
    systemPrompt: `You are a ${role} agent.`,
  };

  return new SwarmNode({
    id,
    type: 'agent',
    name: `${role}-${id}`,
    role,
    agentConfig: config,
    eventBus: createMockBus(),
    config: { maxDepth: 3, taskTimeoutMs: 30000, maxRetries: 2, defaultExecutionMode: 'parallel' },
    agentCallback: async (task) => `Result from ${id}: ${task.name}`,
  });
};

// ──────────────────────────────────────────
// 场景 1: 基础快照 — 创建 → 保存 → 恢复
// ──────────────────────────────────────────

async function demoBasicSnapshot() {
  console.log('\n=== 场景 1: 基础快照 ===\n');

  const bus = createMockBus();
  const config: CoordinatorConfig = {
    model: 'gpt-4',
    maxTokens: 100_000,
    decompositionStrategy: 'auto',
    dispatchStrategy: 'capability-match',
    aggregationStrategy: 'merge',
  };

  const coordinator = new SwarmCoordinator(config, bus, {
    backend: 'memory',
    autoSave: true,
    cleanupPolicy: {
      keepLastN: 5,
      protectedTags: ['important', 'milestone'],
    },
  });

  // 创建Agent
  const agents = [
    createMockAgent('coder-1', 'code-writer', ['typescript', 'algorithm']),
    createMockAgent('reviewer-1', 'code-reviewer', ['review', 'security']),
  ];

  // 创建根战车
  const root = coordinator.createChariot('dev-team', agents);
  console.log(`[1] 创建战车: ${root.name} (${root.id})`);

  // 写入共享记忆
  root.sharedMemory.write('coder-1', 'project-context', {
    repo: 'sylva-core',
    branch: 'main',
    features: ['snapshot-system', 'shared-memory'],
  });
  root.sharedMemory.write('reviewer-1', 'review-rules', 'No any types. Max function length 50 lines.');

  // 保存快照
  const snapshot = await coordinator.saveSnapshot(root.id, {
    tags: ['milestone', 'v1.0'],
    description: 'Initial project setup with snapshot system',
  });
  console.log(`[2] 保存快照: ${snapshot.metadata.snapshotId} (version ${snapshot.metadata.version})`);

  // 修改共享记忆（模拟工作进展）
  root.sharedMemory.write('coder-1', 'project-context', {
    repo: 'sylva-core',
    branch: 'feature/snapshot-v2',
    features: ['snapshot-system', 'shared-memory', 'merge-engine'],
  });

  // 恢复快照（回到初始状态）
  await coordinator.loadSnapshot(root.id, snapshot.metadata.snapshotId);
  const restoredContext = root.sharedMemory.read('coder-1', 'project-context');
  console.log(`[3] 恢复后 context.branch: ${(restoredContext as any)?.branch}`); // 应输出 "main"
}

// ──────────────────────────────────────────
// 场景 2: 快照继承 — 父战车 → 子战车
// ──────────────────────────────────────────

async function demoSnapshotInheritance() {
  console.log('\n=== 场景 2: 快照继承 ===\n');

  const bus = createMockBus();
  const config: CoordinatorConfig = {
    model: 'gpt-4',
    maxTokens: 100_000,
    decompositionStrategy: 'auto',
    dispatchStrategy: 'capability-match',
    aggregationStrategy: 'merge',
  };

  const coordinator = new SwarmCoordinator(config, bus, {
    backend: 'memory',
    autoSave: true,
  });

  // 创建父战车（核心开发团队）
  const parentAgents = [
    createMockAgent('architect-1', 'architect', ['design', 'system']),
    createMockAgent('coder-1', 'code-writer', ['typescript', 'algorithm']),
  ];

  const parent = coordinator.createChariot('core-team', parentAgents);

  // 写入父战车核心知识
  parent.sharedMemory.write('architect-1', 'system-design', {
    pattern: 'microservices',
    database: 'postgresql',
    cache: 'redis',
  });
  parent.sharedMemory.write('architect-1', 'coding-standards', 'Strict TypeScript. No implicit any.');

  // 保存父快照
  const parentSnapshot = await coordinator.saveSnapshot(parent.id, {
    tags: ['parent', 'core'],
    description: 'Core team baseline with system design and coding standards',
  });
  console.log(`[1] 父战车快照: ${parentSnapshot.metadata.snapshotId}`);

  // 创建子战车（前端子团队，继承父状态）
  const childAgents = [
    createMockAgent('frontend-1', 'frontend-dev', ['react', 'typescript']),
    createMockAgent('ui-1', 'ui-designer', ['figma', 'css']),
  ];

  const child = coordinator.createChariotFromSnapshot('frontend-team', parentSnapshot, childAgents);
  console.log(`[2] 子战车创建: ${child.name} (${child.id})`);

  // 验证继承
  const inheritedDesign = child.sharedMemory.read('architect-1', 'system-design');
  const inheritedStandards = child.sharedMemory.read('architect-1', 'coding-standards');
  console.log(`[3] 继承的 design.pattern: ${(inheritedDesign as any)?.pattern}`); // microservices
  console.log(`[4] 继承的 coding-standards: ${inheritedStandards}`); // Strict TypeScript...

  // 子战车写入自己的记忆（不影响父战车）
  child.sharedMemory.write('frontend-1', 'component-lib', 'Using Radix UI + Tailwind');
  const parentComponentLib = parent.sharedMemory.read('frontend-1', 'component-lib');
  console.log(`[5] 父战车能否看到子记忆: ${parentComponentLib === undefined}`); // true（隔离）
}

// ──────────────────────────────────────────
// 场景 3: 快照合并 — 多战车合并为超级战车
// ──────────────────────────────────────────

async function demoSnapshotMerge() {
  console.log('\n=== 场景 3: 快照合并 ===\n');

  const bus = createMockBus();
  const config: CoordinatorConfig = {
    model: 'gpt-4',
    maxTokens: 100_000,
    decompositionStrategy: 'auto',
    dispatchStrategy: 'capability-match',
    aggregationStrategy: 'merge',
  };

  const coordinator = new SwarmCoordinator(config, bus, { backend: 'memory' });
  const engine = new SnapshotEngine(coordinator);

  // 创建两个独立战车
  const backendAgents = [createMockAgent('backend-1', 'backend-dev', ['node', 'sql'])];
  const backendChariot = coordinator.createChariot('backend-team', backendAgents);
  backendChariot.sharedMemory.write('backend-1', 'api-schema', '/users, /posts, /comments');

  const mlAgents = [createMockAgent('ml-1', 'ml-engineer', ['pytorch', 'nlp'])];
  const mlChariot = coordinator.createChariot('ml-team', mlAgents);
  mlChariot.sharedMemory.write('ml-1', 'model-config', { model: 'transformer', layers: 12 });

  // 捕获快照
  const snap1 = engine.captureSnapshot(backendChariot.id);
  const snap2 = engine.captureSnapshot(mlChariot.id);
  console.log(`[1] Backend快照: ${snap1.metadata.snapshotId}`);
  console.log(`[2] ML快照: ${snap2.metadata.snapshotId}`);

  // 合并快照
  const mergeResult = engine.mergeSnapshots([snap1, snap2]);
  console.log(`[3] 合并快照: ${mergeResult.snapshot.metadata.snapshotId}`);
  console.log(`[4] 自动解决冲突: ${mergeResult.autoResolved}`);
  console.log(`[5] 剩余冲突: ${mergeResult.conflicts.length}`);

  // 查看合并后的记忆
  console.log(`[6] 合并后 API schema: ${mergeResult.snapshot.sharedMemory.hot['api-schema']}`);
  console.log(`[7] 合并后 Model config: ${JSON.stringify(mergeResult.snapshot.sharedMemory.hot['model-config'])}`);
}

// ──────────────────────────────────────────
// 场景 4: 快照差异 — 对比状态变化
// ──────────────────────────────────────────

async function demoSnapshotDiff() {
  console.log('\n=== 场景 4: 快照差异 ===\n');

  const bus = createMockBus();
  const coordinator = new SwarmCoordinator(
    {
      model: 'gpt-4',
      maxTokens: 100_000,
      decompositionStrategy: 'auto',
      dispatchStrategy: 'capability-match',
      aggregationStrategy: 'merge',
    },
    bus,
    { backend: 'memory' },
  );

  const engine = new SnapshotEngine(coordinator);
  const agents = [createMockAgent('dev-1', 'developer', ['typescript'])];

  const chariot = coordinator.createChariot('dev-team', agents);

  // 初始状态快照
  chariot.sharedMemory.write('dev-1', 'features', ['auth', 'dashboard']);
  chariot.sharedMemory.write('dev-1', 'bug-count', 5);
  const snapOld = engine.captureSnapshot(chariot.id);

  // 工作一段时间后
  chariot.sharedMemory.write('dev-1', 'features', ['auth', 'dashboard', 'snapshot-system', 'export']);
  chariot.sharedMemory.write('dev-1', 'bug-count', 2);
  chariot.sharedMemory.write('dev-1', 'performance', 'p95 < 100ms');

  const snapNew = engine.captureSnapshot(chariot.id);

  // 计算差异
  const diff = engine.diffSnapshots(snapOld, snapNew);
  console.log(`[1] 新增字段: ${diff.added.join(', ')}`); // performance
  console.log(`[2] 修改字段: ${diff.modified.map(m => m.key).join(', ')}`); // features, bug-count
  console.log(`[3] HOT层差异:`);
  for (const [key, val] of Object.entries(diff.memoryDiff.hotDiff)) {
    console.log(`    ${key}: ${JSON.stringify(val.old)} → ${JSON.stringify(val.new)}`);
  }
}

// ──────────────────────────────────────────
// 场景 5: 血缘追溯 — 从子快照追溯到根
// ──────────────────────────────────────────

async function demoSnapshotLineage() {
  console.log('\n=== 场景 5: 血缘追溯 ===\n');

  const bus = createMockBus();
  const coordinator = new SwarmCoordinator(
    {
      model: 'gpt-4',
      maxTokens: 100_000,
      decompositionStrategy: 'auto',
      dispatchStrategy: 'capability-match',
      aggregationStrategy: 'merge',
    },
    bus,
    { backend: 'memory' },
  );

  const engine = new SnapshotEngine(coordinator);
  const storage = new SnapshotStorage({ backend: 'memory' });

  // 创建根战车 → 快照 A
  const rootAgents = [createMockAgent('root-1', 'architect', ['design'])];
  const root = coordinator.createChariot('root-team', rootAgents);
  root.sharedMemory.write('root-1', 'foundation', 'v1.0');
  const snapA = engine.captureSnapshot(root.id, { tags: ['root'] });
  await storage.save(snapA);

  // 子战车 → 快照 B（继承A）
  const child1 = coordinator.createChariotFromSnapshot('child-1', snapA, [
    createMockAgent('child1-1', 'developer', ['frontend']),
  ]);
  child1.sharedMemory.write('child1-1', 'frontend-stack', 'React');
  const snapB = engine.captureSnapshot(child1.id, {
    parentSnapshotId: snapA.metadata.snapshotId,
    tags: ['child'],
  });
  await storage.save(snapB);

  // 孙子战车 → 快照 C（继承B）
  const child2 = coordinator.createChariotFromSnapshot('child-2', snapB, [
    createMockAgent('child2-1', 'tester', ['e2e']),
  ]);
  const snapC = engine.captureSnapshot(child2.id, {
    parentSnapshotId: snapB.metadata.snapshotId,
    tags: ['grandchild'],
  });
  await storage.save(snapC);

  // 追溯血缘
  const lineage = await storage.getLineage(snapC.metadata.snapshotId);
  console.log(`[1] 血缘链长度: ${lineage.length}`); // 3
  for (let i = 0; i < lineage.length; i++) {
    const snap = lineage[i];
    const prefix = i === 0 ? '根' : i === lineage.length - 1 ? '当前' : '└─';
    console.log(`    ${prefix} [${snap.metadata.tags.join(',')}] ${snap.metadata.snapshotId}`);
  }
}

// ──────────────────────────────────────────
// 场景 6: 自动清理策略
// ──────────────────────────────────────────

async function demoCleanupPolicy() {
  console.log('\n=== 场景 6: 自动清理 ===\n');

  const bus = createMockBus();
  const coordinator = new SwarmCoordinator(
    {
      model: 'gpt-4',
      maxTokens: 100_000,
      decompositionStrategy: 'auto',
      dispatchStrategy: 'capability-match',
      aggregationStrategy: 'merge',
    },
    bus,
    {
      backend: 'memory',
      cleanupPolicy: {
        keepLastN: 3, // 每个战车只保留最近3个快照
        protectedTags: ['important'], // 带 important 标签的不清理
        protectedPrefixes: ['snap-manual-'], // 手动快照前缀保留
      },
    },
  );

  const agents = [createMockAgent('dev-1', 'developer', ['typescript'])];
  const chariot = coordinator.createChariot('dev-team', agents);

  // 连续保存7个快照
  for (let i = 1; i <= 7; i++) {
    chariot.sharedMemory.write('dev-1', 'iteration', i);
    const tags = i === 3 ? ['important'] : i === 5 ? ['wip'] : [];
    await coordinator.saveSnapshot(chariot.id, {
      tags,
      description: `Iteration ${i}`,
    });
    console.log(`[${i}] 保存快照 iteration=${i}`);
  }

  // 手动触发清理
  const deletedCount = await coordinator.cleanupSnapshots();
  console.log(`[8] 清理了 ${deletedCount} 个旧快照`);

  // 查看剩余快照
  const remaining = await coordinator.getSnapshots(chariot.id);
  console.log(`[9] 剩余快照数: ${remaining.length}`);
  for (const snap of remaining.reverse()) {
    const iteration = (snap.sharedMemory.hot['iteration'] as number) ?? '?';
    const protected_ = snap.metadata.tags.includes('important') ? ' [PROTECTED]' : '';
    console.log(`    - iteration=${iteration}${protected_}`);
  }
}

// ──────────────────────────────────────────
// 运行所有演示
// ──────────────────────────────────────────

async function runAllDemos() {
  await demoBasicSnapshot();
  await demoSnapshotInheritance();
  await demoSnapshotMerge();
  await demoSnapshotDiff();
  await demoSnapshotLineage();
  await demoCleanupPolicy();

  console.log('\n=== 所有演示完成 ===\n');
}

// 如果直接运行此文件
if (require.main === module) {
  runAllDemos().catch(console.error);
}

export { runAllDemos };
export default runAllDemos;
