/**
 * @file SkillForge.ts
 * @description 技能锻造系统 — 将提取的模式转化为可复用技能
 *   核心机制：从知识图谱中的模式生成 SKILL.md 文件
 *   TODO: 实际实现使用模板引擎生成标准化技能文件
 */

export interface SkillDraft {
  name: string;
  version: string;
  description: string;
  triggers: string[];
  content: string;
  confidence: number;
  sources: string[];
}

export interface ForgedSkill {
  path: string;
  draft: SkillDraft;
  generatedAt: string;
}

export class SkillForge {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * 从模式锻造技能
   */
  async forgeFromPatterns(patterns: any[], kg: any): Promise<ForgedSkill[]> {
    const skills: ForgedSkill[] = [];

    for (const pattern of patterns) {
      if (pattern.type === 'solution' && pattern.confidence > 0.6) {
        const skill = await this.forgeOne(pattern);
        if (skill) skills.push(skill);
      }
    }

    return skills;
  }

  private async forgeOne(pattern: any): Promise<ForgedSkill | null> {
    try {
      const fs = require('fs');
      const dir = this.outputDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const skillName = this.slugify(pattern.name);
      const skillDir = `${dir}/${skillName}`;
      if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });

      const draft: SkillDraft = {
        name: skillName,
        version: '1.0.0',
        description: pattern.name,
        triggers: [pattern.name.toLowerCase()],
        content: pattern.content,
        confidence: pattern.confidence,
        sources: pattern.sources || [],
      };

      const skillMd = this.generateSkillMarkdown(draft);
      const path = `${skillDir}/SKILL.md`;
      fs.writeFileSync(path, skillMd);

      return {
        path,
        draft,
        generatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private generateSkillMarkdown(draft: SkillDraft): string {
    return `---
name: ${draft.name}
version: ${draft.version}
description: ${draft.description}
triggers: [${draft.triggers.map(t => `"${t}"`).join(', ')}]
auto-generated: true
confidence: ${draft.confidence}
---

# ${draft.name}

## 触发条件
${draft.triggers.map(t => `- ${t}`).join('\n')}

## 执行流程
${draft.content}

## 来源
${draft.sources.map(s => `- ${s}`).join('\n')}

## 生成时间
${new Date().toISOString()}
`;
  }

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
}

export default SkillForge;