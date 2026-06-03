/**
 * @file MemoryScanner.ts
 * @description 记忆扫描器 — 扫描 workspace 中的记忆文件并提取模式
 *   扫描范围：memory/*.md, diary/*.md, MEMORY.md, AGENTS.md
 *   提取目标：重复出现的解决方案、错误、偏好、决策
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
        // 扫描目录下的所有 .md 文件
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
   * 提取模式：从记忆中找出重复出现的结构
   */
  extractPatterns(memories: RawMemory[], threshold = 2): ExtractedPattern[] {
    const patterns: ExtractedPattern[] = [];
    const frequencyMap = new Map<string, { count: number; sources: string[]; type: string; content: string }>();

    for (const memory of memories) {
      // 识别关键段落（用 ## 或 - 分隔的部分）
      const sections = this.extractSections(memory.content);

      for (const section of sections) {
        const key = this.normalizeKey(section);
        const existing = frequencyMap.get(key);

        if (existing) {
          existing.count++;
          if (!existing.sources.includes(memory.source)) {
            existing.sources.push(memory.source);
          }
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

    // 筛选超过阈值的模式
    for (const [key, data] of frequencyMap) {
      if (data.count >= threshold) {
        const confidence = Math.min(0.5 + data.count * 0.15 + data.sources.length * 0.1, 0.99);
        patterns.push({
          id: `pattern-${this.hash(key)}`,
          name: this.generateName(key, data.type),
          type: data.type as any,
          frequency: data.count,
          confidence,
          sources: data.sources,
          content: data.content,
          extractedAt: new Date().toISOString(),
        });
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  async getById(id: string): Promise<RawMemory | null> {
    // 简单实现：从所有扫描到的记忆中查找
    const memories = await this.scan();
    // 实际上 memory ID 生成逻辑需要改进，这里简化处理
    return memories.find(m => m.id === id) || null;
  }

  // ─── 内部工具 ───

  private parseMemory(content: string, source: string): RawMemory {
    // 推断记忆类型
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

    // 按 ## 分隔提取段落
    const headerSplits = content.split(/^#{2,3}\s+/m);
    for (const split of headerSplits.slice(1)) {
      const lines = split.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        sections.push(lines.slice(0, 10).join('\n')); // 取前 10 行
      }
    }

    // 按列表项提取
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
