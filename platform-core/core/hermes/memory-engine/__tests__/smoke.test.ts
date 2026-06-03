import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HermesEngine,
  MemoryScanner,
  MemoryFossilizer,
  SkillForge,
  CodeGrowth,
  AntiForgetting,
} from '../src/index';

describe('HermesEngine smoke tests', () => {
  let engine: HermesEngine;

  beforeEach(() => {
    engine = new HermesEngine({
      scanIntervalMs: 60000,
      fossilizeTrigger: 'manual', // no auto timer
    });
  });

  afterEach(() => {
    engine.stop();
    engine.destroySwarm();
  });

  it('module exports should be defined', () => {
    expect(HermesEngine).toBeDefined();
    expect(MemoryScanner).toBeDefined();
    expect(MemoryFossilizer).toBeDefined();
    expect(SkillForge).toBeDefined();
    expect(CodeGrowth).toBeDefined();
    expect(AntiForgetting).toBeDefined();
  });

  it('should instantiate with default options', () => {
    expect(engine).toBeDefined();
    expect(engine).toBeInstanceOf(HermesEngine);
  });

  it('should get swarm stats', () => {
    const stats = engine.getSwarmStats();
    expect(stats).toBeDefined();
    expect(stats.agentCount).toBe(0);
    expect(stats.totalTasks).toBe(0);
    expect(stats.idleAgents).toBe(0);
  });

  it('should spawn a swarm agent', () => {
    const id = engine.spawnKimiAgent('scanner', 'test-agent');
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    const stats = engine.getSwarmStats();
    expect(stats.agentCount).toBe(1);
    expect(stats.idleAgents).toBe(1);
  });

  it('should submit a task to swarm', () => {
    engine.spawnKimiAgent('writer', 'test-writer');
    const taskId = engine.submitToSwarm('test-task', { data: 'hello' });
    expect(taskId).toBeDefined();
    expect(typeof taskId).toBe('string');

    const stats = engine.getSwarmStats();
    expect(stats.totalTasks).toBeGreaterThan(0);
  });

  it('should get knowledge graph status', async () => {
    const status = await engine.getKnowledgeGraphStatus();
    expect(status).toBeDefined();
    expect(typeof status.nodeCount).toBe('number');
    expect(typeof status.edgeCount).toBe('number');
    expect(Array.isArray(status.topConcepts)).toBe(true);
  });

  it('should query knowledge graph', async () => {
    const results = await engine.queryKnowledge('memory', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it('should generate a scan report', async () => {
    const report = await engine.scanAndReport();
    expect(typeof report).toBe('string');
    expect(report).toContain('Hermes');
  });
});
