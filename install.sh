#!/usr/bin/env bash
# ==============================================================================
# 🌐 HOTZEN — Governed AI Engineering Framework - Online One-Liner Installer (macOS & Linux)
# Legacy remote bootstrap (private repository access required; no public endpoint approved).
# Usage: curl -fsSL https://raw.githubusercontent.com/aminkhan1/agent-core-hub/main/install.sh | bash
# Or:    curl -fsSL https://raw.githubusercontent.com/aminkhan1/agent-core-hub/main/install.sh | bash -s -- --stack=laravel
# ==============================================================================

set -e

REPO_USER="aminkhan1"
REPO_NAME="agent-core-hub"
STACK_ARG=""
BRIDGES_ARG="core"
GLOBAL_INSTALL=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --stack=*)
            STACK_ARG="${arg#*=}"
            ;;
        --bridges=*|--bridge=*)
            BRIDGES_ARG="${arg#*=}"
            ;;
        --global|-g)
            GLOBAL_INSTALL=true
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --install-hooks)
            INSTALL_HOOKS=true
            ;;
        --force-hooks)
            FORCE_HOOKS=true
            ;;
        --force-remote|--remote)
            FORCE_REMOTE=true
            ;;
        --help|-h)
            echo "🌐 HOTZEN — Governed AI Engineering Framework Installer"
            echo "Usage: curl -fsSL ... | bash -s -- [--stack=<name>] [--bridges=<cursor,copilot,all>] [--dry-run] [--install-hooks] [--global]"
            echo ""
            echo "Available Stacks:"
            echo "  flutter, kotlin, swift, react, react-nextjs, vue, vanilla-web, wordpress,"
            echo "  python-fastapi, python-ai-ml, golang, rust, cpp, java, php, laravel,"
            echo "  dotnet, nestjs, nodejs, dart-backend, database, unity, godot,"
            echo "  gdscript, unreal-engine, bash, core"
            echo ""
            echo "Available AI Bridges (Default: Gemini, Claude, Codex):"
            echo "  cursor, copilot, windsurf, cline, aider, deepseek, qwen, codestral, ollama, kimi, opencode, all"
            exit 0
            ;;
    esac
done

if [ "$DRY_RUN" = true ]; then
    echo "🔍 [DRY-RUN MODE ACTIVATED]: Simulating deployment without modifying disk."
fi

MANAGED_START="<!-- AGENT-CORE-HUB:START -->"
MANAGED_END="<!-- AGENT-CORE-HUB:END -->"

safe_copy_file() {
    local src="$1"
    local dst="$2"
    if [ "$DRY_RUN" = true ]; then
        if [ -f "$dst" ]; then
            echo "   [DRY-RUN] Would backup & overwrite: $dst -> .bak"
        else
            echo "   [DRY-RUN] Would create: $dst"
        fi
        return 0
    fi
    mkdir -p "$(dirname "$dst")"
    if [ -f "$dst" ]; then
        if cmp -s "$src" "$dst" 2>/dev/null; then
            return 0 # Exact match, idempotent!
        fi
        local bak="${dst}.bak.$(date +%s)"
        cp "$dst" "$bak" 2>/dev/null || true
        echo "   🛡️ Backed up existing file: $(basename "$dst") -> $(basename "$bak")"
    fi
    cp "$src" "$dst"
}

safe_write_string() {
    local dst="$1"
    local content="$2"
    if [ "$DRY_RUN" = true ]; then
        if [ -f "$dst" ]; then
            echo "   [DRY-RUN] Would backup & overwrite: $dst -> .bak"
        else
            echo "   [DRY-RUN] Would create: $dst"
        fi
        return 0
    fi
    mkdir -p "$(dirname "$dst")"
    if [ -f "$dst" ]; then
        local current
        current=$(cat "$dst" 2>/dev/null || true)
        if [ "$current" = "$content" ]; then
            return 0 # Exact match, idempotent!
        fi
        local bak="${dst}.bak.$(date +%s)"
        cp "$dst" "$bak" 2>/dev/null || true
        echo "   🛡️ Backed up existing file: $(basename "$dst") -> $(basename "$bak")"
    fi
    printf "%s\n" "$content" > "$dst"
}

safe_merge_instruction_file() {
    local src="$1"
    local dst="$2"
    [ ! -f "$src" ] && return 0

    if [ "$DRY_RUN" = true ]; then
        if [ -f "$dst" ]; then
            echo "   [DRY-RUN] Would merge managed block into: $dst"
        else
            echo "   [DRY-RUN] Would create: $dst"
        fi
        return 0
    fi

    mkdir -p "$(dirname "$dst")"
    local src_content
    src_content=$(cat "$src")

    local block
    if echo "$src_content" | grep -Fq "$MANAGED_START"; then
        block="$src_content"
    else
        block="$(printf "%s\n%s\n%s" "$MANAGED_START" "$src_content" "$MANAGED_END")"
    fi

    if [ ! -f "$dst" ]; then
        printf "%s\n" "$block" > "$dst"
        return 0
    fi

    local dst_content
    dst_content=$(cat "$dst")

    local new_content
    if echo "$dst_content" | grep -Fq "$MANAGED_START"; then
        local before
        before=$(awk -v start="$MANAGED_START" 'index($0, start) {exit} {print}' "$dst")
        local after
        after=$(awk -v end="$MANAGED_END" 'found {print} index($0, end) {found=1}' "$dst")
        new_content=$(printf "%s\n%s\n%s" "$before" "$block" "$after")
    else
        new_content=$(printf "%s\n\n%s\n" "$dst_content" "$block")
    fi

    safe_write_string "$dst" "$new_content"
}

safe_copy_dir() {
    local src_dir="$1"
    local dst_dir="$2"
    [ ! -d "$src_dir" ] && return 0

    find "$src_dir" -type f | while read -r src_file; do
        local rel="${src_file#$src_dir/}"
        local dst_file="$dst_dir/$rel"
        safe_copy_file "$src_file" "$dst_file"
    done
}

ensure_consumer_gitignore() {
    local target_gitignore="./.gitignore"
    local required_rules=(
        "*.bak"
        "*.bak.*"
        ".agents/memory/database.sqlite"
        ".agents/memory/database.sqlite*"
        ".agents/memory/runtime_config.json"
        ".agents/memory/metrics.json"
        ".agents/memory/*.local.md"
        ".agents/tasks/*"
        "!.agents/tasks/.gitkeep"
    )
    local header="# Agent Core Hub — local runtime state"

    if [ ! -f "$target_gitignore" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo "   [DRY-RUN] Would create: $target_gitignore"
            return 0
        fi
        {
            echo "$header"
            for rule in "${required_rules[@]}"; do
                echo "$rule"
            done
        } > "$target_gitignore"
        return 0
    fi

    local missing_rules=()
    for rule in "${required_rules[@]}"; do
        if ! grep -Fxq "$rule" "$target_gitignore" 2>/dev/null; then
            missing_rules+=("$rule")
        fi
    done

    if [ ${#missing_rules[@]} -eq 0 ]; then
        return 0
    fi

    if [ "$DRY_RUN" = true ]; then
        echo "   [DRY-RUN] Would update: $target_gitignore (+${#missing_rules[@]} rules)"
        return 0
    fi

    local has_header=false
    if grep -Fxq "$header" "$target_gitignore" 2>/dev/null; then
        has_header=true
    fi

    if [ -s "$target_gitignore" ] && [ -n "$(tail -c 1 "$target_gitignore" 2>/dev/null)" ]; then
        echo "" >> "$target_gitignore"
    fi

    if [ "$has_header" = false ]; then
        if [ -s "$target_gitignore" ]; then
            echo "" >> "$target_gitignore"
        fi
        echo "$header" >> "$target_gitignore"
    fi

    for rule in "${missing_rules[@]}"; do
        echo "$rule" >> "$target_gitignore"
    done
}

echo "======================================================================"
echo "🌐 HOTZEN — Governed AI Engineering Framework - Instant Online Deployer"
echo "======================================================================"

# If stack not passed via flag, ask interactively
if [ -z "$STACK_ARG" ]; then
    echo "🎯 Select Tech Stack to Deploy into $(pwd):"
    echo "  [Mobile & Native]"
    echo "   1) flutter           2) kotlin            3) swift"
    echo "  [Web & Frontend]"
    echo "   4) react             5) react-nextjs      6) vue             7) vanilla-web     8) wordpress"
    echo "  [Backend & Enterprise]"
    echo "   9) python-fastapi   10) golang           11) rust           12) cpp"
    echo "  17) nestjs           18) nodejs           19) dart-backend"
    echo "  [AI & Data]"
    echo "  20) python-ai-ml     21) database"
    echo "  [Blockchain & Smart Contracts]"
    echo "  22) solidity"
    echo "  [Game Engines & Automation]"
    echo "  23) unity            24) godot            25) gdscript       26) unreal-engine"
    echo "  27) bash             28) core (Raw Core)"
    echo "======================================================================"
    
    # Read from terminal even when piped
    if [ -t 0 ]; then
        read -p "Enter number [1-28] (default: 1): " choice
    else
        read -p "Enter number [1-28] (default: 1): " choice < /dev/tty || choice=1
    fi

    case $choice in
        2) STACK_ARG="kotlin" ;;
        3) STACK_ARG="swift" ;;
        4) STACK_ARG="react" ;;
        5) STACK_ARG="react-nextjs" ;;
        6) STACK_ARG="vue" ;;
        7) STACK_ARG="vanilla-web" ;;
        8) STACK_ARG="wordpress" ;;
        9) STACK_ARG="python-fastapi" ;;
        10) STACK_ARG="golang" ;;
        11) STACK_ARG="rust" ;;
        12) STACK_ARG="cpp" ;;
        13) STACK_ARG="java" ;;
        14) STACK_ARG="php" ;;
        15) STACK_ARG="laravel" ;;
        16) STACK_ARG="dotnet" ;;
        17) STACK_ARG="nestjs" ;;
        18) STACK_ARG="nodejs" ;;
        19) STACK_ARG="dart-backend" ;;
        20) STACK_ARG="python-ai-ml" ;;
        21) STACK_ARG="database" ;;
        22) STACK_ARG="solidity" ;;
        23) STACK_ARG="unity" ;;
        24) STACK_ARG="godot" ;;
        25) STACK_ARG="gdscript" ;;
        26) STACK_ARG="unreal-engine" ;;
        27) STACK_ARG="bash" ;;
        28) STACK_ARG="core" ;;
        *)  STACK_ARG="flutter" ;;
    esac
fi

IFS=',' read -ra STACK_LIST <<< "$STACK_ARG"

echo "🚀 Fetching and deploying stacks: ${STACK_LIST[*]} directly from GitHub..."

TMP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

COMBINED_RULES_FILE="$TMP_DIR/combined_AGENTS.md"
touch "$COMBINED_RULES_FILE"

FIRST_STACK=true

for s in "${STACK_LIST[@]}"; do
    s=$(echo "$s" | xargs)
    [ -z "$s" ] && continue
    echo "  📦 Pulling stack: $s..."
    STACK_TMP="$TMP_DIR/$s"
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ "$FORCE_REMOTE" != true ] && [ -d "$SCRIPT_DIR/stacks/$s" ]; then
        EXTRACTED_DIR="$SCRIPT_DIR"
    elif git clone --depth 1 --branch "$s" "https://github.com/$REPO_USER/$REPO_NAME.git" "$STACK_TMP" >/dev/null 2>&1; then
        EXTRACTED_DIR="$STACK_TMP"
    else
        mkdir -p "$STACK_TMP"
        TAR_URL="https://github.com/$REPO_USER/$REPO_NAME/archive/refs/heads/$s.tar.gz"
        curl -fsSL "$TAR_URL" -o "$STACK_TMP/stack.tar.gz" 2>/dev/null || true
        tar -xzf "$STACK_TMP/stack.tar.gz" -C "$STACK_TMP" 2>/dev/null || true
        EXTRACTED_DIR=$(find "$STACK_TMP" -maxdepth 1 -type d -name "$REPO_NAME-*" | head -n 1)
    fi

    if [ -z "$EXTRACTED_DIR" ] || [ ! -d "$EXTRACTED_DIR" ]; then
        echo "❌ Error: Failed to fetch stack '$s' from GitHub."
        exit 1
    fi

    # Deploy core rules, memory, hooks, bridges on first stack
    if [ "$FIRST_STACK" = true ]; then
        safe_copy_dir "$EXTRACTED_DIR/.agents/rules" .agents/rules
        safe_copy_dir "$EXTRACTED_DIR/.agents/hooks" .agents/hooks
        safe_copy_dir "$EXTRACTED_DIR/.agents/security" .agents/security

        # Memory directory: initialize clean project-isolated memory templates only; never copy Core repo's live development memory
        [ ! -d .agents/memory ] && mkdir -p .agents/memory

        # Preserve memory in target project; initialize only if missing
        local_proj_name=$(basename "$(pwd)")
        clean_session="# Session Memory - Executive Summary of Completed Tasks

این فایل تاریخچه کارهای انجام‌شده در سشن‌های کاری فعال این پروژه را برای بازیابی سریع بدون نیاز به مرور مجدد ثبت می‌کند.

---

## 📌 گزارش اقدامات انجام‌شده:

*(هنوز اقدامی در این سشن کاری ثبت نشده است. پس از تکمیل هر تسک توسط ایجنت، خلاصه اجرایی آن در این بخش ثبت می‌شود)*
"
        [ ! -f .agents/memory/session_memory.md ] && safe_write_string .agents/memory/session_memory.md "$clean_session"

        clean_working="# Working Memory - Active Context & Resume Point

- **Current State**: آماده برای دریافت و اجرای تسک جدید.
- **Active Task**: هیچ تسک فعالی در جریان نیست.
- **Resume Point**: منتظر دریافت دستور جدید از سوی کاربر.
"
        [ ! -f .agents/memory/working_memory.md ] && safe_write_string .agents/memory/working_memory.md "$clean_working"

        clean_project="# Project Memory (Architecture & Repository Identity)

این فایل شناسنامه پایدار، اصول ثابت معماری، الگوهای نام‌گذاری و مشخصات اختصاصی این پروژه را برای بازیابی آنی کانتکست ایجنت‌ها ثبت می‌کند.

---

## 🏛️ ۱. ماهیت و معماری پروژه

- **نام پروژه / مخزن**: $local_proj_name
- **پشته فنی (Stack)**: ${STACK_LIST[*]}
- **اصول معماری**: معماری تمیز (Clean Architecture)، تفکیک لایه‌ها، تایپ‌های صریح و اعتبارسنجی هدفمند بدون اثرات جانبی واقعی.

---

## 📁 ۲. ساختار کلیدی دایرکتوری‌ها
*(ایجنت در اولین بررسی تسک، ساختار دایرکتوری‌های واقعی این پروژه را بررسی و در این بخش مستند می‌کند)*
"
        [ ! -f .agents/memory/project_memory.md ] && safe_write_string .agents/memory/project_memory.md "$clean_project"

        clean_decision="# Decision Memory (ADR - Architecture Decision Records)

این فایل شامل تمام تصمیمات کلان معماری (ADR) و شرط «تغییر نده مگر اینکه...» در طول حیات این پروژه است.

---

## 📌 ADR-000: الگوی ثبت تصمیمات معماری (ADR Template)
- **Date**: YYYY-MM-DD
- **Decision**: [شرح خلاصه تصمیم اتخاذشده]
- **Rationale**: [دلیل فنی و مزیتی که این تصمیم ایجاد می‌کند]
- **Do Not Change Unless**: [شرط صریح و شرایطی که تحت آن می‌توان این تصمیم را تغییر داد]
- **Impacted Components**: [بخش‌ها و فایل‌های متأثر از این تصمیم]
"
        [ ! -f .agents/memory/decision_memory.md ] && safe_write_string .agents/memory/decision_memory.md "$clean_decision"

        clean_metrics='{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Agent Core Hub - Telemetry Metrics",
  "description": "Multi-agent task telemetry, token consumption, iterations, and verification rates.",
  "is_template": false,
  "telemetry_summary": {
    "total_tasks_executed": 0,
    "task_success_rate": 1.0,
    "first_pass_success_rate": 1.0,
    "average_iterations": 1.0,
    "average_tokens_per_task": 0,
    "average_latency_ms": 0,
    "context_expansion_count": 0,
    "critic_rejection_rate": 0.0,
    "recovery_success_rate": 1.0,
    "rollback_count": 0,
    "regression_count": 0
  },
  "metrics_history": []
}'
        [ ! -f .agents/memory/metrics.json ] && safe_write_string .agents/memory/metrics.json "$clean_metrics"

        [ ! -f .agents/memory/database.sqlite ] && safe_write_string .agents/memory/database.sqlite ""

        if [ -f "$EXTRACTED_DIR/.agents/mcp_config.json" ] && [ ! -f .agents/mcp_config.json ]; then
            safe_copy_file "$EXTRACTED_DIR/.agents/mcp_config.json" .agents/mcp_config.json
        fi
        if [ ! -f .mcp.json ]; then
            safe_write_string .mcp.json "{\n  \"mcpServers\": {}\n}"
        fi
        if [ -f "$EXTRACTED_DIR/AGENTS.md" ]; then
            safe_merge_instruction_file "$EXTRACTED_DIR/AGENTS.md" ./AGENTS.md
        fi

        ensure_consumer_gitignore

        # Function to deploy a specific bridge
        deploy_bridge() {
            local bKey="$1"
            local bDir="$EXTRACTED_DIR/core/bridges"
            case "$bKey" in
                gemini)
                    [ -f "$bDir/GEMINI.md" ] && safe_merge_instruction_file "$bDir/GEMINI.md" ./GEMINI.md
                    [ -f "$bDir/.geminiignore" ] && safe_copy_file "$bDir/.geminiignore" ./.geminiignore
                    ;;
                claude)
                    [ -f "$bDir/CLAUDE.md" ] && safe_merge_instruction_file "$bDir/CLAUDE.md" ./CLAUDE.md
                    if [ -d "$bDir/.claude" ]; then
                        find "$bDir/.claude" -type f | while read -r f; do
                            rel="${f#$bDir/}"
                            safe_copy_file "$f" "./$rel"
                        done
                    fi
                    ;;
                codex)
                    [ -f "$bDir/CODEX.md" ] && safe_merge_instruction_file "$bDir/CODEX.md" ./CODEX.md
                    [ -f "$bDir/.codexignore" ] && safe_copy_file "$bDir/.codexignore" ./.codexignore
                    [ -f "$bDir/AGENTS.md" ] && safe_merge_instruction_file "$bDir/AGENTS.md" ./AGENTS.md
                    ;;
                cursor)
                    [ -f "$bDir/CURSOR.md" ] && safe_merge_instruction_file "$bDir/CURSOR.md" ./CURSOR.md
                    [ -f "$bDir/.cursorrules" ] && safe_merge_instruction_file "$bDir/.cursorrules" ./.cursorrules
                    [ -f "$bDir/.cursorignore" ] && safe_copy_file "$bDir/.cursorignore" ./.cursorignore
                    if [ -d "$bDir/.cursor" ]; then
                        find "$bDir/.cursor" -type f | while read -r f; do
                            rel="${f#$bDir/}"
                            safe_copy_file "$f" "./$rel"
                        done
                    fi
                    ;;
                copilot)
                    mkdir -p .github
                    [ -f "$bDir/.github/copilot-instructions.md" ] && safe_merge_instruction_file "$bDir/.github/copilot-instructions.md" .github/copilot-instructions.md
                    ;;
                windsurf)
                    [ -f "$bDir/WINDSURF.md" ] && safe_merge_instruction_file "$bDir/WINDSURF.md" ./WINDSURF.md
                    [ -f "$bDir/.windsurfrules" ] && safe_merge_instruction_file "$bDir/.windsurfrules" ./.windsurfrules
                    [ -f "$bDir/.windsurfignore" ] && safe_copy_file "$bDir/.windsurfignore" ./.windsurfignore
                    ;;
                cline)
                    [ -f "$bDir/CLINE.md" ] && safe_merge_instruction_file "$bDir/CLINE.md" ./CLINE.md
                    [ -f "$bDir/.clinerules" ] && safe_merge_instruction_file "$bDir/.clinerules" ./.clinerules
                    ;;
                aider)
                    [ -f "$bDir/AIDER.md" ] && safe_merge_instruction_file "$bDir/AIDER.md" ./AIDER.md
                    [ -f "$bDir/.aider.conf.yml" ] && safe_copy_file "$bDir/.aider.conf.yml" ./.aider.conf.yml
                    [ -f "$bDir/.aiderignore" ] && safe_copy_file "$bDir/.aiderignore" ./.aiderignore
                    ;;
                deepseek)
                    [ -f "$bDir/DEEPSEEK.md" ] && safe_merge_instruction_file "$bDir/DEEPSEEK.md" ./DEEPSEEK.md
                    [ -f "$bDir/.deepseekignore" ] && safe_copy_file "$bDir/.deepseekignore" ./.deepseekignore
                    ;;
                qwen)
                    [ -f "$bDir/QWEN.md" ] && safe_merge_instruction_file "$bDir/QWEN.md" ./QWEN.md
                    [ -f "$bDir/.qwenignore" ] && safe_copy_file "$bDir/.qwenignore" ./.qwenignore
                    ;;
                codestral)
                    [ -f "$bDir/CODESTRAL.md" ] && safe_merge_instruction_file "$bDir/CODESTRAL.md" ./CODESTRAL.md
                    [ -f "$bDir/.codestralignore" ] && safe_copy_file "$bDir/.codestralignore" ./.codestralignore
                    ;;
                ollama)
                    [ -f "$bDir/OLLAMA.md" ] && safe_merge_instruction_file "$bDir/OLLAMA.md" ./OLLAMA.md
                    [ -f "$bDir/.ollamaignore" ] && safe_copy_file "$bDir/.ollamaignore" ./.ollamaignore
                    ;;
                kimi)
                    [ -f "$bDir/KIMI.md" ] && safe_merge_instruction_file "$bDir/KIMI.md" ./KIMI.md
                    [ -f "$bDir/.kimiignore" ] && safe_copy_file "$bDir/.kimiignore" ./.kimiignore
                    ;;
                opencode)
                    [ -f "$bDir/OPENCODE.md" ] && safe_merge_instruction_file "$bDir/OPENCODE.md" ./OPENCODE.md
                    [ -f "$bDir/.opencodeignore" ] && safe_copy_file "$bDir/.opencodeignore" ./.opencodeignore
                    ;;
            esac
        }

        # Always deploy core Big 3
        deploy_bridge "gemini"
        deploy_bridge "claude"
        deploy_bridge "codex"

        # Deploy on-demand bridges if requested
        if [ "$BRIDGES_ARG" = "all" ]; then
            for b in cursor copilot windsurf cline aider deepseek qwen codestral ollama kimi opencode; do
                deploy_bridge "$b"
            done
        elif [ "$BRIDGES_ARG" != "core" ] && [ "$BRIDGES_ARG" != "default" ]; then
            IFS=',' read -ra REQ_BRIDGES <<< "$BRIDGES_ARG"
            for b in "${REQ_BRIDGES[@]}"; do
                b=$(echo "$b" | xargs)
                deploy_bridge "$b"
            done
        fi

        FIRST_STACK=false
    fi

    # Merge skills
    if [ -d "$EXTRACTED_DIR/stacks/$s/skills" ]; then
        safe_copy_dir "$EXTRACTED_DIR/stacks/$s/skills" .agents/skills
    elif [ -d "$EXTRACTED_DIR/.agents/skills" ]; then
        safe_copy_dir "$EXTRACTED_DIR/.agents/skills" .agents/skills
    fi

    # Append STACK_RULES into temporary file
    if [ -f "$EXTRACTED_DIR/stacks/$s/STACK_RULES.md" ]; then
        cat "$EXTRACTED_DIR/stacks/$s/STACK_RULES.md" >> "$COMBINED_RULES_FILE"
        printf "\n\n---\n\n" >> "$COMBINED_RULES_FILE"
    elif [ -f "$EXTRACTED_DIR/STACK_RULES.md" ]; then
        cat "$EXTRACTED_DIR/STACK_RULES.md" >> "$COMBINED_RULES_FILE"
        printf "\n\n---\n\n" >> "$COMBINED_RULES_FILE"
    elif [ -f "$EXTRACTED_DIR/.agents/AGENTS.md" ]; then
        cat "$EXTRACTED_DIR/.agents/AGENTS.md" >> "$COMBINED_RULES_FILE"
        printf "\n\n---\n\n" >> "$COMBINED_RULES_FILE"
    fi
done

if [ -s "$COMBINED_RULES_FILE" ]; then
    safe_merge_instruction_file "$COMBINED_RULES_FILE" .agents/AGENTS.md
    safe_merge_instruction_file "$COMBINED_RULES_FILE" STACK_RULES.md
fi

# Deploy thin runtime skill adapters for Claude Code if .claude exists
if [ -d .claude ] && [ -d .agents/skills ]; then
    [ ! -d .claude/skills ] && mkdir -p .claude/skills
    for sdir in .agents/skills/*; do
        if [ -d "$sdir" ] && [ -f "$sdir/SKILL.md" ]; then
            sname=$(basename "$sdir")
            s_name="$sname"
            s_desc="Specialist skill for $sname"
            n_line=$(grep "^name:" "$sdir/SKILL.md" | head -n 1)
            [ -n "$n_line" ] && s_name=$(echo "$n_line" | sed 's/^name:[[:space:]]*//')
            d_line=$(grep "^description:" "$sdir/SKILL.md" | head -n 1)
            [ -n "$d_line" ] && s_desc=$(echo "$d_line" | sed 's/^description:[[:space:]]*//')

            [ ! -d ".claude/skills/$sname" ] && mkdir -p ".claude/skills/$sname"
            adapter_content="---
name: $s_name
description: $s_desc
---

# $s_name (Claude Runtime Adapter)
> Canonical Source: [$s_name](file:///.agents/skills/$sname/SKILL.md)

This skill is governed by the HOTZEN — Governed AI Engineering Framework canonical skill definition.
Before executing tasks in this domain, load and adhere to the canonical instructions at:
\`.agents/skills/$sname/SKILL.md\`
"
            safe_write_string ".claude/skills/$sname/SKILL.md" "$adapter_content"
        fi
    done
fi

if [ "$DRY_RUN" = true ]; then
    if [ "$INSTALL_HOOKS" = true ]; then
        echo "   [DRY-RUN] Would configure Git pre-commit hook: git config core.hooksPath .agents/hooks"
    else
        echo "   [DRY-RUN] core.hooksPath left unchanged (use --install-hooks to enable)"
    fi
else
    # Setup Git Security Hook if inside a git repository
    if [ -d ".git" ]; then
        if [ -f ".agents/hooks/pre-commit" ]; then
            chmod +x .agents/hooks/pre-commit 2>/dev/null || true
            [ -f ".agents/security/security_scanner.py" ] && chmod +x .agents/security/security_scanner.py 2>/dev/null || true
            if [ "$INSTALL_HOOKS" = true ]; then
                existing_hooks=$(git config --get core.hooksPath 2>/dev/null || true)
                if [ -n "$existing_hooks" ] && [ "$existing_hooks" != ".agents/hooks" ] && [ "$FORCE_HOOKS" != true ]; then
                    echo "   ⚠️ Existing core.hooksPath detected: '$existing_hooks'."
                    echo "      Preserved existing hooks to avoid breaking workflows. Use --force-hooks to override."
                else
                    git config core.hooksPath .agents/hooks 2>/dev/null || true
                fi
            else
                echo "   ℹ️ Git hooks: core.hooksPath left unchanged (use --install-hooks to enable pre-commit guardian)."
            fi
        fi
    fi
fi


echo "======================================================================"
echo "✅ HOTZEN framework successfully deployed for: $STACK_ARG"
echo "📂 Structure deployed into $(pwd):"
echo "   • .agents/ (Rules, Memory, Merged Skills, MCP config)"
if [ "$INSTALL_HOOKS" = true ]; then
    echo "   • 🔒 Git Pre-commit Security Hook configured"
else
    echo "   • ℹ️ Git Pre-commit Hook left unchanged (opt-in via --install-hooks)"
fi

echo "   • Core AI Bridges: Gemini (Antigravity), Claude Code, OpenAI Codex"
echo "   • Extra Bridges: $BRIDGES_ARG"
echo "   • Clean Project Root & Strict Git Human Guardian Law"
echo "======================================================================"
