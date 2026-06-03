import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getDb } from '../database/sqlite';
import crypto from 'crypto';

const router: Router = Router();

/* ── Types ─────────────────────────────────────────────── */

interface BlueprintNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config?: Record<string, any>;
}

interface BlueprintEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface Blueprint {
  id: string;
  name: string;
  description?: string;
  category?: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface BlueprintExecution {
  id: string;
  blueprintId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  startedAt?: string;
  completedAt?: string;
  logs?: string[];
}

/* ── Helpers ─────────────────────────────────────────── */

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

async function initBlueprintsTables() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS blueprints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
  await db.exec(`CREATE TABLE IF NOT EXISTS blueprint_executions (
    id TEXT PRIMARY KEY,
    blueprint_id TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    logs TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
}

function packBlueprint(b: Blueprint): any[] {
  const config = JSON.stringify({
    description: b.description,
    category: b.category,
    nodes: b.nodes,
    edges: b.edges,
  });
  return [b.id, b.name, b.status, config, b.createdAt, b.updatedAt];
}

function unpackBlueprint(row: any): Blueprint {
  const cfg = row.config ? JSON.parse(row.config) : {};
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    description: cfg.description,
    category: cfg.category,
    nodes: cfg.nodes || [],
    edges: cfg.edges || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function packExecution(e: BlueprintExecution): any[] {
  return [e.id, e.blueprintId, e.status, e.result, e.logs ? JSON.stringify(e.logs) : null, e.startedAt, e.completedAt, e.startedAt];
}

function unpackExecution(row: any): BlueprintExecution {
  return {
    id: row.id,
    blueprintId: row.blueprint_id,
    status: row.status,
    result: row.result,
    logs: row.logs ? JSON.parse(row.logs) : [],
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

let tableReady = false;
async function ensureTable() {
  if (!tableReady) {
    await initBlueprintsTables();
    tableReady = true;
  }
}

/* ── Routes ────────────────────────────────────────────── */

// GET /api/blueprints
router.get('/', asyncWrapper(async (_req, res) => {
  await ensureTable();
  const db = await getDb();
  const rows = await db.all('SELECT * FROM blueprints ORDER BY created_at DESC');
  res.json({ success: true, data: rows.map(unpackBlueprint) });
}));

// GET /api/blueprints/:id
router.get('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM blueprints WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Blueprint not found' });
  res.json({ success: true, data: unpackBlueprint(row) });
}));

// POST /api/blueprints — Create nested / blueprint
router.post('/', asyncWrapper(async (req, res) => {
  await ensureTable();
  const { name, description, category, nodes, edges, status } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ success: false, error: 'name required' });

  const t = now();
  const blueprint: Blueprint = {
    id: uid(),
    name,
    description,
    category,
    nodes: nodes || [],
    edges: edges || [],
    status: status || 'draft',
    createdAt: t,
    updatedAt: t,
  };

  const db = await getDb();
  await db.run(
    'INSERT INTO blueprints (id, name, status, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    packBlueprint(blueprint)
  );

  res.status(201).json({ success: true, data: blueprint });
}));

// PUT /api/blueprints/:id
router.put('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const row = await db.get('SELECT * FROM blueprints WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: 'Blueprint not found' });

  const existing = unpackBlueprint(row);
  const patch = req.body;

  const updated: Blueprint = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now(),
  };

  await db.run(
    'UPDATE blueprints SET name = ?, status = ?, config = ?, updated_at = ? WHERE id = ?',
    [updated.name, updated.status, JSON.stringify({
      description: updated.description,
      category: updated.category,
      nodes: updated.nodes,
      edges: updated.edges,
    }), updated.updatedAt, updated.id]
  );

  res.json({ success: true, data: updated });
}));

// DELETE /api/blueprints/:id
router.delete('/:id', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const result = await db.run('DELETE FROM blueprints WHERE id = ?', [req.params.id]);
  if ((result.changes ?? 0) === 0) return res.status(404).json({ success: false, error: 'Blueprint not found' });
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
}));

/* ── Execution routes ──────────────────────────────────── */

// GET /api/blueprints/:id/executions
router.get('/:id/executions', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const rows = await db.all('SELECT * FROM blueprint_executions WHERE blueprint_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json({ success: true, data: rows.map(unpackExecution) });
}));

// POST /api/blueprints/:id/executions
router.post('/:id/executions', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const bpRow = await db.get('SELECT * FROM blueprints WHERE id = ?', [req.params.id]);
  if (!bpRow) return res.status(404).json({ success: false, error: 'Blueprint not found' });

  const t = now();
  const execution: BlueprintExecution = {
    id: uid(),
    blueprintId: req.params.id,
    status: 'pending',
    startedAt: t,
    logs: [],
  };

  await db.run(
    'INSERT INTO blueprint_executions (id, blueprint_id, status, result, logs, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    packExecution(execution)
  );

  res.status(201).json({ success: true, data: execution });
}));

// POST /api/blueprints/:id/execute
router.post('/:id/execute', asyncWrapper(async (req, res) => {
  await ensureTable();
  const db = await getDb();
  const bpRow = await db.get('SELECT * FROM blueprints WHERE id = ?', [req.params.id]);
  if (!bpRow) return res.status(404).json({ success: false, error: 'Blueprint not found' });

  const t = now();
  const execution: BlueprintExecution = {
    id: uid(),
    blueprintId: req.params.id,
    status: 'running',
    startedAt: t,
    logs: ['Execution started'],
  };

  await db.run(
    'INSERT INTO blueprint_executions (id, blueprint_id, status, result, logs, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    packExecution(execution)
  );

  // Simulate async completion
  setTimeout(async () => {
    try {
      await db.run(
        'UPDATE blueprint_executions SET status = ?, result = ?, completed_at = ? WHERE id = ?',
        ['completed', 'Execution completed successfully', now(), execution.id]
      );
    } catch (e) {
      await db.run(
        'UPDATE blueprint_executions SET status = ?, result = ? WHERE id = ?',
        ['failed', String(e), execution.id]
      );
    }
  }, 2000);

  res.status(201).json({ success: true, data: execution });
}));

export default router;
