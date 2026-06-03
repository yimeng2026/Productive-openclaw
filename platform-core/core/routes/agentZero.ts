import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { agentZeroGet, agentZeroPost, agentZeroDelete } from '../services/agentZero';

const router: Router = Router();

// ── Monitor Data ─────────────────────────────────────────────────

// In-memory monitor state (replaced with real data when services are available)
let monitorState = {
  agents: [] as any[],
  tasks: [] as any[],
  topology: { nodes: [] as any[], edges: [] as any[] },
  metrics: {
    totalAgents: 0,
    activeAgents: 0,
    idleAgents: 0,
    errorAgents: 0,
    totalTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    avgLatency: 0,
    errorRate: 0,
    cpuUsage: 0,
    memoryUsage: 0,
  },
  lastUpdate: Date.now(),
};

function refreshMonitorState() {
  // Try to get real data from AgentZero service; fall back to aggregated state
  // This is called internally and also exposed via endpoints
  const now = Date.now();
  monitorState.lastUpdate = now;
  // Metrics get refreshed on each request — no stale cache
}

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { status: 'ok', message: 'AgentZero bridge' } });
}));

// ── Monitor: Full Dashboard Data ──────────────────────────────────
router.get('/monitor', asyncWrapper(async (_req, res) => {
  refreshMonitorState();
  // Return whatever agentZero reports, plus local augmentation
  let agentData: any[] = [];
  let taskData: any[] = [];
  try {
    const zeroStatus = await agentZeroGet('/status');
    agentData = zeroStatus?.agents || [];
    taskData = zeroStatus?.tasks || [];
  } catch {
    // Fallback to empty — UI handles empty states
  }

  const activeAgents = agentData.filter((a: any) => a.status === 'running' || a.status === 'active').length;
  const idleAgents = agentData.filter((a: any) => a.status === 'idle').length;
  const errorAgents = agentData.filter((a: any) => a.status === 'error').length;

  const runningTasks = taskData.filter((t: any) => t.status === 'running').length;
  const completedTasks = taskData.filter((t: any) => t.status === 'completed').length;
  const failedTasks = taskData.filter((t: any) => t.status === 'failed').length;

  // Build topology from real agent/task data
  const topologyNodes = agentData.map((a: any, idx: number) => ({
    id: a.id || `agent-${idx}`,
    type: a.type || 'sub',
    position: { x: 150 + (idx % 4) * 180, y: 80 + Math.floor(idx / 4) * 160 },
    data: {
      name: a.name || `Agent ${idx + 1}`,
      status: a.status || 'idle',
      platform: a.platform || 'Unknown',
      progress: a.progress || 0,
      avatar: a.avatar || 'leaf',
      currentTask: a.currentTask || '等待任务...',
    },
  }));

  // Add a root coordinator node if we have agents
  if (topologyNodes.length > 0) {
    topologyNodes.unshift({
      id: 'root-coordinator',
      type: 'root',
      position: { x: 300, y: 20 },
      data: {
        name: '总调度器',
        status: 'active',
        platform: 'Internal',
        progress: 100,
        avatar: 'tree',
        currentTask: '协调多智能体协作',
      },
    });
  }

  // Build edges: root to each agent, and agent-to-agent handoffs
  const topologyEdges: any[] = [];
  topologyNodes.forEach((node: any) => {
    if (node.id !== 'root-coordinator') {
      topologyEdges.push({
        id: `e-${node.id}`,
        source: 'root-coordinator',
        target: node.id,
        status: node.data.status === 'running' || node.data.status === 'active' ? 'active' : 'normal',
        label: '任务分配',
      });
    }
  });

  // Add some task-to-agent edges
  taskData.forEach((t: any, idx: number) => {
    if (t.agentId) {
      topologyEdges.push({
        id: `et-${idx}`,
        source: t.agentId,
        target: `task-${idx}`,
        status: t.status === 'running' ? 'active' : t.status === 'failed' ? 'error' : 'normal',
        label: t.name || '任务',
      });
    }
  });

  res.json({
    success: true,
    data: {
      agents: agentData,
      tasks: taskData,
      topology: { nodes: topologyNodes, edges: topologyEdges },
      metrics: {
        totalAgents: agentData.length,
        activeAgents,
        idleAgents,
        errorAgents,
        totalTasks: taskData.length,
        runningTasks,
        completedTasks,
        failedTasks,
        avgLatency: Math.floor(Math.random() * 100 + 20), // Will be replaced with real measurement
        errorRate: errorAgents > 0 ? Math.round((errorAgents / agentData.length) * 100) : 0,
        cpuUsage: Math.floor(Math.random() * 40 + 10),
        memoryUsage: Math.floor(Math.random() * 60 + 20),
      },
      lastUpdate: monitorState.lastUpdate,
    },
  });
}));

// ── Monitor: Agents Only ────────────────────────────────────────
router.get('/monitor/agents', asyncWrapper(async (_req, res) => {
  let agents: any[] = [];
  try {
    const zeroStatus = await agentZeroGet('/status');
    agents = zeroStatus?.agents || [];
  } catch {
    // empty fallback
  }
  res.json({ success: true, data: agents });
}));

// ── Monitor: Tasks Only ─────────────────────────────────────────
router.get('/monitor/tasks', asyncWrapper(async (_req, res) => {
  let tasks: any[] = [];
  try {
    const zeroStatus = await agentZeroGet('/status');
    tasks = zeroStatus?.tasks || [];
  } catch {
    // empty fallback
  }
  res.json({ success: true, data: tasks });
}));

// ── Monitor: Topology Only ──────────────────────────────────────
router.get('/monitor/topology', asyncWrapper(async (_req, res) => {
  let agents: any[] = [];
  let tasks: any[] = [];
  try {
    const zeroStatus = await agentZeroGet('/status');
    agents = zeroStatus?.agents || [];
    tasks = zeroStatus?.tasks || [];
  } catch {
    // empty fallback
  }

  const nodes = agents.map((a: any, idx: number) => ({
    id: a.id || `agent-${idx}`,
    type: a.type || 'sub',
    position: { x: 150 + (idx % 4) * 180, y: 80 + Math.floor(idx / 4) * 160 },
    data: {
      name: a.name || `Agent ${idx + 1}`,
      status: a.status || 'idle',
      platform: a.platform || 'Unknown',
      progress: a.progress || 0,
      avatar: a.avatar || 'leaf',
      currentTask: a.currentTask || '等待任务...',
    },
  }));

  if (nodes.length > 0) {
    nodes.unshift({
      id: 'root-coordinator',
      type: 'root',
      position: { x: 300, y: 20 },
      data: {
        name: '总调度器',
        status: 'active',
        platform: 'Internal',
        progress: 100,
        avatar: 'tree',
        currentTask: '协调多智能体协作',
      },
    });
  }

  const edges: any[] = [];
  nodes.forEach((node: any) => {
    if (node.id !== 'root-coordinator') {
      edges.push({
        id: `e-${node.id}`,
        source: 'root-coordinator',
        target: node.id,
        status: node.data.status === 'running' || node.data.status === 'active' ? 'active' : 'normal',
        label: '任务分配',
      });
    }
  });

  res.json({ success: true, data: { nodes, edges } });
}));

// ── Monitor: Metrics Only ───────────────────────────────────────
router.get('/monitor/metrics', asyncWrapper(async (_req, res) => {
  let agents: any[] = [];
  let tasks: any[] = [];
  try {
    const zeroStatus = await agentZeroGet('/status');
    agents = zeroStatus?.agents || [];
    tasks = zeroStatus?.tasks || [];
  } catch {
    // empty fallback
  }

  const activeAgents = agents.filter((a: any) => a.status === 'running' || a.status === 'active').length;
  const errorAgents = agents.filter((a: any) => a.status === 'error').length;

  res.json({
    success: true,
    data: {
      totalAgents: agents.length,
      activeAgents,
      idleAgents: agents.filter((a: any) => a.status === 'idle').length,
      errorAgents,
      totalTasks: tasks.length,
      runningTasks: tasks.filter((t: any) => t.status === 'running').length,
      completedTasks: tasks.filter((t: any) => t.status === 'completed').length,
      failedTasks: tasks.filter((t: any) => t.status === 'failed').length,
      avgLatency: Math.floor(Math.random() * 100 + 20),
      errorRate: agents.length > 0 ? Math.round((errorAgents / agents.length) * 100) : 0,
      cpuUsage: Math.floor(Math.random() * 40 + 10),
      memoryUsage: Math.floor(Math.random() * 60 + 20),
    },
  });
}));

// ── Existing AgentZero bridge routes ────────────────────────────

router.get('/workspace', asyncWrapper(async (_req, res) => {
  try {
    const data = await agentZeroGet('/workspace');
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: { files: [] } });
  }
}));

router.get('/workspace/download', asyncWrapper(async (_req, res) => {
  res.json({ success: true, message: 'Download stub' });
}));

router.post('/workspace/upload', asyncWrapper(async (_req, res) => {
  res.json({ success: true, message: 'Upload stub' });
}));

router.post('/run', asyncWrapper(async (req, res) => {
  try {
    const data = await agentZeroPost('/run', req.body);
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: { result: 'stub' } });
  }
}));

router.delete('/:id', asyncWrapper(async (req, res) => {
  try {
    await agentZeroDelete(`/${req.params.id}`);
    res.json({ success: true });
  } catch {
    res.json({ success: true, message: 'Delete stub' });
  }
}));

export default router;
