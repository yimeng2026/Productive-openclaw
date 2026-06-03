import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

const tasks: any[] = [];

router.get('/tasks', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: tasks });
}));

router.post('/tasks', asyncWrapper(async (req, res) => {
  const t = { id: crypto.randomUUID(), ...req.body, enabled: true };
  tasks.push(t);
  res.status(201).json({ success: true, data: t });
}));

router.get('/tasks/:id', asyncWrapper(async (req, res) => {
  const t = tasks.find(x => x.id === req.params.id);
  if (!t) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, data: t });
}));

router.put('/tasks/:id', asyncWrapper(async (req, res) => {
  const idx = tasks.findIndex(x => x.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  tasks[idx] = { ...tasks[idx], ...req.body };
  res.json({ success: true, data: tasks[idx] });
}));

router.delete('/tasks/:id', asyncWrapper(async (req, res) => {
  const idx = tasks.findIndex(x => x.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  tasks.splice(idx, 1);
  res.json({ success: true, message: 'Deleted' });
}));

router.post('/tasks/:id/run', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Task run initiated (stub)' });
}));

router.post('/tasks/:id/pause', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Task paused (stub)' });
}));

router.post('/tasks/:id/resume', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Task resumed (stub)' });
}));

export default router;
