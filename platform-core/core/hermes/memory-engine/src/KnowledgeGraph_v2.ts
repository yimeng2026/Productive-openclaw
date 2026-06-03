/**
 * @file KnowledgeGraph_v2.ts
 * @description 知识图谱 v2 — 数学知识三元组扩展版
 *   升级点：
 *     1. 新增定理(Theorem)-证明(Proof)-反例(CounterExample)三元组节点类型
 *     2. 引入 MathTriple 结构，支持链式验证与一致性检查
 *     3. 增加专门查询接口：findTheoremsByAssumption, findProofsForTheorem, findCounterExamples
 *     4. 增加 triple 完整性校验与引用图（citation graph）
 *     5. 保留 v1 的所有通用节点/边管理能力
 *   核心设计：
 *     - 通用节点（KnowledgeNode）与数学专用节点（*Node）并存
 *     - 通过 TripleEdge 显式表达 theorem→provedBy→proof→refutedBy→counterExample 链
 */

// ═══════════════════════════════════════════════════════════
// v1 兼容类型（保留）
// ═══════════════════════════════════════════════════════════

export interface KnowledgeNode {
  id: string;
  type: string;
  label: string;
  content: string;
  sources?: string[];
  confidence?: number;
  /** v2 新增：节点版本号，用于冲突检测 */
  version?: number;
  /** v2 新增：最后更新时间戳 */
  lastModified?: string;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  type: string;
  /** v2 新增：边的置信度/权重 */
  weight?: number;
}

export interface GraphStatus {
  nodeCount: number;
  edgeCount: number;
  lastUpdated: string;
  topConcepts: string[];
  /** v2 新增：三元组统计 */
  tripleStats?: TripleStats;
}

// ═══════════════════════════════════════════════════════════
// v2 新增：数学专用节点类型
// ═══════════════════════════════════════════════════════════

export interface Assumption {
  statement: string;
  formalizable?: boolean; // 是否可形式化（Lean/Coq 等）
}

export interface Conclusion {
  statement: string;
  strength: 'strong' | 'moderate' | 'weak';
}

/** 定理节点：存储数学命题的完整结构 */
export interface TheoremNode extends KnowledgeNode {
  type: 'theorem';
  formalStatement: string;
  assumptions: Assumption[];
  conclusions: Conclusion[];
  /** 所属数学领域标签 */
  domain: string[];
  /** 难度估计（0~1） */
  difficulty?: number;
  /** 已知证明数量 */
  knownProofCount: number;
  /** 是否已被证明（true/false/unknown） */
  provenStatus: 'proven' | 'disproven' | 'open' | 'conjecture';
}

/** 证明节点：存储证明的策略与步骤 */
export interface ProofNode extends KnowledgeNode {
  type: 'proof';
  /** 证明目标定理 ID */
  targetTheoremId: string;
  /** 证明策略分类 */
  strategy: 'direct' | 'contradiction' | 'induction' | 'constructive' | 'non-constructive' | 'probabilistic' | 'other';
  /** 证明步骤（可形式化片段） */
  steps: string[];
  /** 使用的引理/定理 IDs */
  lemmasUsed: string[];
  /** 证明是否被验证 */
  verified: boolean;
  /** 验证方式 */
  verificationMethod?: 'manual' | 'formal' | 'peer-review';
}

/** 反例节点：存储对命题的否定构造 */
export interface CounterExampleNode extends KnowledgeNode {
  type: 'counter-example';
  /** 针对的定理/猜想 ID */
  targetTheoremId: string;
  /** 反例的具体构造描述 */
  construction: string;
  /** 反例违反的条件 */
  violatesAssumption?: string;
  /** 反例的规模/复杂度估计 */
  complexity?: string;
  /** 反例是否被确认有效 */
  confirmed: boolean;
}

/** v2 新增：数学三元组 */
export interface MathTriple {
  id: string;
  /** 定理节点 */
  theorem: TheoremNode;
  /** 证明节点数组（一个定理可有多个证明） */
  proofs: ProofNode[];
  /** 反例节点数组（若定理被证伪） */
  counterExamples: CounterExampleNode[];
  /** 三元组状态 */
  status: 'complete' | 'partial' | 'incomplete' | 'contradictory';
  /** 创建时间 */
  createdAt: string;
}

/** v2 新增：三元组统计 */
export interface TripleStats {
  theoremCount: number;
  proofCount: number;
  counterExampleCount: number;
  completeTriples: number;
  contradictoryTriples: number;
}

/** v2 新增：三元组查询过滤 */
export interface TripleQuery {
  domain?: string;
  provenStatus?: TheoremNode['provenStatus'];
  hasCounterExample?: boolean;
  verifiedProofOnly?: boolean;
  minConfidence?: number;
}

/** v2 新增：三元组验证报告 */
export interface TripleValidationReport {
  tripleId: string;
  isValid: boolean;
  issues: string[];
  /** 引用的节点是否存在 */
  missingRefs: string[];
  /** 定理与证明是否逻辑匹配 */
  logicMismatch: boolean;
}

// ═══════════════════════════════════════════════════════════
// v2 主类
// ═══════════════════════════════════════════════════════════

export class KnowledgeGraph {
  private path: string;
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: KnowledgeEdge[] = [];
  /** v2 新增：三元组索引 */
  private triples: Map<string, MathTriple> = new Map();

  constructor(path: string) {
    this.path = path;
  }

  // ─── 持久化（v1 兼容 + v2 扩展） ───

  async load(): Promise<void> {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.path)) {
        const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'node') {
              this.nodes.set(entry.id, entry);
            } else if (entry.type === 'edge') {
              this.edges.push(entry);
            } else if (entry.type === 'triple') {
              this.triples.set(entry.id, entry);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      // ignore load errors
    }
  }

  async persist(): Promise<void> {
    try {
      const fs = require('fs');
      const dir = this.path.substring(0, this.path.lastIndexOf('/')) || '.';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const lines: string[] = [];
      for (const node of this.nodes.values()) {
        lines.push(JSON.stringify({ ...node, type: 'node' }));
      }
      for (const edge of this.edges) {
        lines.push(JSON.stringify({ ...edge, type: 'edge' }));
      }
      for (const triple of this.triples.values()) {
        lines.push(JSON.stringify({ ...triple, type: 'triple' }));
      }
      fs.writeFileSync(this.path, lines.join('\n') + '\n');
    } catch {
      // ignore persist errors
    }
  }

  // ─── 通用节点/边管理（v1 兼容） ───

  async addNode(node: KnowledgeNode): Promise<void> {
    const existing = this.nodes.get(node.id);
    this.nodes.set(node.id, {
      ...node,
      version: (existing?.version || 0) + 1,
      lastModified: new Date().toISOString(),
    });
  }

  async addEdge(from: string, to: string, type: string, weight?: number): Promise<void> {
    this.edges.push({ from, to, type, weight });
  }

  async size(): Promise<number> {
    return this.nodes.size;
  }

  async getNode(id: string): Promise<KnowledgeNode | undefined> {
    return this.nodes.get(id);
  }

  async getEdgesFrom(id: string): Promise<KnowledgeEdge[]> {
    return this.edges.filter(e => e.from === id);
  }

  async getEdgesTo(id: string): Promise<KnowledgeEdge[]> {
    return this.edges.filter(e => e.to === id);
  }

  // ─── v2 新增：数学三元组核心 API ───

  /**
   * 创建定理-证明-反例三元组
   *   自动建立边关系：
   *     theorem --[provedBy]--> proof
   *     theorem --[refutedBy]--> counterExample（如有）
   */
  async createTriple(theorem: TheoremNode, proofs: ProofNode[] = [], counterExamples: CounterExampleNode[] = []): Promise<MathTriple> {
    // 先存储所有节点
    await this.addNode(theorem);
    for (const p of proofs) await this.addNode(p);
    for (const c of counterExamples) await this.addNode(c);

    // 建立边
    for (const p of proofs) {
      await this.addEdge(theorem.id, p.id, 'provedBy', 1.0);
    }
    for (const c of counterExamples) {
      await this.addEdge(theorem.id, c.id, 'refutedBy', 1.0);
    }

    // 推导三元组状态
    let status: MathTriple['status'] = 'incomplete';
    if (proofs.length > 0 && counterExamples.length > 0) {
      status = 'contradictory';
    } else if (proofs.length > 0 && counterExamples.length === 0) {
      status = 'complete';
    } else if (proofs.length === 0 && counterExamples.length > 0) {
      status = 'partial'; // 有反例无证明 = 部分信息
    }

    const triple: MathTriple = {
      id: `triple-${theorem.id}`,
      theorem,
      proofs,
      counterExamples,
      status,
      createdAt: new Date().toISOString(),
    };

    this.triples.set(triple.id, triple);
    return triple;
  }

  /**
   * 获取指定三元组
   */
  async getTriple(tripleId: string): Promise<MathTriple | undefined> {
    return this.triples.get(tripleId);
  }

  /**
   * 获取与定理相关的三元组
   */
  async getTriplesByTheorem(theoremId: string): Promise<MathTriple[]> {
    return Array.from(this.triples.values()).filter(t => t.theorem.id === theoremId);
  }

  /**
   * 查询满足条件的定理
   */
  async findTheorems(query: TripleQuery = {}): Promise<TheoremNode[]> {
    const all = Array.from(this.nodes.values()).filter(n => n.type === 'theorem') as TheoremNode[];

    return all.filter(t => {
      if (query.domain && !t.domain.includes(query.domain)) return false;
      if (query.provenStatus && t.provenStatus !== query.provenStatus) return false;
      if (query.minConfidence !== undefined && (t.confidence || 0) < query.minConfidence) return false;
      return true;
    });
  }

  /**
   * 查找指定定理的所有证明
   */
  async findProofsForTheorem(theoremId: string): Promise<ProofNode[]> {
    const edges = this.edges.filter(e => e.from === theoremId && e.type === 'provedBy');
    const proofIds = edges.map(e => e.to);
    return proofIds
      .map(id => this.nodes.get(id))
      .filter((n): n is ProofNode => n?.type === 'proof')
      .map(n => n as ProofNode);
  }

  /**
   * 查找指定定理的所有反例
   */
  async findCounterExamples(theoremId: string): Promise<CounterExampleNode[]> {
    const edges = this.edges.filter(e => e.from === theoremId && e.type === 'refutedBy');
    const ceIds = edges.map(e => e.to);
    return ceIds
      .map(id => this.nodes.get(id))
      .filter((n): n is CounterExampleNode => n?.type === 'counter-example')
      .map(n => n as CounterExampleNode);
  }

  /**
   * 查找使用了某引理/定理的所有证明
   */
  async findProofsUsingLemma(lemmaId: string): Promise<ProofNode[]> {
    return Array.from(this.nodes.values())
      .filter((n): n is ProofNode => n.type === 'proof')
      .filter(p => p.lemmasUsed.includes(lemmaId));
  }

  /**
   * 三元组完整性校验
   *   检查：
   *     1. 所有引用的节点是否存在
   *     2. 定理与证明的逻辑匹配（证明的目标定理 ID 是否一致）
   *     3. 证明是否引用了不存在的引理
   */
  async validateTriple(tripleId: string): Promise<TripleValidationReport> {
    const triple = this.triples.get(tripleId);
    if (!triple) {
      return { tripleId, isValid: false, issues: ['Triple not found'], missingRefs: [], logicMismatch: false };
    }

    const issues: string[] = [];
    const missingRefs: string[] = [];
    let logicMismatch = false;

    // 检查定理节点存在
    if (!this.nodes.has(triple.theorem.id)) {
      issues.push(`Theorem node ${triple.theorem.id} missing`);
      missingRefs.push(triple.theorem.id);
    }

    // 检查证明节点
    for (const p of triple.proofs) {
      if (!this.nodes.has(p.id)) {
        issues.push(`Proof node ${p.id} missing`);
        missingRefs.push(p.id);
      }
      if (p.targetTheoremId !== triple.theorem.id) {
        issues.push(`Proof ${p.id} targets ${p.targetTheoremId}, expected ${triple.theorem.id}`);
        logicMismatch = true;
      }
      // 检查引理引用
      for (const lemmaId of p.lemmasUsed) {
        if (!this.nodes.has(lemmaId)) {
          issues.push(`Proof ${p.id} references missing lemma ${lemmaId}`);
          missingRefs.push(lemmaId);
        }
      }
    }

    // 检查反例节点
    for (const c of triple.counterExamples) {
      if (!this.nodes.has(c.id)) {
        issues.push(`CounterExample node ${c.id} missing`);
        missingRefs.push(c.id);
      }
      if (c.targetTheoremId !== triple.theorem.id) {
        issues.push(`CounterExample ${c.id} targets ${c.targetTheoremId}, expected ${triple.theorem.id}`);
        logicMismatch = true;
      }
    }

    return {
      tripleId,
      isValid: issues.length === 0,
      issues,
      missingRefs: [...new Set(missingRefs)],
      logicMismatch,
    };
  }

  /**
   * 全图谱三元组批量校验
   */
  async validateAllTriples(): Promise<TripleValidationReport[]> {
    const reports: TripleValidationReport[] = [];
    for (const tripleId of this.triples.keys()) {
      reports.push(await this.validateTriple(tripleId));
    }
    return reports;
  }

  /**
   * 查找"证明网络"——从某定理出发，递归查找所有依赖的引理及其证明
   */
  async buildProofNetwork(theoremId: string, depth = 3): Promise<{
    root: string;
    layers: Array<Array<{ nodeId: string; relation: string }>>;
  }> {
    const visited = new Set<string>();
    const layers: Array<Array<{ nodeId: string; relation: string }>> = [];

    let currentLayer = [{ nodeId: theoremId, relation: 'root' }];
    visited.add(theoremId);

    for (let d = 0; d < depth && currentLayer.length > 0; d++) {
      layers.push(currentLayer);
      const nextLayer: Array<{ nodeId: string; relation: string }> = [];

      for (const item of currentLayer) {
        // 查找证明
        const proofs = this.edges.filter(e => e.from === item.nodeId && e.type === 'provedBy');
        for (const e of proofs) {
          if (!visited.has(e.to)) {
            visited.add(e.to);
            nextLayer.push({ nodeId: e.to, relation: 'provedBy' });
          }
        }

        // 查找引理引用（从 proof 节点出发）
        const node = this.nodes.get(item.nodeId);
        if (node?.type === 'proof') {
          for (const lemmaId of (node as ProofNode).lemmasUsed) {
            if (!visited.has(lemmaId)) {
              visited.add(lemmaId);
              nextLayer.push({ nodeId: lemmaId, relation: 'lemmaFor' });
            }
          }
        }
      }

      currentLayer = nextLayer;
    }

    return { root: theoremId, layers };
  }

  // ─── v1 兼容查询（增强） ───

  async getStatus(): Promise<GraphStatus> {
    const theorems = Array.from(this.nodes.values()).filter(n => n.type === 'theorem') as TheoremNode[];
    const proofs = Array.from(this.nodes.values()).filter(n => n.type === 'proof') as ProofNode[];
    const counterExamples = Array.from(this.nodes.values()).filter(n => n.type === 'counter-example') as CounterExampleNode[];

    const completeTriples = Array.from(this.triples.values()).filter(t => t.status === 'complete').length;
    const contradictoryTriples = Array.from(this.triples.values()).filter(t => t.status === 'contradictory').length;

    const topConcepts = Array.from(this.nodes.values())
      .filter(n => (n.confidence || 0) > 0.7)
      .map(n => n.label)
      .slice(0, 10);

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      lastUpdated: new Date().toISOString(),
      topConcepts,
      tripleStats: {
        theoremCount: theorems.length,
        proofCount: proofs.length,
        counterExampleCount: counterExamples.length,
        completeTriples,
        contradictoryTriples,
      },
    };
  }

  async query(query: string, limit = 10): Promise<Array<{ concept: string; relevance: number }>> {
    const lowerQuery = query.toLowerCase();
    const results = Array.from(this.nodes.values())
      .map(node => ({
        concept: node.label,
        relevance: this.calculateRelevance(lowerQuery, node),
      }))
      .filter(r => r.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
    return results;
  }

  private calculateRelevance(query: string, node: KnowledgeNode): number {
    let score = 0;
    const text = (node.label + ' ' + node.content).toLowerCase();
    const words = query.split(/\s+/);
    for (const word of words) {
      if (word.length < 2) continue;
      if (text.includes(word)) score += 0.3;
      if (node.label.toLowerCase().includes(word)) score += 0.5;
    }

    // v2 增强：定理类型节点在数学查询中加权
    if (node.type === 'theorem' && (query.includes('theorem') || query.includes('证明') || query.includes('命题'))) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }
}

export default KnowledgeGraph;
