# Touchpad gesture setup (GNOME on Wayland)

| Gesture | Action |
|---|---|
| 4-finger swipe up / down | Next / previous workspace |
| 4-finger swipe left / right | Snap window to left / right half |
| 3-finger swipe left / right | Back / forward |
| 3-finger pinch out / in | Fullscreen / exit fullscreen |

## Install

```bash
./install.sh
```

Then **log out and back in**. Wayland can't reload GNOME Shell extensions in place.

## Uninstall

```bash
./uninstall.sh
```

## What's in here

- `extension/custom-swipes@asamara/`: a small GNOME Shell extension. It
  intercepts 3/4-finger swipes and 3-finger pinches before GNOME's built-in
  gestures. Only the normal desktop is affected; the Activities overview keeps
  GNOME's gestures.
- `touchegg/touchegg.conf`: Touchégg config with the clashing swipe and
  3-finger pinch gestures removed. Touchégg's window actions don't work on
  Wayland, so the extension does those instead.
- `install.sh` does the following:
  - copies the extension
  - enables it, and turns off "disable user extensions"
  - turns off Tiling Assistant's Tiling Popup
  - installs the Touchégg config, backing up any existing one to
    `~/.config/touchegg/touchegg.conf.bak.<timestamp>`, and restarts the
    Touchégg client
- `uninstall.sh` reverses those steps. It also offers to restore your newest
  Touchégg backup.

## Notes

- **Snapping uses Tiling Assistant internals.** Snapping calls Tiling
  Assistant's own tiling code, with its popup turned off. If Tiling Assistant
  is missing or changes, the extension falls back to resizing the window to
  half the screen itself.
- **New GNOME versions:** after a GNOME upgrade, add the new major version to
  `shell-version` in `metadata.json` if the extension stops loading.
- **Tuning:** to change sensitivity, edit `THRESHOLD` in `extension.js`. A
  higher value means you have to swipe further.
- **Debugging:** logs are in
  `journalctl -b | grep -iE 'custom-swipes|JS ERROR'`.
