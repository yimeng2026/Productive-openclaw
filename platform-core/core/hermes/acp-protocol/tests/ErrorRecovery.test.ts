import { ErrorRecovery } from '../src/ErrorRecovery';
import { MessageFactory, MessageValidator } from '../src/CrossPlatformMessage';
import { ErrorConfig, CrossPlatformMessage, AgentAddress } from '../src/types';

describe('ErrorRecovery', () => {
  const config: ErrorConfig = {
    maxRetries: 2,
    retryDelayMs: 1000,
    circuitBreakerThreshold: 3,
    circuitBreakerResetMs: 30000,
    escalationTimeoutMs: 60000,
  };

  const createMessage = (taskId: string, platform: string, retryCount: number = 0): CrossPlatformMessage => {
    const from: AgentAddress = { agentId: 'coordinator', platform: 'openclaw' };
    const to: AgentAddress = { agentId: 'agent-1', platform: platform as any };
    const msg = MessageFactory.create(
      taskId,
      from,
      to,
      'task_request',
      { subtask: {} as any, context: '', dependencies: {} },
      5000,
      5
    );
    msg.retryCount = retryCount;
    // Override deadline to simulate future
    msg.deadline = Date.now() + 10000;
    return msg;
  };

  test('classifies timeout when deadline passed', () => {
    const recovery = new ErrorRecovery(config);
    const msg = createMessage('t1', 'openclaw');
    msg.deadline = Date.now() - 1000; // expired

    const decision = recovery.handleFailure(msg, 'openclaw');
    expect(decision.action).toBe('retry');
    expect(decision.reason).toContain('timeout');
  });

  test('opens circuit after 3 failures', () => {
    const recovery = new ErrorRecovery(config);
    const msg = createMessage('t1', 'openclaw');

    // 3 failures
    recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');
    recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');
    recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');

    expect(recovery.isPlatformAvailable('openclaw')).toBe(false);
  });

  test('reassigns when circuit open', () => {
    const recovery = new ErrorRecovery(config);
    const msg = createMessage('t1', 'openclaw', 0);

    // Open circuit
    recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');
    recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');
    recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');

    const decision = recovery.handleFailure(msg, 'openclaw', 'ERR_AGENT');
    expect(decision.action).toBe('reassign');
  });

  test('escalates after max retries', () => {
    const recovery = new ErrorRecovery(config);
    const msg = createMessage('t1', 'openclaw', 2); // already at max
    msg.deadline = Date.now() - 1000;

    const decision = recovery.handleFailure(msg, 'openclaw');
    expect(decision.action).toBe('degrade');
  });
});
