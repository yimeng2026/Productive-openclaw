import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import multer from 'multer';
const router: Router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, 'uploads/'),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const uploads: any[] = [];

router.get('/', asyncWrapper(async (_req, res) => {
  res.json({ success: true, data: uploads });
}));

router.post('/', upload.single('file'), asyncWrapper(async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ success: false, error: 'No file' }); return; }
  const record = { id: crypto.randomUUID(), filename: file.originalname, mimetype: file.mimetype, size: file.size, path: file.path, createdAt: new Date().toISOString() };
  uploads.push(record);
  res.status(201).json({ success: true, data: record });
}));

router.get('/:id/download', asyncWrapper(async (req, res) => {
  const u = uploads.find(x => x.id === req.params.id);
  if (!u) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.download(u.path, u.filename);
}));

router.get('/:id/preview', asyncWrapper(async (req, res) => {
  const u = uploads.find(x => x.id === req.params.id);
  if (!u) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  res.sendFile(u.path, { root: process.cwd() });
}));

router.delete('/:id', asyncWrapper(async (req, res) => {
  const idx = uploads.findIndex(x => x.id === req.params.id);
  if (idx === -1) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  uploads.splice(idx, 1);
  res.json({ success: true, message: 'Deleted' });
}));

export default router;
