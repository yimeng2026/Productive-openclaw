// ============================================================
// Core Types for Cross-Platform Swarm Framework
// ============================================================

export type Platform = 'openclaw' | 'hermes' | 'claude' | 'ollama' | 'generic';

export type AgentRole = 
  | 'researcher' 
  | 'writer' 
  | 'reviewer' 
  | 'coder' 
  | 'tester' 
  | 'analyst' 
  | 'coordinator'
  | 'visualizer'
  | 'security_scanner';

export type TaskStatus = 
  | 'pending' 
  | 'assigned' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'timeout' 
  | 'degraded';

export type MessageType = 
  | 'task_request' 
  | 'task_result' 
  | 'heartbeat' 
  | 'error' 
  | 'retry' 
  | 'status_query' 
  | 'cancel';

export type MergeStrategy = 
  | 'sequential_append' 
  | 'voting_dedup' 
  | 'expert_review' 
  | 'hierarchical_synthesis';

export type DegradationLevel = 
  | 'full' 
  | 'simplified' 
  | 'placeholder' 
  | 'skip';

// Agent capability manifest
export interface CapabilityManifest {
  agentId: string;
  role: AgentRole;
  platform: Platform;
  skills: Skill[];
  maxTokens: number;
  toolCalling: boolean;
  reasoning: 'none' | 'basic' | 'advanced';
  contextWindow: number;
  specialties: string[];
  performanceMetrics: PerformanceMetrics;
}

export interface Skill {
  name: string;
  level: number; // 0-1
  description: string;
}

export interface PerformanceMetrics {
  avgLatencyMs: number;
  successRate: number; // 0-1
  tasksCompleted: number;
  lastFailureAt: number | null;
  consecutiveFailures: number;
}

// Task definitions
export interface SubTask {
  id: string;
  parentId: string | null;
  description: string;
  role: AgentRole;
  platformPreference: Platform;
  platformFallbacks: Platform[];
  inputDependencies: string[]; // subtask IDs this depends on
  outputFormat: OutputFormat;
  estimatedComplexity: number; // 1-10
  timeoutMs: number;
  degradationChain: DegradationLevel[];
  status: TaskStatus;
  assignedAgentId: string | null;
  result: TaskResult | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface OutputFormat {
  type: 'text' | 'json' | 'markdown' | 'code' | 'structured';
  schema?: Record<string, unknown>; // for structured output
  constraints?: string[];
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  status: TaskStatus;
  output: string;
  metadata: ResultMetadata;
  qualityScore: number; // 0-1
  timestamp: number;
}

export interface ResultMetadata {
  tokensUsed: number;
  latencyMs: number;
  toolCalls: string[];
  reasoningTrace?: string;
}

// Message envelope
export interface CrossPlatformMessage {
  id: string;
  taskId: string;
  from: AgentAddress;
  to: AgentAddress;
  type: MessageType;
  payload: MessagePayload;
  timestamp: number;
  deadline: number;
  retryCount: number;
  priority: number; // 1-10
}

export interface AgentAddress {
  agentId: string;
  platform: Platform;
  endpoint?: string;
}

export type MessagePayload =
  | TaskRequestPayload
  | TaskResultPayload
  | HeartbeatPayload
  | ErrorPayload
  | RetryPayload;

export interface TaskRequestPayload {
  subtask: SubTask;
  context: string;
  dependencies: Record<string, TaskResult>;
}

export interface TaskResultPayload {
  result: TaskResult;
}

export interface HeartbeatPayload {
  agentStatus: 'healthy' | 'busy' | 'overloaded' | 'offline';
  queueDepth: number;
  loadFactor: number; // 0-1
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  suggestedAction: 'retry' | 'degrade' | 'reassign' | 'escalate';
  context: Record<string, unknown>;
}

export interface RetryPayload {
  originalMessageId: string;
  reason: string;
  delayMs: number;
}

// Decomposition
export interface DecompositionResult {
  subtasks: SubTask[];
  dependencyGraph: DependencyGraph;
  executionPlan: ExecutionStage[];
}

export interface DependencyGraph {
  nodes: string[]; // subtask IDs
  edges: [string, string][]; // [from, to] meaning "from must complete before to"
  parallelGroups: string[][];
}

export interface ExecutionStage {
  stage: number;
  subtaskIds: string[];
  canParallel: boolean;
}

// Capability matching
export interface MatchResult {
  agentId: string;
  score: number;
  reason: string;
}

export interface MatchConfig {
  minScore: number;
  preferSamePlatform: boolean;
  fallbackEnabled: boolean;
  maxRetries: number;
}

// Result merging
export interface MergeConfig {
  strategy: MergeStrategy;
  conflictResolution: 'latest' | 'highest_score' | 'expert_arbitration' | 'merge_all';
  qualityThreshold: number;
}

export interface MergeResult {
  mergedOutput: string;
  contributions: Contribution[];
  conflicts: Conflict[];
  finalScore: number;
}

export interface Contribution {
  agentId: string;
  subtaskId: string;
  section: string;
  score: number;
}

export interface Conflict {
  agents: string[];
  topic: string;
  resolutions: string[];
  chosenResolution: string;
}

// Error handling
export interface ErrorConfig {
  maxRetries: number;
  retryDelayMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  escalationTimeoutMs: number;
}

export interface CircuitState {
  platform: Platform;
  failures: number;
  lastFailureAt: number;
  state: 'closed' | 'open' | 'half_open';
  nextAttemptAt: number;
}

// Timeout / degradation
export interface TimeoutConfig {
  simpleTaskMs: number;
  complexTaskMs: number;
  researchTaskMs: number;
}

export interface DegradationPlan {
  original: SubTask;
  degraded: SubTask;
  level: DegradationLevel;
  reason: string;
}

// Coordinator
export interface SwarmConfig {
  platforms: PlatformConfig[];
  agents: CapabilityManifest[];
  matchConfig: MatchConfig;
  errorConfig: ErrorConfig;
  timeoutConfig: TimeoutConfig;
  mergeConfig: MergeConfig;
  maxConcurrentTasks: number;
}

export interface PlatformConfig {
  platform: Platform;
  enabled: boolean;
  endpoint: string;
  weight: number;
  apiKeyEnvVar?: string;
}

export interface SwarmState {
  taskId: string;
  status: 'planning' | 'executing' | 'merging' | 'completed' | 'failed';
  subtasks: SubTask[];
  messages: CrossPlatformMessage[];
  circuitStates: Map<Platform, CircuitState>;
  startTime: number;
  lastUpdate: number;
}

// Bridge
export interface PlatformBridge {
  platform: Platform;
  send(message: CrossPlatformMessage): Promise<void>;
  poll(): Promise<CrossPlatformMessage[]>;
  healthCheck(): Promise<boolean>;
}

export interface BridgeConfig {
  pollIntervalMs: number;
  maxMessageAgeMs: number;
  batchSize: number;
}

// ============================================================
// Extended Types for Core Algorithm Layer
// ============================================================

export interface Job {
  id: string;
  description: string;
  priority: number; // 1-10, higher = more urgent
  requiredRole: AgentRole;
  platformPreference: Platform;
  complexity: number; // 1-10
  dependencies: string[]; // job IDs that must complete first
  timeoutMs: number;
  tags: string[];
}

export interface AgentSpec {
  agentId: string;
  role: AgentRole;
  platform: Platform;
  skills: string[];
  loadFactor: number; // 0-1, current utilization
  maxConcurrent: number;
  performanceScore: number; // 0-1 composite score
  avgLatencyMs: number;
  successRate: number; // 0-1
}

export interface Assignment {
  jobId: string;
  agentId: string;
  priority: number;
  expectedStartTime: number;
  expectedDuration: number;
}

export interface CoordinationPlan {
  planId: string;
  assignments: Assignment[];
  stages: ExecutionStage[];
  estimatedCompletion: number;
  loadDistribution: Record<string, number>; // agentId -> projected load 0-1
  unassignedJobs: string[]; // job IDs that could not be assigned
}

export interface Metrics {
  agentUtilization: Record<string, number>; // agentId -> 0-1
  taskCompletionRates: Record<string, number>; // agentId -> tasks/sec
  avgQueueDepth: number;
  platformHealth: Record<Platform, boolean>;
  averageLatencyMs: number;
  throughput: number; // tasks completed per minute
}

export interface ComplexTask {
  id: string;
  description: string;
  domain: string;
  complexity: number;
  requiredOutputs: OutputFormat[];
  constraints: string[];
}

export interface ComplexityScore {
  score: number; // 1-10
  breakdown: Record<string, number>;
  reasoning: string;
}

export interface Task {
  id: string;
  description: string;
  role: AgentRole;
  requiredSkills: string[];
  platformPreference: Platform;
  complexity: number;
}

export interface Result {
  agentId: string;
  jobId: string;
  output: string;
  qualityScore: number;
  timestamp: number;
}

export interface MergedResult {
  output: string;
  confidence: number;
  consensusLevel: ConsensusLevel;
  contributions: Array<{ agentId: string; weight: number }>;
}

export type ConsensusLevel = 'unanimous' | 'strong' | 'weak' | 'none';

export interface SwarmError {
  code: string;
  message: string;
  platform: Platform;
  jobId: string;
  recoverable: boolean;
  retryCount: number;
}

export interface RecoveryContext {
  activeJobs: Job[];
  availableAgents: AgentSpec[];
  circuitStates: Record<Platform, boolean>;
  failureHistory: Array<{ jobId: string; code: string; timestamp: number }>;
}

export type RecoveryAction =
  | { type: 'retry'; delayMs: number; maxAttempts: number }
  | { type: 'reassign'; targetAgentId: string; fallbackChain: string[] }
  | { type: 'degrade'; level: DegradationLevel; simplifiedJob: Job }
  | { type: 'escalate'; reason: string; notify: boolean };

export interface ExecutionPlan {
  planId: string;
  jobId: string;
  subtasks: SubTask[];
  schedule: ExecutionStage[];
  overallTimeoutMs: number;
}

export interface TimeoutSignal {
  jobId: string;
  subtaskId: string;
  elapsedMs: number;
  timeoutMs: number;
  severity: 'warning' | 'critical';
}

export interface DegradedPlan {
  planId: string;
  originalPlan: ExecutionPlan;
  degradedSubtasks: SubTask[];
  skippedSubtasks: string[];
  reason: string;
  newEstimatedCompletion: number;
}
