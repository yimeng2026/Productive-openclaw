-- schema.sql — SYLVA Platform 完整数据库 Schema
-- SQLite 持久化层，支持 Agent、Task、Group、Skill、KnowledgeBase 等核心实体
-- JSON 字段统一使用 TEXT 存储，查询时由 Repository 层解析

-- ─────────────────────────────────────────────
-- Schema 版本控制表
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

-- ─────────────────────────────────────────────
-- agents 表 — 智能体注册信息
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level_a TEXT DEFAULT '[]',         -- JSON array: 平台层级 A
  level_b TEXT DEFAULT 'mega',       -- 平台层级 B (mega | sylva | agentzero)
  level_c TEXT DEFAULT 'openclaw',   -- 平台层级 C / 运行时
  role TEXT DEFAULT 'solo',          -- leader | worker | solo
  status TEXT DEFAULT 'idle',        -- idle | running | error | paused
  health TEXT DEFAULT 'healthy',     -- healthy | degraded | unhealthy
  skills TEXT DEFAULT '[]',          -- JSON array: 技能 ID 列表
  capabilities TEXT DEFAULT '[]',    -- JSON array: 能力标签列表
  max_concurrent_tasks INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 5,
  system_prompt TEXT,
  temperature REAL,
  max_tokens INTEGER,
  model_capability TEXT,             -- JSON: 模型能力描述
  context_budget TEXT,               -- JSON: 上下文预算配置
  config TEXT,                       -- JSON: 扩展配置
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_health ON agents(health);
CREATE INDEX IF NOT EXISTS idx_agents_level_b ON agents(level_b);
CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at);

-- ─────────────────────────────────────────────
-- tasks 表 — 任务执行记录
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT,                         -- chat | code | search | analysis | custom
  target_agent_id TEXT,
  target_swarm_id TEXT,
  prompt TEXT,
  context TEXT,                      -- JSON: 任务上下文
  attachments TEXT,                  -- JSON array: 附件列表
  execution_mode TEXT DEFAULT 'solo', -- solo | swarm
  swarm_mode TEXT,                   -- sequential | parallel | hierarchical | dynamic
  routing_strategy TEXT,             -- priority | cost | latency | balanced | round_robin
  state TEXT DEFAULT 'pending',      -- pending | running | completed | failed | cancelled
  output TEXT,
  error TEXT,
  latency_ms INTEGER,
  tokens_used INTEGER,
  created_at INTEGER,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_target_agent ON tasks(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_target_swarm ON tasks(target_swarm_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);

-- ─────────────────────────────────────────────
-- groups 表 — Swarm 协作群组
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  level INTEGER DEFAULT 1,           -- 1=基础群, 2=二级群, 3=三级群
  agent_ids TEXT DEFAULT '[]',       -- JSON array: 成员 Agent ID 列表
  status TEXT DEFAULT 'active',    -- active | inactive | dissolved
  current_meeting TEXT,              -- JSON: 当前进行中的会议信息
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(status);
CREATE INDEX IF NOT EXISTS idx_groups_level ON groups(level);
CREATE INDEX IF NOT EXISTS idx_groups_created_at ON groups(created_at);

-- ─────────────────────────────────────────────
-- skills 表 — 技能/能力定义
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT DEFAULT 'builtin',     -- hermes-forged | user-created | builtin
  status TEXT DEFAULT 'enabled',     -- enabled | disabled
  version TEXT DEFAULT '1.0.0',
  config TEXT,                       -- JSON: 技能配置
  skill_md TEXT,                     -- SKILL.md 完整内容
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);
CREATE INDEX IF NOT EXISTS idx_skills_created_at ON skills(created_at);

-- ─────────────────────────────────────────────
-- knowledge_bases 表 — 知识库管理
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,                         -- document | vector | hybrid
  description TEXT,
  document_count INTEGER DEFAULT 0,
  index_rate INTEGER DEFAULT 0,      -- 索引进度百分比 0-100
  last_updated TEXT,                 -- ISO 字符串
  file_paths TEXT DEFAULT '[]',      -- JSON array: 文件路径列表
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_type ON knowledge_bases(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created_at ON knowledge_bases(created_at);

-- ─────────────────────────────────────────────
-- meetings 表 — 群组会议记录
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  topic TEXT,
  participant_ids TEXT DEFAULT '[]', -- JSON array: 参与者 Agent ID 列表
  result TEXT,                       -- 会议结论/产出
  started_at INTEGER,
  ended_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_meetings_group ON meetings(group_id);
CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON meetings(started_at);

-- ─────────────────────────────────────────────
-- health_checks 表 — 健康检查历史
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_checks (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  status TEXT,                       -- healthy | degraded | unhealthy
  response_time_ms INTEGER,
  error_rate REAL DEFAULT 0.0,
  score INTEGER DEFAULT 100,         -- 0-100 健康评分
  checked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_health_checks_agent ON health_checks(agent_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at ON health_checks(checked_at);
CREATE INDEX IF NOT EXISTS idx_health_checks_status ON health_checks(status);
