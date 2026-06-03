import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { fetchAllAgentRuntimes } from '../services/agentZero';

const router: Router = Router();

// In-memory process registry (simulated; in production this queries PM2 / systemd / Docker)
interface ProcessInfo {
  id: string;
  name: string;
  pid: number;
  status: 'running' | 'stopped' | 'error' | 'restarting';
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  type: 'agent' | 'system' | 'bridge' | 'scheduler';
  agentId?: string;
}

let processRegistry: ProcessInfo[] = [
  { id: 'proc-1', name: 'Agent Runtime Pool', pid: 12345, status: 'running', cpu: 12, memory: 245, uptime: 3600, restarts: 0, type: 'system' },
  { id: 'proc-2', name: 'Swarm Coordinator', pid: 12346, status: 'running', cpu: 8, memory: 128, uptime: 3600, restarts: 0, type: 'bridge' },
  { id: 'proc-3', name: 'Task Scheduler', pid: 12347, status: 'running', cpu: 5, memory: 64, uptime: 3600, restarts: 0, type: 'scheduler' },
];

function refreshProcesses() {
  // Simulate slight CPU/memory fluctuations
  processRegistry = processRegistry.map((p) => ({
    ...p,
    cpu: Math.max(0, Math.min(100, p.cpu + Math.floor(Math.random() * 6) - 3)),
    memory: Math.max(10, Math.min(1024, p.memory + Math.floor(Math.random() * 10) - 5)),
    uptime: p.uptime + 5,
  }));
}

router.get('/', asyncWrapper(async (_req, res) => {
  refreshProcesses();
  res.json({ success: true, data: { processes: processRegistry } });
}));

// Detailed process stats
router.get('/stats', asyncWrapper(async (_req, res) => {
  refreshProcesses();
  const totalCpu = processRegistry.reduce((sum, p) => sum + p.cpu, 0);
  const totalMem = processRegistry.reduce((sum, p) => sum + p.memory, 0);
  const running = processRegistry.filter((p) => p.status === 'running').length;
  const stopped = processRegistry.filter((p) => p.status === 'stopped').length;
  const errors = processRegistry.filter((p) => p.status === 'error').length;

  res.json({
    success: true,
    data: {
      processes: processRegistry,
      summary: {
        total: processRegistry.length,
        running,
        stopped,
        errors,
        totalCpu,
        totalMemory: totalMem,
        avgCpu: Math.round(totalCpu / processRegistry.length) || 0,
        avgMemory: Math.round(totalMem / processRegistry.length) || 0,
      },
    },
  });
}));

// Process by ID
router.get('/:id', asyncWrapper(async (req, res) => {
  const proc = processRegistry.find((p) => p.id === req.params.id);
  if (!proc) {
    res.status(404).json({ success: false, error: 'Process not found' });
    return;
  }
  res.json({ success: true, data: proc });
}));

// Restart a process
router.post('/:id/restart', asyncWrapper(async (req, res) => {
  const idx = processRegistry.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Process not found' });
    return;
  }
  processRegistry[idx] = {
    ...processRegistry[idx],
    status: 'restarting',
    restarts: processRegistry[idx].restarts + 1,
  };
  // Simulate restart completion
  setTimeout(() => {
    processRegistry[idx] = {
      ...processRegistry[idx],
      status: 'running',
      uptime: 0,
      pid: Math.floor(Math.random() * 50000) + 10000,
    };
  }, 2000);
  res.json({ success: true, data: processRegistry[idx] });
}));

// Kill a process
router.post('/:id/kill', asyncWrapper(async (req, res) => {
  const idx = processRegistry.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, error: 'Process not found' });
    return;
  }
  processRegistry[idx] = { ...processRegistry[idx], status: 'stopped', cpu: 0, memory: 0 };
  res.json({ success: true, data: processRegistry[idx] });
}));

export default router;
