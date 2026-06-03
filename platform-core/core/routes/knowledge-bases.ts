import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';

const router: Router = Router();

export interface KnowledgeBaseItem {
  id: string;
  name: string;
  type: string;
  description: string;
  documentCount: number;
  indexRate: number;
  lastUpdated: string;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

interface KnowledgeBase extends KnowledgeBaseItem {
  documents: Document[];
}

const store = new Map<string, KnowledgeBase>();
export const knowledgeBases: KnowledgeBaseItem[] = [];

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);
const item = (kb: KnowledgeBase): KnowledgeBaseItem => ({
  id: kb.id, name: kb.name, type: kb.type, description: kb.description,
  documentCount: kb.documents.length, indexRate: kb.indexRate, lastUpdated: kb.lastUpdated,
});
const sync = () => {
  knowledgeBases.length = 0;
  for (const kb of store.values()) knowledgeBases.push(item(kb));
};
const fail = (res: any, code: number, msg: string) => res.status(code).json({ success: false, error: msg });

[
  { id: 'kb-1', name: '技术文档库', type: '文档', description: 'API文档、技术规范和开发指南' },
  { id: 'kb-2', name: '产品知识库', type: '产品', description: '产品功能、使用手册和FAQ' },
  { id: 'kb-3', name: 'API参考手册', type: 'API', description: '内部API接口文档和示例' },
  { id: 'kb-4', name: '设计规范', type: '设计', description: 'UI/UX设计规范和组件库' },
  { id: 'kb-5', name: '会议纪要', type: '会议', description: '团队会议记录和决策追踪' },
  { id: 'kb-6', name: '通用知识', type: '通用', description: '通用知识和最佳实践' },
].forEach((s) => store.set(s.id, { ...s, documentCount: 0, indexRate: 100, lastUpdated: today(), documents: [] }));
sync();

// GET / — list all
router.get('/', asyncWrapper(async (_req, res) => res.json({ success: true, data: knowledgeBases })));

// POST / — create
router.post('/', asyncWrapper(async (req, res) => {
  const { name, type, description } = req.body;
  if (!name || !type) return fail(res, 400, 'name and type are required');
  const kb: KnowledgeBase = { id: uid('kb'), name, type, description: description || '', documentCount: 0, indexRate: 100, lastUpdated: today(), documents: [] };
  store.set(kb.id, kb); sync();
  res.status(201).json({ success: true, data: item(kb) });
}));

// GET /:id
router.get('/:id', asyncWrapper(async (req, res) => {
  const kb = store.get(req.params.id);
  if (!kb) return fail(res, 404, 'Knowledge base not found');
  res.json({ success: true, data: kb });
}));

// PUT /:id
router.put('/:id', asyncWrapper(async (req, res) => {
  const kb = store.get(req.params.id);
  if (!kb) return fail(res, 404, 'Knowledge base not found');
  const { name, type, description, indexRate } = req.body;
  if (name !== undefined) kb.name = name;
  if (type !== undefined) kb.type = type;
  if (description !== undefined) kb.description = description;
  if (indexRate !== undefined) kb.indexRate = indexRate;
  kb.lastUpdated = today(); kb.documentCount = kb.documents.length;
  sync(); res.json({ success: true, data: item(kb) });
}));

// DELETE /:id
router.delete('/:id', asyncWrapper(async (req, res) => {
  const kb = store.get(req.params.id);
  if (!kb) return fail(res, 404, 'Knowledge base not found');
  store.delete(req.params.id); sync();
  res.json({ success: true, data: { id: kb.id, deleted: true } });
}));

// POST /:id/documents
router.post('/:id/documents', asyncWrapper(async (req, res) => {
  const kb = store.get(req.params.id);
  if (!kb) return fail(res, 404, 'Knowledge base not found');
  const { title, content } = req.body;
  if (!title) return fail(res, 400, 'title is required');
  const doc: Document = { id: uid('doc'), title, content: content || '', createdAt: new Date().toISOString() };
  kb.documents.push(doc); kb.documentCount = kb.documents.length; kb.lastUpdated = today();
  sync(); res.status(201).json({ success: true, data: doc });
}));

// DELETE /:id/documents/:docId
router.delete('/:id/documents/:docId', asyncWrapper(async (req, res) => {
  const kb = store.get(req.params.id);
  if (!kb) return fail(res, 404, 'Knowledge base not found');
  const idx = kb.documents.findIndex((d) => d.id === req.params.docId);
  if (idx === -1) return fail(res, 404, 'Document not found');
  const doc = kb.documents.splice(idx, 1)[0];
  kb.documentCount = kb.documents.length; kb.lastUpdated = today();
  sync(); res.json({ success: true, data: { docId: doc.id, deleted: true } });
}));

// POST /:id/search
router.post('/:id/search', asyncWrapper(async (req, res) => {
  const kb = store.get(req.params.id);
  if (!kb) return fail(res, 404, 'Knowledge base not found');
  const { query } = req.body;
  if (!query) return fail(res, 400, 'query is required');
  const q = query.toLowerCase();
  const results = kb.documents.filter((d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q));
  res.json({ success: true, data: { query, total: results.length, results } });
}));

export default router;
