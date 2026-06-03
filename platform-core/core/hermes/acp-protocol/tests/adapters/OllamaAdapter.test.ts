import { MessageFactory } from '../../src/CrossPlatformMessage';
import { OllamaAdapter, OllamaResponse, ollamaResponseToUnified } from '../../src/adapters/OllamaAdapter';
import { createMinimalSubTask } from '../../src/adapters/types';

describe('OllamaAdapter', () => {
  const adapter = new OllamaAdapter('llama3', 'You are a swarm node.');

  test('toNative converts task_request → generate request with system + prompt', () => {
    const subtask = createMinimalSubTask('st-ol-1', 'Summarize QFT', 'researcher', 'ollama');
    const msg = MessageFactory.taskRequest(
      'task-qft',
      { agentId: 'coordinator', platform: 'generic' },
      { agentId: 'agent-ol', platform: 'ollama' },
      { subtask, context: 'For undergrads', dependencies: {} }
    );

    const req = adapter.toNative(msg);
    expect(req.model).toBe('llama3');
    expect(req.system).toBe('You are a swarm node.');
    expect(req.prompt).toContain('Summarize QFT');
    expect(req.prompt).toContain('task-qft');
    expect(req.stream).toBe(false);
    expect(req.options?.swarm_task_id).toBe('task-qft');
  });

  test('toNative converts heartbeat → prompt with status info', () => {
    const hb = MessageFactory.heartbeat(
      'task-hb',
      { agentId: 'agent-ol', platform: 'ollama' },
      { agentStatus: 'healthy', queueDepth: 2, loadFactor: 0.3 }
    );

    const req = adapter.toNative(hb);
    expect(req.prompt).toContain('[heartbeat]');
    expect(req.prompt).toContain('status=healthy');
    expect(req.prompt).toContain('queue=2');
  });

  test('fromNative converts Ollama response text → task_result', () => {
    // Adapter.fromNative accepts an OllamaRequest-shaped object where
    // the prompt field carries the response text (set by caller after HTTP).
    const responseLike = {
      model: 'llama3',
      prompt: 'The energy levels are quantized...',
      system: 'You are a swarm node.',
      stream: false,
      options: {
        swarm_task_id: 'task-qft',
        swarm_msg_id: 'msg-77',
      },
    };

    const restored = adapter.fromNative(responseLike);
    expect(restored.type).toBe('task_result');
    expect(restored.taskId).toBe('task-qft');
    expect(restored.from.agentId).toBe('ollama-local');
    expect(restored.from.platform).toBe('ollama');

    const payload = restored.payload as { result: { output: string } };
    expect(payload.result.output).toBe('The energy levels are quantized...');
  });

  test('injectAuth is a no-op for Ollama (local service)', () => {
    const msg = MessageFactory.heartbeat(
      'hb',
      { agentId: 'agent-ol', platform: 'ollama' },
      { agentStatus: 'healthy', queueDepth: 0, loadFactor: 0 }
    );
    const req = adapter.toNative(msg);
    const authed = adapter.injectAuth(req, 'ignored-token');
    // Should return the same object (or an identical copy)
    expect(authed.model).toBe(req.model);
    expect(authed.prompt).toBe(req.prompt);
    expect(authed.system).toBe(req.system);
  });

  test('toNative converts error → prompt with error details', () => {
    const err = MessageFactory.error(
      'task-err',
      { agentId: 'agent-ol', platform: 'ollama' },
      { agentId: 'coordinator', platform: 'generic' },
      {
        code: 'ERR_OOM',
        message: 'Out of memory during inference',
        recoverable: true,
        suggestedAction: 'retry',
        context: { gpu: '8GB' },
      }
    );

    const req = adapter.toNative(err);
    expect(req.prompt).toContain('[error]');
    expect(req.prompt).toContain('ERR_OOM');
    expect(req.prompt).toContain('retry');
  });

  test('ollamaResponseToUnified converts real HTTP response shape', () => {
    const response: OllamaResponse = {
      model: 'llama3',
      response: '42 is the answer.',
      done: true,
      created_at: '2024-01-01T00:00:00Z',
      eval_count: 15,
    };

    const unified = ollamaResponseToUnified(response, 'task-life');
    expect(unified.type).toBe('task_result');
    expect(unified.taskId).toBe('task-life');
    expect(unified.from.platform).toBe('ollama');

    const payload = unified.payload as { result: { output: string } };
    expect(payload.result.output).toBe('42 is the answer.');
  });

  test('fromNative detects heartbeat marker in response text', () => {
    const responseLike = {
      model: 'llama3',
      prompt: '[heartbeat] status=busy queue=7 load=0.91',
      system: '',
      stream: false,
      options: {},
    };

    const restored = adapter.fromNative(responseLike);
    expect(restored.type).toBe('heartbeat');
    const payload = restored.payload as { agentStatus: string; queueDepth: number };
    expect(payload.agentStatus).toBe('healthy'); // fallback default
    expect(payload.queueDepth).toBe(0); // fallback default
  });

  test('toNative includes passthrough swarm metadata in options', () => {
    const subtask = createMinimalSubTask('st-meta', 'Meta test', 'analyst', 'ollama');
    const msg = MessageFactory.create(
      'task-meta',
      { agentId: 'coordinator', platform: 'generic' },
      { agentId: 'agent-ol', platform: 'ollama' },
      'task_request',
      { subtask, context: '', dependencies: {} },
      60000,
      9
    );
    msg.retryCount = 2;

    const req = adapter.toNative(msg);
    expect(req.options?.swarm_msg_id).toBe(msg.id);
    expect(req.options?.swarm_task_id).toBe('task-meta');
    expect(req.options?.swarm_priority).toBe(9);
    expect(req.options?.swarm_retry_count).toBe(2);
    expect(req.options?.swarm_deadline).toBe(msg.deadline);
  });
});
