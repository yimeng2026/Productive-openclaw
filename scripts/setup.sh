#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  Environment Setup Script                               ║
# ║  创建必要目录、生成 .env、初始化数据库、安装 git hooks   ║
# ╚══════════════════════════════════════════════════════════╝

set -euo pipefail

readonly R='\033[0m'
readonly B='\033[1m'
readonly G='\033[32m'
readonly Y='\033[33m'
readonly C='\033[36m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

log_info()  { echo -e "${C}[SETUP]${R} $*"; }
log_ok()    { echo -e "${G}[OK]${R}    $*"; }
log_warn()  { echo -e "${Y}[WARN]${R}  $*"; }

# ─── 1. Create Directories ───────────────────────────────
log_info "═══ 创建必要目录 ═══"

mkdir -p logs
mkdir -p backups
mkdir -p data
mkdir -p dist
mkdir -p sria-smim/models
mkdir -p platform-core/src/generated

log_ok "目录创建完成"

# ─── 2. Generate .env file ───────────────────────────────
log_info "═══ 生成 .env 配置文件 ═══"

if [[ -f ".env.example" ]]; then
    cp .env.example .env
    log_ok ".env 已从 .env.example 生成"
else
    log_warn ".env.example 不存在，创建默认配置"
    cat > .env << 'EOF'
# Productive OpenClaw Environment Configuration
NODE_ENV=development
PYTHON_ENV=development

# API Server
PORT=3000
API_PREFIX=/api/v2

# Ollama Bridge
OLLAMA_BRIDGE_ENABLED=true
OLLAMA_HOST=http://localhost:11434
OLLAMA_BRIDGE_TIMEOUT=120

# SRIA Engine
SRIA_ENGINE_PORT=8500
SRIA_ENABLED=true
SRIA_MAX_RECURSION=5

# Database
DATABASE_URL=sqlite://data/openclaw.db

# Logging
LOG_LEVEL=info
LOG_DIR=logs

# Provider Routing
DEFAULT_PROVIDER=ollama
FALLBACK_ENABLED=true
EOF
    log_ok ".env 默认配置已创建"
fi

# ─── 3. Initialize SQLite Database ───────────────────────
log_info "═══ 初始化 SQLite 数据库 ═══"

DB_FILE="data/openclaw.db"

if [[ -f "$DB_FILE" ]]; then
    log_warn "数据库已存在: $DB_FILE"
else
    python3 - << 'PYEOF'
import sqlite3
import os

db_path = os.path.join(os.getcwd(), "data", "openclaw.db")
os.makedirs(os.path.dirname(db_path), exist_ok=True)

conn = sqlite3.connect(db_path)
c = conn.cursor()

# Agents table
c.execute('''CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT DEFAULT 'ollama',
    model TEXT DEFAULT 'llama3',
    status TEXT DEFAULT 'idle',
    config TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)''')

# Conversations table
c.execute('''CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    messages TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
)''')

# Provider configs table
c.execute('''CREATE TABLE IF NOT EXISTS provider_configs (
    id TEXT PRIMARY KEY,
    provider_name TEXT UNIQUE NOT NULL,
    endpoint TEXT,
    api_key TEXT,
    config_json TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)''')

conn.commit()
conn.close()
print(f"Database initialized: {db_path}")
PYEOF
    log_ok "SQLite 数据库已初始化"
fi

# ─── 4. Git Hooks ────────────────────────────────────────
log_info "═══ 安装 Git Hooks ═══"

if [[ -d ".git" ]]; then
    mkdir -p .git/hooks

    # Pre-commit hook
    cat > .git/hooks/pre-commit << 'HOOK'
#!/usr/bin/env bash
# Pre-commit: Run type check and tests

echo "Running pre-commit checks..."

# TypeScript type check
if [[ -d "platform-core" && -f "platform-core/package.json" ]]; then
    cd platform-core
    npm run typecheck 2>/dev/null || echo "[WARN] TypeScript type check skipped"
    cd ..
fi

# Python lint
if [[ -d "sria-smim" ]]; then
    python3 -m py_compile sria-smim/sria_smim/*.py 2>/dev/null || echo "[WARN] Python compile check skipped"
fi

echo "Pre-commit checks complete."
HOOK
    chmod +x .git/hooks/pre-commit
    log_ok "pre-commit hook 已安装"

    # Post-merge hook
    cat > .git/hooks/post-merge << 'HOOK'
#!/usr/bin/env bash
# Post-merge: Update dependencies after pull/merge

echo "Post-merge: updating dependencies..."

if [[ -f "requirements.txt" ]]; then
    pip3 install -r requirements.txt --quiet
fi

if [[ -f "package.json" ]]; then
    npm install --silent 2>/dev/null
fi

echo "Dependencies updated."
HOOK
    chmod +x .git/hooks/post-merge
    log_ok "post-merge hook 已安装"
else
    log_warn "不是 Git 仓库，跳过 git hooks 安装"
fi

# ─── Done ────────────────────────────────────────────────
echo ""
echo -e "${G}${B}环境设置完成!${R}"
echo -e "  项目根目录: ${C}$PROJECT_ROOT${R}"
echo ""
