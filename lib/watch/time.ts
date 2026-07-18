/**
 * Timezone-aware wall-clock helpers shared by every watch engine that
 * needs to fire "at time X in the user's local timezone" (currently
 * the technical + resonance daily-digest paths).
 *
 * Extracted from `lib/technical-watch/engine.ts` and
 * `lib/resonance-watch/engine.ts`, which used to hold two *identical*
 * copies of `localWallClock`. That was a live bug hazard — a
 * timezone/DST fix applied to one file wouldn't propagate to the
 * other. Now they share exactly one implementation.
 *
 * Design notes
 * ------------
 * We parse `Intl.DateTimeFormat.formatToParts()` rather than
 * `toLocaleString()` output so the numeric fields don't depend on
 * locale (`en-US` uses 12-hour with AM/PM, `en-GB` uses 24-hour, etc.).
 *
 * The timezone strings passed in here are pre-validated upstream by
 * `normalizeTimezone()` in each engine's store module, so we can
 * safely trust IANA names arriving here — `Intl.DateTimeFormat` will
 * throw on an invalid tz but callers should never hit that path.
 */

/**
 * Extract the local YYYY-MM-DD and HH:MM (24-hour, zero-padded) for a
 * given wall-clock instant expressed in `timezone`.
 *
 * Returns strings deliberately so the result is directly comparable
 * with lexicographic ordering (see `timeGte`) and safe to persist as
 * an idempotency key (e.g. `last_digest_local_date`) without any
 * timezone-aware DB column type.
 */
export function localWallClock(
  date: Date,
  timezone: string,
): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  // Intl in en-US returns "24" for midnight on some Node versions —
  // normalise to "00" so downstream string comparisons behave.
  const hh = get("hour") === "24" ? "00" : get("hour");
  const min = get("minute");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`,
  };
}

/**
 * True when HH:MM `a` is at or after HH:MM `b`. Lexicographic string
 * comparison works because both sides are zero-padded to the same
 * width by `localWallClock`.
 */
export function timeGte(a: string, b: string): boolean {
  return a >= b;
}
