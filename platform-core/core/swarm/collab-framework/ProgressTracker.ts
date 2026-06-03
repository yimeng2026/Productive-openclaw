/**
 * ProgressTracker.ts — 导入进度追踪器
 *
 * 提供细粒度的导入进度监控，包括：
 * - 事件驱动：start / progress / complete / error / pause / resume
 * - 统计信息：已处理 / 总计 / 成功 / 失败 / 耗时 / 吞吐量
 * - 可订阅：支持多监听器同时监听同一批导入任务
 * - 可序列化：支持将进度状态快照导出（用于前端渲染、日志归档）
 */

export type ProgressPhase = 'idle' | 'scanning' | 'filtering' | 'validating' | 'transforming' | 'importing' | 'finalizing' | 'complete' | 'error';

export interface ProgressSnapshot {
  phase: ProgressPhase;
  total: number;          // 总文件数
  processed: number;      // 已处理（含成功+失败+跳过）
  succeeded: number;
  failed: number;
  skipped: number;
  currentFile?: string;   // 当前正在处理的文件路径
  currentPhaseProgress: number; // 当前阶段内的进度 0-1
  durationMs: number;     // 总耗时
  startTime: number;      // 时间戳
  endTime?: number;
  errors: ImportErrorInfo[];
  throughput: number;     // files/second
  estimatedRemainingMs: number;
}

export interface ImportErrorInfo {
  filePath: string;
  phase: ProgressPhase;
  message: string;
  timestamp: number;
  recoverable: boolean;   // 是否可恢复（如大文件跳过）
}

export type ProgressEventType = 'start' | 'progress' | 'complete' | 'error' | 'pause' | 'resume' | 'phase-change';

export interface ProgressEvent {
  type: ProgressEventType;
  snapshot: ProgressSnapshot;
  detail?: ImportErrorInfo | { from: ProgressPhase; to: ProgressPhase };
}

export type ProgressListener = (event: ProgressEvent) => void;

/** 进度追踪器 */
export class ProgressTracker {
  private snapshot: ProgressSnapshot;
  private listeners: Map<string, ProgressListener> = new Map();
  private paused = false;

  constructor(taskId?: string) {
    const now = Date.now();
    this.snapshot = {
      phase: 'idle',
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      currentPhaseProgress: 0,
      durationMs: 0,
      startTime: now,
      errors: [],
      throughput: 0,
      estimatedRemainingMs: 0,
    };
  }

  // ── 订阅管理 ─────────────────────────

  subscribe(id: string, listener: ProgressListener): () => void {
    this.listeners.set(id, listener);
    // 立即发送当前快照
    listener({ type: 'start', snapshot: this.getSnapshot() });
    return () => this.listeners.delete(id);
  }

  unsubscribe(id: string): boolean {
    return this.listeners.delete(id);
  }

  private emit(event: ProgressEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        // 监听器错误不应阻断导入流程
        console.warn(`[ProgressTracker] Listener error: ${err}`);
      }
    });
  }

  // ── 阶段转换 ─────────────────────────

  start(total: number): void {
    this.snapshot.phase = 'scanning';
    this.snapshot.total = total;
    this.snapshot.startTime = Date.now();
    this.snapshot.processed = 0;
    this.snapshot.succeeded = 0;
    this.snapshot.failed = 0;
    this.snapshot.skipped = 0;
    this.snapshot.errors = [];
    this.emit({ type: 'start', snapshot: this.getSnapshot() });
  }

  setPhase(phase: ProgressPhase, currentFile?: string): void {
    const oldPhase = this.snapshot.phase;
    this.snapshot.phase = phase;
    this.snapshot.currentFile = currentFile;
    this.snapshot.currentPhaseProgress = 0;
    if (oldPhase !== phase) {
      this.emit({
        type: 'phase-change',
        snapshot: this.getSnapshot(),
        detail: { from: oldPhase, to: phase },
      });
    }
  }

  updatePhaseProgress(ratio: number): void {
    this.snapshot.currentPhaseProgress = Math.max(0, Math.min(1, ratio));
    this.emit({ type: 'progress', snapshot: this.getSnapshot() });
  }

  // ── 计数更新 ─────────────────────────

  /** 标记一个文件处理成功 */
  markSuccess(filePath: string): void {
    this.snapshot.processed++;
    this.snapshot.succeeded++;
    this.snapshot.currentFile = filePath;
    this.updateDerived();
    this.emit({ type: 'progress', snapshot: this.getSnapshot() });
  }

  /** 标记一个文件处理失败 */
  markFailure(filePath: string, message: string, phase: ProgressPhase, recoverable = true): void {
    this.snapshot.processed++;
    this.snapshot.failed++;
    const errorInfo: ImportErrorInfo = {
      filePath,
      phase,
      message,
      timestamp: Date.now(),
      recoverable,
    };
    this.snapshot.errors.push(errorInfo);
    this.snapshot.currentFile = filePath;
    this.updateDerived();
    this.emit({
      type: 'error',
      snapshot: this.getSnapshot(),
      detail: errorInfo,
    });
  }

  /** 标记一个文件被跳过（如大文件、不符合filter） */
  markSkipped(filePath: string, reason: string): void {
    this.snapshot.processed++;
    this.snapshot.skipped++;
    const errorInfo: ImportErrorInfo = {
      filePath,
      phase: this.snapshot.phase,
      message: reason,
      timestamp: Date.now(),
      recoverable: true,
    };
    this.snapshot.errors.push(errorInfo);
    this.updateDerived();
    this.emit({
      type: 'error',
      snapshot: this.getSnapshot(),
      detail: errorInfo,
    });
  }

  // ── 暂停 / 恢复 ──────────────────────

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit({ type: 'pause', snapshot: this.getSnapshot() });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // 调整startTime以扣除暂停时间
    const pausedDuration = Date.now() - (this.snapshot.startTime + this.snapshot.durationMs);
    this.snapshot.startTime += pausedDuration;
    this.emit({ type: 'resume', snapshot: this.getSnapshot() });
  }

  // ── 完成 ─────────────────────────────

  complete(): void {
    this.snapshot.phase = 'complete';
    this.snapshot.endTime = Date.now();
    this.snapshot.durationMs = this.snapshot.endTime - this.snapshot.startTime;
    this.snapshot.currentPhaseProgress = 1;
    this.updateDerived();
    this.emit({ type: 'complete', snapshot: this.getSnapshot() });
  }

  abort(reason: string): void {
    this.snapshot.phase = 'error';
    this.snapshot.endTime = Date.now();
    this.snapshot.durationMs = this.snapshot.endTime - this.snapshot.startTime;
    this.updateDerived();
    this.emit({
      type: 'error',
      snapshot: this.getSnapshot(),
      detail: {
        filePath: '',
        phase: 'finalizing',
        message: `Aborted: ${reason}`,
        timestamp: Date.now(),
        recoverable: false,
      },
    });
  }

  // ── 内部计算 ─────────────────────────

  private updateDerived(): void {
    const now = Date.now();
    this.snapshot.durationMs = now - this.snapshot.startTime;
    const elapsedSeconds = this.snapshot.durationMs / 1000;
    if (elapsedSeconds > 0 && this.snapshot.processed > 0) {
      this.snapshot.throughput = this.snapshot.processed / elapsedSeconds;
    }
    const remaining = this.snapshot.total - this.snapshot.processed;
    if (this.snapshot.throughput > 0) {
      this.snapshot.estimatedRemainingMs = (remaining / this.snapshot.throughput) * 1000;
    }
  }

  // ── 查询 ─────────────────────────────

  getSnapshot(): ProgressSnapshot {
    // 返回深拷贝
    return {
      ...this.snapshot,
      errors: this.snapshot.errors.slice(),
    };
  }

  getPhase(): ProgressPhase {
    return this.snapshot.phase;
  }

  isPaused(): boolean {
    return this.paused;
  }

  isComplete(): boolean {
    return this.snapshot.phase === 'complete' || this.snapshot.phase === 'error';
  }

  /** 序列化为JSON（用于日志、前端同步） */
  toJSON(): string {
    return JSON.stringify(this.getSnapshot(), null, 2);
  }

  /** 从JSON恢复（用于断点续传场景） */
  static fromJSON(json: string): ProgressTracker {
    const data = JSON.parse(json) as ProgressSnapshot;
    const tracker = new ProgressTracker();
    tracker.snapshot = { ...data, errors: data.errors || [] };
    return tracker;
  }
}

/** 便捷工厂：创建带默认console日志的Tracker */
export function createTrackerWithConsole(taskId?: string): ProgressTracker {
  const tracker = new ProgressTracker(taskId);
  tracker.subscribe('console-logger', (event) => {
    const s = event.snapshot;
    switch (event.type) {
      case 'start':
        console.log(`[Import] Starting: ${s.total} files`);
        break;
      case 'phase-change':
        console.log(`[Import] Phase: ${(event.detail as any)?.to || s.phase} (${s.processed}/${s.total})`);
        break;
      case 'progress':
        if (s.total > 0) {
          const pct = ((s.processed / s.total) * 100).toFixed(1);
          console.log(`[Import] ${pct}% | ${s.processed}/${s.total} | ${s.succeeded} OK, ${s.failed} FAIL | ${s.throughput.toFixed(2)} f/s | ETA: ${Math.round(s.estimatedRemainingMs / 1000)}s`);
        }
        break;
      case 'complete':
        console.log(`[Import] Complete: ${s.succeeded} OK, ${s.failed} FAIL, ${s.skipped} SKIP in ${(s.durationMs / 1000).toFixed(1)}s`);
        break;
      case 'error':
        if (event.detail && 'message' in event.detail) {
          const err = event.detail as ImportErrorInfo;
          const level = err.recoverable ? 'WARN' : 'ERROR';
          console.log(`[Import:${level}] ${err.filePath}: ${err.message}`);
        }
        break;
    }
  });
  return tracker;
}
