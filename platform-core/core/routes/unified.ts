import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { status: 'ok', modules: [] } });
}));

export default router;
