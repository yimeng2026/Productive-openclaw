import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { results: [], total: 0 } });
}));

router.get('/indexes', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: [] });
}));

router.post('/indexes', asyncWrapper(async (req, res) => {
  res.status(201).json({ success: true, data: { name: req.body.name } });
}));

router.post('/indexes/:name/reindex', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: `Reindexing ${req.params.name} (stub)` });
}));

export default router;
