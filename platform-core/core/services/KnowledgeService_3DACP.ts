/**
 * KnowledgeService — 3DACP 接入层
 * 知识库管理、文档上传、搜索
 */

import { ServiceAdapter } from '../coordinator/ServiceAdapter';

interface KnowledgeBaseItem {
  id: string; name: string; type: string;
  description: string; documentCount: number;
  indexRate: number; lastUpdated: string;
}

interface Document {
  id: string; title: string; content: string; createdAt: string;
}

interface KnowledgeBase extends KnowledgeBaseItem {
  documents: Document[];
}

const store = new Map<string, KnowledgeBase>();
const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);

// 种子数据
const seeds = [
  { id: 'kb-1', name: '技术文档库', type: '文档', description: 'API文档、技术规范和开发指南' },
  { id: 'kb-2', name: '产品知识库', type: '产品', description: '产品功能、使用手册和FAQ' },
  { id: 'kb-3', name: 'API参考手册', type: 'API', description: '内部API接口文档和示例' },
  { id: 'kb-4', name: '设计规范', type: '设计', description: 'UI/UX设计规范和组件库' },
  { id: 'kb-5', name: '会议纪要', type: '会议', description: '团队会议记录和决策追踪' },
  { id: 'kb-6', name: '通用知识', type: '通用', description: '通用知识和最佳实践' },
];
seeds.forEach((s) => store.set(s.id, { ...s, documentCount: 0, indexRate: 100, lastUpdated: today(), documents: [] }));

export class KnowledgeService extends ServiceAdapter {
  constructor() {
    super({ moduleId: 'knowledge', supportsStreaming: false });
  }

  protected async handleAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'create': return this.createKnowledgeBase(data as { name: string; type: string; description?: string });
      case 'read': return this.readKnowledgeBase(data as { id?: string });
      case 'update': return this.updateKnowledgeBase(data as { id: string } & Partial<KnowledgeBase>);
      case 'delete': return this.deleteKnowledgeBase(data as { id: string });
      case 'invoke': return this.uploadDocument(data as { id: string; title: string; content: string });
      case 'list': return this.listKnowledgeBases();
      default: throw new Error(`KnowledgeService: unsupported action '${action}'`);
    }
  }

  private createKnowledgeBase(data: { name: string; type: string; description?: string }): KnowledgeBase {
    if (!data.name || !data.type) throw new Error('name and type are required');
    const kb: KnowledgeBase = {
      id: uid('kb'), name: data.name, type: data.type,
      description: data.description || '', documentCount: 0,
      indexRate: 100, lastUpdated: today(), documents: [],
    };
    store.set(kb.id, kb);
    return kb;
  }

  private readKnowledgeBase(data: { id?: string }): unknown {
    if (data.id) {
      const kb = store.get(data.id);
      if (!kb) throw new Error(`KnowledgeBase not found: ${data.id}`);
      return kb;
    }
    return Array.from(store.values());
  }

  private updateKnowledgeBase(data: { id: string } & Partial<KnowledgeBase>): KnowledgeBase {
    const kb = store.get(data.id);
    if (!kb) throw new Error(`KnowledgeBase not found: ${data.id}`);
    Object.assign(kb, data);
    kb.lastUpdated = today();
    return kb;
  }

  private deleteKnowledgeBase(data: { id: string }): { id: string; deleted: boolean } {
    if (!store.has(data.id)) throw new Error(`KnowledgeBase not found: ${data.id}`);
    store.delete(data.id);
    return { id: data.id, deleted: true };
  }

  private uploadDocument(data: { id: string; title: string; content: string }): KnowledgeBase {
    const kb = store.get(data.id);
    if (!kb) throw new Error(`KnowledgeBase not found: ${data.id}`);
    const doc: Document = { id: uid('doc'), title: data.title, content: data.content, createdAt: today() };
    kb.documents.push(doc);
    kb.documentCount = kb.documents.length;
    kb.lastUpdated = today();
    return kb;
  }

  private listKnowledgeBases(): KnowledgeBase[] {
    return Array.from(store.values());
  }
}

export function createKnowledgeServiceAdapter(): KnowledgeService {
  return new KnowledgeService();
}
