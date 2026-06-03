/**
 * SkillService — 3DACP 接入层
 * 技能管理、扫描、调用
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';
import { getSkillsReal } from '../services/platformService';

interface Skill {
  id: string; name: string; category: string;
  description?: string; config: Record<string, unknown>;
  installed: boolean; enabled: boolean;
  createdAt: string; updatedAt: string;
}

const skillsMap = new Map<string, Skill>();

const seedSkills: Skill[] = [
  { id: 'skill-search', name: '网络搜索', category: 'search', description: 'Web搜索技能', config: {}, installed: true, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'skill-media', name: '图像处理', category: 'media', description: '图像分析与生成', config: {}, installed: true, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'skill-ocr', name: '文档处理', category: 'ocr', description: 'OCR与文档解析', config: {}, installed: true, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];
seedSkills.forEach((s) => skillsMap.set(s.id, s));

export class SkillService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'skill', supportsStreaming: false });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create': return this.registerSkill(data as Partial<Skill>);
      case 'read': return this.getSkill(data as { id?: string });
      case 'update': return this.updateSkill(data as { id: string } & Partial<Skill>);
      case 'delete': return this.unregisterSkill(data as { id: string });
      case 'invoke': return this.invokeSkill(data as { id: string; payload?: unknown });
      case 'list': return this.listSkills();
      default: throw new Error(`SkillService: unsupported action '${action}'`);
    }
  }

  private async registerSkill(data: Partial<Skill>): Promise<Skill> {
    const id = data.id || `skill-${Date.now()}`;
    const skill: Skill = {
      id, name: data.name || id, category: data.category || 'general',
      description: data.description, config: data.config || {},
      installed: data.installed ?? false, enabled: data.enabled ?? false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    skillsMap.set(id, skill);
    return skill;
  }

  private async getSkill(data: { id?: string }): Promise<unknown> {
    if (data.id) {
      const skill = skillsMap.get(data.id);
      if (!skill) throw new Error(`Skill not found: ${data.id}`);
      return skill;
    }
    // 合并扫描数据
    const scanned = await getSkillsReal();
    for (const s of scanned as any[]) {
      if (!skillsMap.has(s.id)) {
        skillsMap.set(s.id, {
          id: s.id, name: s.name, category: s.category,
          description: s.description, config: s.config || {},
          installed: s.installed ?? false, enabled: s.enabled ?? false,
          createdAt: s.createdAt || new Date().toISOString(),
          updatedAt: s.updatedAt || new Date().toISOString(),
        });
      }
    }
    return Array.from(skillsMap.values());
  }

  private updateSkill(data: { id: string } & Partial<Skill>): Skill {
    const skill = skillsMap.get(data.id);
    if (!skill) throw new Error(`Skill not found: ${data.id}`);
    Object.assign(skill, data, { updatedAt: new Date().toISOString() });
    return skill;
  }

  private unregisterSkill(data: { id: string }): { id: string; deleted: boolean } {
    if (!skillsMap.has(data.id)) throw new Error(`Skill not found: ${data.id}`);
    skillsMap.delete(data.id);
    return { id: data.id, deleted: true };
  }

  private invokeSkill(data: { id: string; payload?: unknown }): unknown {
    const skill = skillsMap.get(data.id);
    if (!skill) throw new Error(`Skill not found: ${data.id}`);
    return { skillId: data.id, name: skill.name, invoked: true, payload: data.payload };
  }

  private listSkills(): Skill[] {
    return Array.from(skillsMap.values());
  }
}

export function createSkillServiceAdapter(): SkillService {
  return new SkillService();
}
