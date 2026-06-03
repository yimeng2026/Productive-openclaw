import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

const webhooks: any[] = [];

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: webhooks });
}));

router.post('/', asyncWrapper(async (req, res) => {
  const w = { id: crypto.randomUUID(), ...req.body, enabled: true };
  webhooks.push(w);
  res.status(201).json({ success: true, data: w });
}));

router.get('/:id', asyncWrapper(async (req, res) => {
  const w = webhooks.find(x => x.id === req.params.id);
  if (!w) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, data: w });
}));

router.put('/:id', asyncWrapper(async (req, res) => {
  const idx = webhooks.findIndex(x => x.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  webhooks[idx] = { ...webhooks[idx], ...req.body };
  res.json({ success: true, data: webhooks[idx] });
}));

router.delete('/:id', asyncWrapper(async (req, res) => {
  const idx = webhooks.findIndex(x => x.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  webhooks.splice(idx, 1);
  res.json({ success: true, message: 'Deleted' });
}));

router.post('/:id/test', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Webhook test sent (stub)' });
}));

export default router;
