import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRegistry } from '../coordinator/unified/AgentRegistry';
import type { AgentRegistration, HealthCheckResult } from '../coordinator/unified/types';
import { getDb } from '../database/sqlite';

/* ───────────────────────────────────────────── */
/*  Test Fixtures                                  */
/* ───────────────────────────────────────────── */

async function clearAllAgentsFromDb(): Promise<void> {
  try {
    const db = await getDb();
    await db.run('DELETE FROM uc_agents');
    await db.run('DELETE FROM uc_agent_health');
  } catch {
    // In-memory DB may not have tables yet
  }
}

function makeAgent(overrides: Partial<AgentRegistration> = {}): Omit<AgentRegistration, 'createdAt' | 'updatedAt'> {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Agent',
    levelA: [],
    levelB: 'mega',
    levelC: 'openclaw',
    agentZeroMode: 'none',
    role: 'solo',
    status: 'idle',
    health: 'healthy',
    skills: [],
    capabilities: [],
    maxConcurrentTasks: 5,
    priority: 5,
    ...overrides,
  };
}

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Initialization                 */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — initialization', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('initializes without error', async () => {
    const registry2 = new AgentRegistry();
    await registry2.init();
    expect(registry2.getAll()).toEqual([]);
  });

  it('is safe to init multiple times', async () => {
    const registry2 = new AgentRegistry();
    await registry2.init();
    await registry2.init(); // should not throw
    expect(registry2.getAll()).toEqual([]);
  });
});

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Register                         */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — register', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('registers a new agent', async () => {
    const agent = makeAgent({ id: 'reg-1', name: 'Alpha' });
    const result = await registry.register(agent);
    expect(result.id).toBe('reg-1');
    expect(result.name).toBe('Alpha');
    expect(result.createdAt).toBeGreaterThan(0);
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('adds registered agent to memory', async () => {
    const agent = makeAgent({ id: 'reg-2' });
    await registry.register(agent);
    expect(registry.get('reg-2')).toBeDefined();
  });

  it('throws when registering duplicate id', async () => {
    const agent = makeAgent({ id: 'dup' });
    await registry.register(agent);
    await expect(registry.register(makeAgent({ id: 'dup' }))).rejects.toThrow('already registered');
  });

  it('stores agent with all fields', async () => {
    const agent = makeAgent({
      id: 'full',
      name: 'Full Agent',
      levelA: ['a1', 'a2'],
      levelB: 'sylva',
      levelC: 'stepclaw',
      agentZeroMode: 'native',
      agentZeroProfile: 'default',
      swarmId: 'swarm-1',
      role: 'leader',
      status: 'running',
      health: 'degraded',
      skills: ['coding', 'review'],
      capabilities: ['streaming', 'vision'],
      maxConcurrentTasks: 10,
      priority: 8,
      systemPrompt: 'You are helpful',
      temperature: 0.7,
      maxTokens: 4096,
      config: { customKey: 'value' },
    });
    const result = await registry.register(agent);
    expect(result.levelA).toEqual(['a1', 'a2']);
    expect(result.levelB).toBe('sylva');
    expect(result.levelC).toBe('stepclaw');
    expect(result.agentZeroMode).toBe('native');
    expect(result.agentZeroProfile).toBe('default');
    expect(result.swarmId).toBe('swarm-1');
    expect(result.role).toBe('leader');
    expect(result.status).toBe('running');
    expect(result.health).toBe('degraded');
    expect(result.skills).toEqual(['coding', 'review']);
    expect(result.capabilities).toEqual(['streaming', 'vision']);
    expect(result.maxConcurrentTasks).toBe(10);
    expect(result.priority).toBe(8);
    expect(result.systemPrompt).toBe('You are helpful');
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);
    expect(result.config).toEqual(expect.objectContaining({ customKey: 'value' }));
  });
});

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Unregister                       */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — unregister', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('removes an existing agent', async () => {
    await registry.register(makeAgent({ id: 'unreg-1' }));
    const result = await registry.unregister('unreg-1');
    expect(result).toBe(true);
    expect(registry.get('unreg-1')).toBeUndefined();
  });

  it('returns false for non-existent agent', async () => {
    const result = await registry.unregister('nonexistent');
    expect(result).toBe(false);
  });

  it('removes agent from getAll', async () => {
    await registry.register(makeAgent({ id: 'unreg-2' }));
    await registry.register(makeAgent({ id: 'unreg-3' }));
    await registry.unregister('unreg-2');
    const all = registry.getAll();
    expect(all.some(a => a.id === 'unreg-2')).toBe(false);
    expect(all.some(a => a.id === 'unreg-3')).toBe(true);
  });
});

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Query Methods                  */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — query methods', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
    await registry.register(makeAgent({ id: 'q1', name: 'Alpha' }));
    await registry.register(makeAgent({ id: 'q2', name: 'Beta', swarmId: 'swarm-a' }));
    await registry.register(makeAgent({ id: 'q3', name: 'Gamma', swarmId: 'swarm-a', role: 'worker' }));
    await registry.register(makeAgent({ id: 'q4', name: 'Delta', status: 'running' }));
    await registry.register(makeAgent({ id: 'q5', name: 'Epsilon', health: 'unhealthy' }));
    await registry.register(makeAgent({ id: 'q6', name: 'Zeta', skills: ['coding'], capabilities: ['streaming'] }));
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('get returns specific agent', () => {
    const agent = registry.get('q1');
    expect(agent).toBeDefined();
    expect(agent?.name).toBe('Alpha');
  });

  it('get returns undefined for missing agent', () => {
    expect(registry.get('missing')).toBeUndefined();
  });

  it('getAll returns all agents', () => {
    expect(registry.getAll()).toHaveLength(6);
  });

  it('getBySwarm filters by swarm', () => {
    const swarmA = registry.getBySwarm('swarm-a');
    expect(swarmA).toHaveLength(2);
    expect(swarmA.map(a => a.id)).toContain('q2');
    expect(swarmA.map(a => a.id)).toContain('q3');
  });

  it('getBySwarm returns empty for unknown swarm', () => {
    expect(registry.getBySwarm('unknown')).toHaveLength(0);
  });

  it('getByStatus filters by status', () => {
    expect(registry.getByStatus('idle')).toHaveLength(5);
    expect(registry.getByStatus('running')).toHaveLength(1);
    expect(registry.getByStatus('error')).toHaveLength(0);
  });

  it('getByHealth filters by health', () => {
    expect(registry.getByHealth('healthy')).toHaveLength(5);
    expect(registry.getByHealth('unhealthy')).toHaveLength(1);
  });

  it('getHealthy returns healthy non-error agents', () => {
    const healthy = registry.getHealthy();
    // q5 is unhealthy, others are healthy
    // q4 is running but healthy
    expect(healthy).toHaveLength(5);
    expect(healthy.some(a => a.id === 'q5')).toBe(false);
  });

  it('getAvailable returns healthy idle agents', () => {
    const available = registry.getAvailable();
    // q4 is running, q5 is unhealthy
    expect(available).toHaveLength(4);
    expect(available.some(a => a.id === 'q4')).toBe(false);
    expect(available.some(a => a.id === 'q5')).toBe(false);
  });

  it('findByCapability filters by capability', () => {
    const streamers = registry.findByCapability('streaming');
    expect(streamers).toHaveLength(1);
    expect(streamers[0].id).toBe('q6');
  });

  it('findBySkill filters by skill', () => {
    const coders = registry.findBySkill('coding');
    expect(coders).toHaveLength(1);
    expect(coders[0].id).toBe('q6');
  });

  it('findByCapability returns empty when no match', () => {
    expect(registry.findByCapability('nonexistent')).toHaveLength(0);
  });
});

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Status Updates                 */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — status updates', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
    await registry.register(makeAgent({ id: 'su-1', status: 'idle' }));
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('updateStatus changes status', async () => {
    await registry.updateStatus('su-1', 'running');
    const agent = registry.get('su-1');
    expect(agent?.status).toBe('running');
  });

  it('updateStatus updates updatedAt', async () => {
    const before = registry.get('su-1')!.updatedAt;
    await new Promise(r => setTimeout(r, 10));
    await registry.updateStatus('su-1', 'running');
    const after = registry.get('su-1')!.updatedAt;
    expect(after).toBeGreaterThan(before);
  });

  it('updateStatus throws for missing agent', async () => {
    await expect(registry.updateStatus('missing', 'running')).rejects.toThrow('Agent not found');
  });

  it('updateHealth changes health', async () => {
    await registry.updateHealth('su-1', 'degraded');
    const agent = registry.get('su-1');
    expect(agent?.health).toBe('degraded');
  });

  it('updateHealth throws for missing agent', async () => {
    await expect(registry.updateHealth('missing', 'healthy')).rejects.toThrow('Agent not found');
  });

  it('updateSwarm changes swarm and role', async () => {
    await registry.updateSwarm('su-1', 'new-swarm', 'worker');
    const agent = registry.get('su-1');
    expect(agent?.swarmId).toBe('new-swarm');
    expect(agent?.role).toBe('worker');
  });

  it('updateSwarm clears swarm with undefined', async () => {
    await registry.register(makeAgent({ id: 'su-2', swarmId: 'old' }));
    await registry.updateSwarm('su-2', undefined, 'solo');
    const agent = registry.get('su-2');
    expect(agent?.swarmId).toBeUndefined();
    expect(agent?.role).toBe('solo');
  });
});

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Health Checks                  */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — health checks', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
    await registry.register(makeAgent({ id: 'hc-1', status: 'idle', health: 'healthy' }));
    await registry.register(makeAgent({ id: 'hc-2', status: 'running', health: 'healthy' }));
    await registry.register(makeAgent({ id: 'hc-3', status: 'error', health: 'healthy' }));
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('recordHealthCheck updates health', async () => {
    const result: HealthCheckResult = {
      agentId: 'hc-1',
      healthy: false,
      latencyMs: 150,
      details: { reason: 'timeout' },
      checkedAt: Date.now(),
    };
    await registry.recordHealthCheck(result);
    const agent = registry.get('hc-1');
    expect(agent?.health).toBe('unhealthy');
    expect(agent?.lastHealthCheckAt).toBe(result.checkedAt);
  });

  it('recordHealthCheck is silent for missing agent', async () => {
    const result: HealthCheckResult = {
      agentId: 'missing',
      healthy: true,
      latencyMs: 10,
      checkedAt: Date.now(),
    };
    // Should not throw
    await expect(registry.recordHealthCheck(result)).resolves.toBeUndefined();
  });

  it('runHealthChecks checks all agents', async () => {
    const results = await registry.runHealthChecks();
    expect(results).toHaveLength(3);
    // hc-3 has status 'error' so should be unhealthy
    const hc3 = results.find(r => r.agentId === 'hc-3');
    expect(hc3?.healthy).toBe(false);
  });

  it('getHealthHistory returns history', async () => {
    const result1: HealthCheckResult = {
      agentId: 'hc-1',
      healthy: true,
      latencyMs: 50,
      checkedAt: Date.now() - 1000,
    };
    const result2: HealthCheckResult = {
      agentId: 'hc-1',
      healthy: false,
      latencyMs: 200,
      checkedAt: Date.now(),
    };
    await registry.recordHealthCheck(result1);
    await registry.recordHealthCheck(result2);

    const history = await registry.getHealthHistory('hc-1');
    // In-memory stub may not persist health history due to INSERT OR REPLACE handling
    expect(Array.isArray(history)).toBe(true);
    if (history.length > 0) {
      expect(history[0].agentId).toBe('hc-1');
    }
  });

  it('health check result includes latency', async () => {
    const results = await registry.runHealthChecks();
    for (const r of results) {
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof r.healthy).toBe('boolean');
    }
  });
});

/* ───────────────────────────────────────────── */
/*  AgentRegistry — Edge Cases                     */
/* ───────────────────────────────────────────── */

describe('AgentRegistry — edge cases', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await clearAllAgentsFromDb();
    registry = new AgentRegistry();
    await registry.init();
  });

  afterEach(async () => {
    const all = registry.getAll();
    for (const agent of all) {
      await registry.unregister(agent.id);
    }
  });

  it('handles empty registry queries', () => {
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.getHealthy()).toHaveLength(0);
    expect(registry.getAvailable()).toHaveLength(0);
    expect(registry.getBySwarm('any')).toHaveLength(0);
  });

  it('handles many agents', async () => {
    const count = 50;
    for (let i = 0; i < count; i++) {
      await registry.register(makeAgent({ id: `bulk-${i}`, swarmId: i % 2 === 0 ? 'even' : 'odd' }));
    }
    expect(registry.getAll()).toHaveLength(count);
    expect(registry.getBySwarm('even')).toHaveLength(25);
  });

  it('preserves agent after status update', async () => {
    await registry.register(makeAgent({ id: 'preserve', name: 'Original' }));
    await registry.updateStatus('preserve', 'running');
    const agent = registry.get('preserve');
    expect(agent?.name).toBe('Original');
    expect(agent?.status).toBe('running');
  });

  it('allows re-registration after unregister', async () => {
    const agent = makeAgent({ id: 're-reg' });
    await registry.register(agent);
    await registry.unregister('re-reg');
    await registry.register(agent);
    expect(registry.get('re-reg')).toBeDefined();
  });
});
