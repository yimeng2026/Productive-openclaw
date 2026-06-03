import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/acl', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: [] });
}));

router.post('/acl', asyncWrapper(async (req, res) => {
  res.status(201).json({ success: true, data: { id: crypto.randomUUID(), ...req.body } });
}));

router.put('/acl/:id', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { id: req.params.id, ...req.body } });
}));

router.delete('/acl/:id', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Deleted' });
}));

router.get('/ip-blocklist', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: [] });
}));

router.post('/ip-blocklist', asyncWrapper(async (req, res) => {
  res.status(201).json({ success: true, data: req.body });
}));

router.delete('/ip-blocklist/:id', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Deleted' });
}));

router.get('/audit-logs', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: [] });
}));

export default router;
