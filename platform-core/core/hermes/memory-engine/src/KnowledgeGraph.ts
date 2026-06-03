/**
 * @file KnowledgeGraph.ts
 * @description 知识图谱 — Hermes 记忆的结构化存储
 *   核心功能：节点管理、边关系、查询、持久化
 *   TODO: 实际实现使用图数据库或 JSONL 文件
 */

export interface KnowledgeNode {
  id: string;
  type: string;
  label: string;
  content: string;
  sources?: string[];
  confidence?: number;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  type: string;
}

export interface GraphStatus {
  nodeCount: number;
  edgeCount: number;
  lastUpdated: string;
  topConcepts: string[];
}

export class KnowledgeGraph {
  private path: string;
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: KnowledgeEdge[] = [];

  constructor(path: string) {
    this.path = path;
  }

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
      fs.writeFileSync(this.path, lines.join('\n') + '\n');
    } catch {
      // ignore persist errors
    }
  }

  async addNode(node: KnowledgeNode): Promise<void> {
    this.nodes.set(node.id, node);
  }

  async addEdge(from: string, to: string, type: string): Promise<void> {
    this.edges.push({ from, to, type });
  }

  async size(): Promise<number> {
    return this.nodes.size;
  }

  async getStatus(): Promise<GraphStatus> {
    const topConcepts = Array.from(this.nodes.values())
      .filter(n => (n.confidence || 0) > 0.7)
      .map(n => n.label)
      .slice(0, 10);

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      lastUpdated: new Date().toISOString(),
      topConcepts,
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
    return Math.min(score, 1.0);
  }
}

export default KnowledgeGraph;
