#!/usr/bin/env bash
# Sets up custom touchpad gestures on GNOME (Wayland):
#   4-finger up/down     -> switch workspace
#   4-finger left/right  -> snap window to left/right half (via Tiling Assistant)
#   3-finger left/right  -> back / forward
#   3-finger pinch       -> fullscreen / exit fullscreen
# Touchégg keeps the remaining pinch/tap gestures, minus anything that clashes.
#
# Safe to re-run. Log out and back in afterwards (Wayland can't reload
# GNOME Shell extensions in place).
set -euo pipefail

UUID="custom-swipes@asamara"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_SRC="$HERE/extension/$UUID"
EXT_DST="$HOME/.local/share/gnome-shell/extensions/$UUID"
TOUCHEGG_SRC="$HERE/touchegg/touchegg.conf"
TOUCHEGG_DST="$HOME/.config/touchegg/touchegg.conf"
TA_SCHEMA="org.gnome.shell.extensions.tiling-assistant"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }

# Add/remove $2 in the string-array gsettings key $1 of org.gnome.shell.
edit_list() {
    local op=$1 key=$2 item=$3 cur new
    cur=$(gsettings get org.gnome.shell "$key")
    new=$(python3 -I -c '
import ast, sys
op, cur, item = sys.argv[1:4]
lst = ast.literal_eval(cur.removeprefix("@as ").strip())
lst = [x for x in lst if x != item]
if op == "add":
    lst.append(item)
print(str(lst))' "$op" "$cur" "$item")
    gsettings set org.gnome.shell "$key" "$new"
}
add_to_list()      { edit_list add "$@"; }
remove_from_list() { edit_list remove "$@"; }

# --- Checks -----------------------------------------------------------------
command -v gnome-shell >/dev/null || { echo "GNOME Shell not found." >&2; exit 1; }
shell_major=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
if ! grep -q "\"$shell_major\"" "$EXT_SRC/metadata.json"; then
    warn "GNOME Shell $shell_major isn't listed in metadata.json (shell-version)."
    warn "Add \"$shell_major\" there if the extension doesn't load; APIs may have changed."
fi
[ "${XDG_SESSION_TYPE:-}" = wayland ] || warn "Not a Wayland session; this setup was built for Wayland."
gnome-extensions info tiling-assistant@ubuntu.com >/dev/null 2>&1 ||
    warn "Tiling Assistant isn't installed; 4-finger snap will use a simple half-screen fallback."

# --- Extension --------------------------------------------------------------
info "Installing GNOME extension $UUID"
mkdir -p "$EXT_DST"
cp "$EXT_SRC"/* "$EXT_DST"/

info "Enabling extension (takes effect after next login)"
gsettings set org.gnome.shell disable-user-extensions false
add_to_list enabled-extensions "$UUID"
remove_from_list disabled-extensions "$UUID"
gnome-extensions enable "$UUID" >/dev/null 2>&1 || true

# --- Tiling Assistant -------------------------------------------------------
if gsettings list-schemas | grep -qx "$TA_SCHEMA" ||
   gsettings list-keys "$TA_SCHEMA" >/dev/null 2>&1; then
    info "Turning off Tiling Assistant's Tiling Popup"
    gsettings set "$TA_SCHEMA" enable-tiling-popup false || warn "Couldn't set enable-tiling-popup."
fi

# --- Touchégg ---------------------------------------------------------------
if command -v touchegg >/dev/null; then
    info "Installing Touchégg config"
    mkdir -p "$(dirname "$TOUCHEGG_DST")"
    if [ -f "$TOUCHEGG_DST" ] && ! cmp -s "$TOUCHEGG_SRC" "$TOUCHEGG_DST"; then
        backup="$TOUCHEGG_DST.bak.$(date +%Y%m%d-%H%M%S)"
        cp "$TOUCHEGG_DST" "$backup"
        info "Backed up previous config to $backup"
    fi
    cp "$TOUCHEGG_SRC" "$TOUCHEGG_DST"

    info "Restarting Touchégg client"
    pkill -x -u "$USER" touchegg 2>/dev/null || true   # client only; daemon runs as root
    (setsid touchegg >/dev/null 2>&1 </dev/null &)
else
    warn "Touchégg isn't installed; skipping its config (the swipe/pinch gestures don't need it)."
fi

info "Done. Log out and back in to activate the gestures."
