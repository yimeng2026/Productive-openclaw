import { CapabilityMatcher } from '../src/CapabilityMatcher';
import { CapabilityManifest, SubTask, AgentRole, Platform } from '../src/types';

describe('CapabilityMatcher', () => {
  const agents: CapabilityManifest[] = [
    {
      agentId: 'agent-oc',
      role: 'researcher',
      platform: 'openclaw',
      skills: [{ name: 'research', level: 0.9, description: 'deep research' }],
      maxTokens: 8000,
      toolCalling: true,
      reasoning: 'advanced',
      contextWindow: 32000,
      specialties: ['physics', 'math'],
      performanceMetrics: {
        avgLatencyMs: 2000,
        successRate: 0.98,
        tasksCompleted: 50,
        lastFailureAt: null,
        consecutiveFailures: 0,
      },
    },
    {
      agentId: 'agent-cl',
      role: 'writer',
      platform: 'claude',
      skills: [{ name: 'writing', level: 0.95, description: 'creative writing' }],
      maxTokens: 4000,
      toolCalling: false,
      reasoning: 'advanced',
      contextWindow: 16000,
      specialties: ['essays', 'fiction'],
      performanceMetrics: {
        avgLatencyMs: 3000,
        successRate: 0.95,
        tasksCompleted: 30,
        lastFailureAt: null,
        consecutiveFailures: 0,
      },
    },
    {
      agentId: 'agent-hm',
      role: 'coder',
      platform: 'hermes',
      skills: [{ name: 'coding', level: 0.85, description: 'systems programming' }],
      maxTokens: 4000,
      toolCalling: true,
      reasoning: 'basic',
      contextWindow: 8000,
      specialties: ['rust', 'cpp'],
      performanceMetrics: {
        avgLatencyMs: 1500,
        successRate: 0.99,
        tasksCompleted: 100,
        lastFailureAt: null,
        consecutiveFailures: 0,
      },
    },
  ];

  const createSubtask = (role: AgentRole, platform: Platform, description: string, complexity: number = 5): SubTask => ({
    id: 'sub-1',
    parentId: null,
    description,
    role,
    platformPreference: platform,
    platformFallbacks: ['generic'],
    inputDependencies: [],
    outputFormat: { type: 'text' },
    estimatedComplexity: complexity,
    timeoutMs: 30000,
    degradationChain: ['full', 'simplified'],
    status: 'pending',
    assignedAgentId: null,
    result: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  });

  test('matches exact role and platform', () => {
    const matcher = new CapabilityMatcher();
    const subtask = createSubtask('researcher', 'openclaw', 'Research quantum computing');
    const match = matcher.bestMatch(agents, subtask);
    expect(match).not.toBeNull();
    expect(match!.agentId).toBe('agent-oc');
    expect(match!.score).toBeGreaterThanOrEqual(0.7);
  });

  test('filters below threshold', () => {
    const matcher = new CapabilityMatcher({ minScore: 0.9 });
    const subtask = createSubtask('reviewer', 'claude', 'Review code');
    const match = matcher.bestMatch(agents, subtask);
    // No exact reviewer, should be null at 0.9 threshold
    expect(match).toBeNull();
  });

  test('penalizes failing agents', () => {
    const failingAgent: CapabilityManifest = {
      ...agents[0],
      agentId: 'agent-fail',
      performanceMetrics: {
        ...agents[0].performanceMetrics,
        consecutiveFailures: 3,
      },
    };
    const matcher = new CapabilityMatcher();
    const subtask = createSubtask('researcher', 'openclaw', 'Research');
    const matches = matcher.findMatches([...agents, failingAgent], subtask);
    const failMatch = matches.find((m) => m.agentId === 'agent-fail');
    const goodMatch = matches.find((m) => m.agentId === 'agent-oc');
    expect(goodMatch!.score).toBeGreaterThan(failMatch!.score);
  });
});
