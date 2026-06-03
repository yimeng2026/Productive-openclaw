/**
 * ImportExample.ts — ImportEngine 使用示例
 *
 * 演示三种导入目标（Knowledge Base / Agent Memory / Agent Config）的
 * 一键导入调用方式，以及分步调用的组合用法。
 */

import {
  ImportEngine,
  ImportOptions,
  ImportResult,
  KnowledgeBaseImport,
  AgentMemoryImport,
  AgentConfigImport,
  ImportTarget,
} from './ImportEngine';

// ── 示例 1: 一键导入到知识库 ────────────────────────────────────────

async function example1_KnowledgeBaseImport(): Promise<ImportResult> {
  const engine = new ImportEngine('kb-import-demo');

  // 订阅进度
  engine.getTracker().subscribe('ui-progress', (event) => {
    const s = event.snapshot;
    if (event.type === 'progress') {
      console.log(`[KB] ${s.phase} | ${s.processed}/${s.total} | ${s.currentFile || ''}`);
    }
  });

  const result = await engine.importDirectory('./docs', {
    target: 'knowledge-base',
    filters: ['*.pdf', '*.md'],
    concurrency: 5,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    onProgress: (p) => {
      // 回调方式接收进度（也可用 subscribe）
      console.log(`${p.processed}/${p.total} files processed`);
    },
    onError: (err) => {
      console.warn(`Skipped: ${err.filePath} — ${err.message}`);
      return true; // 忽略错误，继续
    },
    transformOptions: {
      maxChunkSize: 4000,
      minChunkSize: 500,
    },
  });

  console.log('Import complete:', result);
  return result;
}

// ── 示例 2: 一键导入到 Agent 记忆 ──────────────────────────────────

async function example2_AgentMemoryImport(): Promise<ImportResult> {
  const engine = new ImportEngine('memory-import-demo');

  const result = await engine.importDirectory('./memories', {
    target: 'agent-memory',
    filters: ['*.md', '*.txt', '*.json'],
    concurrency: 3,
    scanOptions: {
      includeHidden: false,
      symlinkPolicy: 'ignore',
      maxDepth: 3,
    },
  });

  console.log(`Memory import: ${result.succeeded} entries added`);
  return result;
}

// ── 示例 3: 一键导入 Agent 配置 ────────────────────────────────────

async function example3_AgentConfigImport(): Promise<ImportResult> {
  const engine = new ImportEngine('config-import-demo');

  const result = await engine.importDirectory('./configs', {
    target: 'agent-config',
    filters: ['*.json', '*.yaml', '*.yml'],
    concurrency: 2,
    onError: (err) => {
      console.error(`Config error: ${err.filePath}: ${err.message}`);
      return false; // 遇到配置错误时停止
    },
  });

  console.log(`Config import: ${result.succeeded} configs merged`);
  return result;
}

// ── 示例 4: 分步调用（高级用法）─────────────────────────────────────

async function example4_PipelineStepByStep(): Promise<void> {
  const engine = new ImportEngine('pipeline-demo');

  // Step 1: 扫描
  const files = await engine.scanDirectory('./mixed_docs', {
    maxDepth: 2,
    exclude: ['node_modules', '.git', '*.tmp'],
  });
  console.log(`Scanned ${files.length} files`);

  // Step 2: 手动过滤
  const pdfsAndMarkdowns = engine.filterByPattern(files, ['*.pdf', '*.md']);
  console.log(`After filter: ${pdfsAndMarkdowns.length} files`);

  // Step 3: 创建自定义目标
  const customTarget: ImportTarget = new KnowledgeBaseImport({
    // 可注入自定义依赖
    embeddingService: {
      embed: async (text: string) => {
        // 接入平台 embeddingService（如 sylva_platform/backend/src/services/embeddingService.ts）
        // 这里用 mock
        return new Array(768).fill(0).map(() => Math.random());
      },
    },
    vectorStore: {
      add: async (id, embedding, metadata) => {
        // 接入平台向量数据库
        console.log(`[MockVectorStore] add ${id}, dim=${embedding.length}, meta=`, metadata);
      },
    },
  });

  // Step 4: 批量导入
  const results = await engine.batchImport(pdfsAndMarkdowns, customTarget, {
    concurrency: 4,
    onProgress: (p) => console.log(`${p.processed}/${p.total}`),
  });

  console.log(`Imported ${results.length} batches`);
}

// ── 示例 5: 带暂停/恢复的控制 ───────────────────────────────────────

async function example5_PauseResume(): Promise<void> {
  const engine = new ImportEngine('pause-demo');

  // 启动导入
  const promise = engine.importDirectory('./large_docs', {
    target: 'knowledge-base',
    concurrency: 2,
  });

  // 2 秒后暂停
  setTimeout(() => {
    console.log('Pausing...');
    engine.getTracker().pause();
  }, 2000);

  // 5 秒后恢复
  setTimeout(() => {
    console.log('Resuming...');
    engine.getTracker().resume();
  }, 5000);

  const result = await promise;
  console.log('Final:', result.succeeded, 'success');
}

// ── 主入口（仅用于直接运行此文件时）─────────────────────────────────

async function main(): Promise<void> {
  console.log('=== ImportEngine Examples ===\n');

  // 运行示例 1
  console.log('--- Example 1: Knowledge Base ---');
  await example1_KnowledgeBaseImport();

  console.log('\n--- Example 2: Agent Memory ---');
  await example2_AgentMemoryImport();

  console.log('\n--- Example 3: Agent Config ---');
  await example3_AgentConfigImport();

  console.log('\n--- Example 4: Step-by-step Pipeline ---');
  await example4_PipelineStepByStep();

  console.log('\nAll examples completed.');
}

// 如果直接 node 运行此文件
if (require.main === module) {
  main().catch(console.error);
}

export {
  example1_KnowledgeBaseImport,
  example2_AgentMemoryImport,
  example3_AgentConfigImport,
  example4_PipelineStepByStep,
  example5_PauseResume,
};
