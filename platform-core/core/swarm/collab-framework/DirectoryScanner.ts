/**
 * DirectoryScanner.ts — 目录扫描器
 *
 * 递归扫描目录结构，支持：
 * - include / exclude 模式（glob / regex）
 * - 软链接处理：追踪、忽略、或报错
 * - 大文件检测与跳过
 * - 深度限制
 * - 隐藏文件过滤（以.开头的文件/目录）
 */

import fs from 'fs/promises';
import path from 'path';

// ── 类型 ────────────────────────────────────────────────────────────

export interface ScannedFile {
  absolutePath: string;
  relativePath: string;    // 相对于扫描根目录
  name: string;
  ext: string;             // 包含点，如 .pdf
  size: number;
  mtimeMs: number;         // 修改时间
  isSymbolicLink: boolean;
  symlinkTarget?: string;   // 软链接指向的目标（如果 resolved 了）
  depth: number;           // 相对于根目录的深度
}

export interface ScanOptions {
  /** 包含模式（glob 或正则字符串）。为空则包含所有。 */
  include?: string[];
  /** 排除模式。匹配任一模式的文件/目录会被跳过。 */
  exclude?: string[];
  /** 软链接处理策略 */
  symlinkPolicy?: 'follow' | 'ignore' | 'error';
  /** 大文件阈值（字节），超过则标记并跳过。默认 50MB */
  maxFileSize?: number;
  /** 最大递归深度，0 = 不限制 */
  maxDepth?: number;
  /** 是否包含隐藏文件/目录（以 . 开头）。默认 false */
  includeHidden?: boolean;
  /** 是否只返回文件（排除目录自身）。默认 true */
  filesOnly?: boolean;
  /** 自定义过滤器，返回 false 则跳过 */
  customFilter?: (file: ScannedFile) => boolean;
  /** 扫描根目录的相对路径前缀（用于多根扫描时区分来源） */
  rootPrefix?: string;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: SkippedEntry[];
  totalSize: number;
  elapsedMs: number;
  rootPath: string;
}

export interface SkippedEntry {
  path: string;
  reason: 'symlink' | 'max-depth' | 'max-size' | 'hidden' | 'exclude-pattern' | 'custom-filter' | 'not-file';
  detail?: string;
}

// ── 工具函数 ────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  // 简化 glob → regex：* 匹配任意，? 匹配单个，** 匹配路径分隔符
  const escaped = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/\\]*')
    .replace(/\?/g, '.')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAnyPattern(str: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    // 如果已经是正则，直接使用
    if (pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
      const lastSlash = pat.lastIndexOf('/');
      const flags = pat.slice(lastSlash + 1);
      const body = pat.slice(1, lastSlash);
      try {
        const re = new RegExp(body, flags || 'i');
        if (re.test(str)) return true;
      } catch {
        // 解析失败则回退为 glob
      }
    }
    const re = globToRegex(pat);
    if (re.test(str)) return true;
  }
  return false;
}

function isHidden(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..';
}

// ── 核心扫描 ──────────────────────────────────────────────────────

/**
 * 递归扫描目录
 *
 * @param dirPath 扫描根目录
 * @param options 扫描选项
 * @returns ScanResult
 */
export async function scanDirectory(
  dirPath: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const start = Date.now();
  const resolvedRoot = path.resolve(dirPath);

  const {
    include = [],
    exclude = [],
    symlinkPolicy = 'follow',
    maxFileSize = 50 * 1024 * 1024,
    maxDepth = 0,
    includeHidden = false,
    filesOnly = true,
    customFilter,
    rootPrefix = '',
  } = options;

  const files: ScannedFile[] = [];
  const skipped: SkippedEntry[] = [];
  let totalSize = 0;

  const visitedInodes = new Set<string>(); // 防循环（软链接循环）

  async function walk(currentPath: string, depth: number): Promise<void> {
    // 深度限制
    if (maxDepth > 0 && depth > maxDepth) {
      skipped.push({ path: currentPath, reason: 'max-depth', detail: `depth=${depth} > max=${maxDepth}` });
      return;
    }

    let stat: fs.Stats;
    let isSymlink = false;

    try {
      const lstat = await fs.lstat(currentPath);
      isSymlink = lstat.isSymbolicLink();

      if (isSymlink) {
        switch (symlinkPolicy) {
          case 'ignore':
            skipped.push({ path: currentPath, reason: 'symlink' });
            return;
          case 'error':
            throw new Error(`Symbolic link encountered (policy=error): ${currentPath}`);
          case 'follow':
          default:
            // 继续追踪
            break;
        }
      }

      // 追踪软链接后的真实文件状态
      if (isSymlink) {
        stat = await fs.stat(currentPath);
        // 循环检测：记录inode
        const inodeKey = `${stat.dev}:${stat.ino}`;
        if (visitedInodes.has(inodeKey)) {
          skipped.push({ path: currentPath, reason: 'symlink', detail: 'circular reference detected' });
          return;
        }
        visitedInodes.add(inodeKey);
      } else {
        stat = lstat;
      }
    } catch (err: any) {
      skipped.push({ path: currentPath, reason: 'custom-filter', detail: `stat error: ${err.message}` });
      return;
    }

    const name = path.basename(currentPath);

    // 隐藏文件过滤
    if (!includeHidden && isHidden(name)) {
      skipped.push({ path: currentPath, reason: 'hidden' });
      return;
    }

    if (stat.isDirectory()) {
      // 目录：递归进入
      // 检查目录是否在 exclude 列表中
      const rel = path.relative(resolvedRoot, currentPath).replace(/\\/g, '/');
      if (exclude.length > 0 && matchesAnyPattern(rel || '.', exclude)) {
        skipped.push({ path: currentPath, reason: 'exclude-pattern' });
        return;
      }

      let entries: string[];
      try {
        entries = await fs.readdir(currentPath);
      } catch (err: any) {
        skipped.push({ path: currentPath, reason: 'custom-filter', detail: `readdir error: ${err.message}` });
        return;
      }

      for (const entry of entries) {
        await walk(path.join(currentPath, entry), depth + 1);
      }
      return;
    }

    // 文件处理
    const relativePath = path.relative(resolvedRoot, currentPath).replace(/\\/g, '/');

    // exclude 检查
    if (exclude.length > 0 && matchesAnyPattern(relativePath, exclude)) {
      skipped.push({ path: currentPath, reason: 'exclude-pattern' });
      return;
    }

    // include 检查（如果定义了 include，必须匹配至少一个）
    if (include.length > 0 && !matchesAnyPattern(relativePath, include)) {
      return; // 静默跳过，不算入 skipped（属于正常过滤）
    }

    // 大文件检测
    if (stat.size > maxFileSize) {
      skipped.push({
        path: currentPath,
        reason: 'max-size',
        detail: `${stat.size} bytes > ${maxFileSize} bytes`,
      });
      return;
    }

    const scanned: ScannedFile = {
      absolutePath: currentPath,
      relativePath: rootPrefix ? `${rootPrefix}/${relativePath}` : relativePath,
      name,
      ext: path.extname(name).toLowerCase(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      isSymbolicLink: isSymlink,
      depth,
    };

    if (isSymlink && symlinkPolicy === 'follow') {
      try {
        scanned.symlinkTarget = await fs.readlink(currentPath);
      } catch {
        // 忽略无法读取的软链接目标
      }
    }

    // 自定义过滤器
    if (customFilter && !customFilter(scanned)) {
      skipped.push({ path: currentPath, reason: 'custom-filter' });
      return;
    }

    // 如果 filesOnly=false 也记录目录本身，这里只处理文件
    files.push(scanned);
    totalSize += stat.size;
  }

  await walk(resolvedRoot, 0);

  // 按相对路径排序，保证确定性
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    files,
    skipped,
    totalSize,
    elapsedMs: Date.now() - start,
    rootPath: resolvedRoot,
  };
}

/**
 * 批量扫描多个目录
 */
export async function scanMultiple(
  dirPaths: string[],
  options: ScanOptions = {}
): Promise<ScanResult[]> {
  return Promise.all(
    dirPaths.map((dir, idx) =>
      scanDirectory(dir, {
        ...options,
        rootPrefix: options.rootPrefix || `root-${idx}`,
      })
    )
  );
}

/**
 * 快速检查路径是否为有效目录
 */
export async function isValidDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
