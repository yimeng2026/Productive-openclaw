import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { ollamaListModels, ollamaGenerate, ollamaChat, ollamaStatus } from '../services/ollamaService';
const router: Router = Router();

router.get('/models', asyncWrapper(async (_req, res) => {
  try {
    const data = await ollamaListModels();
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: { models: [] } });
  }
}));

router.get('/status', asyncWrapper(async (_req, res) => {
  try {
    const data = await ollamaStatus();
    res.json({ success: true, data });
  } catch {
    res.json({ success: true, data: { running: false } });
  }
}));

router.post('/generate', asyncWrapper(async (req, res) => {
  try {
    const data = await ollamaGenerate(req.body.model, req.body.prompt);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(503).json({ success: false, error: err.message });
  }
}));

router.post('/chat', asyncWrapper(async (req, res) => {
  try {
    const data = await ollamaChat(req.body.model, req.body.messages);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(503).json({ success: false, error: err.message });
  }
}));

export default router;
