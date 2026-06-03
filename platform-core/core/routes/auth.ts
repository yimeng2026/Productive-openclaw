import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { generateToken } from '../middleware/auth';
const router: Router = Router();

const users = new Map<string, { id: string; username: string; email: string; password: string; role: string }>();

router.post('/register', asyncWrapper(async (req, res) => {
  const { username, email, password } = req.body;
  const id = crypto.randomUUID();
  users.set(id, { id, username, email, password, role: 'user' });
  res.status(201).json({ success: true, data: { id, username, email } });
}));

router.post('/login', asyncWrapper(async (req, res) => {
  const { username, password } = req.body;
  const user = Array.from(users.values()).find(u => u.username === username && u.password === password);
  if (!user) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }
  const token = generateToken({ id: user.id, username: user.username, role: user.role });
  res.json({ success: true, data: { token, user: { id: user.id, username, role: user.role } } });
}));

router.post('/refresh', asyncWrapper(async (req, res) => {
  const { token } = req.body;
  // Stub: return same token
  res.json({ success: true, data: { token } });
}));

router.post('/logout', asyncWrapper(async (_req, res) => {
  res.json({ success: true, message: 'Logged out' });
}));

router.get('/me', asyncWrapper(async (req, res) => {
  const user = (req as any).user;
  res.json({ success: true, data: user || { id: 'guest', username: 'guest', role: 'guest' } });
}));

router.post('/forgot-password', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Reset link sent (stub)' });
}));

router.post('/reset-password', asyncWrapper(async (req, res) => {
  res.json({ success: true, message: 'Password reset (stub)' });
}));

export default router;
