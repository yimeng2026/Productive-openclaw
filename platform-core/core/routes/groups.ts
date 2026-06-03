import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getDb } from '../database/sqlite';
import crypto from 'crypto';

const router: Router = Router();

/* ── Types ─────────────────────────────────────────────── */

interface GroupMember {
  id: string;
  name: string;
  role: string;
  status: 'online' | 'offline' | 'busy';
}

interface GroupTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  assigneeId: string;
  priority: 'high' | 'medium' | 'low';
  progress: number;
}

interface GroupHealth {
  overall: string;
  issues: string[];
}

interface GroupHandoff {
  fromAgentId: string;
  toAgentId: string;
  context: string;
  status: 'pending' | 'active' | 'completed';
}

interface GroupMeeting {
  id: string;
  topic: string;
  participants: string[];
  status: 'active' | 'paused' | 'completed';
  startedAt: string;
}

interface GroupGovernance {
  leaderId?: string;
  rules: string[];
}

interface Group {
  id: string;
  name: string;
  description?: string;
  type: 'sequential' | 'parallel' | 'hierarchical' | 'dynamic';
  status: 'active' | 'paused' | 'completed';
  agents: string[];
  tasks: GroupTask[];
  members: GroupMember[];
  health?: GroupHealth;
  handoff?: GroupHandoff[];
  governance?: GroupGovernance;
  meeting?: GroupMeeting;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ─────────────────────────────────────────── */

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

async function initGroupsTable() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}

function packGroup(g: Group): any[] {
  const config = JSON.stringify({
    description: g.description,
    type: g.type,
    agents: g.agents,
    tasks: g.tasks,
    members: g.members,
    health: g.health,
    handoff: g.handoff,
    governance: g.governance,
    meeting: g.meeting,
    metadata: g.metadata,
  });
  return [g.id, g.name, g.status, config, g.createdAt, g.updatedAt];
}

function unpackGroup(row: any): Group {
  const cfg = row.config ? JSON.parse(row.config) : {};
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    description: cfg.description,
    type: cfg.type || 'parallel',
    agents: cfg.agents || [],
    tasks: cfg.tasks || [],
    members: cfg.members || [],
    health: cfg.health,
    handoff: cfg.handoff,
    governance: cfg.governance,
    meeting: cfg.meeting,
    metadata: cfg.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let tableReady = false;
async function ensureTable() {
  if (!tableReady) {
    await initGroupsTable();
    tableReady = true;
  }
}

/* ── Routes ────────────────────────────────────────────── */

// GET /api/groups
router.get('/', asyncWrapper(async (_req, res) => {
  await ensureTable();
  const db = await getDb();
  const rows = await db.all('SELECT * FROM groups ORDER BY created_at DESC');
  res.json({ success: true, data: rows.map(unpackGroup) });
}));

// GET /api/groups/:id
router.get('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  res.json({ success: true, data: unpackGroup(row) });
}));

// POST /api/groups — Create team (receives multiple agent IDs)
router.post('/', asyncWrapper(async (req, res) => {
  await ensureTable();
  const { name, description, type, agents, tasks, members, metadata } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ success: false, error: 'name required' });

  const t = now();
  const group: Group = {
    id: uid(),
    name,
    description,
    type: type || 'parallel',
    status: 'active',
    agents: agents || [],
    tasks: tasks || [],
    members: members || [],
    metadata,
    createdAt: t,
    updatedAt: t,
  };

  const db = await getDb();
  await db.run(
    'INSERT INTO groups (id, name, status, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    packGroup(group)
  );

  res.status(201).json({ success: true, data: group });
}));

// POST /api/groups/:id/agents — Add agent(s) to team
router.post('/:id/agents', asyncWrapper(async (req, res) => {
  await ensureTable();
  const { agentIds } = req.body;
  if (!Array.isArray(agentIds) || agentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'agentIds array required' });
  }

  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });

  const group = unpackGroup(row);
  const existing = new Set(group.agents);
  let added = 0;
  for (const aid of agentIds) {
    if (!existing.has(aid)) {
      group.agents.push(aid);
      added++;
    }
  }

  if (added > 0) {
    group.updatedAt = now();
    await db.run(
      'UPDATE groups SET config = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify({
        description: group.description,
        type: group.type,
        agents: group.agents,
        tasks: group.tasks,
        members: group.members,
        health: group.health,
        handoff: group.handoff,
        governance: group.governance,
        meeting: group.meeting,
        metadata: group.metadata,
      }), group.updatedAt, group.id]
    );
  }

  res.json({ success: true, data: group, added });
}));

// PUT /api/groups/:id
router.put('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });

  const existing = unpackGroup(row);
  const patch = req.body;

  const updated: Group = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now(),
  };

  await db.run(
    'UPDATE groups SET name = ?, status = ?, config = ?, updated_at = ? WHERE id = ?',
    [updated.name, updated.status, JSON.stringify({
      description: updated.description,
      type: updated.type,
      agents: updated.agents,
      tasks: updated.tasks,
      members: updated.members,
      health: updated.health,
      handoff: updated.handoff,
      governance: updated.governance,
      meeting: updated.meeting,
      metadata: updated.metadata,
    }), updated.updatedAt, updated.id]
  );

  res.json({ success: true, data: updated });
}));

// DELETE /api/groups/:id
router.delete('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const result = await db.run('DELETE FROM groups WHERE id = ?', [req.params.id]);
  if ((result.changes ?? 0) === 0) return res.status(404).json({ success: false, error: 'Group not found' });
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
}));

// GET /api/groups/:id/status
router.get('/:id/status', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: { id: group.id, status: group.status, agents: group.agents.length, tasks: group.tasks.length } });
}));

// PUT /api/groups/:id/status
router.put('/:id/status', asyncWrapper(async (req, res) => {
  await ensureTable();
  const { status } = req.body;
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });

  const t = now();
  const group = unpackGroup(row);
  group.status = status || group.status;
  group.updatedAt = t;

  await db.run(
    'UPDATE groups SET status = ?, config = ?, updated_at = ? WHERE id = ?',
    [group.status, JSON.stringify({
      description: group.description,
      type: group.type,
      agents: group.agents,
      tasks: group.tasks,
      members: group.members,
      health: group.health,
      handoff: group.handoff,
      governance: group.governance,
      meeting: group.meeting,
      metadata: group.metadata,
    }), t, group.id]
  );

  res.json({ success: true, data: group });
}));

// POST /api/groups/:id/meeting
router.post('/:id/meeting', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });

  const group = unpackGroup(row);
  const { topic, participants } = req.body;
  group.meeting = {
    id: uid(),
    topic: topic || 'Sync meeting',
    participants: participants || group.agents,
    status: 'active',
    startedAt: now(),
  };
  group.updatedAt = now();

  await db.run(
    'UPDATE groups SET config = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify({
      description: group.description,
      type: group.type,
      agents: group.agents,
      tasks: group.tasks,
      members: group.members,
      health: group.health,
      handoff: group.handoff,
      governance: group.governance,
      meeting: group.meeting,
      metadata: group.metadata,
    }), group.updatedAt, group.id]
  );

  res.json({ success: true, data: group.meeting });
}));

// GET /api/groups/:id/meetings
router.get('/:id/meetings', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: group.meeting ? [group.meeting] : [] });
}));

// POST /api/groups/:id/relay
router.post('/:id/relay', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: { id: group.id, relayed: true, agents: group.agents } });
}));

// GET /api/groups/:id/relays
router.get('/:id/relays', asyncWrapper(async (req, res) => {
  await ensureTable();
  res.json({ success: true, data: [] });
}));

// POST /api/groups/:id/interrupt
router.post('/:id/interrupt', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: { id: group.id, interrupted: true } });
}));

// GET /api/groups/:id/conflicts
router.get('/:id/conflicts', asyncWrapper(async (req, res) => {
  await ensureTable();
  res.json({ success: true, data: [] });
}));

// POST /api/groups/:id/resolve
router.post('/:id/resolve', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: { id: group.id, resolved: true } });
}));

// GET /api/groups/:id/health
router.get('/:id/health', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: group.health || { overall: 'healthy', issues: [] } });
}));

// GET /api/groups/:id/hierarchy
router.get('/:id/hierarchy', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  res.json({ success: true, data: { level: 1, children: [] } });
}));

// GET /api/groups/:id/reorganization
router.get('/:id/reorganization', asyncWrapper(async (req, res) => {
  await ensureTable();
  res.json({ success: true, data: { strategy: 'auto', recommended: [] } });
}));

// POST /api/groups/:id/reorganize
router.post('/:id/reorganize', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: { id: group.id, reorganized: true } });
}));

// POST /api/groups/:id/messages
router.post('/:id/messages', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({ success: true, data: { delivered: true, toAgents: group.agents } });
}));

// GET /api/groups/:id/governance
router.get('/:id/governance', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Group not found' });
  const group = unpackGroup(row);
  res.json({
    success: true,
    data: {
      provinces: {
        zhongshu: { name: '中书省', subtitle: '决策中枢', agents: [], stats: {} },
        menxia: { name: '门下省', subtitle: '审核机构', agents: [], stats: {} },
        shangshu: { name: '尚书省', subtitle: '执行机构', agents: [], stats: {} },
      },
      ministries: {
        li: { name: '礼部', subtitle: '协作礼仪', agents: group.agents.length, stats: {} },
        li2: { name: '吏部', subtitle: '人员调度', agents: group.agents.length, stats: {} },
        bing: { name: '兵部', subtitle: '任务执行', agents: group.tasks.length, stats: {} },
        hu: { name: '户部', subtitle: '资源管理', agents: 0, stats: {} },
        xing: { name: '刑部', subtitle: '冲突裁决', agents: 0, stats: {} },
        gong: { name: '工部', subtitle: '基础建设', agents: 0, stats: {} },
      },
    },
  });
}));

export default router;
