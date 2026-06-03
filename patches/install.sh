#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  OpenClaw Extension - One-Click Installer                ║
# ║  将 productive-openclaw 作为扩展安全应用到 OpenClaw      ║
# ╚══════════════════════════════════════════════════════════╝

set -euo pipefail

# ─── Colors ──────────────────────────────────────────────
readonly R='\033[0m'
readonly B='\033[1m'
readonly G='\033[32m'
readonly Y='\033[33m'
readonly R2='\033[31m'
readonly C='\033[36m'

log_info()  { echo -e "${C}[INFO]${R} $*"; }
log_ok()    { echo -e "${G}[OK]${R}   $*"; }
log_warn()  { echo -e "${Y}[WARN]${R} $*"; }
log_err()   { echo -e "${R2}[ERR]${R}  $*"; }

# ─── Paths ───────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OLLAMA_PORT=11434
PYTHON_MIN="3.9"
NODE_MIN="18"

print_banner() {
    echo -e ""
    echo -e "${B}${C}  ____  ____   ___    _     ____ _                 _ ${R}"
    echo -e "${B}${C} / __ \/ __ \ /   |  | |   / __ \ |               | |${R}"
    echo -e "${B}${C}| |  | | |  | / /| |  | |  | |  | | | ___  _   _  __| |${R}"
    echo -e "${B}${C}| |  | | |  | / /_| |  | |  | |  | | |/ _ \| | | |/ _\ |${R}"
    echo -e "${B}${C}| |__| | |__| / ___  | | |__| |__| | | (_) | |_| | (_| |${R}"
    echo -e "${B}${C} \\____/\\____/_/   |_|  \\____\\____/|_|\\___/ \\__,_|\\__,_|${R}"
    echo -e "${B}          Extension Patch System v2.0.0${R}"
    echo -e "${B}          SRIA + Multi-Agent + Multi-Provider${R}"
    echo -e ""
}

# ═══════════════════════════════════════════════════════════
# Step 1: Environment Detection
# ═══════════════════════════════════════════════════════════
step1_detect_env() {
    log_info "═══ Step 1/5: 检测系统环境 ═══"
    local fail=0

    # Python version check
    if command -v python3 &>/dev/null; then
        PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
        PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
        PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
        if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge 9 ]]; then
            log_ok "Python $PY_VER (>= ${PYTHON_MIN})"
        else
            log_err "Python $PY_VER < ${PYTHON_MIN}，请升级"
            fail=1
        fi
    else
        log_err "未找到 Python3"
        fail=1
    fi

    # Node.js version check
    if command -v node &>/dev/null; then
        NODE_VER=$(node --version | tr -d 'v')
        NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
        if [[ "$NODE_MAJOR" -ge ${NODE_MIN} ]]; then
            log_ok "Node.js v${NODE_VER} (>= ${NODE_MIN})"
        else
            log_err "Node.js v${NODE_VER} < ${NODE_MIN}，请升级"
            fail=1
        fi
    else
        log_err "未找到 Node.js"
        fail=1
    fi

    # pip3 check
    if command -v pip3 &>/dev/null; then
        log_ok "pip3 已安装"
    else
        log_err "未找到 pip3"
        fail=1
    fi

    # npm check
    if command -v npm &>/dev/null; then
        log_ok "npm 已安装"
    else
        log_err "未找到 npm"
        fail=1
    fi

    if [[ $fail -eq 1 ]]; then
        log_err "环境检测失败，请先安装缺失的依赖"
        exit 1
    fi

    log_ok "环境检测通过"
}

# ═══════════════════════════════════════════════════════════
# Step 2: Install Dependencies
# ═══════════════════════════════════════════════════════════
step2_install_deps() {
    log_info "═══ Step 2/5: 安装依赖 ═══"

    # Python dependencies
    log_info "安装 Python 依赖..."
    cd "$PROJECT_ROOT"
    if [[ -f "requirements.txt" ]]; then
        pip3 install -r requirements.txt --quiet
        log_ok "Python 依赖安装完成"
    else
        log_warn "未找到 requirements.txt"
    fi

    # Node.js dependencies
    log_info "安装 Node.js 依赖..."
    if [[ -f "package.json" ]]; then
        npm install --silent
        log_ok "Node.js 依赖安装完成 (根级)"
    fi

    # platform-core dependencies
    if [[ -d "platform-core" && -f "platform-core/package.json" ]]; then
        cd "$PROJECT_ROOT/platform-core"
        npm install --silent
        log_ok "platform-core 依赖安装完成"
    fi

    cd "$PROJECT_ROOT"
}

# ═══════════════════════════════════════════════════════════
# Step 3: Ollama Detection
# ═══════════════════════════════════════════════════════════
step3_detect_ollama() {
    log_info "═══ Step 3/5: 检测 Ollama 状态 ═══"

    if command -v ollama &>/dev/null; then
        log_ok "Ollama CLI 已安装"

        # Check if Ollama is running
        if curl -s "http://localhost:${OLLAMA_PORT}/api/tags" &>/dev/null; then
            local model_count
            model_count=$(curl -s "http://localhost:${OLLAMA_PORT}/api/tags" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null || echo "0")
            log_ok "Ollama 服务运行中 (端口 ${OLLAMA_PORT}, ${model_count} 个模型)"
        else
            log_warn "Ollama 已安装但服务未运行"
            log_info "请执行: ${B}ollama serve${R} 启动服务"
        fi
    else
        log_warn "未检测到 Ollama 安装"
        log_info "安装指南: ${B}https://ollama.com/download${R}"
    fi
}

# ═══════════════════════════════════════════════════════════
# Step 4: Apply Patches
# ═══════════════════════════════════════════════════════════
step4_apply_patches() {
    log_info "═══ Step 4/5: 应用扩展补丁 ═══"

    cd "$PROJECT_ROOT"

    # Run setup script first
    if [[ -f "scripts/setup.sh" ]]; then
        log_info "运行环境设置..."
        bash scripts/setup.sh
    fi

    # Apply patch via Python patcher
    if [[ -f "patches/patcher.py" ]]; then
        log_info "应用 OpenClaw 扩展补丁..."
        python3 -m patches.patcher apply --target "$PROJECT_ROOT" || {
            log_err "补丁应用失败"
            exit 1
        }
    else
        log_err "未找到补丁引擎: patches/patcher.py"
        exit 1
    fi

    log_ok "补丁应用成功"
}

# ═══════════════════════════════════════════════════════════
# Step 5: Start Services
# ═══════════════════════════════════════════════════════════
step5_start_services() {
    log_info "═══ Step 5/5: 启动服务 ═══"

    cd "$PROJECT_ROOT"

    # Start Python SRIA engine in background
    if [[ -d "sria-smim" ]]; then
        log_info "启动 Python SRIA 引擎 (后台)..."
        (
            cd sria-smim
            nohup python3 -m sria_smim > "$PROJECT_ROOT/logs/sria.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/.sria.pid"
        )
        sleep 1
        if [[ -f "$PROJECT_ROOT/.sria.pid" ]] && kill -0 "$(cat "$PROJECT_ROOT/.sria.pid")" 2>/dev/null; then
            log_ok "SRIA 引擎已启动 (PID: $(cat "$PROJECT_ROOT/.sria.pid"))"
        fi
    fi

    # Start TypeScript platform core in background
    if [[ -d "platform-core" ]]; then
        log_info "启动 TypeScript 平台核心 (后台)..."
        (
            cd platform-core
            nohup npm run dev > "$PROJECT_ROOT/logs/platform.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/.platform.pid"
        )
        sleep 2
        if [[ -f "$PROJECT_ROOT/.platform.pid" ]] && kill -0 "$(cat "$PROJECT_ROOT/.platform.pid")" 2>/dev/null; then
            log_ok "平台核心已启动 (PID: $(cat "$PROJECT_ROOT/.platform.pid"))"
        fi
    fi

    print_summary
}

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
print_summary() {
    echo -e ""
    echo -e "${B}${G}╔══════════════════════════════════════════════════════════╗${R}"
    echo -e "${B}${G}║        安装完成! Productive OpenClaw 已就绪             ║${R}"
    echo -e "${B}${G}╚══════════════════════════════════════════════════════════╝${R}"
    echo -e ""
    echo -e "${B}可用端点:${R}"
    echo -e "  ${C}POST${R} http://localhost:3000/api/v2/unified/chat     ${Y}# 统一聊天接口${R}"
    echo -e "  ${C}GET${R}  http://localhost:3000/api/v2/unified/models    ${Y}# 模型列表${R}"
    echo -e "  ${C}GET${R}  http://localhost:3000/api/v2/sylva/agents     ${Y}# Agent编排${R}"
    echo -e "  ${C}POST${R} http://localhost:3000/api/v2/sylva/inference  ${Y}# SRIA推理${R}"
    echo -e ""
    echo -e "${B}常用命令:${R}"
    echo -e "  ${B}npm run dev${R}          启动开发模式"
    echo -e "  ${B}npm run patch:revert${R} 回滚补丁"
    echo -e "  ${B}npm run test${R}         运行测试"
    echo -e ""
    echo -e "${B}日志:${R}"
    echo -e "  ${C}$PROJECT_ROOT/logs/${R}"
    echo -e ""
    echo -e "${B}更多信息:${R}"
    echo -e "  项目根目录: ${C}$PROJECT_ROOT${R}"
    echo -e ""
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
main() {
    mkdir -p "$PROJECT_ROOT/logs"
    print_banner
    step1_detect_env
    step2_install_deps
    step3_detect_ollama
    step4_apply_patches
    step5_start_services
}

main "$@"
