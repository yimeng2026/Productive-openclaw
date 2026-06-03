import { TimeoutDegradation } from '../src/TimeoutDegradation';
import { SubTask, TimeoutConfig, TaskStatus } from '../src/types';

describe('TimeoutDegradation', () => {
  const config: TimeoutConfig = {
    simpleTaskMs: 30000,
    complexTaskMs: 300000,
    researchTaskMs: 600000,
  };

  const createSubtask = (complexity: number, role: any = 'writer'): SubTask => ({
    id: 'sub-1',
    parentId: null,
    description: 'Test task',
    role,
    platformPreference: 'openclaw',
    platformFallbacks: [],
    inputDependencies: [],
    outputFormat: { type: 'text' },
    estimatedComplexity: complexity,
    timeoutMs: 30000,
    degradationChain: ['full', 'simplified', 'placeholder', 'skip'],
    status: 'pending' as TaskStatus,
    assignedAgentId: null,
    result: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  });

  test('resolves timeout by complexity', () => {
    const td = new TimeoutDegradation(config);
    const simple = createSubtask(2);
    const complex = createSubtask(6);
    const research = createSubtask(9, 'researcher');

    expect(td.resolveTimeout(simple)).toBe(30000);
    expect(td.resolveTimeout(complex)).toBe(300000);
    expect(td.resolveTimeout(research)).toBe(600000);
  });

  test('degrades to simplified on timeout', () => {
    const plans: any[] = [];
    const td = new TimeoutDegradation(config, (p) => plans.push(p));
    const subtask = createSubtask(7);

    const plan = td.degrade(subtask, 'test');
    expect(plan.level).toBe('simplified');
    expect(plan.degraded.description).toContain('[SIMPLIFIED]');
    expect(plans.length).toBe(1);
  });

  test('degradation chain progresses through levels', () => {
    const td = new TimeoutDegradation(config);
    let subtask = createSubtask(7);

    const plan1 = td.degrade(subtask, 'first');
    expect(plan1.level).toBe('simplified');

    subtask = plan1.degraded;
    const plan2 = td.degrade(subtask, 'second');
    expect(plan2.level).toBe('placeholder');

    subtask = plan2.degraded;
    const plan3 = td.degrade(subtask, 'third');
    expect(plan3.level).toBe('skip');
  });
});
