// AgentRegistry.ts — Agent 注册中心
// 支持注册 / 注销 / 查询 Agent，持久化到 SQLite，健康检查状态管理

import { getDb } from '../../database/sqlite';
import { logger } from '../../utils/logger';
import { pushAgentStatus, pushAgentHealth } from '../../websocket/push';
import type {
  AgentRegistration,
  AgentStatus,
  AgentHealth,
  HealthCheckResult,
} from './types';

const TABLE_AGENTS = 'uc_agents';
const TABLE_HEALTH = 'uc_agent_health';

export class AgentRegistry {
  private agents = new Map<string, AgentRegistration>();
  private initialized = false;

  // ── 初始化 ─────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    const db = await getDb();

    await db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE_AGENTS} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        level_a TEXT DEFAULT '[]',
        level_b TEXT DEFAULT 'mega',
        level_c TEXT DEFAULT 'openclaw',
        agent_zero_mode TEXT DEFAULT 'none',
        agent_zero_profile TEXT,
        swarm_id TEXT,
        role TEXT DEFAULT 'solo',
        status TEXT DEFAULT 'idle',
        health TEXT DEFAULT 'healthy',
        skills TEXT DEFAULT '[]',
        capabilities TEXT DEFAULT '[]',
        max_concurrent_tasks INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 5,
        config TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ${TABLE_HEALTH} (
        agent_id TEXT PRIMARY KEY,
        healthy INTEGER DEFAULT 1,
        latency_ms INTEGER DEFAULT 0,
        details TEXT,
        checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES ${TABLE_AGENTS}(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agents_swarm ON ${TABLE_AGENTS}(swarm_id);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON ${TABLE_AGENTS}(status);
      CREATE INDEX IF NOT EXISTS idx_agents_health ON ${TABLE_AGENTS}(health);
    `);

    // 从数据库加载
    const rows = await db.all(`SELECT * FROM ${TABLE_AGENTS}`);
    for (const row of rows) {
      const agent = this.rowToAgent(row);
      this.agents.set(agent.id, agent);
    }

    this.initialized = true;
    logger.info(`[AgentRegistry] Loaded ${this.agents.size} agents from DB`);
  }

  // ── 注册 ───────────────────────────────────

  async register(agent: Omit<AgentRegistration, 'createdAt' | 'updatedAt'>): Promise<AgentRegistration> {
    await this.ensureInit();

    const now = Date.now();
    const full: AgentRegistration = {
      ...agent,
      createdAt: now,
      updatedAt: now,
    };

    if (this.agents.has(full.id)) {
      throw new Error(`Agent already registered: ${full.id}`);
    }

    const db = await getDb();
    await db.run(
      `INSERT INTO ${TABLE_AGENTS} (
        id, name, level_a, level_b, level_c, agent_zero_mode, agent_zero_profile,
        swarm_id, role, status, health, skills, capabilities,
        max_concurrent_tasks, priority, config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        full.id,
        full.name,
        JSON.stringify(full.levelA),
        full.levelB,
        full.levelC,
        full.agentZeroMode,
        full.agentZeroProfile ?? null,
        full.swarmId ?? null,
        full.role,
        full.status,
        full.health,
        JSON.stringify(full.skills),
        JSON.stringify(full.capabilities),
        full.maxConcurrentTasks,
        full.priority,
        JSON.stringify({ systemPrompt: full.systemPrompt, temperature: full.temperature, maxTokens: full.maxTokens, ...full.config }),
        new Date(full.createdAt).toISOString(),
        new Date(full.updatedAt).toISOString(),
      ]
    );

    // 初始化健康记录
    await db.run(
      `INSERT OR IGNORE INTO ${TABLE_HEALTH} (agent_id, healthy, latency_ms, checked_at) VALUES (?, 1, 0, ?)`,
      [full.id, new Date(now).toISOString()]
    );

    this.agents.set(full.id, full);
    logger.info({ agentId: full.id, name: full.name }, '[AgentRegistry] Agent registered');
    return full;
  }

  // ── 注销 ───────────────────────────────────

  async unregister(agentId: string): Promise<boolean> {
    await this.ensureInit();

    const db = await getDb();
    const result = await db.run(`DELETE FROM ${TABLE_AGENTS} WHERE id = ?`, [agentId]);

    if (result.changes && result.changes > 0) {
      this.agents.delete(agentId);
      logger.info({ agentId }, '[AgentRegistry] Agent unregistered');
      return true;
    }
    return false;
  }

  // ── 查询 ───────────────────────────────────

  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  getAll(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  getBySwarm(swarmId: string): AgentRegistration[] {
    return this.getAll().filter((a) => a.swarmId === swarmId);
  }

  getByStatus(status: AgentStatus): AgentRegistration[] {
    return this.getAll().filter((a) => a.status === status);
  }

  getByHealth(health: AgentHealth): AgentRegistration[] {
    return this.getAll().filter((a) => a.health === health);
  }

  getHealthy(): AgentRegistration[] {
    return this.getAll().filter((a) => a.health === 'healthy' && a.status !== 'error');
  }

  getAvailable(): AgentRegistration[] {
    return this.getHealthy().filter((a) => a.status === 'idle');
  }

  findByCapability(capability: string): AgentRegistration[] {
    return this.getAll().filter((a) => a.capabilities.includes(capability));
  }

  findBySkill(skillId: string): AgentRegistration[] {
    return this.getAll().filter((a) => a.skills.includes(skillId));
  }

  // ── 状态更新 ───────────────────────────────

  async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
    await this.ensureInit();
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    agent.status = status;
    agent.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `UPDATE ${TABLE_AGENTS} SET status = ?, updated_at = ? WHERE id = ?`,
      [status, new Date(agent.updatedAt).toISOString(), agentId]
    );

    pushAgentStatus(agentId, status);
  }

  async updateHealth(agentId: string, health: AgentHealth): Promise<void> {
    await this.ensureInit();
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    agent.health = health;
    agent.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `UPDATE ${TABLE_AGENTS} SET health = ?, updated_at = ? WHERE id = ?`,
      [health, new Date(agent.updatedAt).toISOString(), agentId]
    );

    pushAgentHealth(agentId, health);
  }

  async updateSwarm(agentId: string, swarmId: string | undefined, role: AgentRegistration['role']): Promise<void> {
    await this.ensureInit();
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    agent.swarmId = swarmId;
    agent.role = role;
    agent.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `UPDATE ${TABLE_AGENTS} SET swarm_id = ?, role = ?, updated_at = ? WHERE id = ?`,
      [swarmId ?? null, role, new Date(agent.updatedAt).toISOString(), agentId]
    );
  }

  // ── 健康检查 ───────────────────────────────

  async recordHealthCheck(result: HealthCheckResult): Promise<void> {
    await this.ensureInit();
    const agent = this.agents.get(result.agentId);
    if (!agent) return;

    agent.health = result.healthy ? 'healthy' : 'unhealthy';
    agent.lastHealthCheckAt = result.checkedAt;
    agent.updatedAt = Date.now();

    const db = await getDb();
    await db.run(
      `UPDATE ${TABLE_AGENTS} SET health = ?, updated_at = ? WHERE id = ?`,
      [agent.health, new Date(agent.updatedAt).toISOString(), result.agentId]
    );

    await db.run(
      `INSERT OR REPLACE INTO ${TABLE_HEALTH} (agent_id, healthy, latency_ms, details, checked_at) VALUES (?, ?, ?, ?, ?)`,
      [
        result.agentId,
        result.healthy ? 1 : 0,
        result.latencyMs,
        JSON.stringify(result.details ?? {}),
        new Date(result.checkedAt).toISOString(),
      ]
    );

    pushAgentHealth(result.agentId, agent.health);
  }

  async getHealthHistory(agentId: string): Promise<HealthCheckResult[]> {
    const db = await getDb();
    const rows = await db.all(
      `SELECT * FROM ${TABLE_HEALTH} WHERE agent_id = ? ORDER BY checked_at DESC`,
      [agentId]
    );
    return rows.map((r: any) => ({
      agentId: r.agent_id,
      healthy: Boolean(r.healthy),
      latencyMs: r.latency_ms,
      details: r.details ? JSON.parse(r.details) : undefined,
      checkedAt: new Date(r.checked_at).getTime(),
    }));
  }

  // ── 批量检查 ───────────────────────────────

  async runHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];
    for (const agent of this.getAll()) {
      const start = Date.now();
      // 简化：仅检查状态是否异常；实际中可调用 Agent 的 ping 端点
      const healthy = agent.status !== 'error';
      const result: HealthCheckResult = {
        agentId: agent.id,
        healthy,
        latencyMs: Date.now() - start,
        details: { status: agent.status },
        checkedAt: Date.now(),
      };
      await this.recordHealthCheck(result);
      results.push(result);
    }
    logger.info(`[AgentRegistry] Health checks completed for ${results.length} agents`);
    return results;
  }

  // ── 内部 ───────────────────────────────────

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.init();
  }

  private rowToAgent(row: any): AgentRegistration {
    const config = row.config ? JSON.parse(row.config) : {};
    return {
      id: row.id,
      name: row.name,
      levelA: JSON.parse(row.level_a || '[]'),
      levelB: row.level_b,
      levelC: row.level_c,
      agentZeroMode: row.agent_zero_mode,
      agentZeroProfile: row.agent_zero_profile ?? undefined,
      swarmId: row.swarm_id ?? undefined,
      role: row.role,
      status: row.status,
      health: row.health,
      skills: JSON.parse(row.skills || '[]'),
      capabilities: JSON.parse(row.capabilities || '[]'),
      maxConcurrentTasks: row.max_concurrent_tasks,
      priority: row.priority,
      systemPrompt: config.systemPrompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      config,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }
}
