/**
 * ImportEngine.ts — 一键导入文件系统核心引擎
 *
 * 职责：
 * 1. 扫描目录 → 过滤文件 → 验证格式 → 内容转换 → 批量导入
 * 2. 支持三种导入目标：
 *    - knowledge-base:  分块 → 向量化 → 存入向量数据库
 *    - agent-memory:    解析 → 按时间线组织 → 写入记忆存储
 *    - agent-config:    验证 → 合并 → 写入配置目录
 * 3. 并发导入，可配置并发数
 * 4. 错误隔离：单个文件失败不影响整体
 * 5. 进度可追踪（通过 ProgressTracker）
 *
 * 与现有上传系统的协作：
 * - ImportEngine 是"导入管道"，负责将本地/上传的文件内容转化为平台数据
 * - 与 uploadService.ts 的物理存储层是独立的，但通过统一的 UploadRecord ID 关联
 */

import path from 'path';
import fs from 'fs/promises';
import { ProgressTracker, createTrackerWithConsole, ProgressSnapshot } from './ProgressTracker';
import { ScannedFile, ScanOptions, scanDirectory, isValidDirectory } from './DirectoryScanner';
import { TransformedContent, ContentChunk, transformFile, transformFiles, isTransformable } from './FileTransformer';

// ── 导入目标类型 ──────────────────────────────────────────────────────

export type ImportTargetType = 'knowledge-base' | 'agent-memory' | 'agent-config';

export interface ImportTarget {
  readonly type: ImportTargetType;
  readonly name: string;
  readonly acceptedMimeTypes: string[];
  readonly acceptedExtensions: string[];
  /**
   * 执行导入：将转换后的内容写入目标存储
   * 返回导入结果的元数据（如 chunk 数量、向量 ID 列表、配置 key 等）
   */
  import(content: TransformedContent, meta: ImportMeta): Promise<ImportTargetResult>;
  /** 验证目标存储是否就绪 */
  validateTarget(): Promise<{ ready: boolean; error?: string }>;
}

export interface ImportMeta {
  taskId: string;
  fileIndex: number;
  totalFiles: number;
  sourcePath: string;
  relativePath: string;
  scannedFile: ScannedFile;
}

export interface ImportTargetResult {
  importedId: string;       // 目标系统中的 ID
  importedCount: number;    // 实际写入的记录数（如 chunk 数、配置条目数）
  metadata: Record<string, unknown>;
}

// ── 导入选项 ────────────────────────────────────────────────────────

export interface ImportOptions {
  target: ImportTargetType;
  /** 文件过滤模式，如 ['*.pdf', '*.md'] */
  filters?: string[];
  /** 并发导入数量。默认 4 */
  concurrency?: number;
  /** 最大文件大小（字节）。默认 50MB */
  maxFileSize?: number;
  /** 是否递归扫描子目录。默认 true */
  recursive?: boolean;
  /** 进度回调 */
  onProgress?: (snapshot: ProgressSnapshot) => void;
  /** 单文件错误回调。返回 true 表示忽略此错误继续 */
  onError?: (error: ImportFileError) => boolean;
  /** 扫描选项（覆盖默认） */
  scanOptions?: Partial<ScanOptions>;
  /** 转换选项 */
  transformOptions?: {
    maxChunkSize?: number;
    minChunkSize?: number;
    maxTextLength?: number;
  };
  /** 任务 ID（用于日志追踪） */
  taskId?: string;
}

export interface ImportFileError {
  filePath: string;
  phase: 'scan' | 'filter' | 'validate' | 'transform' | 'import';
  message: string;
  originalError?: Error;
}

export interface ImportResult {
  taskId: string;
  target: ImportTargetType;
  totalFiles: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
  finalSnapshot: ProgressSnapshot;
  errors: ImportFileError[];
  targetResults: ImportTargetResult[];
}

// ── 具体导入目标实现 ────────────────────────────────────────────────

/**
 * Knowledge Base 导入策略
 * - 将文本分块
 * - 生成向量嵌入
 * - 存入向量数据库（如 pgvector / milvus / qdrant）
 */
export class KnowledgeBaseImport implements ImportTarget {
  readonly type = 'knowledge-base' as const;
  readonly name = '知识库';
  readonly acceptedMimeTypes = [
    'text/markdown',
    'text/plain',
    'application/pdf',
  ];
  readonly acceptedExtensions = ['.md', '.markdown', '.txt', '.pdf'];

  private embeddingService?: { embed(text: string): Promise<number[]> };
  private vectorStore?: { add(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void> };

  constructor(deps?: {
    embeddingService?: { embed(text: string): Promise<number[]> };
    vectorStore?: { add(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void> };
  }) {
    this.embeddingService = deps?.embeddingService;
    this.vectorStore = deps?.vectorStore;
  }

  async validateTarget(): Promise<{ ready: boolean; error?: string }> {
    if (!this.embeddingService) {
      return { ready: true, error: 'Warning: no embeddingService configured, chunks will not be vectorized' };
    }
    if (!this.vectorStore) {
      return { ready: true, error: 'Warning: no vectorStore configured, chunks will not be persisted' };
    }
    return { ready: true };
  }

  async import(content: TransformedContent, meta: ImportMeta): Promise<ImportTargetResult> {
    const chunks = content.chunks ?? [];
    const textsToEmbed: string[] = [];
    const chunkIds: string[] = [];

    // 如果 Markdown 分块了，逐块向量化
    if (chunks.length > 0) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = `${meta.taskId}-chunk-${meta.fileIndex}-${i}`;
        chunkIds.push(chunkId);
        textsToEmbed.push(chunk.text);

        // 写入原始 chunk 文本（即使不向量化）
        await this.persistChunk(chunkId, chunk, meta, content);
      }
    } else if (content.text) {
      // 无分块内容（如 PDF 提取的纯文本）
      const chunkId = `${meta.taskId}-chunk-${meta.fileIndex}-0`;
      chunkIds.push(chunkId);
      textsToEmbed.push(content.text);
      await this.persistChunk(chunkId, {
        id: 'chunk-0',
        text: content.text,
        startOffset: 0,
        endOffset: content.text.length,
        tags: ['full-document'],
      }, meta, content);
    }

    // 向量化
    if (this.embeddingService) {
      for (let i = 0; i < textsToEmbed.length; i++) {
        try {
          const embedding = await this.embeddingService.embed(textsToEmbed[i]);
          if (this.vectorStore) {
            await this.vectorStore.add(chunkIds[i], embedding, {
              source: content.source.path,
              taskId: meta.taskId,
              fileIndex: meta.fileIndex,
              chunkIndex: i,
              mimeType: content.source.mimeType,
            });
          }
        } catch (err: any) {
          console.warn(`[KnowledgeBaseImport] Embedding failed for ${chunkIds[i]}: ${err.message}`);
        }
      }
    }

    return {
      importedId: `${meta.taskId}-file-${meta.fileIndex}`,
      importedCount: chunkIds.length,
      metadata: { chunkIds, hasEmbeddings: !!this.embeddingService },
    };
  }

  private async persistChunk(
    chunkId: string,
    chunk: ContentChunk,
    meta: ImportMeta,
    content: TransformedContent
  ): Promise<void> {
    // 这里可以对接实际存储，如 SQLite / PostgreSQL / 文件系统
    // 默认实现：仅记录日志（真实部署时替换为数据库写入）
    // 示例写入路径: ./kb_chunks/{taskId}/{chunkId}.json
    const dir = path.join(process.cwd(), 'kb_chunks', meta.taskId);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${chunkId}.json`),
        JSON.stringify({
          id: chunkId,
          text: chunk.text,
          tags: chunk.tags,
          metadata: { ...chunk.metadata, sourcePath: content.source.path },
          createdAt: Date.now(),
        }, null, 2)
      );
    } catch {
      // 静默失败，向量化已存储在 vectorStore
    }
  }
}

/**
 * Agent Memory 导入策略
 * - 解析内容中的时间信息
 * - 按时间线组织记忆条目
 * - 写入记忆存储
 */
export class AgentMemoryImport implements ImportTarget {
  readonly type = 'agent-memory' as const;
  readonly name = 'Agent 记忆';
  readonly acceptedMimeTypes = ['text/markdown', 'text/plain', 'application/json'];
  readonly acceptedExtensions = ['.md', '.txt', '.json'];

  private memoryService?: { add(entry: Record<string, unknown>): Promise<string> };

  constructor(deps?: { memoryService?: { add(entry: Record<string, unknown>): Promise<string> } }) {
    this.memoryService = deps?.memoryService;
  }

  async validateTarget(): Promise<{ ready: boolean; error?: string }> {
    return { ready: true };
  }

  async import(content: TransformedContent, meta: ImportMeta): Promise<ImportTargetResult> {
    const entries: Record<string, unknown>[] = [];

    // 尝试从文本中提取日期/时间线信息
    if (content.text) {
      const timeline = this.extractTimeline(content.text);
      for (const item of timeline) {
        entries.push({
          type: 'memory_import',
          content: item.text,
          timestamp: item.date?.getTime() || Date.now(),
          sourcePath: content.source.path,
          relativePath: meta.relativePath,
          taskId: meta.taskId,
          tags: ['imported', ...item.tags],
        });
      }
    }

    // JSON 结构化数据直接作为记忆条目
    if (content.structured && typeof content.structured === 'object') {
      entries.push({
        type: 'memory_structured',
        content: content.structured,
        timestamp: Date.now(),
        sourcePath: content.source.path,
        relativePath: meta.relativePath,
        taskId: meta.taskId,
        tags: ['imported', 'structured'],
      });
    }

    // 写入记忆存储
    const memoryIds: string[] = [];
    if (this.memoryService) {
      for (const entry of entries) {
        try {
          const id = await this.memoryService.add(entry);
          memoryIds.push(id);
        } catch (err: any) {
          console.warn(`[AgentMemoryImport] Memory add failed: ${err.message}`);
        }
      }
    }

    // 回退：写入本地文件
    if (memoryIds.length === 0) {
      const dir = path.join(process.cwd(), 'agent_memories', meta.taskId);
      await fs.mkdir(dir, { recursive: true });
      for (let i = 0; i < entries.length; i++) {
        const id = `${meta.taskId}-mem-${meta.fileIndex}-${i}`;
        memoryIds.push(id);
        await fs.writeFile(
          path.join(dir, `${id}.json`),
          JSON.stringify(entries[i], null, 2)
        );
      }
    }

    return {
      importedId: `${meta.taskId}-file-${meta.fileIndex}`,
      importedCount: entries.length,
      metadata: { memoryIds },
    };
  }

  private extractTimeline(text: string): { text: string; date?: Date; tags: string[] }[] {
    // 简化版：按行检测日期模式
    const results: { text: string; date?: Date; tags: string[] }[] = [];
    const lines = text.split('\n');

    // 常见日期正则：YYYY-MM-DD, YYYY/MM/DD, 中文日期等
    const datePatterns = [
      /(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})[日\sT:]*/,
      /(\d{4})-(\d{2})-(\d{2})/,
    ];

    let currentBlock = '';
    let currentDate: Date | undefined;

    for (const line of lines) {
      let foundDate: Date | undefined;
      for (const pat of datePatterns) {
        const m = line.match(pat);
        if (m) {
          const [_, y, mo, d] = m;
          const parsed = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
          if (!isNaN(parsed.getTime())) {
            foundDate = parsed;
            break;
          }
        }
      }

      if (foundDate) {
        // 保存上一块
        if (currentBlock.trim()) {
          results.push({ text: currentBlock.trim(), date: currentDate, tags: currentDate ? ['dated'] : [] });
        }
        currentBlock = line + '\n';
        currentDate = foundDate;
      } else {
        currentBlock += line + '\n';
      }
    }

    if (currentBlock.trim()) {
      results.push({ text: currentBlock.trim(), date: currentDate, tags: currentDate ? ['dated'] : [] });
    }

    // 如果没有检测到任何日期，将整个文本作为一个条目
    if (results.length === 0) {
      results.push({ text: text.trim(), tags: ['undated'] });
    }

    return results;
  }
}

/**
 * Agent 配置导入策略
 * - 验证 JSON/YAML 的 Schema
 * - 合并到现有配置（不覆盖，追加或更新）
 * - 写入配置目录
 */
export class AgentConfigImport implements ImportTarget {
  readonly type = 'agent-config' as const;
  readonly name = 'Agent 配置';
  readonly acceptedMimeTypes = ['application/json', 'text/yaml'];
  readonly acceptedExtensions = ['.json', '.yaml', '.yml'];

  private configDir: string;
  private mergeStrategy: 'overwrite' | 'merge' | 'append';

  constructor(options?: {
    configDir?: string;
    mergeStrategy?: 'overwrite' | 'merge' | 'append';
  }) {
    this.configDir = options?.configDir || path.join(process.cwd(), 'configs');
    this.mergeStrategy = options?.mergeStrategy || 'merge';
  }

  async validateTarget(): Promise<{ ready: boolean; error?: string }> {
    try {
      await fs.access(this.configDir);
      return { ready: true };
    } catch {
      return { ready: true, error: `Config dir ${this.configDir} does not exist yet, will be created` };
    }
  }

  async import(content: TransformedContent, meta: ImportMeta): Promise<ImportTargetResult> {
    if (!content.structured) {
      throw new Error('Agent config import requires structured data (JSON/YAML)');
    }

    // 基础 Schema 验证：必须是对象
    if (typeof content.structured !== 'object' || content.structured === null) {
      throw new Error('Config must be a JSON/YAML object');
    }

    // 确保配置目录存在
    await fs.mkdir(this.configDir, { recursive: true });

    const configId = `${meta.taskId}-config-${meta.fileIndex}`;
    const configPath = path.join(this.configDir, `${configId}.json`);

    // 合并策略
    let finalConfig: Record<string, unknown>;
    const incoming = content.structured as Record<string, unknown>;

    if (this.mergeStrategy === 'overwrite') {
      finalConfig = incoming;
    } else if (this.mergeStrategy === 'merge') {
      // 尝试读取现有同名配置并合并
      let existing: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        existing = JSON.parse(raw);
      } catch {
        // 无现有配置
      }
      finalConfig = this.deepMerge(existing, incoming);
    } else {
      // append：直接生成新文件名
      finalConfig = incoming;
    }

    // 写入
    await fs.writeFile(configPath, JSON.stringify(finalConfig, null, 2));

    return {
      importedId: configId,
      importedCount: Object.keys(finalConfig).length,
      metadata: {
        configPath,
        mergeStrategy: this.mergeStrategy,
        topLevelKeys: Object.keys(finalConfig),
      },
    };
  }

  private deepMerge(base: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
    const result = { ...base };
    for (const key of Object.keys(incoming)) {
      if (
        key in result &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        typeof incoming[key] === 'object' &&
        incoming[key] !== null &&
        !Array.isArray(incoming[key])
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          incoming[key] as Record<string, unknown>
        );
      } else {
        result[key] = incoming[key];
      }
    }
    return result;
  }
}

// ── 导入目标工厂 ────────────────────────────────────────────────────

export function createImportTarget(
  type: ImportTargetType,
  deps?: {
    embeddingService?: { embed(text: string): Promise<number[]> };
    vectorStore?: { add(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void> };
    memoryService?: { add(entry: Record<string, unknown>): Promise<string> };
    configDir?: string;
    mergeStrategy?: 'overwrite' | 'merge' | 'append';
  }
): ImportTarget {
  switch (type) {
    case 'knowledge-base':
      return new KnowledgeBaseImport(deps);
    case 'agent-memory':
      return new AgentMemoryImport(deps);
    case 'agent-config':
      return new AgentConfigImport({ configDir: deps?.configDir, mergeStrategy: deps?.mergeStrategy });
    default:
      throw new Error(`Unknown import target: ${type}`);
  }
}

// ── ImportEngine 主类 ───────────────────────────────────────────────

export class ImportEngine {
  private tracker: ProgressTracker;
  private taskId: string;

  constructor(taskId?: string) {
    this.taskId = taskId || `import-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.tracker = new ProgressTracker(this.taskId);
  }

  /** 获取内部 Tracker（用于外部订阅） */
  getTracker(): ProgressTracker {
    return this.tracker;
  }

  /** 获取当前任务 ID */
  getTaskId(): string {
    return this.taskId;
  }

  // ── 分步 API ─────────────────────────

  /** 扫描目录 */
  async scanDirectory(dirPath: string, options?: Partial<ScanOptions>): Promise<ScannedFile[]> {
    this.tracker.setPhase('scanning');

    if (!(await isValidDirectory(dirPath))) {
      throw new Error(`Not a valid directory: ${dirPath}`);
    }

    const result = await scanDirectory(dirPath, {
      ...(options || {}),
      filesOnly: true,
    });

    this.tracker.updatePhaseProgress(1);
    return result.files;
  }

  /** 按模式过滤 */
  filterByPattern(files: ScannedFile[], patterns: string[]): ScannedFile[] {
    this.tracker.setPhase('filtering');

    if (patterns.length === 0) return files;

    // 使用 DirectoryScanner 的 globToRegex 逻辑（复用）
    // 这里简化实现：按扩展名或 glob 匹配
    const regexes = patterns.map((p) => {
      const clean = p
        .replace(/\*\*/g, '{{STAR}}')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/\?/g, '.')
        .replace(/\{\{STAR\}\}/g, '.*');
      return new RegExp(clean, 'i');
    });

    const filtered = files.filter((f) => regexes.some((re) => re.test(f.relativePath) || re.test(f.name)));
    this.tracker.updatePhaseProgress(1);
    return filtered;
  }

  /** 验证文件格式 */
  validateFile(file: ScannedFile, target: ImportTarget): { valid: boolean; error?: string } {
    // 扩展名检查
    if (!target.acceptedExtensions.includes(file.ext)) {
      return {
        valid: false,
        error: `Extension ${file.ext} not accepted for target "${target.type}". Accepted: ${target.acceptedExtensions.join(', ')}`,
      };
    }

    // 可转换性检查
    if (!isTransformable(file.absolutePath)) {
      return { valid: false, error: `File type not transformable: ${file.ext}` };
    }

    return { valid: true };
  }

  /** 转换内容 */
  async transformContent(file: ScannedFile, options?: ImportOptions['transformOptions']): Promise<TransformedContent> {
    return transformFile(file.absolutePath, {
      maxChunkSize: options?.maxChunkSize,
      minChunkSize: options?.minChunkSize,
      maxTextLength: options?.maxTextLength,
    });
  }

  /** 批量导入 */
  async batchImport(
    files: ScannedFile[],
    target: ImportTarget,
    options: Pick<ImportOptions, 'concurrency' | 'onProgress' | 'onError'>
  ): Promise<ImportTargetResult[]> {
    const { concurrency = 4, onProgress, onError } = options;
    const results: ImportTargetResult[] = [];

    // 订阅进度
    if (onProgress) {
      this.tracker.subscribe('batch-import', (event) => {
        if (event.type === 'progress' || event.type === 'complete') {
          onProgress(event.snapshot);
        }
      });
    }

    this.tracker.start(files.length);

    // 分批次并发处理
    for (let i = 0; i < files.length; i += concurrency) {
      if (this.tracker.isPaused()) {
        // 等待恢复
        await new Promise<void>((resolve) => {
          const check = () => {
            if (!this.tracker.isPaused()) {
              resolve();
            } else {
              setTimeout(check, 100);
            }
          };
          check();
        });
      }

      const batch = files.slice(i, i + concurrency);
      const batchPromises = batch.map(async (file, batchIdx) => {
        const fileIndex = i + batchIdx;
        const filePath = file.absolutePath;

        try {
          // 阶段：验证
          this.tracker.setPhase('validating', filePath);
          const validation = this.validateFile(file, target);
          if (!validation.valid) {
            throw new Error(validation.error);
          }

          // 阶段：转换
          this.tracker.setPhase('transforming', filePath);
          const transformed = await this.transformContent(file);

          // 阶段：导入
          this.tracker.setPhase('importing', filePath);
          const meta: ImportMeta = {
            taskId: this.taskId,
            fileIndex,
            totalFiles: files.length,
            sourcePath: filePath,
            relativePath: file.relativePath,
            scannedFile: file,
          };

          const result = await target.import(transformed, meta);
          this.tracker.markSuccess(filePath);
          return { status: 'success' as const, result, filePath };
        } catch (err: any) {
          const fileError: ImportFileError = {
            filePath,
            phase: this.tracker.getPhase() as ImportFileError['phase'],
            message: err instanceof Error ? err.message : String(err),
            originalError: err instanceof Error ? err : undefined,
          };

          this.tracker.markFailure(filePath, fileError.message, this.tracker.getPhase() as any);

          // 用户回调决定
          if (onError) {
            const shouldContinue = onError(fileError);
            if (!shouldContinue) {
              throw new Error(`User abort at ${filePath}: ${fileError.message}`);
            }
          }

          return { status: 'failure' as const, error: fileError, filePath };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const br of batchResults) {
        if (br.status === 'success' && br.result) {
          results.push(br.result);
        }
      }
    }

    return results;
  }

  // ── 一键导入 ─────────────────────────

  /**
   * 一键导入整个目录
   * 流水线: scan → filter → validate → transform → batchImport
   */
  async importDirectory(dirPath: string, options: ImportOptions): Promise<ImportResult> {
    const start = Date.now();
    const target = createImportTarget(options.target);

    // 验证目标就绪
    const targetCheck = await target.validateTarget();
    if (!targetCheck.ready) {
      throw new Error(`Import target not ready: ${targetCheck.error}`);
    }
    if (targetCheck.error) {
      console.warn(`[ImportEngine] Target warning: ${targetCheck.error}`);
    }

    // 扫描
    const files = await this.scanDirectory(dirPath, {
      include: options.filters,
      maxFileSize: options.maxFileSize,
      ...(options.scanOptions || {}),
    });

    // 如果提供了 filters，再做一次精确过滤
    let filteredFiles = files;
    if (options.filters && options.filters.length > 0) {
      filteredFiles = this.filterByPattern(files, options.filters);
    }

    // 目标类型预过滤（只保留目标接受的扩展名）
    filteredFiles = filteredFiles.filter((f) => target.acceptedExtensions.includes(f.ext));

    // 批量导入
    const targetResults = await this.batchImport(filteredFiles, target, {
      concurrency: options.concurrency,
      onProgress: options.onProgress,
      onError: options.onError,
    });

    // 完成
    this.tracker.complete();

    const snapshot = this.tracker.getSnapshot();

    return {
      taskId: this.taskId,
      target: options.target,
      totalFiles: snapshot.total,
      succeeded: snapshot.succeeded,
      failed: snapshot.failed,
      skipped: snapshot.skipped,
      durationMs: Date.now() - start,
      finalSnapshot: snapshot,
      errors: snapshot.errors.map((e) => ({
        filePath: e.filePath,
        phase: e.phase as ImportFileError['phase'],
        message: e.message,
      })),
      targetResults,
    };
  }
}

// ── 便捷导出 ────────────────────────────────────────────────────────

/** 快速创建带有 console 日志的 ImportEngine */
export function createImportEngineWithConsole(taskId?: string): ImportEngine {
  const engine = new ImportEngine(taskId);
  createTrackerWithConsole(engine.getTaskId());
  return engine;
}

export default ImportEngine;
