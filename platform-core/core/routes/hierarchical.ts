/**
 * Hierarchical Orchestration API Routes
 * 
 * 暴露分层协调系统的所有功能:
 * - /hierarchical/tree — 获取分层树结构
 * - /hierarchical/coordinators — 协调员 CRUD
 * - /hierarchical/agents — Agent 状态
 * - /hierarchical/intervene — 人工干预
 * - /hierarchical/approvals — 审批队列
 * - /hierarchical/alerts — 告警管理
 * - /hierarchical/monitor — 监控数据流 (WebSocket upgrade)
 * 
 * @author SYLVA
 * @version 2.0.0
 */

// @ts-nocheck — agent-zero 模块缺失，跳过类型检查

import { Router } from 'express';
import { getHierarchicalMonitor } from '../../../agent-zero/helpers/hierarchical_monitor';
import { getInterventionInterface } from '../../../agent-zero/helpers/intervention_interface';
import { getStateManager } from '../../../agent-zero/helpers/coordinator_state_manager';
import { SubGroupCoordinator } from '../../../agent-zero/helpers/sub_group_coordinator';

const router: Router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/tree — 完整分层树
// ─────────────────────────────────────────────────────────────────────────────

router.get('/tree', (req, res) => {
  try {
    const monitor = getHierarchicalMonitor();
    const tree = monitor.buildTree();
    res.json({ success: true, data: tree });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/status — 扁平化状态列表
// ─────────────────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  try {
    const monitor = getHierarchicalMonitor();
    const status = monitor.getFlatStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/coordinators — 所有协调员
// ─────────────────────────────────────────────────────────────────────────────

router.get('/coordinators', (req, res) => {
  try {
    const level = req.query.level ? parseInt(req.query.level as string) : undefined;
    const monitor = getHierarchicalMonitor();

    if (level !== undefined) {
      const coordinators = monitor.getCoordinatorsByLevel(level as 0 | 1 | 2);
      res.json({ success: true, data: coordinators });
    } else {
      const status = monitor.getFlatStatus();
      res.json({ success: true, data: status.coordinators });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// GET /api/hierarchical/coordinators/:id — 单个协调员详情

router.get('/coordinators/:id', (req, res) => {
  try {
    const monitor = getHierarchicalMonitor();
    const coordinator = monitor.getCoordinator(req.params.id);

    if (!coordinator) {
      return res.status(404).json({ success: false, error: 'Coordinator not found' });
    }

    const stateManager = getStateManager();
    const snapshot = stateManager.createSnapshot(req.params.id);

    res.json({
      success: true,
      data: {
        ...coordinator,
        stateSnapshot: snapshot,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/hierarchical/coordinators/:id/state — 切换协调员状态

router.post('/coordinators/:id/state', async (req, res) => {
  try {
    const { newState, reason } = req.body;
    const coordinatorId = req.params.id;

    const stateManager = getStateManager();
    const success = await stateManager.transition(
      coordinatorId,
      newState,
      'human',
      reason || 'Manual state change via API'
    );

    if (success) {
      // 更新监控状态
      const monitor = getHierarchicalMonitor();
      monitor.updateCoordinator(coordinatorId, { state: newState });

      res.json({ success: true, message: `State changed to ${newState}` });
    } else {
      res.status(400).json({ success: false, error: 'State transition failed' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/agents — 所有 Agent
// ─────────────────────────────────────────────────────────────────────────────

router.get('/agents', (req, res) => {
  try {
    const coordinatorId = req.query.coordinator as string;
    const monitor = getHierarchicalMonitor();

    if (coordinatorId) {
      const agents = monitor.getAgentsByCoordinator(coordinatorId);
      res.json({ success: true, data: agents });
    } else {
      const status = monitor.getFlatStatus();
      res.json({ success: true, data: status.agents });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// GET /api/hierarchical/agents/:id — 单个 Agent 详情

router.get('/agents/:id', (req, res) => {
  try {
    const monitor = getHierarchicalMonitor();
    const agent = monitor.getAgent(req.params.id);

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    res.json({ success: true, data: agent });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/hierarchical/agents/:id/control — 控制 Agent (暂停/恢复/终止)

router.post('/agents/:id/control', async (req, res) => {
  try {
    const { action, reason } = req.body;
    const agentId = req.params.id;

    const intervention = getInterventionInterface();
    let interventionType: string;

    switch (action) {
      case 'pause':
        interventionType = 'AGENT_PAUSE';
        break;
      case 'resume':
        interventionType = 'AGENT_RESUME';
        break;
      case 'terminate':
        interventionType = 'AGENT_TERMINATE';
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const result = await intervention.submitIntervention({
      type: interventionType as any,
      target: { agentId },
      payload: {},
      reason: reason || `Manual ${action} via API`,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/hierarchical/intervene — 人工干预
// ─────────────────────────────────────────────────────────────────────────────

router.post('/intervene', async (req, res) => {
  try {
    const { type, target, payload, reason, priority } = req.body;

    const intervention = getInterventionInterface();
    const result = await intervention.submitIntervention({
      type,
      target,
      payload,
      reason,
      priority: priority || 'normal',
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/hierarchical/emergency-stop — 紧急停止

router.post('/emergency-stop', async (req, res) => {
  try {
    const { coordinatorId, reason } = req.body;

    const intervention = getInterventionInterface();
    const result = await intervention.emergencyStop(coordinatorId, reason || 'Emergency stop via API');

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/approvals — 待审批列表
// ─────────────────────────────────────────────────────────────────────────────

router.get('/approvals', (req, res) => {
  try {
    const intervention = getInterventionInterface();
    const approvals = intervention.getPendingApprovals();
    res.json({ success: true, data: approvals });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/hierarchical/approvals/:id — 处理审批

router.post('/approvals/:id', (req, res) => {
  try {
    const { approved } = req.body;
    const intervention = getInterventionInterface();
    intervention.processApproval(req.params.id, approved);

    res.json({ success: true, message: approved ? 'Approved' : 'Rejected' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/alerts — 告警列表
// ─────────────────────────────────────────────────────────────────────────────

router.get('/alerts', (req, res) => {
  try {
    const level = req.query.level as string;
    const acknowledged = req.query.acknowledged === 'true' ? true :
      req.query.acknowledged === 'false' ? false : undefined;
    const source = req.query.source as string;

    const monitor = getHierarchicalMonitor();
    const alerts = monitor.getAlerts({ level, acknowledged, source });

    res.json({ success: true, data: alerts });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/hierarchical/alerts/:id/acknowledge — 确认告警

router.post('/alerts/:id/acknowledge', (req, res) => {
  try {
    const monitor = getHierarchicalMonitor();
    monitor.acknowledgeAlert(req.params.id);
    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/events — 事件流
// ─────────────────────────────────────────────────────────────────────────────

router.get('/events', (req, res) => {
  try {
    const type = req.query.type as string;
    const source = req.query.source as string;
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

    const monitor = getHierarchicalMonitor();
    const events = monitor.getEvents({ type, source, since, limit });

    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/search — 搜索
// ─────────────────────────────────────────────────────────────────────────────

router.get('/search', (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query parameter "q" required' });
    }

    const monitor = getHierarchicalMonitor();
    const results = monitor.search(query);

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/hierarchical/stats — 聚合统计
// ─────────────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const monitor = getHierarchicalMonitor();
    const coordinators = Array.from(monitor.getFlatStatus().coordinators);
    const agents = Array.from(monitor.getFlatStatus().agents);

    const stats = {
      coordinators: {
        total: coordinators.length,
        byLevel: {
          l0: coordinators.filter(c => c.level === 0).length,
          l1: coordinators.filter(c => c.level === 1).length,
          l2: coordinators.filter(c => c.level === 2).length,
        },
        byState: {
          autonomy: coordinators.filter(c => c.state === 'AUTONOMY').length,
          advisory: coordinators.filter(c => c.state === 'ADVISORY').length,
          manual: coordinators.filter(c => c.state === 'MANUAL').length,
        },
        byHealth: {
          healthy: coordinators.filter(c => c.health === 'healthy').length,
          degraded: coordinators.filter(c => c.health === 'degraded').length,
          unhealthy: coordinators.filter(c => c.health === 'unhealthy').length,
        },
      },
      agents: {
        total: agents.length,
        byStatus: {
          idle: agents.filter(a => a.status === 'idle').length,
          busy: agents.filter(a => a.status === 'busy').length,
          paused: agents.filter(a => a.status === 'paused').length,
          offline: agents.filter(a => a.status === 'offline').length,
          degraded: agents.filter(a => a.status === 'degraded').length,
        },
      },
      alerts: {
        total: monitor.getAlerts().length,
        unacknowledged: monitor.getAlerts({ acknowledged: false }).length,
        critical: monitor.getAlerts({ level: 'critical' }).length,
        warning: monitor.getAlerts({ level: 'warning' }).length,
      },
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
