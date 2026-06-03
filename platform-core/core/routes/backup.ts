import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

const backups: any[] = [];

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: backups });
}));

router.post('/', asyncWrapper(async (req, res) => {
  const b = { id: crypto.randomUUID(), note: req.body.note, size: 0, createdAt: new Date().toISOString() };
  backups.push(b);
  res.status(201).json({ success: true, data: b });
}));

router.get('/:id', asyncWrapper(async (req, res) => {
  const b = backups.find(x => x.id === req.params.id);
  if (!b) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.json({ success: true, data: b });
}));

router.post('/:id/restore', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Restore initiated (stub)' });
}));

router.get('/:id/download', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Download stub' });
}));

router.get('/:id/verify', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { valid: true } });
}));

router.delete('/:id', asyncWrapper(async (req, res) => {
  const idx = backups.findIndex(x => x.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  backups.splice(idx, 1);
  res.json({ success: true, message: 'Deleted' });
}));

export default router;
