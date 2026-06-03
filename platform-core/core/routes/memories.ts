import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { listMemories, getMemory, createMemory, deleteMemory } from '../services/memoryService';
const router: Router = Router();

router.get('/', asyncWrapper(async (req, res) => {
  const data = await listMemories(req.query.agentId as string | undefined);
  res.json({ success: true, data });
}));

router.get('/:id', asyncWrapper(async (req, res) => {
  const data = await getMemory(req.params.id);
  if (!data) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, data });
}));

router.post('/', asyncWrapper(async (req, res) => {
  const data = await createMemory(req.body);
  res.status(201).json({ success: true, data });
}));

router.delete('/:id', asyncWrapper(async (req, res) => {
  const ok = await deleteMemory(req.params.id);
  if (!ok) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, message: 'Deleted' });
}));

router.post('/search', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: [] });
}));

router.post('/:id/sync', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Sync initiated (stub)' });
}));

export default router;
