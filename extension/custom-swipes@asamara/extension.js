import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Minimum cumulative finger travel (unaccelerated touchpad units) to trigger.
const THRESHOLD = 60;

export default class CustomSwipesExtension extends Extension {
    enable() {
        this._dx = 0;
        this._dy = 0;
        this._fingers = 0;
        this._handling = false;

        const seat = Clutter.get_default_backend().get_default_seat();
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

        // Capture phase runs before GNOME's SwipeTrackers (which listen on
        // the bubble phase), so returning EVENT_STOP suppresses them.
        this._captureId = global.stage.connect('captured-event::touchpad',
            (_actor, event) => this._onEvent(event));
    }

    disable() {
        if (this._captureId) {
            global.stage.disconnect(this._captureId);
            this._captureId = 0;
        }
        this._pointer = null;
        if (this._placeTimeoutId) {
            GLib.source_remove(this._placeTimeoutId);
            this._placeTimeoutId = 0;
        }
    }

    _onEvent(event) {
        if (event.type() === Clutter.EventType.TOUCHPAD_PINCH)
            return this._onPinch(event);
        if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE)
            return Clutter.EVENT_PROPAGATE;

        const fingers = event.get_touchpad_gesture_finger_count();
        const phase = event.get_gesture_phase();

        if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
            // Only take over on the normal desktop; leave the overview etc. alone.
            this._handling = (fingers === 3 || fingers === 4) &&
                Main.actionMode === Shell.ActionMode.NORMAL;
            this._fingers = fingers;
            this._dx = 0;
            this._dy = 0;
        }

        if (!this._handling)
            return Clutter.EVENT_PROPAGATE;

        const [dx, dy] = event.get_gesture_motion_delta_unaccelerated();
        this._dx += dx;
        this._dy += dy;

        if (phase === Clutter.TouchpadGesturePhase.END) {
            this._handling = false;
            this._trigger();
        } else if (phase === Clutter.TouchpadGesturePhase.CANCEL) {
            this._handling = false;
        }

        return Clutter.EVENT_STOP;
    }

    _trigger() {
        const horizontal = Math.abs(this._dx) > Math.abs(this._dy);
        const distance = horizontal ? this._dx : this._dy;
        if (Math.abs(distance) < THRESHOLD)
            return;

        if (this._fingers === 4 && !horizontal) {
            // Swipe up -> next workspace, swipe down -> previous.
            this._switchWorkspace(distance < 0
                ? Meta.MotionDirection.RIGHT : Meta.MotionDirection.LEFT);
        } else if (this._fingers === 4 && horizontal) {
            this._tileHalf(distance < 0);
        } else if (this._fingers === 3 && horizontal) {
            // Fingers move left -> back, right -> forward.
            // Mouse side buttons (8 = back, 9 = forward) work more reliably
            // across apps than a synthesized Alt+Left/Right.
            this._clickButton(distance < 0 ? 8 : 9);
        }
        // 3-finger vertical: swallowed (no action).
    }

    _onPinch(event) {
        const fingers = event.get_touchpad_gesture_finger_count();
        const phase = event.get_gesture_phase();

        if (phase === Clutter.TouchpadGesturePhase.BEGIN) {
            this._pinching = fingers === 3 &&
                Main.actionMode === Shell.ActionMode.NORMAL;
            this._scale = 1;
        }

        if (!this._pinching)
            return Clutter.EVENT_PROPAGATE;

        // The END event's scale isn't reliable, so remember the last update's.
        if (phase === Clutter.TouchpadGesturePhase.UPDATE)
            this._scale = event.get_gesture_pinch_scale();

        if (phase === Clutter.TouchpadGesturePhase.END) {
            this._pinching = false;
            const scale = this._scale;
            const win = global.display.focus_window;
            if (win && win.window_type === Meta.WindowType.NORMAL) {
                // Pinch out -> fullscreen, pinch in -> exit fullscreen.
                if (scale > 1.15 && !win.is_fullscreen())
                    win.make_fullscreen();
                else if (scale < 0.87 && win.is_fullscreen())
                    win.unmake_fullscreen();
            }
        } else if (phase === Clutter.TouchpadGesturePhase.CANCEL) {
            this._pinching = false;
        }

        return Clutter.EVENT_STOP;
    }

    _clickButton(button) {
        let t = GLib.get_monotonic_time();
        this._pointer.notify_button(t++, button, Clutter.ButtonState.PRESSED);
        this._pointer.notify_button(t++, button, Clutter.ButtonState.RELEASED);
    }

    _switchWorkspace(direction) {
        const active = global.workspace_manager.get_active_workspace();
        const target = active.get_neighbor(direction);
        if (target !== active)
            Main.wm.actionMoveWorkspace(target);
    }

    async _tileHalf(left) {
        const win = global.display.focus_window;
        if (!win || win.window_type !== Meta.WindowType.NORMAL)
            return;

        // Use Tiling Assistant's own tiling (tile groups etc.), but without
        // its Tiling Popup, which its Super+Left/Right handler may open.
        // Importing by the same file URI reuses its already-loaded modules.
        try {
            const ta = Main.extensionManager.lookup('tiling-assistant@ubuntu.com');
            if (ta?.state === 1 /* ACTIVE */) {
                const src = ta.dir.get_child('src').get_child('extension');
                const {TilingWindowManager: Twm} =
                    await import(src.get_child('tilingWindowManager.js').get_uri());
                const {Rect} = await import(src.get_child('utility.js').get_uri());
                const workArea = new Rect(win.get_work_area_current_monitor());
                const rect = Twm.getTileFor(left ? 'tile-left-half' : 'tile-right-half',
                    workArea, win.get_monitor());
                // Always tile, never toggle: toggleTiling() un-snaps a window
                // already on that half. Don't skip based on Tiling Assistant's
                // own tiled state either: it can say "tiled" while the window
                // actually sits elsewhere. Re-tiling in place is harmless.
                await Twm.tile(win, rect, {openTilingPopup: false});
                this._ensurePlaced(win, rect.x, rect.y, rect.width, rect.height);
                return;
            }
        } catch (e) {
            console.error(`[custom-swipes] Tiling Assistant tiling failed: ${e}`);
        }

        // Fallback: resize the focused window to that half of the work area.
        if (win.is_fullscreen())
            win.unmake_fullscreen();
        if (win.is_maximized())
            win.unmaximize();
        const area = win.get_work_area_current_monitor();
        const half = Math.floor(area.width / 2);
        const x = left ? area.x : area.x + half;
        const width = left ? half : area.width - half;
        win.move_resize_frame(true, x, area.y, width, area.height);
        this._ensurePlaced(win, x, area.y, width, area.height);
    }

    // On Wayland, leaving maximized/fullscreen completes asynchronously, and
    // the restored (often mid-screen) geometry can land after the tile move.
    // Re-check shortly after and force the window into place if needed.
    _ensurePlaced(win, x, y, width, height) {
        const delays = [300, 800];
        const check = attempt => {
            this._placeTimeoutId = 0;
            if (!win.get_compositor_private())
                return GLib.SOURCE_REMOVE; // window closed
            const r = win.get_frame_rect();
            // Loose tolerance: terminals etc. resize in whole character cells.
            const ok = Math.abs(r.x - x) <= 10 && Math.abs(r.y - y) <= 10 &&
                Math.abs(r.x + r.width - (x + width)) <= 40 &&
                Math.abs(r.height - height) <= 40;
            if (!ok) {
                console.log(`[custom-swipes] ${win.get_wm_class()} at ${r.x},${r.y} ${r.width}x${r.height}, ` +
                    `expected ${x},${y} ${width}x${height} (maximized=${win.is_maximized()} ` +
                    `fullscreen=${win.is_fullscreen()}); re-placing (attempt ${attempt + 1})`);
                if (win.is_fullscreen())
                    win.unmake_fullscreen();
                if (win.is_maximized())
                    win.unmaximize();
                win.move_resize_frame(true, x, y, width, height);
                if (attempt + 1 < delays.length) {
                    this._placeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                        delays[attempt + 1], () => check(attempt + 1));
                }
            }
            return GLib.SOURCE_REMOVE;
        };
        if (this._placeTimeoutId)
            GLib.source_remove(this._placeTimeoutId);
        this._placeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            delays[0], () => check(0));
    }
}
