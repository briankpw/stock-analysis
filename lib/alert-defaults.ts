/**
 * Shared defaults for the alert configurator UI.
 *
 * The technical-signal alert and 6-Signal Resonance alert popovers both
 * seed a "daily digest time" when the user has no persisted config yet.
 * We used to hard-code `09:30` in each control, which meant:
 *
 *   • Any tweak to the default forced edits in two places.
 *   • Operators couldn't change it without shipping a code patch.
 *
 * This module resolves the default once from the environment (or the
 * baked-in fallback) so every control agrees on the same value.
 *
 * Configuration:
 *
 *   NEXT_PUBLIC_ALERT_DEFAULT_TIME=22:30   # HH:MM, 24-hour clock
 *
 * Because the value is embedded in the client bundle at build time, a
 * container rebuild is required to pick up a change. That's fine for a
 * *default* — users can still pick any time per alert from the UI.
 *
 * Invalid values (anything that isn't a 24-hour `HH:MM`) fall back to
 * the hard-coded default so a misconfigured env var can never crash
 * the popover.
 */

const FALLBACK_DAILY_TIME = "22:30";
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function resolve(raw: string | undefined): string {
  if (!raw) return FALLBACK_DAILY_TIME;
  const trimmed = raw.trim();
  return TIME_RE.test(trimmed) ? trimmed : FALLBACK_DAILY_TIME;
}

/**
 * The initial daily-digest time shown when a user opens an alert
 * popover for a ticker they haven't configured yet. Users can still
 * pick any time from the picker; this is only the pre-fill.
 *
 * Defaults to `22:30` (10:30 PM) — chosen so a post-close digest
 * lands in the evening on the Asia/Shanghai timezone the app was
 * originally deployed in.
 */
export const DEFAULT_ALERT_DAILY_TIME: string = resolve(
  process.env.NEXT_PUBLIC_ALERT_DEFAULT_TIME,
);
