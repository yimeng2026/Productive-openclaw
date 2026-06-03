import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { runtimes: [] } });
}));

router.post('/:id/start', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { agentId: req.params.id, status: 'running' } });
}));

router.post('/:id/stop', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { agentId: req.params.id, status: 'stopped' } });
}));

export default router;
