import { MessageFactory } from '../../src/CrossPlatformMessage';
import { HermesAdapter, HermesACPMessage } from '../../src/adapters/HermesAdapter';
import { createMinimalSubTask, createMinimalTaskResult } from '../../src/adapters/types';

describe('HermesAdapter', () => {
  const adapter = new HermesAdapter();

  test('toNative converts task_request → team_send_message JSON-RPC', () => {
    const subtask = createMinimalSubTask('st-hm-1', 'Refactor monolith to microservices', 'coder', 'hermes');
    const msg = MessageFactory.taskRequest(
      'task-refactor',
      { agentId: 'coordinator', platform: 'generic' },
      { agentId: 'agent-hm', platform: 'hermes' },
      { subtask, context: 'Use Rust', dependencies: {} }
    );

    const acp = adapter.toNative(msg);
    expect(acp.jsonrpc).toBe('2.0');
    expect(acp.method).toBe('team_send_message');
    expect(acp.id).toBe(msg.id); // requests carry id
    expect(acp.params?.task_id).toBe('task-refactor');
    expect(acp.params?.sender_id).toBe('coordinator');
    expect(acp.params?.recipient_id).toBe('agent-hm');
    expect(acp.params?.subtask).toBeDefined();
  });

  test('toNative converts task_result → session/update notification', () => {
    const result = createMinimalTaskResult('task-refactor', 'agent-hm', 'Done.');
    const msg = MessageFactory.taskResult(
      'task-refactor',
      { agentId: 'agent-hm', platform: 'hermes' },
      { agentId: 'coordinator', platform: 'generic' },
      { result }
    );

    const acp = adapter.toNative(msg);
    expect(acp.method).toBe('session/update');
    expect(acp.id).toBeUndefined(); // notifications omit id
    expect(acp.params?.output).toBe('Done.');
  });

  test('fromNative restores unified message from JSON-RPC request', () => {
    const acpMsg: HermesACPMessage = {
      jsonrpc: '2.0',
      id: 'rpc-42',
      method: 'team_send_message',
      params: {
        task_id: 'task-42',
        sender_id: 'hermes-bot',
        sender_platform: 'hermes',
        recipient_id: 'coordinator',
        recipient_platform: 'generic',
        subtask: { id: 'st-99', description: 'Deploy to staging' },
        context: 'CI passed',
        dependencies: {},
        priority: 8,
        timestamp: 1700000000000,
        deadline: 1700000030000,
        retry_count: 1,
      },
    };

    const restored = adapter.fromNative(acpMsg);
    expect(restored.type).toBe('task_request');
    expect(restored.id).toBe('rpc-42');
    expect(restored.taskId).toBe('task-42');
    expect(restored.from.agentId).toBe('hermes-bot');
    expect(restored.to.agentId).toBe('coordinator');
    expect(restored.priority).toBe(8);
    expect(restored.retryCount).toBe(1);

    const payload = restored.payload as { subtask: { description: string } };
    expect(payload.subtask.description).toBe('Deploy to staging');
  });

  test('fromNative restores heartbeat from session/heartbeat', () => {
    const acpMsg: HermesACPMessage = {
      jsonrpc: '2.0',
      method: 'session/heartbeat',
      params: {
        task_id: 'hb-1',
        agent_status: 'overloaded',
        queue_depth: 12,
        load_factor: 0.95,
      },
    };

    const restored = adapter.fromNative(acpMsg);
    expect(restored.type).toBe('heartbeat');
    const payload = restored.payload as { agentStatus: string; queueDepth: number; loadFactor: number };
    expect(payload.agentStatus).toBe('overloaded');
    expect(payload.queueDepth).toBe(12);
    expect(payload.loadFactor).toBe(0.95);
  });

  test('injectAuth adds acp_token to params', () => {
    const subtask = createMinimalSubTask('st-hm-auth', 'Secret mission', 'coder', 'hermes');
    const msg = MessageFactory.taskRequest(
      'task-secret',
      { agentId: 'coordinator', platform: 'generic' },
      { agentId: 'agent-hm', platform: 'hermes' },
      { subtask, context: 'Need auth', dependencies: {} }
    );

    const acp = adapter.toNative(msg);
    const authed = adapter.injectAuth(acp, 'super-secret-token');
    expect(authed.params?.acp_token).toBe('super-secret-token');
    // Original params preserved
    expect(authed.params?.task_id).toBe('task-secret');
  });

  test('toNative maps error → session/error notification', () => {
    const err = MessageFactory.error(
      'task-err',
      { agentId: 'agent-hm', platform: 'hermes' },
      { agentId: 'coordinator', platform: 'generic' },
      {
        code: 'ERR_HERMES_CRASH',
        message: 'Segmentation fault',
        recoverable: false,
        suggestedAction: 'escalate',
        context: { signal: 'SIGSEGV' },
      }
    );

    const acp = adapter.toNative(err);
    expect(acp.method).toBe('session/error');
    expect(acp.id).toBeUndefined();
    expect(acp.params?.error_code).toBe('ERR_HERMES_CRASH');
    expect(acp.params?.recoverable).toBe(false);
    expect(acp.params?.suggested_action).toBe('escalate');
  });

  test('fromNative handles JSON-RPC error response frame', () => {
    const acpMsg: HermesACPMessage = {
      jsonrpc: '2.0',
      id: 'rpc-fail',
      error: {
        code: -32600,
        message: 'Invalid Request',
        data: { detail: 'missing method' },
      },
    };

    const restored = adapter.fromNative(acpMsg);
    // Error responses without method default to task_request fallback
    expect(restored.id).toBe('rpc-fail');
    expect(restored.type).toBe('task_request');
  });
});
