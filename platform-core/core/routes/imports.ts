import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.post('/', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Import initiated (stub)', data: req.body });
}));

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { imports: [] } });
}));

export default router;
