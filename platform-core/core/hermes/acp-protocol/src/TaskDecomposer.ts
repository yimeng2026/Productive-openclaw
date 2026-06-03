import {
  SubTask,
  DecompositionResult,
  DependencyGraph,
  ExecutionStage,
  AgentRole,
  Platform,
  OutputFormat,
  TaskStatus,
} from './types';

// ============================================================
// Task Decomposition Engine
// ============================================================
// Input:  Raw user request (e.g. "Write a paper on quantum computing")
// Output: Ordered subtasks with platform preferences and dependency graph
//
// Decomposition rules:
//   1. Analyze request → extract intent, domain, complexity
//   2. Pattern-match against known workflow templates
//   3. Generate subtasks with role/platform annotations
//   4. Build dependency graph (data-flow + temporal ordering)
//   5. Compute parallel execution stages

export interface DecompositionRule {
  pattern: RegExp;
  workflowTemplate: string;
  defaultRoles: AgentRole[];
  defaultPlatforms: Platform[];
}

export class TaskDecomposer {
  private taskCounter = 0;

  // Known workflow templates keyed by intent
  private readonly templates: Record<string, WorkflowTemplate> = {
    'write_paper': {
      stages: [
        { role: 'researcher', platform: 'openclaw', task: 'Research and gather sources' },
        { role: 'writer', platform: 'claude', task: 'Draft content sections' },
        { role: 'reviewer', platform: 'hermes', task: 'Review and fact-check' },
        { role: 'writer', platform: 'claude', task: 'Final polish and formatting' },
      ],
    },
    'code_review': {
      stages: [
        { role: 'coder', platform: 'hermes', task: 'Static analysis and style check' },
        { role: 'security_scanner', platform: 'claude', task: 'Security vulnerability scan' },
        { role: 'tester', platform: 'openclaw', task: 'Test coverage and execution' },
      ],
    },
    'data_analysis': {
      stages: [
        { role: 'analyst', platform: 'hermes', task: 'Data cleaning and preprocessing' },
        { role: 'visualizer', platform: 'claude', task: 'Visualization and chart generation' },
        { role: 'analyst', platform: 'openclaw', task: 'Interpretation and insights' },
      ],
    },
    'default': {
      stages: [
        { role: 'researcher', platform: 'openclaw', task: 'Background research' },
        { role: 'writer', platform: 'claude', task: 'Primary execution' },
        { role: 'reviewer', platform: 'hermes', task: 'Quality review' },
      ],
    },
  };

  // Heuristic keyword→template mapping
  private readonly keywordMap: Record<string, string> = {
    'paper': 'write_paper',
    'essay': 'write_paper',
    'thesis': 'write_paper',
    'article': 'write_paper',
    'code review': 'code_review',
    'review code': 'code_review',
    'pull request': 'code_review',
    'analyze data': 'data_analysis',
    'data analysis': 'data_analysis',
    'visualization': 'data_analysis',
    'dashboard': 'data_analysis',
  };

  /**
   * Main entry: decompose a raw user request into subtasks.
   */
  decompose(userRequest: string, requestId: string): DecompositionResult {
    const templateKey = this.detectTemplate(userRequest);
    const template = (this.templates[templateKey] ?? this.templates['default'])!;
    const complexity = this.estimateComplexity(userRequest);

    const subtasks: SubTask[] = [];
    const dependencyEdges: [string, string][] = [];
    let prevId: string | null = null;

    for (let i = 0; i < template.stages.length; i++) {
      const stage = template.stages[i]!;
      const subtaskId = `${requestId}-sub-${++this.taskCounter}`;
      const timeoutMs = this.computeTimeout(complexity, stage.role);
      const degradationChain = this.buildDegradationChain(complexity);

      const subtask: SubTask = {
        id: subtaskId,
        parentId: requestId,
        description: `${stage.task} for: "${userRequest}"`,
        role: stage.role,
        platformPreference: stage.platform,
        platformFallbacks: this.computeFallbacks(stage.platform),
        inputDependencies: prevId ? [prevId] : [],
        outputFormat: this.inferOutputFormat(stage.role),
        estimatedComplexity: complexity,
        timeoutMs,
        degradationChain,
        status: 'pending' as TaskStatus,
        assignedAgentId: null,
        result: null,
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
      };

      if (prevId) {
        dependencyEdges.push([prevId, subtaskId]);
      }

      subtasks.push(subtask);
      prevId = subtaskId;
    }

    // For complex requests, inject a parallel research branch
    if (complexity >= 7 && subtasks.length >= 2) {
      const parallelResearchId = `${requestId}-sub-${++this.taskCounter}`;
      const parallelResearch: SubTask = {
        id: parallelResearchId,
        parentId: requestId,
        description: `Deep research and source verification for: "${userRequest}"`,
        role: 'researcher',
        platformPreference: 'openclaw',
        platformFallbacks: this.computeFallbacks('openclaw'),
        inputDependencies: [],
        outputFormat: { type: 'structured', schema: { sources: 'array', summary: 'string' } },
        estimatedComplexity: complexity,
        timeoutMs: this.computeTimeout(complexity, 'researcher'),
        degradationChain: this.buildDegradationChain(complexity),
        status: 'pending',
        assignedAgentId: null,
        result: null,
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
      };

      // Parallel research feeds into stage 2 (writer)
      if (subtasks.length > 1) {
        dependencyEdges.push([parallelResearchId, subtasks[1]!.id]);
        subtasks[1]!.inputDependencies.push(parallelResearchId);
      }

      subtasks.splice(1, 0, parallelResearch);
    }

    const graph = this.buildDependencyGraph(subtasks, dependencyEdges);
    const executionPlan = this.computeExecutionStages(graph);

    return { subtasks, dependencyGraph: graph, executionPlan };
  }

  // ---- Template detection ----

  private detectTemplate(request: string): string {
    const lower = request.toLowerCase();
    for (const [keyword, template] of Object.entries(this.keywordMap)) {
      if (lower.includes(keyword)) return template;
    }
    return 'default';
  }

  // ---- Complexity estimation ----

  private estimateComplexity(request: string): number {
    const score = this.computeComplexityScore(request);
    return Math.min(10, Math.max(1, Math.round(score)));
  }

  private computeComplexityScore(request: string): number {
    let score = 5; // baseline
    const lower = request.toLowerCase();
    const wordCount = request.split(/\s+/).filter((w) => w.length > 0).length;

    // --- Lexical scale ---
    if (wordCount > 50) score += 0.5;
    if (wordCount > 120) score += 1.0;
    if (wordCount > 300) score += 1.5;

    // --- Domain complexity keywords (weighted) ---
    const domainWeights: Record<string, number> = {
      'quantum': 1.5,
      'relativity': 1.5,
      'topology': 1.5,
      'cryptography': 1.2,
      'formal proof': 2.0,
      'verification': 1.5,
      'distributed consensus': 1.8,
      'optimization': 1.0,
      'neural network': 1.2,
      'theorem': 1.5,
      'lemma': 1.0,
      'conjecture': 1.5,
      'hilbert': 1.5,
      'navier-stokes': 2.0,
      'riemann': 2.0,
      'p vs np': 2.0,
      'computational complexity': 1.5,
    };

    for (const [keyword, weight] of Object.entries(domainWeights)) {
      if (lower.includes(keyword)) score += weight;
    }

    // --- Structural complexity ---
    const sentenceCount = request.split(/[.!?;]+/).filter((s) => s.trim().length > 0).length;
    if (sentenceCount > 5) score += 0.5;
    if (sentenceCount > 10) score += 1.0;

    // Enumerated items indicate multi-part complexity
    const enumerated = (request.match(/^(\d+[.):]\s|[\-•*]\s)/gm) ?? []).length;
    score += Math.min(2, enumerated * 0.3);

    // --- Cross-domain requirements ---
    const domains = ['physics', 'math', 'biology', 'computer', 'economics', 'philosophy'];
    const domainHits = domains.filter((d) => lower.includes(d)).length;
    if (domainHits >= 2) score += 1.0;
    if (domainHits >= 3) score += 1.5;

    // --- Ambiguity / open-endedness ---
    const ambiguityMarkers = ['explore', 'discuss', 'compare', 'survey', 'overview', 'review'];
    for (const marker of ambiguityMarkers) {
      if (lower.includes(marker)) score += 0.3;
    }

    // --- Multi-step chain indicators ---
    const stepIndicators = ['then', 'followed by', 'after that', 'subsequently', 'next'];
    for (const ind of stepIndicators) {
      if (lower.includes(ind)) score += 0.4;
    }

    return score;
  }

  // ---- Timeout computation ----

  private computeTimeout(complexity: number, role: AgentRole): number {
    // Base timeouts by role
    const roleBase: Record<AgentRole, number> = {
      researcher: 60000,
      writer: 45000,
      reviewer: 30000,
      coder: 60000,
      tester: 90000,
      analyst: 45000,
      coordinator: 15000,
      visualizer: 45000,
      security_scanner: 60000,
    };

    const base = roleBase[role] ?? 30000;
    // Scale with complexity: each point above 5 adds 20%
    const multiplier = 1 + Math.max(0, (complexity - 5) * 0.2);
    return Math.round(base * multiplier);
  }

  // ---- Degradation chain ----

  private buildDegradationChain(complexity: number): Array<'full' | 'simplified' | 'placeholder' | 'skip'> {
    if (complexity <= 3) {
      return ['full', 'simplified'];
    } else if (complexity <= 7) {
      return ['full', 'simplified', 'placeholder'];
    } else {
      return ['full', 'simplified', 'placeholder', 'skip'];
    }
  }

  // ---- Fallback computation ----

  private computeFallbacks(primary: Platform): Platform[] {
    const fallbackMap: Record<Platform, Platform[]> = {
      openclaw: ['claude', 'hermes', 'generic'],
      hermes: ['openclaw', 'generic', 'claude'],
      claude: ['openclaw', 'hermes', 'generic'],
      ollama: ['openclaw', 'claude', 'hermes', 'generic'],
      generic: ['openclaw', 'claude', 'hermes', 'ollama'],
    };
    return fallbackMap[primary] ?? ['generic'];
  }

  // ---- Output format inference ----

  private inferOutputFormat(role: AgentRole): OutputFormat {
    const formatMap: Record<AgentRole, OutputFormat> = {
      researcher: { type: 'structured', schema: { sources: 'array', findings: 'string' } },
      writer: { type: 'markdown', constraints: ['sections', 'citations'] },
      reviewer: { type: 'structured', schema: { score: 'number', comments: 'array', verdict: 'string' } },
      coder: { type: 'code', constraints: ['syntax_valid', 'typed'] },
      tester: { type: 'structured', schema: { passed: 'number', failed: 'number', coverage: 'number' } },
      analyst: { type: 'structured', schema: { metrics: 'object', insights: 'array' } },
      coordinator: { type: 'json' },
      visualizer: { type: 'structured', schema: { charts: 'array', summary: 'string' } },
      security_scanner: { type: 'structured', schema: { vulnerabilities: 'array', severity: 'string' } },
    };
    return formatMap[role] ?? { type: 'text' };
  }

  // ---- Dependency graph construction ----

  private buildDependencyGraph(
    subtasks: SubTask[],
    edges: [string, string][]
  ): DependencyGraph {
    const nodeIds = subtasks.map((s) => s.id);

    // Compute parallel groups via topological levels
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const [from, to] of edges) {
      adjacency.get(from)!.push(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }

    const levels: string[][] = [];
    let current = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
    const visited = new Set<string>();

    while (current.length > 0) {
      levels.push([...current]);
      for (const id of current) visited.add(id);

      const next: string[] = [];
      for (const id of current) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!visited.has(neighbor)) {
            const remaining = (inDegree.get(neighbor) ?? 0) -
              [...adjacency.entries()]
                .filter(([_, v]) => v.includes(neighbor))
                .filter(([k]) => visited.has(k)).length;
            if (remaining <= 0 && !visited.has(neighbor) && !next.includes(neighbor)) {
              next.push(neighbor);
            }
          }
        }
      }
      current = next;
    }

    return { nodes: nodeIds, edges, parallelGroups: levels };
  }

  // ---- Execution stage computation ----

  private computeExecutionStages(graph: DependencyGraph): ExecutionStage[] {
    return graph.parallelGroups.map((group, idx) => ({
      stage: idx + 1,
      subtaskIds: group,
      canParallel: group.length > 1,
    }));
  }
}

interface WorkflowTemplate {
  stages: Array<{ role: AgentRole; platform: Platform; task: string }>;
}
