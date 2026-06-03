import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

const settings = new Map<string, any>();

router.get('/', asyncWrapper(async (_req, res) => {
  const obj: Record<string, any> = {};
  for (const [k, v] of settings) obj[k] = v;
  res.json({ success: true, data: obj });
}));

router.get('/:key', asyncWrapper(async (req, res) => {
  const v = settings.get(req.params.key);
  if (v === undefined) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, data: { key: req.params.key, value: v } });
}));

router.put('/:key', asyncWrapper(async (req, res) => {
  settings.set(req.params.key, req.body.value);
  res.json({ success: true, data: { key: req.params.key, value: req.body.value } });
}));

router.delete('/:key', asyncWrapper(async (req, res) => {
  settings.delete(req.params.key);
  res.json({ success: true, message: 'Deleted' });
}));

export default router;
