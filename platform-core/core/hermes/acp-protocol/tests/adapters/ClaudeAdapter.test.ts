import { MessageFactory } from '../../src/CrossPlatformMessage';
import { ClaudeAdapter } from '../../src/adapters/ClaudeAdapter';
import { createMinimalSubTask, createMinimalTaskResult } from '../../src/adapters/types';

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  test('toNative converts task_request → tool_use block', () => {
    const subtask = createMinimalSubTask('st-claude-1', 'Write a poem about recursion', 'writer', 'claude');
    const msg = MessageFactory.taskRequest(
      'task-poem',
      { agentId: 'coordinator', platform: 'generic' },
      { agentId: 'agent-cl', platform: 'claude' },
      { subtask, context: 'Be creative', dependencies: {} }
    );

    const claude = adapter.toNative(msg);
    expect(claude.role).toBe('user');
    expect(claude.content.length).toBe(1);

    const block = claude.content[0];
    expect(block.type).toBe('tool_use');
    if (block.type === 'tool_use') {
      expect(block.name).toBe('execute_subtask');
      expect(block.input.description).toBe('Write a poem about recursion');
      expect(block.input.taskId).toBe('task-poem');
    }
  });

  test('toNative converts task_result → tool_result block', () => {
    const result = createMinimalTaskResult('task-poem', 'agent-cl', 'Roses are red, recursion is blue...');
    const msg = MessageFactory.taskResult(
      'task-poem',
      { agentId: 'agent-cl', platform: 'claude' },
      { agentId: 'coordinator', platform: 'generic' },
      { result }
    );

    const claude = adapter.toNative(msg);
    expect(claude.content.length).toBe(1);
    const block = claude.content[0];
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.content).toBe('Roses are red, recursion is blue...');
    }
  });

  test('fromNative restores task_request from tool_use block', () => {
    const claudeMsg = {
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: 'tool-123',
          name: 'execute_subtask',
          input: {
            taskId: 'task-restore',
            subtaskId: 'st-77',
            description: 'Analyze complexity',
            context: 'Big-O analysis',
          },
        },
      ],
    };

    const restored = adapter.fromNative(claudeMsg);
    expect(restored.type).toBe('task_request');
    expect(restored.taskId).toBe('task-restore');
    expect(restored.id).toBe('tool-123');

    const payload = restored.payload as { subtask: { description: string; id: string } };
    expect(payload.subtask.description).toBe('Analyze complexity');
    expect(payload.subtask.id).toBe('st-77');
  });

  test('fromNative restores task_result from tool_result block', () => {
    const claudeMsg = {
      role: 'assistant' as const,
      content: [
        {
          type: 'tool_result' as const,
          tool_use_id: 'task-99',
          content: 'O(n log n)',
        },
      ],
    };

    const restored = adapter.fromNative(claudeMsg);
    expect(restored.type).toBe('task_result');
    expect(restored.taskId).toBe('task-99');

    const payload = restored.payload as { result: { output: string } };
    expect(payload.result.output).toBe('O(n log n)');
  });

  test('injectAuth stores apiKey in _metadata', () => {
    const msg = MessageFactory.heartbeat(
      'hb',
      { agentId: 'agent-cl', platform: 'claude' },
      { agentStatus: 'healthy', queueDepth: 0, loadFactor: 0 }
    );
    const claude = adapter.toNative(msg);
    const authed = adapter.injectAuth(claude, 'sk-ant-secret');
    expect(authed._metadata?.apiKey).toBe('sk-ant-secret');
  });

  test('heartbeat maps to text block with status info', () => {
    const hb = MessageFactory.heartbeat(
      'task-hb',
      { agentId: 'agent-cl', platform: 'claude' },
      { agentStatus: 'busy', queueDepth: 5, loadFactor: 0.85 }
    );
    const claude = adapter.toNative(hb);
    expect(claude.content.length).toBe(1);
    const block = claude.content[0];
    expect(block.type).toBe('text');
    if (block.type === 'text') {
      expect(block.text).toContain('heartbeat');
      expect(block.text).toContain('busy');
      expect(block.text).toContain('5');
    }
  });

  test('error message maps to text block with error details', () => {
    const err = MessageFactory.error(
      'task-err',
      { agentId: 'agent-cl', platform: 'claude' },
      { agentId: 'coordinator', platform: 'generic' },
      {
        code: 'ERR_RATE_LIMIT',
        message: 'Too many requests',
        recoverable: true,
        suggestedAction: 'retry',
        context: {},
      }
    );
    const claude = adapter.toNative(err);
    const block = claude.content[0];
    expect(block.type).toBe('text');
    if (block.type === 'text') {
      expect(block.text).toContain('ERR_RATE_LIMIT');
      expect(block.text).toContain('retry');
    }
  });

  test('fromNative falls back to task_result for plain text without markers', () => {
    const claudeMsg = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Just a regular response.' }],
    };
    const restored = adapter.fromNative(claudeMsg);
    expect(restored.type).toBe('task_result');
    const payload = restored.payload as { result: { output: string } };
    expect(payload.result.output).toBe('Just a regular response.');
  });
});
