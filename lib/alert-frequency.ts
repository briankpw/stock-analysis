/**
 * Shared "how often can this alert notify me?" primitive.
 *
 * Introduced so every alert type in the app can offer a small,
 * consistent frequency selector alongside its other settings without
 * duplicating the throttle logic across five engines.
 *
 * ## The three modes
 *
 *   * **`always`** — no throttle. Every eligible event fires (this is
 *     the pre-existing behaviour of every alert engine — kept as the
 *     safe default so upgrading users don't lose any notifications
 *     they were already receiving).
 *
 *   * **`daily`**  — at most ONE on-change notification per rule per
 *     calendar day, evaluated in the alert's own timezone. Silences
 *     the "verdict flipped BUY→HOLD→BUY→HOLD" chatter that busy
 *     markets can produce.
 *
 *   * **`once`**   — fires the first eligible event, then never fires
 *     again for that rule. Useful when you just want to be told the
 *     FIRST time a ticker crosses into BUY (say, after a fresh
 *     technical setup) and don't want to hear about it again unless
 *     you re-arm the alert.
 *
 * ## Scope
 *
 * The gate only applies to "on-change" / "on-event" firings — the
 * paths that a busy day can spam. Explicit user-scheduled channels
 * (e.g. a daily-digest sent at HH:MM) are unaffected: those are
 * already once-per-day by design and represent a deliberate
 * subscription rather than event-driven noise.
 *
 * ## Reset semantics
 *
 * Once a `once`-mode rule has fired, it stays quiet until the user
 * clears or re-saves the rule (which resets the last-change
 * timestamp implicitly via a form save that opts back into
 * `always`), or picks a different frequency. This matches the
 * user's mental model — "I asked to be told once, so I was told
 * once".
 */

// ---------------------------------------------------------------------------
// Type + validation
// ---------------------------------------------------------------------------

export type NotifyFrequency = "always" | "daily" | "once";

export const ALL_NOTIFY_FREQUENCIES: NotifyFrequency[] = [
  "always",
  "daily",
  "once",
];

export const DEFAULT_NOTIFY_FREQUENCY: NotifyFrequency = "always";

/**
 * Coerce arbitrary user / API input into a valid `NotifyFrequency`.
 * Unknown values quietly fall back to `always` — that matches the
 * historic "no throttle" behaviour, which is the safest failure mode
 * for a notification setting (users hear too much rather than too
 * little).
 */
export function normalizeFrequency(raw: unknown): NotifyFrequency {
  if (raw === "daily" || raw === "once") return raw;
  return "always";
}

// ---------------------------------------------------------------------------
// Gate — call from every engine's on-change / on-event decision path
// ---------------------------------------------------------------------------

/**
 * Return true when this rule is allowed to fire a notification right
 * now given its frequency mode and the last time it fired.
 *
 * @param frequency       Rule's current mode (from its store row).
 * @param lastNotifiedAt  ISO timestamp OR unix seconds of the last
 *                        successful notification for this rule. Pass
 *                        `null` for "never fired yet". Both formats
 *                        are accepted because the current store
 *                        layer uses ISO strings and future callers
 *                        may want to pass epoch seconds directly.
 * @param now             Optional injection for tests. Defaults to
 *                        `new Date()`.
 * @param timezone        IANA zone used for the `daily` calendar-day
 *                        comparison. Defaults to `UTC`. Matches the
 *                        alert row's own `timezone` field for the
 *                        verdict alerts, so a user in Asia/Shanghai
 *                        gets one alert per Shanghai-local day.
 */
export function shouldNotifyOnChange(
  frequency: NotifyFrequency,
  lastNotifiedAt: string | number | null,
  now: Date = new Date(),
  timezone = "UTC",
): boolean {
  if (frequency === "always") return true;
  if (lastNotifiedAt === null || lastNotifiedAt === undefined) return true;

  if (frequency === "once") {
    // Any prior fire — regardless of when — permanently mutes the
    // rule until the user re-arms it.
    return false;
  }

  // `daily`: allow one fire per calendar day in the alert's own
  // timezone. Using calendar-day (not rolling 24h) matches how a
  // human reads "once a day" — a fire at 23:59 doesn't gate the
  // next morning's 07:00 event.
  const lastDate = _localDate(lastNotifiedAt, timezone);
  const nowDate = _localDate(now, timezone);
  return lastDate !== nowDate;
}

/**
 * Locale-safe "YYYY-MM-DD in a given IANA zone" formatter. Kept
 * private because callers should never need to depend on the date
 * string format — the only comparison we ever make is equality.
 *
 * `Intl.DateTimeFormat` with the `en-CA` locale conveniently emits
 * the ISO-shaped `YYYY-MM-DD`; falls back to a manual UTC render
 * when Intl can't understand the zone (extremely unlikely on any
 * modern Node runtime, but the fallback keeps the gate honest).
 */
function _localDate(input: string | number | Date, timezone: string): string {
  const date =
    input instanceof Date
      ? input
      : typeof input === "number"
        ? new Date(input * 1000)
        : new Date(input);
  if (!Number.isFinite(date.getTime())) {
    // Malformed timestamp — treat as "never fired" by returning a
    // sentinel that will never equal today's date.
    return "0000-00-00";
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
