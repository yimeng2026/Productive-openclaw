// SkillBridge.ts — Skills 桥接模块
// 连接 Sylva Backend 与 workspace/skills/ 目录下的所有技能
// 支持扫描、调用、健康检查

import { logger } from "../../utils/logger";
import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

// ============================================================================
// 类型定义
// ============================================================================

export type SkillRuntime = "nodejs" | "python" | "shell" | "wasm";
export type SkillCategory = "search" | "media" | "ocr" | "data" | "ops" | "communication" | "other";

export interface SkillManifest {
  id: string;
  name: string;
  category: SkillCategory;
  version: string;
  runtime: SkillRuntime;
  entry: string;                    // 入口文件路径（相对于 skills/ 目录）
  capabilities: string[];
  envVars?: string[];
  dependencies?: string[];
  healthCheck?: {
    command: string;
    timeoutMs: number;
  };
  description?: string;
}

export interface SkillCallRequest {
  skillId: string;
  params: Record<string, unknown>;
  context?: {
    agentId?: string;
    sessionId?: string;
    memory?: unknown[];
  };
}

export interface SkillCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
  logs?: string[];
}

export interface SkillHealthResult {
  skillId: string;
  healthy: boolean;
  lastCheck: string;
  error?: string;
}

// ============================================================================
// SkillBridge 类
// ============================================================================

const WORKSPACE_ROOT = resolve(process.cwd(), "../../..");
const SKILLS_BASE_PATH = resolve(WORKSPACE_ROOT, "skills");

export class SkillBridge {
  private skills = new Map<string, SkillManifest>();
  private healthCache = new Map<string, SkillHealthResult>();
  private initialized = false;

  // ── 初始化 ─────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.scanSkills();
    this.initialized = true;
    logger.info({ count: this.skills.size }, "[SkillBridge] Skills scanned");
  }

  // ── 扫描技能目录 ────────────────────────────

  async scanSkills(): Promise<SkillManifest[]> {
    this.skills.clear();
    const found: SkillManifest[] = [];

    // 1. 加载预定义的 skills-manifest.json
    const manifestPath = join(process.cwd(), "src/coordinator/skills-manifest.json");
    if (existsSync(manifestPath)) {
      try {
        const manifestData = JSON.parse(readFileSync(manifestPath, "utf-8"));
        if (manifestData.skills && Array.isArray(manifestData.skills)) {
          for (const skill of manifestData.skills) {
            const validated = this.validateManifest({ ...skill, id: skill.id });
            this.skills.set(validated.id, validated);
            found.push(validated);
          }
          logger.info({ count: found.length }, "[SkillBridge] Skills loaded from manifest");
        }
      } catch (err: any) {
        logger.warn({ error: err.message }, "[SkillBridge] Failed to load manifest");
      }
    }

    // 2. 扫描 workspace/skills/ 下的所有目录（补充 manifest 中没有的）
    if (existsSync(SKILLS_BASE_PATH)) {
      const entries = readdirSync(SKILLS_BASE_PATH, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (this.skills.has(entry.name)) continue; // 已在 manifest 中

        const skillDir = join(SKILLS_BASE_PATH, entry.name);
        const manifest = this.readManifest(skillDir, entry.name);
        if (manifest) {
          this.skills.set(manifest.id, manifest);
          found.push(manifest);
        }
      }
    } else {
      logger.warn("[SkillBridge] Skills directory not found: " + SKILLS_BASE_PATH);
    }

    return found;
  }

  private readManifest(dir: string, dirName: string): SkillManifest | null {
    // 尝试读取 manifest.json 或 manifest.yaml
    const jsonPath = join(dir, "manifest.json");
    const yamlPath = join(dir, "manifest.yaml");
    const ymlPath = join(dir, "manifest.yml");

    try {
      if (existsSync(jsonPath)) {
        const content = require(jsonPath);
        return this.validateManifest({ ...content, id: content.id || dirName });
      }
      // YAML 解析简化版（实际可用 yaml 库）
      if (existsSync(yamlPath) || existsSync(ymlPath)) {
        // 如果没有 yaml 库，尝试推断基本结构
        return this.inferManifest(dir, dirName);
      }
      // 没有 manifest 文件，尝试推断
      return this.inferManifest(dir, dirName);
    } catch (err: any) {
      logger.warn({ dir, error: err.message }, "[SkillBridge] Failed to read manifest");
      return this.inferManifest(dir, dirName);
    }
  }

  private inferManifest(dir: string, dirName: string): SkillManifest {
    // 根据目录内容推断技能信息
    const files = readdirSync(dir);
    let runtime: SkillRuntime = "nodejs";
    let entry = "index.ts";

    if (files.includes("main.py") || files.includes("app.py")) {
      runtime = "python";
      entry = files.includes("main.py") ? "main.py" : "app.py";
    } else if (files.includes("index.ts") || files.includes("index.js")) {
      runtime = "nodejs";
      entry = files.includes("index.ts") ? "index.ts" : "index.js";
    } else if (files.includes("run.sh") || files.includes("script.sh")) {
      runtime = "shell";
      entry = files.includes("run.sh") ? "run.sh" : "script.sh";
    }

    // 推断类别
    let category: SkillCategory = "other";
    const lower = dirName.toLowerCase();
    if (lower.includes("search") || lower.includes("brave") || lower.includes("tavily")) category = "search";
    else if (lower.includes("image") || lower.includes("video") || lower.includes("music") || lower.includes("media")) category = "media";
    else if (lower.includes("ocr") || lower.includes("doc") || lower.includes("pdf")) category = "ocr";
    else if (lower.includes("data") || lower.includes("chart") || lower.includes("sqlite")) category = "data";
    else if (lower.includes("monitor") || lower.includes("diag") || lower.includes("repair") || lower.includes("ops")) category = "ops";
    else if (lower.includes("telegram") || lower.includes("slack") || lower.includes("web")) category = "communication";

    return {
      id: dirName,
      name: dirName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      category,
      version: "1.0.0",
      runtime,
      entry: `${dirName}/${entry}`,
      capabilities: ["execute"],
      description: `Auto-inferred skill: ${dirName}`,
    };
  }

  private validateManifest(manifest: any): SkillManifest {
    return {
      id: manifest.id || "unknown",
      name: manifest.name || manifest.id || "Unknown Skill",
      category: manifest.category || "other",
      version: manifest.version || "1.0.0",
      runtime: manifest.runtime || "nodejs",
      entry: manifest.entry || `${manifest.id}/index.ts`,
      capabilities: manifest.capabilities || ["execute"],
      envVars: manifest.envVars,
      dependencies: manifest.dependencies,
      healthCheck: manifest.healthCheck,
      description: manifest.description,
    };
  }

  // ── 列出所有技能 ────────────────────────────

  listSkills(): SkillManifest[] {
    return Array.from(this.skills.values());
  }

  listByCategory(category: SkillCategory): SkillManifest[] {
    return this.listSkills().filter((s) => s.category === category);
  }

  getSkill(id: string): SkillManifest | undefined {
    return this.skills.get(id);
  }

  // ── 调用技能 ────────────────────────────────

  async callSkill(request: SkillCallRequest): Promise<SkillCallResult> {
    const { skillId, params, context } = request;
    const skill = this.skills.get(skillId);

    if (!skill) {
      return { success: false, error: `Skill not found: ${skillId}`, executionTimeMs: 0 };
    }

    const start = Date.now();
    const logs: string[] = [];

    try {
      let result: unknown;

      switch (skill.runtime) {
        case "nodejs":
          result = await this.callNodeSkill(skill, params, context, logs);
          break;
        case "python":
          result = await this.callPythonSkill(skill, params, context, logs);
          break;
        case "shell":
          result = await this.callShellSkill(skill, params, context, logs);
          break;
        default:
          throw new Error(`Unsupported runtime: ${skill.runtime}`);
      }

      return {
        success: true,
        data: result,
        executionTimeMs: Date.now() - start,
        logs,
      };
    } catch (err: any) {
      logger.error({ skillId, error: err.message }, "[SkillBridge] Skill execution failed");
      return {
        success: false,
        error: err.message,
        executionTimeMs: Date.now() - start,
        logs,
      };
    }
  }

  private async callNodeSkill(
    skill: SkillManifest,
    params: Record<string, unknown>,
    context?: SkillCallRequest["context"],
    logs?: string[]
  ): Promise<unknown> {
    const skillPath = join(WORKSPACE_ROOT, "skills", skill.entry);
    
    if (!existsSync(skillPath)) {
      throw new Error(`Skill entry not found: ${skillPath}`);
    }

    // 动态 require 技能模块
    // 注意：生产环境可能需要更安全的沙箱方案
    const skillModule = require(skillPath);
    
    if (typeof skillModule.default === "function") {
      return await skillModule.default(params, context);
    } else if (typeof skillModule.execute === "function") {
      return await skillModule.execute(params, context);
    } else if (typeof skillModule === "function") {
      return await skillModule(params, context);
    }

    throw new Error(`Skill ${skill.id} has no callable export (default/execute/function)`);
  }

  private async callPythonSkill(
    skill: SkillManifest,
    params: Record<string, unknown>,
    context?: SkillCallRequest["context"],
    logs?: string[]
  ): Promise<unknown> {
    const skillPath = join(WORKSPACE_ROOT, "skills", skill.entry);
    
    if (!existsSync(skillPath)) {
      throw new Error(`Skill entry not found: ${skillPath}`);
    }

    // 通过子进程调用 Python 脚本
    const args = [
      skillPath,
      JSON.stringify(params),
      context ? JSON.stringify(context) : "{}",
    ];

    const output = execSync(`python "${args[0]}" "${args[1]}" "${args[2]}"`, {
      cwd: WORKSPACE_ROOT,
      encoding: "utf-8",
      timeout: 30000,
      env: {
        ...process.env,
        SKILL_ID: skill.id,
        SKILL_DIR: join(WORKSPACE_ROOT, "skills", skill.id),
      },
    });

    try {
      return JSON.parse(output.trim());
    } catch {
      return { rawOutput: output.trim() };
    }
  }

  private async callShellSkill(
    skill: SkillManifest,
    params: Record<string, unknown>,
    context?: SkillCallRequest["context"],
    logs?: string[]
  ): Promise<unknown> {
    const skillPath = join(WORKSPACE_ROOT, "skills", skill.entry);
    
    if (!existsSync(skillPath)) {
      throw new Error(`Skill entry not found: ${skillPath}`);
    }

    // 序列化参数为环境变量
    const env: Record<string, string> = {
      ...process.env,
      SKILL_PARAMS: JSON.stringify(params),
      SKILL_CONTEXT: context ? JSON.stringify(context) : "{}",
    };

    const output = execSync(`bash "${skillPath}"`, {
      cwd: join(WORKSPACE_ROOT, "skills", skill.id),
      encoding: "utf-8",
      timeout: 30000,
      env,
    });

    try {
      return JSON.parse(output.trim());
    } catch {
      return { rawOutput: output.trim() };
    }
  }

  // ── 健康检查 ────────────────────────────────

  async checkHealth(skillId: string): Promise<SkillHealthResult> {
    const skill = this.skills.get(skillId);
    const result: SkillHealthResult = {
      skillId,
      healthy: false,
      lastCheck: new Date().toISOString(),
    };

    if (!skill) {
      result.error = "Skill not found";
      this.healthCache.set(skillId, result);
      return result;
    }

    try {
      // 检查入口文件是否存在
      const entryPath = join(WORKSPACE_ROOT, "skills", skill.entry);
      if (!existsSync(entryPath)) {
        result.error = `Entry file not found: ${entryPath}`;
        this.healthCache.set(skillId, result);
        return result;
      }

      // 如果有自定义健康检查命令，执行它
      if (skill.healthCheck) {
        execSync(skill.healthCheck.command, {
          cwd: join(WORKSPACE_ROOT, "skills", skill.id),
          timeout: skill.healthCheck.timeoutMs || 5000,
        });
      }

      result.healthy = true;
    } catch (err: any) {
      result.error = err.message;
    }

    this.healthCache.set(skillId, result);
    return result;
  }

  async checkAllHealth(): Promise<SkillHealthResult[]> {
    const results: SkillHealthResult[] = [];
    for (const id of this.skills.keys()) {
      results.push(await this.checkHealth(id));
    }
    return results;
  }

  // ── 环境变量检查 ────────────────────────────

  checkEnvVars(skillId: string): Record<string, boolean> {
    const skill = this.skills.get(skillId);
    if (!skill || !skill.envVars) return {};

    const status: Record<string, boolean> = {};
    for (const envVar of skill.envVars) {
      status[envVar] = !!process.env[envVar];
    }
    return status;
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let bridgeInstance: SkillBridge | null = null;

export function getSkillBridge(): SkillBridge {
  if (!bridgeInstance) {
    bridgeInstance = new SkillBridge();
  }
  return bridgeInstance;
}

export async function initSkillBridge(): Promise<SkillBridge> {
  const bridge = getSkillBridge();
  await bridge.init();
  return bridge;
}

export default SkillBridge;
