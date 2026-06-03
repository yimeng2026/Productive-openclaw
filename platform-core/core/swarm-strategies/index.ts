// index.ts — Swarm Strategies 统一出口
// 导出所有 GitHub Agent Swarm 架构策略

export { HierarchicalSwarm } from './HierarchicalSwarm';
export type {
  HierarchicalSwarmState,
  WorkerQueueItem,
  HierarchicalSwarmConfig,
} from './HierarchicalSwarm';

export { AgentRearrange, FlowParser } from './AgentRearrange';
export type {
  RearrangeNode,
  RearrangeNodeType,
  RearrangeEdge,
  AgentRearrangeConfig,
  AgentRearrangeState,
} from './AgentRearrange';

export { ForestSwarm } from './ForestSwarm';
export type {
  ForestNode,
  ForestSwarmConfig,
  ForestSwarmState,
} from './ForestSwarm';

export { HeavySwarm } from './HeavySwarm';
export type {
  HeavyPhase,
  HeavyPhaseConfig,
  PhaseResult,
  HeavySwarmConfig,
  HeavySwarmState,
} from './HeavySwarm';

export { SwarmRouter } from './SwarmRouter';
export type {
  RouterStrategy,
  StrategyRegistration,
  RouterConfig,
  RoutingDecision,
  SwarmRouterState,
} from './SwarmRouter';

export { RufloSwarm } from './RufloSwarm';
export type {
  ExperienceEntry,
  QueenMemory,
  RufloSwarmConfig,
  RufloSwarmState,
} from './RufloSwarm';

export { MultiRepoSwarm } from './MultiRepoSwarm';
export type {
  RepoDefinition,
  SharedMemoryEntry,
  SyncOperation,
  MultiRepoSwarmConfig,
  MultiRepoSwarmState,
} from './MultiRepoSwarm';
