#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  Development Start Script                               ║
# ║  同时启动 Python SRIA 引擎和 TypeScript 平台核心        ║
# ╚══════════════════════════════════════════════════════════╝

set -uo pipefail

readonly R='\033[0m'
readonly B='\033[1m'
readonly G='\033[32m'
readonly Y='\033[33m'
readonly R2='\033[31m'
readonly C='\033[36m'
readonly M='\033[35m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# ─── Logging with color ──────────────────────────────────
log_sria()   { echo -e "${M}[SRIA]${R}  $*"; }
log_plat()   { echo -e "${C}[CORE]${R}  $*"; }
log_info()   { echo -e "${Y}[DEV]${R}   $*"; }
log_ok()     { echo -e "${G}[OK]${R}    $*"; }
log_err()    { echo -e "${R2}[ERR]${R}   $*"; }

# ─── Cleanup ─────────────────────────────────────────────
cleanup_pids() {
    log_info "正在停止所有服务..."
    [[ -n "${SRIA_PID:-}" ]] && kill "$SRIA_PID" 2>/dev/null && log_sria "已停止"
    [[ -n "${PLAT_PID:-}" ]] && kill "$PLAT_PID" 2>/dev/null && log_plat "已停止"
    exit 0
}
trap cleanup_pids INT TERM EXIT

# ─── Banner ──────────────────────────────────────────────
echo ""
echo -e "${B}${G}  Dev Mode: OpenClaw Extension${R}"
echo -e "${B}  Python SRIA + TypeScript Platform Core${R}"
echo ""

# ─── Create logs dir ─────────────────────────────────────
mkdir -p logs

# ─── Start Python SRIA Engine ────────────────────────────
start_sria() {
    log_sria "启动 SRIA 递归推理引擎..."

    if [[ ! -d "sria-smim" ]]; then
        log_err "sria-smim 目录不存在"
        return 1
    fi

    cd "$PROJECT_ROOT/sria-smim"

    python3 -m sria_smim 2>&1 &
    SRIA_PID=$!

    cd "$PROJECT_ROOT"

    sleep 2
    if kill -0 "$SRIA_PID" 2>/dev/null; then
        log_ok "SRIA 引擎运行中 ${G}PID=$SRIA_PID${R}"
        log_sria "监听地址: ${C}http://localhost:8500${R}"
        return 0
    else
        log_err "SRIA 引擎启动失败"
        return 1
    fi
}

# ─── Start TypeScript Platform Core ──────────────────────
start_platform() {
    log_plat "启动 TypeScript 平台核心..."

    if [[ ! -d "platform-core" ]]; then
        log_err "platform-core 目录不存在"
        return 1
    fi

    cd "$PROJECT_ROOT/platform-core"

    npm run dev 2>&1 &
    PLAT_PID=$!

    cd "$PROJECT_ROOT"

    sleep 3
    if kill -0 "$PLAT_PID" 2>/dev/null; then
        log_ok "平台核心运行中 ${G}PID=$PLAT_PID${R}"
        log_plat "监听地址: ${C}http://localhost:3000${R}"
        return 0
    else
        log_err "平台核心启动失败"
        return 1
    fi
}

# ─── Status Monitor ──────────────────────────────────────
status_monitor() {
    local sria_status plat_status
    while true; do
        sleep 10

        if kill -0 "${SRIA_PID:-0}" 2>/dev/null; then
            sria_status="${G}running${R}"
        else
            sria_status="${R2}stopped${R}"
        fi

        if kill -0 "${PLAT_PID:-0}" 2>/dev/null; then
            plat_status="${G}running${R}"
        else
            plat_status="${R2}stopped${R}"
        fi

        echo -e ""
        echo -e "${Y}[DEV]${R} 服务状态 | SRIA: $sria_status | CORE: $plat_status"
    done
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
main() {
    # Check .env
    if [[ ! -f ".env" ]]; then
        log_info ".env 文件不存在，运行 setup..."
        bash scripts/setup.sh
    fi

    # Source env
    set -a
    source .env 2>/dev/null || true
    set +a

    start_sria
    start_platform

    echo ""
    echo -e "${B}${G}═══════════════════════════════════════════════════${R}"
    echo -e "${B}${G}  所有服务已启动!${R}"
    echo -e "${B}${G}═══════════════════════════════════════════════════${R}"
    echo -e "  ${M}SRIA${R}  http://localhost:8500"
    echo -e "  ${C}CORE${R}  http://localhost:3000"
    echo -e "  ${Y}API${R}   http://localhost:3000/api/v2"
    echo ""
    echo -e "  按 ${R2}Ctrl+C${R} 停止所有服务"
    echo ""

    # Keep running, show status periodically
    status_monitor &
    MONITOR_PID=$!

    wait
}

main "$@"
