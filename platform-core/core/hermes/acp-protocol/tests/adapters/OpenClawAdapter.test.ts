import { MessageFactory } from '../../src/CrossPlatformMessage';
import { OpenClawAdapter, OpenClawFrame } from '../../src/adapters/OpenClawAdapter';
import { createMinimalSubTask } from '../../src/adapters/types';

describe('OpenClawAdapter', () => {
  const adapter = new OpenClawAdapter();

  // ── Helper to build a task_request message ─────────────────
  const makeTaskRequest = () => {
    const subtask = createMinimalSubTask('st-42', 'Compute factorial of 202712', 'coder', 'openclaw');
    return MessageFactory.taskRequest(
      'task-99',
      { agentId: 'coordinator', platform: 'generic' },
      { agentId: 'agent-oc', platform: 'openclaw', endpoint: adapter.endpoint },
      { subtask, context: 'urgent', dependencies: {} }
    );
  };

  test('toNative converts task_request → req frame with fn field', () => {
    const msg = makeTaskRequest();
    const frame = adapter.toNative(msg);

    expect(frame.type).toBe('req');
    expect(frame.header.id).toBe(msg.id);
    expect(frame.header.taskId).toBe('task-99');
    expect(frame.header.from.agentId).toBe('coordinator');
    expect(frame.header.to.agentId).toBe('agent-oc');
    expect(frame.header.to.platform).toBe('openclaw');
    expect(frame.header.fn).toBe('Compute factorial of 202712');
    expect(frame.header.payloadCategory).toBe('request');

    // Verify payload round-trips
    const parsed = JSON.parse(frame.header.payloadJson);
    expect(parsed.subtask.id).toBe('st-42');
  });

  test('fromNative restores unified message from OpenClaw frame', () => {
    const msg = makeTaskRequest();
    const frame = adapter.toNative(msg);
    const restored = adapter.fromNative(frame);

    expect(restored.id).toBe(msg.id);
    expect(restored.taskId).toBe(msg.taskId);
    expect(restored.type).toBe('task_request');
    expect(restored.from.agentId).toBe('coordinator');
    expect(restored.to.agentId).toBe('agent-oc');
    expect(restored.priority).toBe(msg.priority);

    const payload = restored.payload as { subtask: { description: string } };
    expect(payload.subtask.description).toBe('Compute factorial of 202712');
  });

  test('injectAuth adds Bearer token to header', () => {
    const msg = makeTaskRequest();
    const frame = adapter.toNative(msg);
    const authed = adapter.injectAuth(frame, 'secret-token-123');

    expect(authed.header.auth).toBe('Bearer secret-token-123');
    // Ensure other fields untouched
    expect(authed.type).toBe(frame.type);
    expect(authed.header.id).toBe(frame.header.id);
  });

  test('heartbeat maps to tick frame and back', () => {
    const hb = MessageFactory.heartbeat(
      'task-hb',
      { agentId: 'agent-oc', platform: 'openclaw' },
      { agentStatus: 'healthy', queueDepth: 3, loadFactor: 0.4 }
    );
    const frame = adapter.toNative(hb);
    expect(frame.type).toBe('tick');
    expect(frame.header.payloadCategory).toBe('heartbeat');

    const restored = adapter.fromNative(frame);
    expect(restored.type).toBe('heartbeat');
    const payload = restored.payload as { agentStatus: string; queueDepth: number };
    expect(payload.agentStatus).toBe('healthy');
    expect(payload.queueDepth).toBe(3);
  });

  test('error maps to event frame and back', () => {
    const err = MessageFactory.error(
      'task-err',
      { agentId: 'agent-oc', platform: 'openclaw' },
      { agentId: 'coordinator', platform: 'generic' },
      {
        code: 'ERR_TIMEOUT',
        message: 'Agent did not respond',
        recoverable: true,
        suggestedAction: 'retry',
        context: { elapsed: 30000 },
      }
    );
    const frame = adapter.toNative(err);
    expect(frame.type).toBe('event');

    const restored = adapter.fromNative(frame);
    expect(restored.type).toBe('error');
    const payload = restored.payload as { code: string; recoverable: boolean };
    expect(payload.code).toBe('ERR_TIMEOUT');
    expect(payload.recoverable).toBe(true);
  });

  test('fromNative gracefully handles malformed payloadJson', () => {
    const brokenFrame: OpenClawFrame = {
      type: 'req',
      header: {
        id: 'msg-broken',
        taskId: 'task-broken',
        from: { agentId: 'a', platform: 'openclaw' },
        to: { agentId: 'b', platform: 'generic' },
        fn: 'do-something',
        priority: 5,
        timestamp: Date.now(),
        deadline: Date.now() + 30000,
        retryCount: 0,
        payloadCategory: 'request',
        payloadJson: 'this is not json {{{',
      },
    };

    const restored = adapter.fromNative(brokenFrame);
    expect(restored.id).toBe('msg-broken');
    expect(restored.type).toBe('task_request');
    const payload = restored.payload as { subtask: { description: string } };
    expect(payload.subtask.description).toBe('do-something');
  });
});
