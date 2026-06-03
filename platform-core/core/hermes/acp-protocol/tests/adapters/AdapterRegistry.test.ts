import { AdapterRegistry } from '../../src/adapters/AdapterRegistry';
import { OpenClawAdapter } from '../../src/adapters/OpenClawAdapter';
import { ClaudeAdapter } from '../../src/adapters/ClaudeAdapter';
import { HermesAdapter } from '../../src/adapters/HermesAdapter';
import { OllamaAdapter } from '../../src/adapters/OllamaAdapter';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  test('register and getAdapter round-trip', () => {
    const oc = new OpenClawAdapter();
    registry.register('openclaw', oc);

    const retrieved = registry.getAdapter('openclaw');
    expect(retrieved.platform).toBe('openclaw');
    expect(retrieved.endpoint).toBe('ws://127.0.0.1:18679');
  });

  test('resolveForMessage selects adapter by msg.to.platform', () => {
    registry.register('openclaw', new OpenClawAdapter());
    registry.register('claude', new ClaudeAdapter());
    registry.register('hermes', new HermesAdapter());
    registry.register('ollama', new OllamaAdapter());

    const msg = {
      id: 'msg-1',
      taskId: 'task-1',
      from: { agentId: 'coord', platform: 'generic' as const },
      to: { agentId: 'agent-cl', platform: 'claude' as const },
      type: 'task_request' as const,
      payload: { subtask: null as any, context: '', dependencies: {} },
      timestamp: Date.now(),
      deadline: Date.now() + 30000,
      retryCount: 0,
      priority: 5,
    };

    const adapter = registry.resolveForMessage(msg);
    expect(adapter.platform).toBe('claude');
  });

  test('getAdapter throws for unregistered platform', () => {
    expect(() => registry.getAdapter('openclaw')).toThrow('No adapter registered');
  });

  test('has returns true only for registered platforms', () => {
    expect(registry.has('openclaw')).toBe(false);
    registry.register('openclaw', new OpenClawAdapter());
    expect(registry.has('openclaw')).toBe(true);
    expect(registry.has('claude')).toBe(false);
  });

  test('listPlatforms returns all registered keys', () => {
    registry.register('openclaw', new OpenClawAdapter());
    registry.register('claude', new ClaudeAdapter());
    registry.register('hermes', new HermesAdapter());
    registry.register('ollama', new OllamaAdapter());

    const platforms = registry.listPlatforms();
    expect(platforms).toContain('openclaw');
    expect(platforms).toContain('claude');
    expect(platforms).toContain('hermes');
    expect(platforms).toContain('ollama');
    expect(platforms.length).toBe(4);
  });

  test('unregister removes an adapter', () => {
    registry.register('openclaw', new OpenClawAdapter());
    expect(registry.has('openclaw')).toBe(true);

    const removed = registry.unregister('openclaw');
    expect(removed).toBe(true);
    expect(registry.has('openclaw')).toBe(false);
  });

  test('clear removes all adapters', () => {
    registry.register('openclaw', new OpenClawAdapter());
    registry.register('claude', new ClaudeAdapter());
    registry.clear();

    expect(registry.has('openclaw')).toBe(false);
    expect(registry.has('claude')).toBe(false);
    expect(registry.listPlatforms().length).toBe(0);
  });
});
