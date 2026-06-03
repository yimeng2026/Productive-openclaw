import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
const router: Router = Router();

router.get('/', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { results: [] } });
}));

router.post('/', asyncWrapper(async (req, res) => {
  res.json({ success: true, data: { results: [] } });
}));

export default router;
