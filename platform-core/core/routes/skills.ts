import { Router } from 'express';
import { asyncWrapper } from '../utils/asyncWrapper';
import { getSkillsReal } from '../services/platformService';
import { getSkillBridge } from '../coordinator/bridges';

const router: Router = Router();

/* ── 内存存储 ─────────────────────────────────────────────── */

interface Skill {
  id: string;
  name: string;
  category: string;
  description?: string;
  config: Record<string, any>;
  installed: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const skillsMap = new Map<string, Skill>();

// 预置种子数据（与真实扫描数据合并后使用）
const seedSkills: Skill[] = [
  { id: 'skill-search', name: '网络搜索', category: 'search', description: 'Web搜索技能', config: {}, installed: true, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'skill-media', name: '图像处理', category: 'media', description: '图像分析与生成', config: {}, installed: true, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'skill-ocr', name: '文档处理', category: 'ocr', description: 'OCR与文档解析', config: {}, installed: true, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

seedSkills.forEach((s) => skillsMap.set(s.id, s));

/* ── 路由（5端点）───────────────────────────────────────────── */

// GET /skills — 列出所有技能
router.get('/', asyncWrapper(async (_req, res) => {
  // 合并内存存储与真实扫描数据
  const scanned = await getSkillsReal();
  const scannedIds = new Set(scanned.map((s) => s.id));

  for (const s of scanned as any[]) {
    if (!skillsMap.has(s.id)) {
      skillsMap.set(s.id, {
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        config: s.config || {},
        installed: s.installed ?? false,
        enabled: s.enabled ?? false,
        createdAt: s.createdAt || new Date().toISOString(),
        updatedAt: s.updatedAt || new Date().toISOString(),
      });
    }
  }

  const all = Array.from(skillsMap.values());
  res.json({ success: true, data: all, count: all.length });
}));

// POST /skills — 创建技能
router.post('/', asyncWrapper(async (req, res) => {
  const { name, category, description, config } = req.body;

  if (!name || !category) {
    return res.status(400).json({ success: false, error: 'name and category required' });
  }

  const id = `skill-${Date.now()}`;
  const now = new Date().toISOString();
  const skill: Skill = {
    id,
    name,
    category,
    description: description || '',
    config: config || {},
    installed: false,
    enabled: false,
    createdAt: now,
    updatedAt: now,
  };

  skillsMap.set(id, skill);
  res.status(201).json({ success: true, data: skill });
}));

// DELETE /skills/:id — 删除技能
router.delete('/:id', asyncWrapper(async (req, res) => {
  const skill = skillsMap.get(req.params.id);
  if (!skill) {
    return res.status(404).json({ success: false, error: 'Skill not found' });
  }

  skillsMap.delete(req.params.id);
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
}));

// PUT /skills/:id/config — 更新技能配置
router.put('/:id/config', asyncWrapper(async (req, res) => {
  const skill = skillsMap.get(req.params.id);
  if (!skill) {
    return res.status(404).json({ success: false, error: 'Skill not found' });
  }

  const { config } = req.body;
  if (config && typeof config === 'object') {
    skill.config = { ...skill.config, ...config };
  }
  skill.updatedAt = new Date().toISOString();

  res.json({ success: true, data: skill });
}));

// GET /skills/:id/status — 技能健康状态
router.get('/:id/status', asyncWrapper(async (req, res) => {
  const skill = skillsMap.get(req.params.id);
  if (!skill) {
    return res.status(404).json({ success: false, error: 'Skill not found' });
  }

  try {
    const bridge = getSkillBridge();
    const health = await bridge.checkHealth(req.params.id);
    res.json({
      success: true,
      data: {
        id: req.params.id,
        installed: skill.installed,
        enabled: skill.enabled,
        healthy: health.healthy,
        error: health.error,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (_err) {
    res.json({
      success: true,
      data: {
        id: req.params.id,
        installed: skill.installed,
        enabled: skill.enabled,
        healthy: null,
        error: 'Health check unavailable',
        checkedAt: new Date().toISOString(),
      },
    });
  }
}));

export default router;
