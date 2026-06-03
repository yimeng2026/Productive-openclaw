#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║  Build Script                                           ║
# ║  编译 TypeScript + 打包 Python + 运行测试              ║
# ╚══════════════════════════════════════════════════════════╝

set -euo pipefail

readonly R='\033[0m'
readonly B='\033[1m'
readonly G='\033[32m'
readonly Y='\033[33m'
readonly R2='\033[31m'
readonly C='\033[36m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

log_info()  { echo -e "${C}[BUILD]${R} $*"; }
log_ok()    { echo -e "${G}[OK]${R}    $*"; }
log_warn()  { echo -e "${Y}[WARN]${R}  $*"; }
log_err()   { echo -e "${R2}[ERR]${R}   $*"; }

# ─── Stats ───────────────────────────────────────────────
BUILD_START=$(date +%s)
ERRORS=0

# ═══════════════════════════════════════════════════════════
# 1. Compile TypeScript
# ═══════════════════════════════════════════════════════════
build_typescript() {
    log_info "═══ 编译 TypeScript ═══"

    if [[ ! -d "platform-core" ]]; then
        log_warn "platform-core 不存在，跳过"
        return 0
    fi

    cd "$PROJECT_ROOT/platform-core"

    if [[ ! -f "package.json" ]]; then
        log_warn "package.json 不存在，跳过"
        cd "$PROJECT_ROOT"
        return 0
    fi

    log_info "安装依赖..."
    npm ci --silent 2>/dev/null || npm install --silent

    log_info "运行 TypeScript 编译器..."
    if npx tsc --noEmit 2>/dev/null; then
        log_ok "类型检查通过"
    else
        log_warn "类型检查发现问题（继续编译）"
    fi

    if npx tsc --build 2>/dev/null; then
        log_ok "TypeScript 编译成功"
    else
        log_err "TypeScript 编译失败"
        ERRORS=$((ERRORS + 1))
    fi

    cd "$PROJECT_ROOT"
}

# ═══════════════════════════════════════════════════════════
# 2. Package Python
# ═══════════════════════════════════════════════════════════
build_python() {
    log_info "═══ 打包 Python 包 ═══"

    if [[ ! -d "sria-smim" ]]; then
        log_warn "sria-smim 不存在，跳过"
        return 0
    fi

    cd "$PROJECT_ROOT/sria-smim"

    if [[ ! -f "setup.py" && ! -f "pyproject.toml" ]]; then
        log_warn "未找到 setup.py 或 pyproject.toml"
        log_info "尝试用 pip 安装..."
        pip3 install -e . 2>/dev/null || {
            log_warn "pip install 失败（可能需要手动配置）"
            cd "$PROJECT_ROOT"
            return 0
        }
    fi

    # Build wheel
    log_info "构建 Python wheel..."
    pip3 install build --quiet 2>/dev/null || true
    python3 -m build --wheel --outdir "$PROJECT_ROOT/dist" 2>/dev/null || {
        log_warn "wheel 构建失败，尝试 setup.py"
        python3 setup.py bdist_wheel --dist-dir "$PROJECT_ROOT/dist" 2>/dev/null || {
            log_warn "Python 打包失败"
            ERRORS=$((ERRORS + 1))
        }
    }

    cd "$PROJECT_ROOT"
    log_ok "Python 打包完成"
}

# ═══════════════════════════════════════════════════════════
# 3. Run Tests
# ═══════════════════════════════════════════════════════════
run_tests() {
    log_info "═══ 运行测试 ═══"

    # TypeScript tests
    if [[ -d "platform-core" && -f "platform-core/package.json" ]]; then
        log_info "运行 TypeScript 测试..."
        cd "$PROJECT_ROOT/platform-core"
        npm test 2>/dev/null && log_ok "TypeScript 测试通过" || {
            log_warn "TypeScript 测试失败或不存在"
            ERRORS=$((ERRORS + 1))
        }
        cd "$PROJECT_ROOT"
    fi

    # Python tests
    if [[ -d "sria-smim" ]]; then
        log_info "运行 Python 测试..."
        cd "$PROJECT_ROOT/sria-smim"
        python3 -m pytest tests/ -v --tb=short 2>/dev/null && log_ok "Python 测试通过" || {
            log_warn "Python 测试失败或 pytest 未安装"
        }
        cd "$PROJECT_ROOT"
    fi

    # Patcher tests
    if [[ -d "patches" ]]; then
        log_info "运行 Patcher 自检查..."
        python3 -m patches.patcher verify 2>/dev/null && log_ok "Patcher 验证通过" || {
            log_warn "Patcher 未应用或无清单文件"
        }
    fi
}

# ═══════════════════════════════════════════════════════════
# 4. Bundle Summary
# ═══════════════════════════════════════════════════════════
print_summary() {
    BUILD_END=$(date +%s)
    DURATION=$((BUILD_END - BUILD_START))

    echo ""
    echo -e "${B}${G}╔══════════════════════════════════════════════════════════╗${R}"
    echo -e "${B}${G}║  构建完成                                                ║${R}"
    echo -e "${B}${G}╚══════════════════════════════════════════════════════════╝${R}"
    echo -e "  耗时: ${C}${DURATION}s${R}"
    echo -e "  错误: ${C}${ERRORS}${R}"
    echo ""
    echo -e "  构建产物:"
    if [[ -d "dist" ]]; then
        ls -lh dist/ 2>/dev/null | tail -n +2 | while read -r line; do
            echo -e "    ${C}${line}${R}"
        done
    fi
    echo ""

    if [[ $ERRORS -gt 0 ]]; then
        echo -e "  ${Y}注意: 部分步骤出现警告/错误，请检查上方日志${R}"
        echo ""
        exit 1
    fi
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
main() {
    log_info "═══ 开始构建 productive-openclaw ═══"
    echo ""

    build_typescript
    build_python
    run_tests
    print_summary
}

main "$@"
