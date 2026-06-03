import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: { entries: [] } });
}));

router.get('/:id', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { id: req.params.id } });
}));

export default router;
