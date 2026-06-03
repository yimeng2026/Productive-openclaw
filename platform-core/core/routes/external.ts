import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { integrations: [] } });
}));

router.get('/api/external/:endpoint', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { endpoint: req.params.endpoint } });
}));

export default router;
