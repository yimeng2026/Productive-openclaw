import {
  CapabilityManifest,
  SubTask,
  MatchResult,
  MatchConfig,
  AgentRole,
  Platform,
  Skill,
} from './types';

// ============================================================
// Capability Matcher
// ============================================================
// Each Agent registers a CapabilityManifest on boot.
// The Matcher scores every (Agent, SubTask) pair and returns
// ranked candidates. Score threshold: < 0.70 → no allocation.
//
// Scoring dimensions (weighted):
//   - Role fit          : 30%  (exact role match)
//   - Skill overlap     : 25%  (Jaccard over skill names)
//   - Skill depth       : 15%  (average skill level)
//   - Platform affinity : 15%  (preferred vs actual)
//   - Historical perf   : 10%  (success rate, latency)
//   - Token budget      :  5%  (can task fit in context?)

export class CapabilityMatcher {
  private readonly defaultConfig: MatchConfig = {
    minScore: 0.70,
    preferSamePlatform: true,
    fallbackEnabled: true,
    maxRetries: 3,
  };

  private config: MatchConfig;

  constructor(config?: Partial<MatchConfig>) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Score every agent against the subtask and return sorted matches.
   */
  findMatches(
    agents: CapabilityManifest[],
    subtask: SubTask
  ): MatchResult[] {
    const scored = agents
      .map((agent) => ({
        agentId: agent.agentId,
        score: this.computeScore(agent, subtask),
        reason: this.buildReason(agent, subtask),
      }))
      .filter((m) => m.score >= this.config.minScore)
      .sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Pick the single best match; return null if none clears threshold.
   */
  bestMatch(
    agents: CapabilityManifest[],
    subtask: SubTask
  ): MatchResult | null {
    const matches = this.findMatches(agents, subtask);
    return matches.length > 0 ? matches[0]! : null;
  }

  // ---- Score computation ----

  private computeScore(agent: CapabilityManifest, subtask: SubTask): number {
    const roleScore = this.scoreRole(agent.role, subtask.role);
    const skillScore = this.scoreSkills(agent.skills, subtask.description);
    const depthScore = this.scoreSkillDepth(agent.skills);
    const platformScore = this.scorePlatform(agent.platform, subtask);
    const perfScore = this.scorePerformance(agent.performanceMetrics);
    const tokenScore = this.scoreTokenBudget(agent, subtask);

    const weights = {
      role: 0.30,
      skill: 0.25,
      depth: 0.15,
      platform: 0.15,
      perf: 0.10,
      token: 0.05,
    };

    const raw =
      roleScore * weights.role +
      skillScore * weights.skill +
      depthScore * weights.depth +
      platformScore * weights.platform +
      perfScore * weights.perf +
      tokenScore * weights.token;

    // Circuit breaker penalty: if platform is failing, slash score
    const cbPenalty = this.circuitPenalty(agent);
    return Math.max(0, raw - cbPenalty);
  }

  private scoreRole(agentRole: AgentRole, requiredRole: AgentRole): number {
    if (agentRole === requiredRole) return 1.0;

    // Adjacency map for near-miss scoring
    const adjacency: Record<AgentRole, AgentRole[]> = {
      researcher: ['analyst', 'writer'],
      writer: ['researcher', 'reviewer'],
      reviewer: ['writer', 'analyst'],
      coder: ['tester', 'security_scanner'],
      tester: ['coder', 'security_scanner'],
      analyst: ['researcher', 'visualizer'],
      coordinator: [],
      visualizer: ['analyst'],
      security_scanner: ['coder', 'tester'],
    };

    const near = adjacency[requiredRole] ?? [];
    return near.includes(agentRole) ? 0.55 : 0.15;
  }

  private scoreSkills(skills: Skill[], taskDescription: string): number {
    if (skills.length === 0) return 0.3;

    const descWords = new Set(
      taskDescription.toLowerCase().split(/[\s,;:.!?()[\]{}]+/).filter((w) => w.length > 2)
    );
    const descText = taskDescription.toLowerCase();

    let totalMatchScore = 0;
    for (const skill of skills) {
      let skillMatch = 0;

      // Name match: exact or partial
      const skillName = skill.name.toLowerCase();
      if (descWords.has(skillName)) {
        skillMatch = 1.0;
      } else if (descText.includes(skillName)) {
        skillMatch = 0.8;
      } else {
        // Token-level partial match
        const skillTokens = skillName.split(/[\s\-_]+/).filter((t) => t.length > 2);
        const matchedTokens = skillTokens.filter((t) => descText.includes(t));
        skillMatch = matchedTokens.length / Math.max(1, skillTokens.length) * 0.6;
      }

      // Description match: weighted word overlap
      if (skill.description) {
        const descSkillWords = skill.description.toLowerCase().split(/[\s,;:.!?()[\]{}]+/).filter((w) => w.length > 2);
        const overlap = descSkillWords.filter((w) => descWords.has(w)).length;
        const descMatch = overlap / Math.max(1, descSkillWords.length);
        skillMatch = Math.max(skillMatch, descMatch * 0.7);
      }

      // Weight by skill level
      totalMatchScore += skillMatch * skill.level;
    }

    // Normalize: ideal = all skills perfectly matched at level 1
    const idealScore = skills.reduce((sum, s) => sum + s.level, 0);
    return idealScore > 0 ? totalMatchScore / idealScore : 0.3;
  }

  private scoreSkillDepth(skills: Skill[]): number {
    if (skills.length === 0) return 0.3;
    const avg = skills.reduce((sum, s) => sum + s.level, 0) / skills.length;
    return avg;
  }

  private scorePlatform(
    agentPlatform: Platform,
    subtask: SubTask
  ): number {
    if (agentPlatform === subtask.platformPreference) return 1.0;
    if (subtask.platformFallbacks.includes(agentPlatform)) return 0.6;
    return this.config.fallbackEnabled ? 0.2 : 0.0;
  }

  private scorePerformance(metrics: {
    successRate: number;
    avgLatencyMs: number;
  }): number {
    const successComponent = metrics.successRate;
    // Latency: ideal < 5s, penalize above 15s
    const latencyScore = Math.max(
      0,
      1 - metrics.avgLatencyMs / 15000
    );
    return successComponent * 0.7 + latencyScore * 0.3;
  }

  private scoreTokenBudget(
    agent: CapabilityManifest,
    subtask: SubTask
  ): number {
    // Rough estimate: complexity * 500 tokens baseline
    const estimatedTokens = subtask.estimatedComplexity * 500;
    if (agent.maxTokens >= estimatedTokens * 2) return 1.0;
    if (agent.maxTokens >= estimatedTokens) return 0.7;
    if (agent.maxTokens >= estimatedTokens * 0.5) return 0.3;
    return 0.0;
  }

  private circuitPenalty(agent: CapabilityManifest): number {
    const fails = agent.performanceMetrics.consecutiveFailures;
    if (fails >= 3) return 0.5;
    if (fails === 2) return 0.25;
    if (fails === 1) return 0.1;
    return 0;
  }

  private buildReason(agent: CapabilityManifest, subtask: SubTask): string {
    const parts: string[] = [];
    if (agent.role === subtask.role) parts.push('exact role match');
    if (agent.platform === subtask.platformPreference)
      parts.push('preferred platform');
    else if (subtask.platformFallbacks.includes(agent.platform))
      parts.push('fallback platform');
    if (agent.performanceMetrics.successRate > 0.95)
      parts.push('high success rate');
    return parts.join(', ') || 'general capability match';
  }
}
