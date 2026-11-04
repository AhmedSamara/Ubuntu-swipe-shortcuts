#!/usr/bin/env bash
# Removes the custom gesture extension and restores GNOME's built-in
# 3/4-finger gestures. Optionally restores your previous Touchégg config.
# Log out and back in afterwards.
set -euo pipefail

UUID="custom-swipes@asamara"
EXT_DST="$HOME/.local/share/gnome-shell/extensions/$UUID"
TOUCHEGG_DST="$HOME/.config/touchegg/touchegg.conf"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

info "Disabling and removing extension $UUID"
gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
gsettings set org.gnome.shell enabled-extensions "$(python3 -I -c '
import ast, sys
lst = ast.literal_eval(sys.argv[1].removeprefix("@as ").strip())
print(str([x for x in lst if x != sys.argv[2]]))' \
    "$(gsettings get org.gnome.shell enabled-extensions)" "$UUID")"
rm -rf "$EXT_DST"

info "Re-enabling Tiling Assistant's Tiling Popup (its default)"
gsettings reset org.gnome.shell.extensions.tiling-assistant enable-tiling-popup 2>/dev/null || true

# Offer to restore the newest Touchégg backup made by install.sh.
latest=$(ls -t "$TOUCHEGG_DST".bak.* 2>/dev/null | head -1 || true)
if [ -n "$latest" ]; then
    read -r -p "Restore previous Touchégg config from $latest? [y/N] " ans
    if [[ $ans =~ ^[Yy] ]]; then
        cp "$latest" "$TOUCHEGG_DST"
        pkill -x -u "$USER" touchegg 2>/dev/null || true
        (setsid touchegg >/dev/null 2>&1 </dev/null &)
        info "Restored Touchégg config"
    fi
fi

info "Done. Log out and back in to finish."
