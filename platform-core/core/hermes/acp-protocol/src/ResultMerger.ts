import {
  TaskResult,
  MergeConfig,
  MergeResult,
  Contribution,
  Conflict,
} from './types';

// ============================================================
// Result Merger
// ============================================================
// Merges outputs from multiple agents into a coherent final result.
//
// Strategies:
//   1. sequential_append  — concatenate in order (for chapters/sections)
//   2. voting_dedup       — majority vote on overlapping answers
//   3. expert_review      — one agent grades another's output
//   4. hierarchical_synthesis — data → analysis → conclusion layering
//
// Conflict resolution:
//   When two platform results contradict, apply resolution policy.

export class ResultMerger {
  private config: MergeConfig;

  constructor(config: MergeConfig) {
    this.config = config;
  }

  merge(results: TaskResult[]): MergeResult {
    if (results.length === 0) {
      return {
        mergedOutput: '',
        contributions: [],
        conflicts: [],
        finalScore: 0,
      };
    }

    if (results.length === 1) {
      return {
        mergedOutput: results[0]!.output,
        contributions: [{
          agentId: results[0]!.agentId,
          subtaskId: results[0]!.taskId,
          section: 'full',
          score: results[0]!.qualityScore,
        }],
        conflicts: [],
        finalScore: results[0]!.qualityScore,
      };
    }

    switch (this.config.strategy) {
      case 'sequential_append':
        return this.mergeSequential(results);
      case 'voting_dedup':
        return this.mergeVoting(results);
      case 'expert_review':
        return this.mergeExpertReview(results);
      case 'hierarchical_synthesis':
        return this.mergeHierarchical(results);
      default:
        return this.mergeSequential(results);
    }
  }

  // ---- Strategy 1: Sequential Append ----

  private mergeSequential(results: TaskResult[]): MergeResult {
    // Sort by subtask order implied by taskId suffix (sub-1, sub-2...)
    const sorted = [...results].sort((a, b) => {
      const idxA = this.extractIndex(a.taskId);
      const idxB = this.extractIndex(b.taskId);
      return idxA - idxB;
    });

    const parts: string[] = [];
    const contributions: Contribution[] = [];

    for (const r of sorted) {
      parts.push(r.output);
      contributions.push({
        agentId: r.agentId,
        subtaskId: r.taskId,
        section: `section-${this.extractIndex(r.taskId)}`,
        score: r.qualityScore,
      });
    }

    const merged = parts.join('\n\n---\n\n');
    const avgScore =
      results.reduce((s, r) => s + r.qualityScore, 0) / results.length;

    return {
      mergedOutput: merged,
      contributions,
      conflicts: [],
      finalScore: avgScore,
    };
  }

  // ---- Strategy 2: Voting Dedup ----

  private mergeVoting(results: TaskResult[]): MergeResult {
    // Tokenize outputs into sentences/claims
    const claims = this.extractClaims(results);
    const voteMap = new Map<string, { count: number; sources: string[] }>();

    for (const claim of claims) {
      const normalized = claim.text.trim().toLowerCase();
      const existing = voteMap.get(normalized);
      if (existing) {
        existing.count++;
        if (!existing.sources.includes(claim.agentId)) {
          existing.sources.push(claim.agentId);
        }
      } else {
        voteMap.set(normalized, { count: 1, sources: [claim.agentId] });
      }
    }

    // Keep claims with > 50% vote share
    const threshold = results.length * 0.5;
    const winners: string[] = [];
    const conflicts: Conflict[] = [];

    for (const [text, vote] of voteMap.entries()) {
      if (vote.count >= threshold) {
        winners.push(text);
      } else if (vote.count > 1) {
        // Minority opinion → conflict record
        conflicts.push({
          agents: vote.sources,
          topic: text.slice(0, 100),
          resolutions: ['minority_rejected'],
          chosenResolution: 'majority_wins',
        });
      }
    }

    const contributions: Contribution[] = results.map((r) => ({
      agentId: r.agentId,
      subtaskId: r.taskId,
      section: 'voting_block',
      score: r.qualityScore,
    }));

    return {
      mergedOutput: winners.join('. ') + '.',
      contributions,
      conflicts,
      finalScore: this.computeConsensusScore(voteMap, results.length),
    };
  }

  // ---- Strategy 3: Expert Review ----

  private mergeExpertReview(results: TaskResult[]): MergeResult {
    // Identify highest-quality result as "expert"
    const expert = results.reduce((best, r) =>
      r.qualityScore > best.qualityScore ? r : best
    );

    // Others are "candidates"; expert reviews each
    const reviewed: string[] = [];
    const conflicts: Conflict[] = [];

    for (const r of results) {
      if (r.agentId === expert.agentId) {
        reviewed.push(r.output);
        continue;
      }

      const similarity = this.textSimilarity(expert.output, r.output);
      if (similarity >= 0.8) {
        // Aligned → accepted
        reviewed.push(r.output);
      } else if (similarity >= 0.5) {
        // Partial → merge with expert preference
        reviewed.push(this.interleave(expert.output, r.output));
        conflicts.push({
          agents: [expert.agentId, r.agentId],
          topic: 'partial_disagreement',
          resolutions: ['expert_priority', 'merged'],
          chosenResolution: 'expert_priority',
        });
      } else {
        // Strong conflict → reject candidate, keep expert
        conflicts.push({
          agents: [expert.agentId, r.agentId],
          topic: 'strong_disagreement',
          resolutions: ['expert_priority', 'candidate_priority', 'escalate'],
          chosenResolution: this.resolveConflict(expert, r),
        });
        if (this.resolveConflict(expert, r) === 'candidate_priority') {
          reviewed.push(r.output);
        } else {
          reviewed.push(expert.output);
        }
      }
    }

    const contributions: Contribution[] = results.map((r) => ({
      agentId: r.agentId,
      subtaskId: r.taskId,
      section: r.agentId === expert.agentId ? 'expert_base' : 'reviewed',
      score: r.qualityScore,
    }));

    return {
      mergedOutput: reviewed.join('\n\n'),
      contributions,
      conflicts,
      finalScore: expert.qualityScore,
    };
  }

  // ---- Strategy 4: Hierarchical Synthesis ----

  private mergeHierarchical(results: TaskResult[]): MergeResult {
    // Categorize results by role layer
    const layers = this.categorizeLayers(results);

    const synthesis: string[] = [];
    const conflicts: Conflict[] = [];

    // Layer 0: raw data / facts
    if (layers.data.length > 0) {
      synthesis.push('## Data Layer\n' + layers.data.map((r) => r.output).join('\n'));
    }

    // Layer 1: analysis
    if (layers.analysis.length > 0) {
      const analysisMerged = this.mergeByQuality(layers.analysis);
      synthesis.push('## Analysis Layer\n' + analysisMerged);
    }

    // Layer 2: conclusions
    if (layers.conclusion.length > 0) {
      const conclusionMerged = this.mergeByQuality(layers.conclusion);
      synthesis.push('## Conclusion Layer\n' + conclusionMerged);
    }

    // Detect cross-layer conflicts
    if (layers.conclusion.length > 0 && layers.data.length > 0) {
      for (const c of layers.conclusion) {
        for (const d of layers.data) {
          if (this.contradicts(c.output, d.output)) {
            conflicts.push({
              agents: [c.agentId, d.agentId],
              topic: 'data_conclusion_mismatch',
              resolutions: ['data_priority', 'conclusion_priority'],
              chosenResolution: 'data_priority',
            });
          }
        }
      }
    }

    const contributions: Contribution[] = results.map((r) => ({
      agentId: r.agentId,
      subtaskId: r.taskId,
      section: this.inferLayer(r),
      score: r.qualityScore,
    }));

    const allScores = results.map((r) => r.qualityScore);
    const finalScore = allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;

    return {
      mergedOutput: synthesis.join('\n\n'),
      contributions,
      conflicts,
      finalScore,
    };
  }

  // ---- Conflict resolution dispatcher ----

  private resolveConflict(a: TaskResult, b: TaskResult): string {
    switch (this.config.conflictResolution) {
      case 'latest':
        return a.timestamp > b.timestamp ? 'expert_priority' : 'candidate_priority';
      case 'highest_score':
        return a.qualityScore >= b.qualityScore ? 'expert_priority' : 'candidate_priority';
      case 'expert_arbitration':
        return 'expert_priority';
      case 'merge_all':
        return 'merged';
      default:
        return 'expert_priority';
    }
  }

  // ---- Helpers ----

  private extractIndex(taskId: string): number {
    const match = taskId.match(/sub-(\d+)/);
    return match ? parseInt(match[1]!, 10) : 0;
  }

  private extractClaims(results: TaskResult[]): Array<{ text: string; agentId: string }> {
    const claims: Array<{ text: string; agentId: string }> = [];
    for (const r of results) {
      const sentences = r.output.split(/[.!?]\s+/).filter((s) => s.trim().length > 10);
      for (const s of sentences) {
        claims.push({ text: s.trim(), agentId: r.agentId });
      }
    }
    return claims;
  }

  private computeConsensusScore(
    voteMap: Map<string, { count: number }>,
    totalAgents: number
  ): number {
    if (voteMap.size === 0) return 0;
    let consensusSum = 0;
    for (const v of voteMap.values()) {
      consensusSum += v.count / totalAgents;
    }
    return consensusSum / voteMap.size;
  }

  private textSimilarity(a: string, b: string): number {
    // Simplified Jaccard on word sets
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private interleave(base: string, alt: string): string {
    // Naive: prepend base, append alt as alternative view
    return base + '\n\n[Alternative view]:\n' + alt;
  }

  private categorizeLayers(results: TaskResult[]): {
    data: TaskResult[];
    analysis: TaskResult[];
    conclusion: TaskResult[];
  } {
    const layers = { data: [] as TaskResult[], analysis: [] as TaskResult[], conclusion: [] as TaskResult[] };
    for (const r of results) {
      const layer = this.inferLayer(r);
      if (layer === 'data') layers.data.push(r);
      else if (layer === 'analysis') layers.analysis.push(r);
      else layers.conclusion.push(r);
    }
    return layers;
  }

  private inferLayer(r: TaskResult): 'data' | 'analysis' | 'conclusion' {
    const lower = r.output.toLowerCase();
    if (lower.includes('conclusion') || lower.includes('therefore') || lower.includes('in summary')) {
      return 'conclusion';
    }
    if (lower.includes('analysis') || lower.includes('because') || lower.includes('suggests')) {
      return 'analysis';
    }
    return 'data';
  }

  private mergeByQuality(results: TaskResult[]): string {
    const sorted = [...results].sort((a, b) => b.qualityScore - a.qualityScore);
    return sorted[0]?.output ?? '';
  }

  private contradicts(a: string, b: string): boolean {
    // Simplified: check for negation keywords
    const negations = ['not', 'no ', 'never', 'false', 'incorrect'];
    const aHasNeg = negations.some((n) => a.toLowerCase().includes(n));
    const bHasNeg = negations.some((n) => b.toLowerCase().includes(n));
    return aHasNeg !== bHasNeg && this.textSimilarity(a, b) > 0.3;
  }
}
