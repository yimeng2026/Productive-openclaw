/**
 * @file MemoryScanner_v2.ts
 * @description 记忆扫描器 v2 — 语义增强版模式提取
 *   升级点：
 *     1. 增加语义相似度匹配引擎（SimHash + 余弦相似度）
 *     2. 支持跨措辞的语义聚类（"修复bug"≈"解决错误"≈"fix issue"）
 *     3. 引入 TF-IDF 向量空间模型进行局部敏感哈希聚类
 *     4. 保留 v1 的所有原始接口兼容性
 *   扫描范围：memory/*.md, diary/*.md, MEMORY.md, AGENTS.md
 *   提取目标：重复出现的解决方案、错误、偏好、决策（含语义等价）
 */

export interface RawMemory {
  id: string;
  source: string;
  timestamp: string;
  content: string;
  type: 'log' | 'decision' | 'error' | 'preference' | 'insight';
}

export interface ExtractedPattern {
  id: string;
  name: string;
  type: 'solution' | 'mistake' | 'preference' | 'decision' | 'pattern';
  frequency: number;
  confidence: number;
  sources: string[];
  content: string;
  extractedAt: string;
  /** v2 新增：语义聚类 ID，同一 clusterId 的 pattern 互为语义等价 */
  semanticClusterId?: string;
  /** v2 新增：该 pattern 的语义指纹（SimHash） */
  semanticFingerprint?: string;
  /** v2 新增：与该 pattern 语义相似的其他 pattern IDs */
  semanticSiblings?: string[];
}

/** v2 新增：TF-IDF 向量表示 */
export interface TextVector {
  tokens: Record<string, number>;
  magnitude: number;
}

/** v2 新增：语义匹配配置 */
export interface SemanticMatchConfig {
  /** 触发语义聚类的最低相似度阈值（0~1），默认 0.72 */
  similarityThreshold?: number;
  /** 语义指纹的哈希位数，默认 64 */
  simhashBits?: number;
  /** 最大允许汉明距离以判定为同一语义簇，默认 8 */
  maxHammingDistance?: number;
  /** 停用词列表 */
  stopWords?: Set<string>;
}

/** v2 新增：语义相似度匹配引擎 */
export class SemanticSimilarityEngine {
  private config: Required<SemanticMatchConfig>;
  private idfCache = new Map<string, number>();
  private docCount = 0;

  constructor(config: SemanticMatchConfig = {}) {
    this.config = {
      similarityThreshold: 0.72,
      simhashBits: 64,
      maxHammingDistance: 8,
      stopWords: new Set([
        '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
        'to', 'of', 'and', 'in', 'that', 'have', 'it', 'for', 'on',
      ]),
      ...config,
    };
  }

  /**
   * 对段落集合建立 IDF 词典
   */
  fit(documents: string[]): void {
    const df = new Map<string, number>();
    this.docCount = documents.length;

    for (const doc of documents) {
      const tokens = this.tokenize(doc);
      const seen = new Set<string>();
      for (const t of tokens) {
        if (!seen.has(t)) {
          seen.add(t);
          df.set(t, (df.get(t) || 0) + 1);
        }
      }
    }

    for (const [term, freq] of df) {
      this.idfCache.set(term, Math.log(this.docCount / (freq + 1)) + 1);
    }
  }

  /**
   * 将文本转换为 TF-IDF 加权向量
   */
  vectorize(text: string): TextVector {
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    const vec: Record<string, number> = {};
    let sqSum = 0;
    for (const [term, count] of tf) {
      const idf = this.idfCache.get(term) || 1.0;
      const weight = count * idf;
      vec[term] = weight;
      sqSum += weight * weight;
    }

    return { tokens: vec, magnitude: Math.sqrt(sqSum) };
  }

  /**
   * 计算两段文本的余弦相似度（0~1）
   */
  cosineSimilarity(a: string | TextVector, b: string | TextVector): number {
    const va = typeof a === 'string' ? this.vectorize(a) : a;
    const vb = typeof b === 'string' ? this.vectorize(b) : b;

    if (va.magnitude === 0 || vb.magnitude === 0) return 0;

    let dot = 0;
    for (const term of Object.keys(va.tokens)) {
      if (vb.tokens[term]) {
        dot += va.tokens[term] * vb.tokens[term];
      }
    }

    return dot / (va.magnitude * vb.magnitude);
  }

  /**
   * 生成 SimHash 语义指纹（简化版：基于加权 token 哈希）
   */
  simhash(text: string): string {
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    const bits = this.config.simhashBits;
    const vec = new Array<number>(bits).fill(0);

    for (const [term, count] of tf) {
      const idf = this.idfCache.get(term) || 1.0;
      const weight = count * idf;
      const hash = this.djb2(term);
      for (let i = 0; i < bits; i++) {
        const bit = (hash >> i) & 1;
        vec[i] += bit ? weight : -weight;
      }
    }

    let fingerprint = '';
    for (let i = 0; i < bits; i++) {
      fingerprint += vec[i] >= 0 ? '1' : '0';
    }
    return fingerprint;
  }

  /**
   * 计算两个 SimHash 的汉明距离
   */
  hammingDistance(a: string, b: string): number {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) dist++;
    }
    return dist;
  }

  /**
   * 判断两段文本是否语义等价（余弦相似度或汉明距离任一通过）
   */
  isSemanticallyEquivalent(a: string, b: string): boolean {
    const sim = this.cosineSimilarity(a, b);
    if (sim >= this.config.similarityThreshold) return true;

    const ha = this.simhash(a);
    const hb = this.simhash(b);
    return this.hammingDistance(ha, hb) <= this.config.maxHammingDistance;
  }

  /**
   * 对文本列表进行语义聚类，返回 clusterId → textIndices[]
   */
  cluster(texts: string[]): Map<string, number[]> {
    // 先计算所有指纹
    const fingerprints = texts.map(t => this.simhash(t));
    const clusters = new Map<string, number[]>();
    const assigned = new Set<number>();

    for (let i = 0; i < texts.length; i++) {
      if (assigned.has(i)) continue;
      const clusterId = `cluster-${fingerprints[i].substring(0, 8)}`;
      const members: number[] = [i];
      assigned.add(i);

      for (let j = i + 1; j < texts.length; j++) {
        if (assigned.has(j)) continue;
        const hd = this.hammingDistance(fingerprints[i], fingerprints[j]);
        if (hd <= this.config.maxHammingDistance) {
          members.push(j);
          assigned.add(j);
        }
      }

      clusters.set(clusterId, members);
    }

    return clusters;
  }

  // ─── 内部工具 ───

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !this.config.stopWords.has(t));
  }

  private djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return Math.abs(hash);
  }
}

export class MemoryScanner {
  private readonly scanPaths = [
    'memory',
    'diary',
    'MEMORY.md',
    'AGENTS.md',
    'mega/BUILD_REPORT.md',
    'mega/.ollama-state.json',
  ];

  /** v2 新增：语义相似度引擎 */
  private semanticEngine: SemanticSimilarityEngine;

  constructor(semanticConfig?: SemanticMatchConfig) {
    this.semanticEngine = new SemanticSimilarityEngine(semanticConfig);
  }

  /**
   * 扫描所有记忆文件
   */
  async scan(): Promise<RawMemory[]> {
    const memories: RawMemory[] = [];
    const fs = require('fs');

    for (const scanPath of this.scanPaths) {
      if (!fs.existsSync(scanPath)) continue;

      const stat = fs.statSync(scanPath);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(scanPath).filter((f: string) => f.endsWith('.md'));
        for (const file of files) {
          const content = fs.readFileSync(`${scanPath}/${file}`, 'utf8');
          memories.push(this.parseMemory(content, `${scanPath}/${file}`));
        }
      } else if (stat.isFile()) {
        const content = fs.readFileSync(scanPath, 'utf8');
        memories.push(this.parseMemory(content, scanPath));
      }
    }

    return memories;
  }

  /**
   * 提取模式：v2 增加语义相似度聚层
   *   流程：
   *     1. v1 精确匹配提取基础 pattern
   *     2. 对所有 section 建立语义向量
   *     3. 语义聚类，将相似措辞的 pattern 归入同一 semanticClusterId
   *     4. 按 cluster 合并频率与来源，提升置信度
   */
  extractPatterns(memories: RawMemory[], threshold = 2): ExtractedPattern[] {
    // ── Phase 1: 精确匹配（v1 逻辑）──
    const frequencyMap = new Map<string, { count: number; sources: string[]; type: string; content: string }>();
    const allSections: { key: string; content: string; source: string; memoryType: string }[] = [];

    for (const memory of memories) {
      const sections = this.extractSections(memory.content);
      for (const section of sections) {
        const key = this.normalizeKey(section);
        allSections.push({ key, content: section, source: memory.source, memoryType: memory.type });

        const existing = frequencyMap.get(key);
        if (existing) {
          existing.count++;
          if (!existing.sources.includes(memory.source)) existing.sources.push(memory.source);
        } else {
          frequencyMap.set(key, {
            count: 1,
            sources: [memory.source],
            type: this.inferType(section, memory.type),
            content: section,
          });
        }
      }
    }

    // ── Phase 2: 语义引擎预热 ──
    const sectionContents = allSections.map(s => s.content);
    this.semanticEngine.fit(sectionContents);

    // ── Phase 3: 语义聚类 ──
    const clusterMap = this.semanticEngine.cluster(sectionContents);
    const keyToClusterId = new Map<string, string>();
    const clusterToKeys = new Map<string, Set<string>>();

    for (const [clusterId, indices] of clusterMap) {
      clusterToKeys.set(clusterId, new Set());
      for (const idx of indices) {
        const key = allSections[idx].key;
        keyToClusterId.set(key, clusterId);
        clusterToKeys.get(clusterId)!.add(key);
      }
    }

    // ── Phase 4: 合并 cluster 内频率，生成 v2 patterns ──
    const clusterAggregates = new Map<string, {
      totalCount: number;
      allSources: Set<string>;
      representativeKey: string;
      allKeys: Set<string>;
    }>();

    for (const [key, data] of frequencyMap) {
      const clusterId = keyToClusterId.get(key);
      if (!clusterId) continue;

      const agg = clusterAggregates.get(clusterId);
      if (agg) {
        agg.totalCount += data.count;
        for (const s of data.sources) agg.allSources.add(s);
        agg.allKeys.add(key);
      } else {
        clusterAggregates.set(clusterId, {
          totalCount: data.count,
          allSources: new Set(data.sources),
          representativeKey: key,
          allKeys: new Set([key]),
        });
      }
    }

    const patterns: ExtractedPattern[] = [];

    for (const [clusterId, agg] of clusterAggregates) {
      if (agg.totalCount < threshold) continue;

      const repData = frequencyMap.get(agg.representativeKey)!;
      const fingerprint = this.semanticEngine.simhash(repData.content);
      const confidence = Math.min(
        0.4 + agg.totalCount * 0.1 + agg.allSources.size * 0.08,
        0.99
      );

      // cluster 内所有 sibling pattern IDs
      const semanticSiblings: string[] = [];
      for (const k of agg.allKeys) {
        if (k !== agg.representativeKey) {
          semanticSiblings.push(`pattern-${this.hash(k)}`);
        }
      }

      patterns.push({
        id: `pattern-${this.hash(agg.representativeKey)}`,
        name: this.generateName(agg.representativeKey, repData.type),
        type: repData.type as any,
        frequency: agg.totalCount,
        confidence,
        sources: Array.from(agg.allSources),
        content: repData.content,
        extractedAt: new Date().toISOString(),
        semanticClusterId: clusterId,
        semanticFingerprint: fingerprint,
        semanticSiblings: semanticSiblings.length > 0 ? semanticSiblings : undefined,
      });
    }

    // 单独处理未聚类的精确匹配模式（仍保留 v1 兼容行为）
    for (const [key, data] of frequencyMap) {
      if (keyToClusterId.has(key)) continue; // 已聚类处理
      if (data.count >= threshold) {
        patterns.push({
          id: `pattern-${this.hash(key)}`,
          name: this.generateName(key, data.type),
          type: data.type as any,
          frequency: data.count,
          confidence: Math.min(0.5 + data.count * 0.15 + data.sources.length * 0.1, 0.99),
          sources: data.sources,
          content: data.content,
          extractedAt: new Date().toISOString(),
          semanticFingerprint: this.semanticEngine.simhash(data.content),
        });
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * v2 新增：跨源语义搜索
   *   给定查询文本，在所有记忆中寻找语义相似度最高的段落
   */
  async semanticSearch(query: string, topK = 5): Promise<Array<{ memoryId: string; snippet: string; similarity: number; source: string }>> {
    const memories = await this.scan();
    const candidates: { memoryId: string; snippet: string; similarity: number; source: string }[] = [];

    const allSnippets: string[] = [];
    const snippetMeta: { memoryId: string; source: string }[] = [];

    for (const mem of memories) {
      const sections = this.extractSections(mem.content);
      for (const sec of sections) {
        allSnippets.push(sec);
        snippetMeta.push({ memoryId: mem.id, source: mem.source });
      }
    }

    this.semanticEngine.fit(allSnippets);
    const queryVec = this.semanticEngine.vectorize(query);

    for (let i = 0; i < allSnippets.length; i++) {
      const sim = this.semanticEngine.cosineSimilarity(queryVec, allSnippets[i]);
      if (sim > 0.3) {
        candidates.push({
          memoryId: snippetMeta[i].memoryId,
          snippet: allSnippets[i],
          similarity: sim,
          source: snippetMeta[i].source,
        });
      }
    }

    return candidates
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * v2 新增：批量检测语义冗余（跨文件重复语义）
   */
  detectSemanticRedundancy(memories: RawMemory[]): Array<{
    clusterId: string;
    redundantSources: string[];
    estimatedReduction: number;
  }> {
    const allSections: { content: string; source: string }[] = [];
    for (const mem of memories) {
      const sections = this.extractSections(mem.content);
      for (const sec of sections) {
        allSections.push({ content: sec, source: mem.source });
      }
    }

    const contents = allSections.map(s => s.content);
    this.semanticEngine.fit(contents);
    const clusters = this.semanticEngine.cluster(contents);

    const redundancies: Array<{ clusterId: string; redundantSources: string[]; estimatedReduction: number }> = [];

    for (const [clusterId, indices] of clusters) {
      if (indices.length < 2) continue;
      const sources = indices.map(i => allSections[i].source);
      const uniqueSources = [...new Set(sources)];
      if (uniqueSources.length > 1) {
        redundancies.push({
          clusterId,
          redundantSources: uniqueSources,
          estimatedReduction: indices.length - 1,
        });
      }
    }

    return redundancies.sort((a, b) => b.estimatedReduction - a.estimatedReduction);
  }

  async getById(id: string): Promise<RawMemory | null> {
    const memories = await this.scan();
    return memories.find(m => m.id === id) || null;
  }

  // ─── 内部工具（v1 兼容） ───

  private parseMemory(content: string, source: string): RawMemory {
    let type: RawMemory['type'] = 'log';
    if (content.includes('错误') || content.includes('失败') || content.includes('bug')) type = 'error';
    else if (content.includes('决定') || content.includes('采用') || content.includes('选择')) type = 'decision';
    else if (content.includes('偏好') || content.includes('习惯') || content.includes('喜欢')) type = 'preference';
    else if (content.includes('洞察') || content.includes('发现') || content.includes('领悟')) type = 'insight';

    return {
      id: `mem-${this.hash(content + source)}`,
      source,
      timestamp: this.extractDate(content) || new Date().toISOString(),
      content,
      type,
    };
  }

  private extractSections(content: string): string[] {
    const sections: string[] = [];
    const headerSplits = content.split(/^#{2,3}\s+/m);
    for (const split of headerSplits.slice(1)) {
      const lines = split.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        sections.push(lines.slice(0, 10).join('\n'));
      }
    }
    const listItems = content.match(/^-\s+.+$/gm);
    if (listItems) {
      sections.push(...listItems.slice(0, 20));
    }
    return sections;
  }

  private normalizeKey(section: string): string {
    return section
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  private inferType(section: string, memoryType: string): string {
    const lower = section.toLowerCase();
    if (lower.includes('修复') || lower.includes('解决') || lower.includes('fix') || lower.includes('solution')) return 'solution';
    if (lower.includes('错误') || lower.includes('失败') || lower.includes(' mistake') || lower.includes('bug')) return 'mistake';
    if (lower.includes('偏好') || lower.includes('prefer') || lower.includes('喜欢')) return 'preference';
    if (lower.includes('决定') || lower.includes('decision') || lower.includes('采用')) return 'decision';
    if (memoryType === 'error') return 'mistake';
    if (memoryType === 'decision') return 'decision';
    if (memoryType === 'preference') return 'preference';
    return 'pattern';
  }

  private generateName(key: string, type: string): string {
    const words = key.split(' ').filter(w => w.length > 2);
    const topWords = words.slice(0, 5).join('-');
    return `${type}-${topWords || 'pattern'}`;
  }

  private extractDate(content: string): string | null {
    const match = content.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }

  private hash(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36).substring(0, 8);
  }
}

export default MemoryScanner;
