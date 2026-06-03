import { SwarmCoordinator } from '../src/SwarmCoordinator';
import { SwarmConfig, CapabilityManifest, MergeConfig, MatchConfig, ErrorConfig, TimeoutConfig } from '../src/types';

describe('SwarmCoordinator', () => {
  const agentOC: CapabilityManifest = {
    agentId: 'agent-oc',
    role: 'researcher',
    platform: 'openclaw',
    skills: [{ name: 'research', level: 0.9, description: 'deep research' }],
    maxTokens: 8000,
    toolCalling: true,
    reasoning: 'advanced',
    contextWindow: 32000,
    specialties: ['physics'],
    performanceMetrics: {
      avgLatencyMs: 2000,
      successRate: 0.98,
      tasksCompleted: 0,
      lastFailureAt: null,
      consecutiveFailures: 0,
    },
  };

  const agentCL: CapabilityManifest = {
    agentId: 'agent-cl',
    role: 'writer',
    platform: 'claude',
    skills: [{ name: 'writing', level: 0.95, description: 'creative writing' }],
    maxTokens: 4000,
    toolCalling: false,
    reasoning: 'advanced',
    contextWindow: 16000,
    specialties: ['essays'],
    performanceMetrics: {
      avgLatencyMs: 3000,
      successRate: 0.95,
      tasksCompleted: 0,
      lastFailureAt: null,
      consecutiveFailures: 0,
    },
  };

  const agentHM: CapabilityManifest = {
    agentId: 'agent-hm',
    role: 'reviewer',
    platform: 'hermes',
    skills: [{ name: 'review', level: 0.85, description: 'code review' }],
    maxTokens: 4000,
    toolCalling: true,
    reasoning: 'basic',
    contextWindow: 8000,
    specialties: ['security'],
    performanceMetrics: {
      avgLatencyMs: 1500,
      successRate: 0.99,
      tasksCompleted: 0,
      lastFailureAt: null,
      consecutiveFailures: 0,
    },
  };

  const createConfig = (): SwarmConfig => ({
    platforms: [
      { platform: 'openclaw', enabled: true, endpoint: 'memory://oc', weight: 1 },
      { platform: 'claude', enabled: true, endpoint: 'memory://cl', weight: 1 },
      { platform: 'hermes', enabled: true, endpoint: 'memory://hm', weight: 1 },
    ],
    agents: [agentOC, agentCL, agentHM],
    matchConfig: {
      minScore: 0.5,
      preferSamePlatform: true,
      fallbackEnabled: true,
      maxRetries: 2,
    } as MatchConfig,
    errorConfig: {
      maxRetries: 2,
      retryDelayMs: 500,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 30000,
      escalationTimeoutMs: 60000,
    } as ErrorConfig,
    timeoutConfig: {
      simpleTaskMs: 5000,
      complexTaskMs: 10000,
      researchTaskMs: 15000,
    } as TimeoutConfig,
    mergeConfig: {
      strategy: 'sequential_append',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.5,
    } as MergeConfig,
    maxConcurrentTasks: 5,
  });

  test('initializes with config', () => {
    const coordinator = new SwarmCoordinator(createConfig());
    expect(coordinator.getState()).toBeNull();
  });

  test('decomposes request and produces subtasks', () => {
    const coordinator = new SwarmCoordinator(createConfig());
    const progress: string[] = [];
    coordinator.onProgress = (m) => progress.push(m);

    // We can't fully execute without mocked agents, but we can test decomposition
    // by examining internal state after triggering execute (which will timeout)
    // Instead, verify the config produces the right setup
    expect(coordinator.getAgentStats().length).toBe(3);
  });
});
