import { ResultMerger } from '../src/ResultMerger';
import { TaskResult, MergeConfig } from '../src/types';

describe('ResultMerger', () => {
  const createResult = (taskId: string, agentId: string, output: string, score: number): TaskResult => ({
    taskId,
    agentId,
    status: 'completed',
    output,
    metadata: { tokensUsed: 100, latencyMs: 2000, toolCalls: [] },
    qualityScore: score,
    timestamp: Date.now(),
  });

  test('sequential append merges in order', () => {
    const config: MergeConfig = {
      strategy: 'sequential_append',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.5,
    };
    const merger = new ResultMerger(config);
    const results = [
      createResult('sub-1', 'agent-a', '# Introduction\nThis is intro.', 0.9),
      createResult('sub-2', 'agent-b', '# Methods\nWe used X.', 0.8),
    ];
    const merged = merger.merge(results);
    expect(merged.mergedOutput).toContain('Introduction');
    expect(merged.mergedOutput).toContain('Methods');
    expect(merged.finalScore).toBeCloseTo(0.85, 1);
  });

  test('voting dedup picks majority claims', () => {
    const config: MergeConfig = {
      strategy: 'voting_dedup',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.5,
    };
    const merger = new ResultMerger(config);
    const results = [
      createResult('sub-1', 'agent-a', 'The sky is blue. Water is wet.', 0.9),
      createResult('sub-2', 'agent-b', 'The sky is blue. Fire is hot.', 0.8),
      createResult('sub-3', 'agent-c', 'The sky is blue. Water is wet.', 0.85),
    ];
    const merged = merger.merge(results);
    expect(merged.mergedOutput).toContain('sky is blue');
    expect(merged.mergedOutput).toContain('water is wet');
  });

  test('expert review selects highest score as expert', () => {
    const config: MergeConfig = {
      strategy: 'expert_review',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.5,
    };
    const merger = new ResultMerger(config);
    const results = [
      createResult('sub-1', 'agent-a', 'Conclusion: X is true.', 0.95),
      createResult('sub-2', 'agent-b', 'Conclusion: X is false.', 0.6),
    ];
    const merged = merger.merge(results);
    expect(merged.mergedOutput).toContain('X is true');
    expect(merged.conflicts.length).toBeGreaterThan(0);
  });

  test('hierarchical synthesis categorizes layers', () => {
    const config: MergeConfig = {
      strategy: 'hierarchical_synthesis',
      conflictResolution: 'highest_score',
      qualityThreshold: 0.5,
    };
    const merger = new ResultMerger(config);
    const results = [
      createResult('sub-1', 'agent-a', 'Raw data: 100 samples collected.', 0.8),
      createResult('sub-2', 'agent-b', 'Analysis suggests correlation is 0.9.', 0.85),
      createResult('sub-3', 'agent-c', 'In summary, the hypothesis is confirmed.', 0.9),
    ];
    const merged = merger.merge(results);
    expect(merged.mergedOutput).toContain('Data Layer');
    expect(merged.mergedOutput).toContain('Analysis Layer');
    expect(merged.mergedOutput).toContain('Conclusion Layer');
  });
});
