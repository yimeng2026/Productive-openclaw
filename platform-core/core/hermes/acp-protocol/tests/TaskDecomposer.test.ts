import { TaskDecomposer } from '../src/TaskDecomposer';

describe('TaskDecomposer', () => {
  const decomposer = new TaskDecomposer();

  test('decomposes a paper writing request', () => {
    const result = decomposer.decompose('Write a paper on quantum computing', 'req-1');
    expect(result.subtasks.length).toBeGreaterThanOrEqual(3);
    expect(result.executionPlan.length).toBeGreaterThanOrEqual(2);
    expect(result.subtasks[0].role).toBe('researcher');
  });

  test('detects code review template', () => {
    const result = decomposer.decompose('Review my pull request for security issues', 'req-2');
    const roles = result.subtasks.map((s) => s.role);
    expect(roles).toContain('coder');
    expect(roles).toContain('security_scanner');
  });

  test('builds dependency edges between stages', () => {
    const result = decomposer.decompose('Analyze this dataset and create charts', 'req-3');
    expect(result.dependencyGraph.edges.length).toBeGreaterThanOrEqual(1);
  });

  test('assigns timeouts based on complexity', () => {
    const simple = decomposer.decompose('Say hello', 'req-4');
    const complex = decomposer.decompose('Write a formal proof of the Riemann Hypothesis using advanced topological methods and quantum field theory', 'req-5');
    expect(complex.subtasks[0].timeoutMs).toBeGreaterThan(simple.subtasks[0].timeoutMs);
  });
});
