/**
 * @file MemoryFossilizer.ts
 * @description 记忆化石化器 — 将 ephemeral memory 转化为永久结构
 *   核心机制：
 *   • 识别"重复出现的解决方案" → 生成 SKILL.md
 *   • 识别"重复犯的错误" → 生成 guardian rule / lint rule
 *   • 识别"用户偏好" → 生成 config 默认值
 *   • 识别"架构决策" → 生成 ADR (Architecture Decision Record)
 */

import { RawMemory } from './MemoryScanner';
import { KnowledgeGraph } from './KnowledgeGraph';

export interface FossilizablePattern {
  id: string;
  name: string;
  type: 'solution' | 'mistake' | 'preference' | 'decision' | 'pattern';
  frequency: number;
  confidence: number;
  sources: string[]; // memory file paths
  content: string;
  extractedAt: string;
}

export interface FossilizationResult {
  patternId: string;
  action: 'skill-created' | 'config-updated' | 'adr-recorded' | 'rule-added' | 'knowledge-graph-node';
  outputPath: string;
  content: string;
}

export class MemoryFossilizer {
  private fossilRegistry: Map<string, FossilizationResult> = new Map();

  /**
   * 批量化石化——将提取的模式全部转化为永久结构
   */
  async fossilize(patterns: FossilizablePattern[], kg: KnowledgeGraph): Promise<FossilizationResult[]> {
    const results: FossilizationResult[] = [];

    for (const pattern of patterns) {
      // 跳过已化石化的模式
      if (this.fossilRegistry.has(pattern.id)) continue;

      const result = await this.fossilizeOne(pattern, kg);
      if (result) {
        this.fossilRegistry.set(pattern.id, result);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 单条记忆化石化
   */
  async fossilizeOne(pattern: FossilizablePattern | RawMemory, kg: KnowledgeGraph): Promise<FossilizationResult | null> {
    const normalized = this.isRawMemory(pattern) ? this.convertToPattern(pattern) : pattern;
    switch (normalized.type) {
      case 'solution':
        return this.fossilizeSolution(normalized, kg);
      case 'mistake':
        return this.fossilizeMistake(normalized, kg);
      case 'preference':
        return this.fossilizePreference(normalized, kg);
      case 'decision':
        return this.fossilizeDecision(normalized, kg);
      case 'pattern':
        return this.fossilizePattern(normalized, kg);
      default:
        return null;
    }
  }

  private isRawMemory(input: any): input is RawMemory {
    return input && 'source' in input && 'timestamp' in input && !('frequency' in input);
  }

  private convertToPattern(memory: RawMemory): FossilizablePattern {
    return {
      id: memory.id,
      name: memory.source.split('/').pop() || memory.id,
      type: this.inferTypeFromMemory(memory),
      frequency: 1,
      confidence: 0.5,
      sources: [memory.source],
      content: memory.content,
      extractedAt: memory.timestamp,
    };
  }

  private inferTypeFromMemory(memory: RawMemory): FossilizablePattern['type'] {
    switch (memory.type) {
      case 'error': return 'mistake';
      case 'decision': return 'decision';
      case 'preference': return 'preference';
      case 'insight': return 'solution';
      default: return 'pattern';
    }
  }

  // ─── 具体化石化策略 ───

  private async fossilizeSolution(pattern: FossilizablePattern, kg: KnowledgeGraph): Promise<FossilizationResult> {
    // 解决方案 → 自动技能
    const skillName = this.slugify(pattern.name);
    const skillContent = this.generateSkillMarkdown(pattern);
    const outputPath = `skills/auto-forged/${skillName}/SKILL.md`;

    // 写入知识图谱
    await kg.addNode({
      id: `skill:${skillName}`,
      type: 'skill',
      label: pattern.name,
      content: pattern.content,
      sources: pattern.sources,
      confidence: pattern.confidence,
    });

    return {
      patternId: pattern.id,
      action: 'skill-created',
      outputPath,
      content: skillContent,
    };
  }

  private async fossilizeMistake(pattern: FossilizablePattern, kg: KnowledgeGraph): Promise<FossilizationResult> {
    // 错误模式 → 生成 guardian rule
    const ruleName = this.slugify(pattern.name);
    const ruleContent = this.generateGuardianRule(pattern);
    const outputPath = `skills/hermes/rules/${ruleName}.json`;

    await kg.addNode({
      id: `rule:${ruleName}`,
      type: 'rule',
      label: `Prevent: ${pattern.name}`,
      content: pattern.content,
      sources: pattern.sources,
      confidence: pattern.confidence,
    });

    return {
      patternId: pattern.id,
      action: 'rule-added',
      outputPath,
      content: ruleContent,
    };
  }

  private async fossilizePreference(pattern: FossilizablePattern, kg: KnowledgeGraph): Promise<FossilizationResult> {
    // 用户偏好 → 更新配置默认值
    const configKey = this.slugify(pattern.name);
    const outputPath = `skills/hermes/config/preferences.json`;

    await kg.addNode({
      id: `pref:${configKey}`,
      type: 'preference',
      label: pattern.name,
      content: pattern.content,
      sources: pattern.sources,
      confidence: pattern.confidence,
    });

    return {
      patternId: pattern.id,
      action: 'config-updated',
      outputPath,
      content: JSON.stringify({ [configKey]: pattern.content }, null, 2),
    };
  }

  private async fossilizeDecision(pattern: FossilizablePattern, kg: KnowledgeGraph): Promise<FossilizationResult> {
    // 架构决策 → ADR
    const adrId = `adr-${Date.now()}`;
    const adrContent = this.generateADR(pattern);
    const outputPath = `skills/hermes/adr/${adrId}.md`;

    await kg.addNode({
      id: adrId,
      type: 'decision',
      label: pattern.name,
      content: pattern.content,
      sources: pattern.sources,
      confidence: pattern.confidence,
    });

    return {
      patternId: pattern.id,
      action: 'adr-recorded',
      outputPath,
      content: adrContent,
    };
  }

  private async fossilizePattern(pattern: FossilizablePattern, kg: KnowledgeGraph): Promise<FossilizationResult> {
    // 通用模式 → 知识图谱节点
    const nodeId = `pattern:${this.slugify(pattern.name)}`;

    await kg.addNode({
      id: nodeId,
      type: 'pattern',
      label: pattern.name,
      content: pattern.content,
      sources: pattern.sources,
      confidence: pattern.confidence,
    });

    // 建立关联边
    for (const source of pattern.sources) {
      await kg.addEdge(nodeId, `memory:${source}`, 'derived-from');
    }

    return {
      patternId: pattern.id,
      action: 'knowledge-graph-node',
      outputPath: `skills/hermes/data/knowledge-graph.jsonl`,
      content: JSON.stringify({ id: nodeId, label: pattern.name }),
    };
  }

  // ─── 生成器 ───

  private generateSkillMarkdown(pattern: FossilizablePattern): string {
    return `---
name: ${this.slugify(pattern.name)}
version: 1.0.0
description: ${pattern.name}
triggers: ["${pattern.name.toLowerCase()}"]
auto-generated: true
confidence: ${pattern.confidence}
---

# ${pattern.name}

## 触发条件
当检测到以下场景时自动激活：
- ${pattern.name}

## 执行流程
${pattern.content}

## 来源
此技能由 Hermes 自动从以下记忆提取：
${pattern.sources.map(s => `- ${s}`).join('\n')}

## 提取时间
${pattern.extractedAt}
`;
  }

  private generateGuardianRule(pattern: FossilizablePattern): string {
    return JSON.stringify({
      name: this.slugify(pattern.name),
      description: `Prevent: ${pattern.name}`,
      trigger: pattern.name.toLowerCase(),
      action: 'warn',
      severity: 'high',
      content: pattern.content,
      sources: pattern.sources,
    }, null, 2);
  }

  private generateADR(pattern: FossilizablePattern): string {
    return `# ADR: ${pattern.name}

## 状态
Accepted (auto-fossilized by Hermes)

## 上下文
${pattern.content}

## 决策
采用此方案作为标准做法。

## 后果
- 一致性提高
- 新人 onboarding 有参考
- 自动被 Hermes 保护，防止遗忘

## 来源
${pattern.sources.map(s => `- ${s}`).join('\n')}

## 时间
${pattern.extractedAt}
`;
  }

  // ─── 工具 ───

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
}

export default MemoryFossilizer;
