import { getMegaProviderBridge } from "../coordinator/bridges";
import { getSkillBridge } from "../coordinator/bridges";
import { logger } from "../utils/logger";
import { AgentRepository } from "../database/repositories/AgentRepository";

// ── Types ───────────────────────────────────────────────

export interface AutoConfigResult {
  ollamaDetected: boolean;
  ollamaModels: string[];
  providersConfigured: string[];
  skillsScanned: number;
  skillsFound: string[];
  agentsLoaded: number;
  databaseReady: boolean;
  errors: string[];
}

// ── Auto Config Service ─────────────────────────────────

const agentRepo = new AgentRepository();

/**
 * 系统启动时的自动配置流程：
 * 1. 检测 Ollama 本地模型
 * 2. 从环境变量配置云端 Provider
 * 3. 扫描 workspace skills
 * 4. 初始化数据库
 * 5. 预加载已有 Agent
 */
export async function runAutoConfig(): Promise<AutoConfigResult> {
  logger.info("[AutoConfig] 开始自动配置...");

  const result: AutoConfigResult = {
    ollamaDetected: false,
    ollamaModels: [],
    providersConfigured: [],
    skillsScanned: 0,
    skillsFound: [],
    agentsLoaded: 0,
    databaseReady: false,
    errors: [],
  };

  // ── 1. 检测 Ollama ──────────────────────────────────
  try {
    const bridge = getMegaProviderBridge();
    await bridge.refreshOllamaModels();
    const ollamaProvider = bridge.getProvider("ollama");

    if (ollamaProvider && ollamaProvider.models.length > 0) {
      result.ollamaDetected = true;
      result.ollamaModels = ollamaProvider.models.map((m) => m.id);
      logger.info({ count: ollamaProvider.models.length, models: result.ollamaModels }, "[AutoConfig] Ollama detected");
    } else {
      logger.warn("[AutoConfig] Ollama not detected or no models");
    }
  } catch (err: any) {
    result.errors.push(`Ollama detection failed: ${err.message}`);
    logger.warn({ error: err.message }, "[AutoConfig] Ollama detection failed");
  }

  // ── 2. 从环境变量配置 Provider ─────────────────────
  try {
    const bridge = getMegaProviderBridge();
    // 初始化会触发 scanProviderConfigs 和 loadProvidersFromEnv
    await bridge.init();
    const providers = bridge.listProviders();
    result.providersConfigured = providers.map((p) => p.id);
    logger.info({ count: providers.length }, "[AutoConfig] Providers configured");
  } catch (err: any) {
    result.errors.push(`Provider config failed: ${err.message}`);
    logger.warn({ error: err.message }, "[AutoConfig] Provider config failed");
  }

  // ── 3. 扫描 workspace skills ────────────────────────
  try {
    const bridge = getSkillBridge();
    const skills = await bridge.scanSkills();
    result.skillsScanned = skills.length;
    result.skillsFound = skills.map((s) => s.id);
    logger.info({ count: skills.length }, "[AutoConfig] Skills scanned");
  } catch (err: any) {
    result.errors.push(`Skill scan failed: ${err.message}`);
    logger.warn({ error: err.message }, "[AutoConfig] Skill scan failed");
  }

  // ── 4. 检查数据库 ──────────────────────────────────
  try {
    const agents = await agentRepo.findAll();
    result.agentsLoaded = agents.length;
    result.databaseReady = true;
    logger.info({ count: agents.length }, "[AutoConfig] Database ready");
  } catch (err: any) {
    result.errors.push(`Database check failed: ${err.message}`);
    logger.warn({ error: err.message }, "[AutoConfig] Database check failed");
  }

  logger.info(result, "[AutoConfig] Auto configuration completed");
  return result;
}

/**
 * 重新扫描 Ollama 模型（用于手动刷新）
 */
export async function rescanOllama(): Promise<{
  success: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const bridge = getMegaProviderBridge();
    await bridge.refreshOllamaModels();
    const provider = bridge.getProvider("ollama");
    const models = provider?.models.map((m) => m.id) || [];
    return { success: true, models };
  } catch (err: any) {
    return { success: false, models: [], error: err.message };
  }
}

/**
 * 重新扫描 workspace skills（用于手动刷新）
 */
export async function rescanSkills(): Promise<{
  success: boolean;
  count: number;
  skills: string[];
  error?: string;
}> {
  try {
    const bridge = getSkillBridge();
    const skills = await bridge.scanSkills();
    return {
      success: true,
      count: skills.length,
      skills: skills.map((s) => s.id),
    };
  } catch (err: any) {
    return { success: false, count: 0, skills: [], error: err.message };
  }
}
