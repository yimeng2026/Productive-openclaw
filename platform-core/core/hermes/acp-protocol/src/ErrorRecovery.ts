import {
  ErrorConfig,
  CircuitState,
  Platform,
  CrossPlatformMessage,
  RetryPayload,
} from './types';
import { MessageFactory } from './CrossPlatformMessage';

// ============================================================
// Error Recovery & Retry Handler
// ============================================================
// Failure detection: timeout | error code | low quality score
// Retry chain: same-platform swap agent → cross-platform fallback → human
// Circuit breaker: 3 consecutive failures → platform paused 30s
// Compensation: failed subtask → simplified substitute

export class ErrorRecovery {
  private config: ErrorConfig;
  private circuits = new Map<Platform, CircuitState>();

  constructor(config: ErrorConfig) {
    this.config = config;
  }

  /**
   * Main handler: classify failure and decide action.
   */
  handleFailure(
    msg: CrossPlatformMessage,
    platform: Platform,
    errorCode?: string,
    qualityScore?: number
  ): FailureDecision {
    const now = Date.now();

    // 1. Detect failure type
    const failureType = this.classifyFailure(msg, errorCode, qualityScore);

    // 2. Update circuit breaker
    this.recordFailure(platform, now);

    // 3. Decide recovery path
    const decision = this.decideRecovery(failureType, platform, msg);

    // 4. Build retry or compensation message
    if (decision.action === 'retry') {
      decision.retryMessage = this.buildRetryMessage(msg, decision.delayMs);
    }

    return decision;
  }

  /**
   * Check if platform is currently usable (circuit closed).
   */
  isPlatformAvailable(platform: Platform): boolean {
    const cb = this.circuits.get(platform);
    if (!cb) return true;
    const now = Date.now();

    if (cb.state === 'open') {
      if (now >= cb.nextAttemptAt) {
        cb.state = 'half_open';
        return true; // allow probe
      }
      return false;
    }

    return true;
  }

  /**
   * Mark platform as healthy (reset circuit).
   */
  markHealthy(platform: Platform): void {
    const cb = this.circuits.get(platform);
    if (cb) {
      cb.failures = 0;
      cb.state = 'closed';
      cb.lastFailureAt = 0;
    }
  }

  // ---- Failure classification ----

  private classifyFailure(
    msg: CrossPlatformMessage,
    errorCode?: string,
    qualityScore?: number
  ): FailureType {
    const expired = Date.now() > msg.deadline;

    if (expired) return 'timeout';
    if (errorCode?.startsWith('ERR_')) return 'agent_error';
    if ((qualityScore ?? 1) < 0.3) return 'low_quality';
    if (msg.type === 'error') return 'agent_error';

    return 'unknown';
  }

  // ---- Circuit breaker logic ----

  private recordFailure(platform: Platform, now: number): void {
    let cb = this.circuits.get(platform);
    if (!cb) {
      cb = {
        platform,
        failures: 0,
        lastFailureAt: 0,
        state: 'closed',
        nextAttemptAt: 0,
      };
      this.circuits.set(platform, cb);
    }

    cb.failures++;
    cb.lastFailureAt = now;

    if (cb.failures >= this.config.circuitBreakerThreshold) {
      cb.state = 'open';
      cb.nextAttemptAt = now + this.config.circuitBreakerResetMs;
    }
  }

  // ---- Recovery decision tree ----

  private decideRecovery(
    failureType: FailureType,
    platform: Platform,
    msg: CrossPlatformMessage
  ): FailureDecision {
    const cb = this.circuits.get(platform);
    const tooManyRetries = msg.retryCount >= this.config.maxRetries;
    const platformBlocked = cb?.state === 'open';

    if (!tooManyRetries && !platformBlocked) {
      // Retry on same platform with delay
      const delay = Math.min(
        this.config.retryDelayMs * Math.pow(2, msg.retryCount),
        30000
      );
      return {
        action: 'retry',
        targetPlatform: platform,
        delayMs: delay,
        reason: `${failureType}: retry #${msg.retryCount + 1}`,
        retryMessage: null,
      };
    }

    if (!tooManyRetries && platformBlocked) {
      // Cross-platform fallback
      return {
        action: 'reassign',
        targetPlatform: this.pickFallback(platform),
        delayMs: 0,
        reason: `${failureType}: circuit open, reassigning`,
        retryMessage: null,
      };
    }

    if (tooManyRetries) {
      return {
        action: 'degrade',
        targetPlatform: platform,
        delayMs: 0,
        reason: `${failureType}: max retries exceeded, degrading task`,
        retryMessage: null,
      };
    }

    // Last resort
    return {
      action: 'escalate',
      targetPlatform: platform,
      delayMs: 0,
      reason: `${failureType}: unrecoverable, escalate to human`,
      retryMessage: null,
    };
  }

  private pickFallback(platform: Platform): Platform {
    const fallbackMap: Record<Platform, Platform[]> = {
      openclaw: ['claude', 'hermes', 'generic'],
      hermes: ['openclaw', 'generic', 'claude'],
      claude: ['openclaw', 'hermes', 'generic'],
      ollama: ['openclaw', 'claude', 'hermes', 'generic'],
      generic: ['openclaw', 'claude', 'hermes', 'ollama'],
    };
    const candidates = fallbackMap[platform] ?? ['generic'];
    for (const p of candidates) {
      if (this.isPlatformAvailable(p)) return p;
    }
    return 'generic';
  }

  private buildRetryMessage(
    original: CrossPlatformMessage,
    delayMs: number
  ): CrossPlatformMessage {
    const retryPayload: RetryPayload = {
      originalMessageId: original.id,
      reason: 'failure_recovery',
      delayMs,
    };

    return MessageFactory.create(
      original.taskId,
      original.to, // now becomes from (the retrying agent)
      original.from, // target the original sender
      'retry',
      retryPayload,
      delayMs + 30000,
      8
    );
  }

  getCircuitStates(): CircuitState[] {
    return Array.from(this.circuits.values());
  }
}

// ---- Types ----

type FailureType = 'timeout' | 'agent_error' | 'low_quality' | 'unknown';

interface FailureDecision {
  action: 'retry' | 'reassign' | 'degrade' | 'escalate';
  targetPlatform: Platform;
  delayMs: number;
  reason: string;
  retryMessage: CrossPlatformMessage | null;
}
