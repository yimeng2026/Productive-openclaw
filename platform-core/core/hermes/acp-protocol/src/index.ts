export * from './types';
export { TaskDecomposer } from './TaskDecomposer';
export { CapabilityMatcher } from './CapabilityMatcher';
export { MessageRouter } from './MessageRouter';
export { ResultMerger } from './ResultMerger';
export { ErrorRecovery } from './ErrorRecovery';
export { TimeoutDegradation } from './TimeoutDegradation';
export { SwarmCoordinator } from './SwarmCoordinator';
export {
  MessageFactory,
  MessageValidator,
  MemoryInbox,
} from './CrossPlatformMessage';
export {
  BridgeFactory,
  InMemoryBridge,
  HTTPBridge,
  BasePlatformBridge,
} from './CrossPlatformBridge';

// ── Adapters ──────────────────────────────────────────────
export {
  PlatformAdapter,
  makeAgentAddress,
  messageTypeCategory,
  createMinimalSubTask,
  createMinimalTaskResult,
} from './adapters/types';

export {
  OpenClawAdapter,
  OpenClawFrame,
  OpenClawHeader,
  OpenClawFrameType,
} from './adapters/OpenClawAdapter';

export {
  ClaudeAdapter,
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeRole,
} from './adapters/ClaudeAdapter';

export {
  HermesAdapter,
  HermesACPMessage,
} from './adapters/HermesAdapter';

export {
  OllamaAdapter,
  OllamaRequest,
  OllamaResponse,
  ollamaResponseToUnified,
} from './adapters/OllamaAdapter';

export {
  AdapterRegistry,
  globalRegistry,
} from './adapters/AdapterRegistry';
