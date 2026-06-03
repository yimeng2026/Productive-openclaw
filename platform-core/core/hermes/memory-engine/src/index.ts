/**
 * @file index.ts
 * @description Hermes Mind Engine — 记忆进化引擎统一导出
 *   Memory → Structure evolution engine
 */

export { HermesEngine } from './HermesEngine';
export { MemoryScanner } from './MemoryScanner';
export { MemoryFossilizer } from './MemoryFossilizer';
export { SkillForge } from './SkillForge';
export { CodeGrowth } from './CodeGrowth';
export { AntiForgetting } from './AntiForgetting';
export { KnowledgeGraph } from './KnowledgeGraph';

export type { HermesConfig, HermesState } from './HermesEngine';
export type { RawMemory, ExtractedPattern } from './MemoryScanner';
export type { FossilizablePattern, FossilizationResult } from './MemoryFossilizer';
export type { CodePattern, GrowthAction } from './CodeGrowth';
export type { AntiForgettingConfig, SyncReport } from './AntiForgetting';
export type { KnowledgeNode, KnowledgeEdge, GraphStatus } from './KnowledgeGraph';
export type { SkillDraft, ForgedSkill } from './SkillForge';
