import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getDb } from '../database/sqlite';
import crypto from 'crypto';

const router: Router = Router();

/* ── Types ─────────────────────────────────────────────── */

interface Agent {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  provider?: string;
  apiConfigId?: string;
  model?: string;
  skills?: string[];
  knowledgeBases?: string[];
  memoryId?: string;
  workspaceId?: string;
  status: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  level_a?: string;
  level_b?: string;
  level_c?: string;
  agent_zero_enabled?: boolean;
  agent_zero_mode?: string;
  agent_zero_profile?: string;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ─────────────────────────────────────────── */

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

async function initAgentsTable() {
  const db = await getDb();
  await db.exec(\CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'idle',
    config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );\);
}

function packAgent(a: Agent): any[] {
  const config = JSON.stringify({
    description: a.description,
    avatar: a.avatar,
    provider: a.provider,
    apiConfigId: a.apiConfigId,
    model: a.model,
    skills: a.skills,
    knowledgeBases: a.knowledgeBases,
    memoryId: a.memoryId,
    workspaceId: a.workspaceId,
    temperature: a.temperature,
    maxTokens: a.maxTokens,
    systemPrompt: a.systemPrompt,
    level_a: a.level_a,
    level_b: a.level_b,
    level_c: a.level_c,
    agent_zero_enabled: a.agent_zero_enabled,
    agent_zero_mode: a.agent_zero_mode,
    agent_zero_profile: a.agent_zero_profile,
  });
  return [a.id, a.name, a.status, config, a.createdAt, a.updatedAt];
}

function unpackAgent(row: any): Agent {
  const cfg = row.config ? JSON.parse(row.config) : {};
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    description: cfg.description,
    avatar: cfg.avatar,
    provider: cfg.provider,
    apiConfigId: cfg.apiConfigId,
    model: cfg.model,
    skills: cfg.skills,
    knowledgeBases: cfg.knowledgeBases,
    memoryId: cfg.memoryId,
    workspaceId: cfg.workspaceId,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    systemPrompt: cfg.systemPrompt,
    level_a: cfg.level_a,
    level_b: cfg.level_b,
    level_c: cfg.level_c,
    agent_zero_enabled: cfg.agent_zero_enabled,
    agent_zero_mode: cfg.agent_zero_mode,
    agent_zero_profile: cfg.agent_zero_profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* Ensure table exists on first request */
let tableReady = false;
async function ensureTable() {
  if (!tableReady) {
    await initAgentsTable();
    tableReady = true;
  }
}

/* ── Routes ──────────────────────────────────────────── */

// GET /api/agents
router.get('/', asyncWrapper(async (_req, res) => {
  await ensureTable();
  const db = await getDb();
  const rows = await db.all('SELECT * FROM agents ORDER BY created_at DESC');
  res.json({ success: true, data: rows.map(unpackAgent) });
}));

// GET /api/agents/:id
router.get('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Agent not found' });
  res.json({ success: true, data: unpackAgent(row) });
}));

// POST /api/agents
router.post('/', asyncWrapper(async (req, res) => {
  await ensureTable();
  const { name, description, avatar, provider, apiConfigId, model, skills, knowledgeBases, memoryId, workspaceId, status, temperature, maxTokens, systemPrompt, level_a, level_b, level_c, agent_zero_enabled, agent_zero_mode, agent_zero_profile } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ success: false, error: 'name required' });

  const t = now();
  const agent: Agent = {
    id: uid(),
    name,
    description,
    avatar,
    provider,
    apiConfigId,
    model,
    skills,
    knowledgeBases,
    memoryId,
    workspaceId,
    status: status || 'idle',
    temperature,
    maxTokens,
    systemPrompt,
    level_a,
    level_b,
    level_c,
    agent_zero_enabled,
    agent_zero_mode,
    agent_zero_profile,
    createdAt: t,
    updatedAt: t,
  };

  const db = await getDb();
  await db.run(
    'INSERT INTO agents (id, name, status, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    packAgent(agent)
  );

  res.status(201).json({ success: true, data: agent });
}));

// PUT /api/agents/:id
router.put('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Agent not found' });

  const existing = unpackAgent(row);
  const patch = req.body;

  const updated: Agent = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now(),
  };

  await db.run(
    'UPDATE agents SET name = ?, status = ?, config = ?, updated_at = ? WHERE id = ?',
    [updated.name, updated.status, JSON.stringify({
      description: updated.description,
      avatar: updated.avatar,
      provider: updated.provider,
      apiConfigId: updated.apiConfigId,
      model: updated.model,
      skills: updated.skills,
      knowledgeBases: updated.knowledgeBases,
      memoryId: updated.memoryId,
      workspaceId: updated.workspaceId,
      temperature: updated.temperature,
      maxTokens: updated.maxTokens,
      systemPrompt: updated.systemPrompt,
      level_a: updated.level_a,
      level_b: updated.level_b,
      level_c: updated.level_c,
      agent_zero_enabled: updated.agent_zero_enabled,
      agent_zero_mode: updated.agent_zero_mode,
      agent_zero_profile: updated.agent_zero_profile,
    }), updated.updatedAt, updated.id]
  );

  res.json({ success: true, data: updated });
}));

// DELETE /api/agents/:id
router.delete('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const result = await db.run('DELETE FROM agents WHERE id = ?', [req.params.id]);
  if ((result.changes ?? 0) === 0) return res.status(404).json({ success: false, error: 'Agent not found' });
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
}));

// POST /api/agents/:id/start
router.post('/:id/start', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Agent not found' });

  const t = now();
  await db.run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['running', t, req.params.id]);

  const updated = unpackAgent({ ...row, status: 'running', updated_at: t });
  res.json({ success: true, data: updated });
}));

// POST /api/agents/:id/stop
router.post('/:id/stop', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Agent not found' });

  const t = now();
  await db.run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['idle', t, req.params.id]);

  const updated = unpackAgent({ ...row, status: 'idle', updated_at: t });
  res.json({ success: true, data: updated });
}));

export default router;
