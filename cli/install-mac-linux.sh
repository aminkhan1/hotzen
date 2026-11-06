#!/usr/bin/env bash
# HOTZEN — Governed AI Engineering Framework. User-local wrappers only.
set -e

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
EXECUTABLE="$BIN_DIR/agent-hub"

# Compare bytes with the historical template; never execute an existing wrapper.
legacy_wrapper() {
    cat <<INNER_EOF
#!/usr/bin/env bash
HUB_SOURCE="$1"

if command -v node >/dev/null 2>&1; then
    exec node "\$HUB_SOURCE/cli/index.js" "\$@"
else
    echo "❌ Error: Node.js is required to execute Universal Agent Core Hub CLI." >&2
    echo "   Please install Node.js (https://nodejs.org) or run via npx." >&2
    exit 1
fi
INNER_EOF
}

hotzen_wrapper() {
    printf '#!/usr/bin/env bash\n# HOTZEN local CLI wrapper v1\nHUB_SOURCE=%q\n' "$1"
    cat <<'INNER_EOF'
if command -v node >/dev/null 2>&1; then
    exec node "$HUB_SOURCE/cli/index.js" "$@"
else
    echo "Error: Node.js is required to execute HOTZEN CLI." >&2
    exit 1
fi
INNER_EOF
}

owned_hub=false
if [[ -f "$EXECUTABLE" && ! -L "$EXECUTABLE" ]]; then
    # Legacy paths are parsed as data, with no eval or shell sourcing.
    legacy_source=$(sed -n '2s/^HUB_SOURCE="\(.*\)"$/\1/p' "$EXECUTABLE")
    if [[ -n "$legacy_source" ]] && cmp -s "$EXECUTABLE" <(legacy_wrapper "$legacy_source"); then
        owned_hub=true
    elif [[ "$(head -n 2 "$EXECUTABLE")" = $'#!/usr/bin/env bash\n# HOTZEN local CLI wrapper v1' ]] &&
         [[ "$(sed -n '3p' "$EXECUTABLE")" = HUB_SOURCE=* ]] &&
         cmp -s <(tail -n +4 "$EXECUTABLE") <(hotzen_wrapper "$SOURCE_DIR" | tail -n +4); then
        owned_hub=true
    fi
fi

# Preflight every destination before creating a directory or changing any alias.
for name in core hotzen agent-hub-init agent-hub; do
    candidate="$BIN_DIR/$name"
    if [[ -e "$candidate" || -L "$candidate" ]]; then
        if [[ "$name" = agent-hub && "$owned_hub" = true ]]; then
            continue
        fi
        if [[ "$name" != agent-hub && -L "$candidate" && "$owned_hub" = true ]] &&
           [[ "$(readlink "$candidate")" = "$EXECUTABLE" ]]; then
            continue
        fi
        echo "Error: $name already exists at $candidate; leaving existing commands unchanged." >&2
        exit 1
    fi
done

mkdir -p "$BIN_DIR"
hotzen_wrapper "$SOURCE_DIR" > "$EXECUTABLE"
chmod +x "$EXECUTABLE"
for name in hotzen core agent-hub-init; do
    ln -sfn "$EXECUTABLE" "$BIN_DIR/$name"
done

echo "Installed hotzen, core, agent-hub and agent-hub-init into $BIN_DIR"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "Add $BIN_DIR to your PATH in ~/.bashrc or ~/.zshrc:"
    echo '   export PATH="$HOME/.local/bin:$PATH"'
fi
echo "Run 'hotzen --help' to get started. Keep the source directory in place."
