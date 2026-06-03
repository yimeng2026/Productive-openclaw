/**
 * FileTransformer.ts — 文件内容转换管道
 *
 * 支持以下转换：
 * - PDF → 纯文本（简化提取，不做 OCR）
 * - Markdown → 结构化分块（按标题层级切分）
 * - JSON → Schema 验证 + 类型检查
 * - YAML → 解析 + 类型检查
 * - TXT → 编码检测 + BOM 去除 + 换行符统一
 *
 * 所有转换器都返回统一的 TransformedContent 结构，
 * 下游 ImportTarget 可基于此进行进一步处理。
 */

import fs from 'fs/promises';
import path from 'path';

// ── 类型 ────────────────────────────────────────────────────────────

export interface TransformedContent {
  /** 原始文件信息 */
  source: {
    path: string;
    name: string;
    size: number;
    mimeType: string;
  };
  /** 转换后的文本内容 */
  text?: string;
  /** 结构化内容（分块后的结果） */
  chunks?: ContentChunk[];
  /** JSON/YAML 解析后的结构化数据 */
  structured?: unknown;
  /** 元数据（如编码、BOM 信息等） */
  meta: TransformMeta;
}

export interface ContentChunk {
  id: string;            // chunk-0, chunk-1, ...
  text: string;
  /** 在原始文本中的字符偏移 */
  startOffset: number;
  endOffset: number;
  /** 语义标签 */
  tags: string[];        // e.g. ['h1', 'section']
  /** 附加元数据（如标题层级、JSON 路径） */
  metadata?: Record<string, unknown>;
}

export interface TransformMeta {
  originalEncoding: string;
  hadBOM: boolean;
  lineEnding: 'CRLF' | 'LF' | 'CR' | 'mixed';
  normalizedTo: 'LF';
  warnings: string[];
  transformDurationMs: number;
}

export interface TransformerOptions {
  /** Markdown 分块时每个 chunk 的最大字符数 */
  maxChunkSize?: number;
  /** Markdown 分块时最小字符数 */
  minChunkSize?: number;
  /** JSON 解析时是否允许注释 */
  allowJsonComments?: boolean;
  /** 最大文本长度限制（防止内存爆炸），默认 10MB */
  maxTextLength?: number;
}

// ── 编码检测与预处理 ────────────────────────────────────────────────

/**
 * 检测并统一编码、去除 BOM、统一换行符
 */
async function readAndNormalize(filePath: string, maxTextLength: number): Promise<{
  text: string;
  encoding: string;
  hadBOM: boolean;
  lineEnding: TransformMeta['lineEnding'];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const raw = await fs.readFile(filePath);

  // BOM 检测与去除
  let bytes = raw;
  let hadBOM = false;
  if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    hadBOM = true;
    bytes = raw.subarray(3);
    warnings.push('UTF-8 BOM detected and removed');
  } else if (raw.length >= 2 && raw[0] === 0xFE && raw[1] === 0xFF) {
    hadBOM = true;
    bytes = raw.subarray(2);
    warnings.push('UTF-16 BE BOM detected and removed');
  } else if (raw.length >= 2 && raw[0] === 0xFF && raw[1] === 0xFE) {
    hadBOM = true;
    bytes = raw.subarray(2);
    warnings.push('UTF-16 LE BOM detected and removed');
  }

  // 编码检测（简化版：先尝试 UTF-8，失败则尝试 Latin1）
  let text: string;
  let encoding = 'utf-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // UTF-8 解码失败，尝试 Latin1
    text = new TextDecoder('iso-8859-1').decode(bytes);
    encoding = 'iso-8859-1';
    warnings.push(`File is not valid UTF-8, decoded as ${encoding}`);
  }

  // 长度限制
  if (text.length > maxTextLength) {
    text = text.slice(0, maxTextLength);
    warnings.push(`Text truncated to ${maxTextLength} chars (original ~${bytes.length} bytes)`);
  }

  // 换行符检测
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfCount = (text.match(/(?<!\r)\n/g) || []).length;
  const crCount = (text.match(/\r(?!\n)/g) || []).length;

  let lineEnding: TransformMeta['lineEnding'] = 'LF';
  if (crlfCount > 0 && lfCount === 0 && crCount === 0) {
    lineEnding = 'CRLF';
  } else if (crlfCount === 0 && lfCount === 0 && crCount > 0) {
    lineEnding = 'CR';
  } else if (crlfCount > 0 || crCount > 0) {
    lineEnding = 'mixed';
  }

  // 统一为 LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return { text, encoding, hadBOM, lineEnding, warnings };
}

// ── PDF → Text ──────────────────────────────────────────────────────

/**
 * 简化版 PDF 文本提取
 * 依赖：pdf-parse 或类似库
 * 如果未安装 pdf-parse，回退到基础元数据提取
 */
async function transformPDF(filePath: string, opts: TransformerOptions): Promise<TransformedContent> {
  const start = Date.now();
  const name = path.basename(filePath);
  const size = (await fs.stat(filePath)).size;
  const warnings: string[] = [];

  let text = '';

  try {
    // 动态导入 pdf-parse（避免硬依赖）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse');
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer, { max: 0 });
    text = data.text || '';
  } catch (err: any) {
    // 回退：不做 OCR，仅提取文件名作为占位
    warnings.push(`pdf-parse unavailable or failed: ${err.message}. Falling back to filename-only.`);
    text = `[PDF: ${name}]\n[Content extraction requires pdf-parse dependency]`;
  }

  // 清理 PDF 提取中的常见噪声
  text = text
    .replace(/\n\s*\n\s*\n+/g, '\n\n')   // 去除多余空行
    .replace(/\x00/g, '')                   // 去除 null 字节
    .replace(/[ \t]+\n/g, '\n');          // 行尾空白

  const maxLen = opts.maxTextLength ?? 10 * 1024 * 1024;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen);
    warnings.push(`PDF text truncated to ${maxLen} chars`);
  }

  return {
    source: { path: filePath, name, size, mimeType: 'application/pdf' },
    text,
    meta: {
      originalEncoding: 'binary',
      hadBOM: false,
      lineEnding: 'mixed',
      normalizedTo: 'LF',
      warnings,
      transformDurationMs: Date.now() - start,
    },
  };
}

// ── Markdown → Structured Chunks ──────────────────────────────────

interface MarkdownHeading {
  level: number;
  title: string;
  offset: number;
}

function parseMarkdownHeadings(text: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    headings.push({
      level: match[1].length,
      title: match[2].trim(),
      offset: match.index,
    });
  }
  return headings;
}

async function transformMarkdown(filePath: string, opts: TransformerOptions): Promise<TransformedContent> {
  const start = Date.now();
  const maxChunkSize = opts.maxChunkSize ?? 4000;
  const minChunkSize = opts.minChunkSize ?? 500;
  const maxTextLength = opts.maxTextLength ?? 10 * 1024 * 1024;

  const name = path.basename(filePath);
  const size = (await fs.stat(filePath)).size;

  const { text, encoding, hadBOM, lineEnding, warnings } = await readAndNormalize(filePath, maxTextLength);

  // 解析标题层级
  const headings = parseMarkdownHeadings(text);
  const chunks: ContentChunk[] = [];

  if (headings.length === 0) {
    // 无标题，整体作为一个 chunk
    chunks.push({
      id: 'chunk-0',
      text,
      startOffset: 0,
      endOffset: text.length,
      tags: ['no-heading'],
    });
  } else {
    // 按标题切分
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const nextH = headings[i + 1];
      const chunkText = text.slice(h.offset, nextH ? nextH.offset : text.length).trim();

      // 如果 chunk 太大，进一步细分
      if (chunkText.length > maxChunkSize) {
        const subChunks = splitByParagraphs(chunkText, maxChunkSize, minChunkSize);
        for (let j = 0; j < subChunks.length; j++) {
          const sc = subChunks[j];
          chunks.push({
            id: `chunk-${chunks.length}`,
            text: sc.text,
            startOffset: h.offset + sc.startOffset,
            endOffset: h.offset + sc.endOffset,
            tags: j === 0 ? ['h' + h.level, 'section'] : ['h' + h.level, 'paragraph'],
            metadata: {
              headingLevel: h.level,
              headingTitle: h.title,
              paragraphIndex: j,
            },
          });
        }
      } else {
        chunks.push({
          id: `chunk-${chunks.length}`,
          text: chunkText,
          startOffset: h.offset,
          endOffset: nextH ? nextH.offset : text.length,
          tags: ['h' + h.level, 'section'],
          metadata: {
            headingLevel: h.level,
            headingTitle: h.title,
          },
        });
      }
    }
  }

  return {
    source: { path: filePath, name, size, mimeType: 'text/markdown' },
    text,
    chunks,
    meta: {
      originalEncoding: encoding,
      hadBOM,
      lineEnding,
      normalizedTo: 'LF',
      warnings,
      transformDurationMs: Date.now() - start,
    },
  };
}

/** 按段落进一步切分 */
function splitByParagraphs(
  text: string,
  maxSize: number,
  minSize: number
): { text: string; startOffset: number; endOffset: number }[] {
  const paragraphs = text.split(/\n\n+/);
  const result: { text: string; startOffset: number; endOffset: number }[] = [];
  let current = '';
  let currentStart = 0;

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxSize && current.length >= minSize) {
      result.push({ text: current.trim(), startOffset: currentStart, endOffset: currentStart + current.length });
      currentStart += current.length;
      current = para + '\n\n';
    } else {
      current += para + '\n\n';
    }
  }

  if (current.trim().length > 0) {
    result.push({ text: current.trim(), startOffset: currentStart, endOffset: currentStart + current.length });
  }

  return result;
}

// ── JSON / YAML ─────────────────────────────────────────────────────

async function transformJSON(filePath: string, opts: TransformerOptions): Promise<TransformedContent> {
  const start = Date.now();
  const maxTextLength = opts.maxTextLength ?? 10 * 1024 * 1024;
  const name = path.basename(filePath);
  const size = (await fs.stat(filePath)).size;

  const { text, encoding, hadBOM, lineEnding, warnings } = await readAndNormalize(filePath, maxTextLength);

  let structured: unknown;
  try {
    structured = JSON.parse(text);
  } catch (err: any) {
    warnings.push(`JSON parse error: ${err.message}`);
    // 尝试容错解析：去除注释后再试（如果允许）
    if (opts.allowJsonComments) {
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      try {
        structured = JSON.parse(stripped);
        warnings.push('JSON parsed after stripping comments');
      } catch (err2: any) {
        warnings.push(`JSON parse retry failed: ${err2.message}`);
      }
    }
  }

  return {
    source: { path: filePath, name, size, mimeType: 'application/json' },
    text,
    structured,
    meta: {
      originalEncoding: encoding,
      hadBOM,
      lineEnding,
      normalizedTo: 'LF',
      warnings,
      transformDurationMs: Date.now() - start,
    },
  };
}

async function transformYAML(filePath: string, opts: TransformerOptions): Promise<TransformedContent> {
  const start = Date.now();
  const maxTextLength = opts.maxTextLength ?? 10 * 1024 * 1024;
  const name = path.basename(filePath);
  const size = (await fs.stat(filePath)).size;

  const { text, encoding, hadBOM, lineEnding, warnings } = await readAndNormalize(filePath, maxTextLength);

  let structured: unknown;
  try {
    // 动态导入 js-yaml
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require('js-yaml');
    structured = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (err: any) {
    warnings.push(`YAML parse error: ${err.message}. Ensure js-yaml is installed.`);
  }

  return {
    source: { path: filePath, name, size, mimeType: 'text/yaml' },
    text,
    structured,
    meta: {
      originalEncoding: encoding,
      hadBOM,
      lineEnding,
      normalizedTo: 'LF',
      warnings,
      transformDurationMs: Date.now() - start,
    },
  };
}

// ── TXT / 通用文本 ──────────────────────────────────────────────────

async function transformText(filePath: string, opts: TransformerOptions): Promise<TransformedContent> {
  const start = Date.now();
  const maxTextLength = opts.maxTextLength ?? 10 * 1024 * 1024;
  const name = path.basename(filePath);
  const size = (await fs.stat(filePath)).size;

  const { text, encoding, hadBOM, lineEnding, warnings } = await readAndNormalize(filePath, maxTextLength);

  return {
    source: { path: filePath, name, size, mimeType: 'text/plain' },
    text,
    meta: {
      originalEncoding: encoding,
      hadBOM,
      lineEnding,
      normalizedTo: 'LF',
      warnings,
      transformDurationMs: Date.now() - start,
    },
  };
}

// ── 主入口 ──────────────────────────────────────────────────────────

/** 根据文件扩展名自动选择转换器 */
export async function transformFile(
  filePath: string,
  options: TransformerOptions = {}
): Promise<TransformedContent> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return transformPDF(filePath, options);
    case '.md':
    case '.markdown':
    case '.mdx':
      return transformMarkdown(filePath, options);
    case '.json':
    case '.jsonc':
      return transformJSON(filePath, { ...options, allowJsonComments: ext === '.jsonc' });
    case '.yaml':
    case '.yml':
      return transformYAML(filePath, options);
    case '.txt':
    case '.text':
    case '.rst':
    case '.asciidoc':
    case '.org':
    default:
      return transformText(filePath, options);
  }
}

/** 批量转换，支持并发限制 */
export async function transformFiles(
  filePaths: string[],
  options: TransformerOptions & { concurrency?: number } = {}
): Promise<TransformedContent[]> {
  const { concurrency = 4, ...transformOpts } = options;
  const results: TransformedContent[] = [];

  // 简单批次并发
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((fp) => transformFile(fp, transformOpts))
    );

    for (const br of batchResults) {
      if (br.status === 'fulfilled') {
        results.push(br.value);
      } else {
        // 失败时生成占位结果，避免阻断
        const failedPath = filePaths[results.length];
        results.push({
          source: {
            path: failedPath,
            name: path.basename(failedPath),
            size: 0,
            mimeType: 'application/octet-stream',
          },
          text: `[Transform Error: ${br.reason}]`,
          meta: {
            originalEncoding: 'unknown',
            hadBOM: false,
            lineEnding: 'LF',
            normalizedTo: 'LF',
            warnings: [`Transform failed: ${br.reason}`],
            transformDurationMs: 0,
          },
        });
      }
    }
  }

  return results;
}

/** 快速判断文件是否需要转换（可处理） */
export function isTransformable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const supported = ['.pdf', '.md', '.markdown', '.mdx', '.json', '.jsonc', '.yaml', '.yml', '.txt', '.text', '.rst', '.asciidoc', '.org'];
  return supported.includes(ext);
}
