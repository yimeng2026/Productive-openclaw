import { describe, it, expect, vi } from 'vitest';

// Mock workspace dependencies to keep smoke tests isolated
vi.mock('@sylva/types', () => ({}));
vi.mock('@sylva/utils', () => ({}));
vi.mock('@sylva/security-shield', () => ({}));
vi.mock('@sylva/orchestrator', () => ({}));

describe('hermes-mind smoke', () => {
  it('module imports without error', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    expect(mod.HermesEngine).toBeDefined();
    expect(mod.MemoryScanner).toBeDefined();
    expect(mod.MemoryFossilizer).toBeDefined();
    expect(mod.SkillForge).toBeDefined();
    expect(mod.CodeGrowth).toBeDefined();
    expect(mod.AntiForgetting).toBeDefined();
    expect(mod.KnowledgeGraph).toBeDefined();
  });

  it('HermesEngine can be instantiated', async () => {
    const { HermesEngine } = await import('../index');
    const engine = new HermesEngine();
    expect(engine).toBeInstanceOf(HermesEngine);
  });

  it('MemoryScanner can scan and return patterns', async () => {
    const { MemoryScanner } = await import('../index');
    const scanner = new MemoryScanner();
    const result = await scanner.scan('test input');
    expect(result).toBeDefined();
  });
});
