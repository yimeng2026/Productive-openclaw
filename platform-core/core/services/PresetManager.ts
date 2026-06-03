import { EventEmitter } from "events";

/**
 * Agent Preset 系统
 * 
 * 功能：
 * - 定义可复用的Agent配置模板
 * - CRUD + 版本管理
 * - 导入/导出
 * - 与现有 AgentConfig 兼容
 */

export interface MCPConfig {
  serverId: string;
  enabled: boolean;
  settings?: Record<string, any>;
}

export interface SkillConfig {
  skillId: string;
  version: string;
  parameters?: Record<string, any>;
}

export interface AgentProfile {
  name: string;
  role: string;
  expertise: string[];
  personality?: string;
  backstory?: string;
}

export interface AgentPreset {
  id: string;
  name: string;
  version: string;
  description?: string;
  
  // 身份
  profile: AgentProfile;
  
  // 模型配置
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  
  // 能力
  mcpServers: MCPConfig[];
  skills: SkillConfig[];
  allowedTools: string[];
  
  // 元数据
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  author?: string;
}

export interface PresetVersion {
  version: string;
  preset: AgentPreset;
  changelog: string;
  createdAt: Date;
}

export class PresetManager extends EventEmitter {
  private presets: Map<string, AgentPreset> = new Map();
  private versions: Map<string, PresetVersion[]> = new Map();

  // ========== CRUD ==========

  createPreset(preset: Omit<AgentPreset, 'id' | 'version' | 'createdAt' | 'updatedAt'>): AgentPreset {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    
    const newPreset: AgentPreset = {
      ...preset,
      id,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
    };

    this.presets.set(id, newPreset);
    this.versions.set(id, [{
      version: '1.0.0',
      preset: newPreset,
      changelog: 'Initial version',
      createdAt: now,
    }]);

    this.emit('presetCreated', { preset: newPreset });
    return newPreset;
  }

  getPreset(id: string): AgentPreset | undefined {
    return this.presets.get(id);
  }

  updatePreset(id: string, updates: Partial<Omit<AgentPreset, 'id' | 'createdAt'>>): AgentPreset | undefined {
    const existing = this.presets.get(id);
    if (!existing) return undefined;

    // 版本递增
    const versionParts = existing.version.split('.').map(Number);
    versionParts[2] += 1;
    const newVersion = versionParts.join('.');

    const updated: AgentPreset = {
      ...existing,
      ...updates,
      version: newVersion,
      updatedAt: new Date(),
    };

    this.presets.set(id, updated);

    // 保存版本历史
    const history = this.versions.get(id) || [];
    history.push({
      version: newVersion,
      preset: updated,
      changelog: updates.description || 'Updated',
      createdAt: new Date(),
    });
    this.versions.set(id, history);

    this.emit('presetUpdated', { preset: updated });
    return updated;
  }

  deletePreset(id: string): boolean {
    const existed = this.presets.has(id);
    this.presets.delete(id);
    this.versions.delete(id);
    
    if (existed) {
      this.emit('presetDeleted', { presetId: id });
    }
    return existed;
  }

  listPresets(filters?: { tag?: string; role?: string }): AgentPreset[] {
    let presets = Array.from(this.presets.values());
    
    if (filters?.tag) {
      presets = presets.filter((p) => p.tags.includes(filters.tag!));
    }
    if (filters?.role) {
      presets = presets.filter((p) => p.profile.role === filters.role);
    }

    return presets.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  // ========== 版本管理 ==========

  getVersions(presetId: string): PresetVersion[] {
    return this.versions.get(presetId) || [];
  }

  rollback(presetId: string, targetVersion: string): AgentPreset | undefined {
    const history = this.versions.get(presetId);
    if (!history) return undefined;

    const target = history.find((v) => v.version === targetVersion);
    if (!target) return undefined;

    // 恢复该版本并创建新版本记录
    const restored = { ...target.preset, updatedAt: new Date() };
    this.presets.set(presetId, restored);

    this.emit('presetRollback', { presetId, toVersion: targetVersion });
    return restored;
  }

  // ========== 导入/导出 ==========

  exportPreset(id: string): string | undefined {
    const preset = this.presets.get(id);
    if (!preset) return undefined;
    return JSON.stringify(preset, null, 2);
  }

  importPreset(json: string): AgentPreset | undefined {
    try {
      const parsed = JSON.parse(json) as AgentPreset;
      // 重新生成ID避免冲突
      return this.createPreset({
        name: parsed.name,
        description: parsed.description,
        profile: parsed.profile,
        modelId: parsed.modelId,
        temperature: parsed.temperature,
        maxTokens: parsed.maxTokens,
        systemPrompt: parsed.systemPrompt,
        mcpServers: parsed.mcpServers,
        skills: parsed.skills,
        allowedTools: parsed.allowedTools,
        tags: parsed.tags,
        author: parsed.author,
      });
    } catch {
      return undefined;
    }
  }

  exportAll(): string {
    const all = Array.from(this.presets.values());
    return JSON.stringify(all, null, 2);
  }

  // ========== 与现有系统兼容 ==========

  /**
   * 转换为现有 AgentConfig 格式（兼容 SwarmNode）
   */
  toAgentConfig(presetId: string): { modelId: string; expertise: string[]; temperature?: number; maxTokens?: number; systemPrompt?: string } | undefined {
    const preset = this.presets.get(presetId);
    if (!preset) return undefined;

    return {
      modelId: preset.modelId,
      expertise: preset.profile.expertise,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
      systemPrompt: preset.systemPrompt,
    };
  }
}
