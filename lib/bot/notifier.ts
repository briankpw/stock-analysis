/**
 * Alert dispatcher — fans every notification out to two independent
 * channels:
 *
 *   1. Telegram — a single chat that receives the full Markdown-formatted
 *      alert. Configured via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
 *      Uses native `fetch` (Node 18+) so we don't pull in a full SDK.
 *
 *   2. Web Push (RFC 8291) — every browser + installed PWA that the user
 *      has explicitly subscribed to. Auto-configured; VAPID keys are
 *      generated + persisted on first boot. The service worker in
 *      `public/service-worker.js` renders the payload as an OS-level
 *      notification (Android, Windows, macOS, iOS 16.4+ PWAs).
 *
 * Both channels are attempted in parallel. `NotifyResult.ok === true`
 * whenever *at least one* channel accepted the alert — so a caller that
 * has only Telegram configured (no push subscribers) still gets a green
 * light, and vice versa.
 */

import { settings, telegramConfigured } from "../config";
import type { PortfolioEvent } from "../portfolio-watch/events";
import type { IssuerInsiderTransaction } from "../stock-watch/sec-issuer";
import type { NewsItemInput } from "../news-watch/store";
import type { TechnicalSignal, Verdict } from "../technical-signal";
import type { ResonanceResult, ResonanceVerdict } from "../resonance";
import type { MasterSource, MasterVerdict } from "../master-verdict";
import type {
  RiskAssessment,
  RiskSeverity,
  RiskSignalId,
} from "../portfolio-risk/signals";
import {
  sendWebPushBatch,
  webPushConfigured,
  type WebPushPayload,
} from "./webpush";
import { pushSubscriberCount } from "./push-store";

export interface NotifyResult {
  ok: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Channel: Telegram
// ---------------------------------------------------------------------------

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

/**
 * Send a message via the Telegram Bot API with proper handling of
 * flood-wait (429), permanent-block (403), and transient-5xx errors.
 *
 * Telegram's contract:
 *   * 200 → sent.
 *   * 403 → the chat has blocked the bot (or the bot was removed from
 *           the group). Permanent — retrying just burns quota. We
 *           report this as a distinct failure detail so the alert
 *           engine can log it clearly; ideally a future feature would
 *           auto-disable the subscription, but the current single-
 *           chat model doesn't need that yet.
 *   * 429 → flood-wait. Body includes `parameters.retry_after`
 *           (seconds). We honour it, capped at 30 s so a bug on
 *           Telegram's side can't wedge a tick indefinitely, and
 *           retry once.
 *   * 5xx / network errors → transient. Retry with a short backoff
 *           up to `MAX_ATTEMPTS` times.
 *   * Other 4xx → permanent (bad chat id, malformed markdown, …).
 *           Report the body so the operator can fix it; don't retry.
 */
const TELEGRAM_MAX_ATTEMPTS = 3;
const TELEGRAM_MAX_FLOOD_WAIT_MS = 30_000;

async function sendTelegram(text: string): Promise<NotifyResult> {
  if (!telegramConfigured()) {
    return { ok: false, detail: "Telegram not configured" };
  }
  let lastDetail = "unknown error";
  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        TG_API(settings.bot.telegramBotToken, "sendMessage"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: settings.bot.telegramChatId,
            text,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (res.ok) return { ok: true, detail: "sent" };

      // Peek at the body once — Telegram error responses are small
      // JSON blobs of the shape `{ ok: false, error_code, description,
      // parameters?: { retry_after?: number } }`.
      const raw = await res.text().catch(() => "");
      let parsed: { description?: string; parameters?: { retry_after?: number } } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* leave parsed empty; description falls back to raw body */
      }
      const description = parsed.description ?? raw.slice(0, 200);

      if (res.status === 403) {
        // Permanent: bot blocked / removed from chat. No point
        // retrying; surface a distinct detail so ops can diagnose.
        return {
          ok: false,
          detail: `telegram: chat has blocked the bot (403) — ${description}`,
        };
      }
      if (res.status === 429) {
        const retryAfterSec =
          Number(parsed.parameters?.retry_after ?? res.headers.get("retry-after") ?? 1) || 1;
        const waitMs = Math.min(
          TELEGRAM_MAX_FLOOD_WAIT_MS,
          Math.max(500, retryAfterSec * 1000),
        );
        lastDetail = `HTTP 429 (flood-wait ${retryAfterSec}s): ${description}`;
        if (attempt < TELEGRAM_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        return { ok: false, detail: lastDetail };
      }
      if (res.status >= 500) {
        // Transient server-side. Exponential backoff, then retry.
        lastDetail = `HTTP ${res.status}: ${description}`;
        if (attempt < TELEGRAM_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
          continue;
        }
        return { ok: false, detail: lastDetail };
      }
      // Any other 4xx (bad markdown, bad chat id, …) — permanent.
      // Don't retry, don't burn quota.
      return { ok: false, detail: `HTTP ${res.status}: ${description}` };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < TELEGRAM_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        continue;
      }
      return { ok: false, detail: lastDetail };
    }
  }
  return { ok: false, detail: lastDetail };
}

// ---------------------------------------------------------------------------
// Multi-channel dispatch
// ---------------------------------------------------------------------------

/**
 * Send an alert to every configured channel in parallel. Returns an
 * aggregate `NotifyResult` where `ok` is true if either channel accepted
 * the alert (i.e. reached at least one recipient).
 *
 * Callers pass:
 *   - `markdown`: Telegram-formatted text (parse_mode: Markdown)
 *   - `push`:     web-push payload with title/body/tag/url. The SW renders
 *                 this straight to the OS notification centre.
 */
async function dispatchAlert(input: {
  markdown: string;
  push: WebPushPayload;
}): Promise<NotifyResult> {
  const telegramEnabled = telegramConfigured();
  const pushEnabled = webPushConfigured() && pushSubscriberCount() > 0;

  if (!telegramEnabled && !pushEnabled) {
    return { ok: false, detail: "no notification channels configured" };
  }

  const [tg, push] = await Promise.all([
    telegramEnabled ? sendTelegram(input.markdown) : Promise.resolve(null),
    pushEnabled ? sendWebPushBatch(input.push) : Promise.resolve(null),
  ]);

  const parts: string[] = [];
  let anyOk = false;
  if (tg) {
    parts.push(`telegram: ${tg.ok ? "ok" : tg.detail}`);
    if (tg.ok) anyOk = true;
  }
  if (push) {
    const pushOk = push.sent > 0;
    parts.push(`webpush: ${pushOk ? push.detail : (push.detail || "no sends")}`);
    if (pushOk) anyOk = true;
  }
  return { ok: anyOk, detail: parts.join(" | ") };
}

// ---------------------------------------------------------------------------
// Notification payloads — each pair (Telegram markdown + Web Push payload)
// is built from the same source event so both channels stay in sync.
// ---------------------------------------------------------------------------

const MAX_ITEMS_PER_BATCH = 15;

function emojiForAction(action: "BUY" | "SELL" | "OTHER" | string): string {
  if (action === "BUY") return "🟢";
  if (action === "SELL") return "🔴";
  return "⚪️";
}

function formatDateSuffix(event: PortfolioEvent): string {
  return event.tradeDate
    ? ` on ${event.tradeDate}`
    : event.filingDate
      ? ` (filed ${event.filingDate})`
      : "";
}

// (The `notifySignal` / `notifySignalsBatch` helpers used to live here
// but were removed alongside the legacy SMA/RSI/MACD strategy tick —
// see `lib/bot/engine.ts` for the rationale. Per-ticker signals now
// flow through `notifyTechnicalDigest` / `notifyResonanceChange`
// below, both of which have proper user-configured gating.)

// ---- Portfolio watch events -----------------------------------------------

export async function notifyPortfolioEvent(
  event: PortfolioEvent,
  matchedRules: string,
): Promise<NotifyResult> {
  const emoji = emojiForAction(event.action);
  const categoryLabel =
    event.category === "politicians" ? "Politician"
    : event.category === "people" ? "Insider"
    : "Fund manager";
  const tickerStr = event.ticker ? ` · *${escapeMd(event.ticker)}*` : "";
  const dateStr = formatDateSuffix(event);
  const sourceLine = event.sourceUrl ? `\n[Open filing](${event.sourceUrl})` : "";

  const markdown =
    `${emoji} *${escapeMd(event.actionLabel)}* — ${escapeMd(event.presetName)}${tickerStr}\n` +
    `_${categoryLabel}_${escapeMd(dateStr)}\n\n` +
    `${escapeMd(event.companyName)}\n` +
    `${escapeMd(event.amountLabel)}\n` +
    `\n_${escapeMd(matchedRules)}_` +
    sourceLine;

  const pushTicker = event.ticker ? ` · ${event.ticker}` : "";
  const push: WebPushPayload = {
    title: `${emoji} ${event.actionLabel} — ${event.presetName}${pushTicker}`,
    body: `${truncate(event.companyName, 80)} · ${event.amountLabel}${dateStr}`,
    tag: `portfolio:${event.category}:${event.presetId}`,
    url: "/portfolios",
    data: {
      kind: "portfolio",
      category: event.category,
      presetId: event.presetId,
      ticker: event.ticker,
    },
  };
  return dispatchAlert({ markdown, push });
}

export async function notifyPortfolioBatch(
  category: "people" | "politicians" | "funds",
  events: PortfolioEvent[],
  matchedRules: string,
): Promise<NotifyResult> {
  if (events.length === 0) return { ok: false, detail: "empty batch" };
  if (events.length === 1) return notifyPortfolioEvent(events[0]!, matchedRules);

  const categoryLabel =
    category === "politicians" ? "politician"
    : category === "people" ? "insider"
    : "fund manager";
  const headerEmoji =
    category === "politicians" ? "🏛️" : category === "people" ? "🏢" : "💼";

  const rows: string[] = [];
  const shown = events.slice(0, MAX_ITEMS_PER_BATCH);
  for (const e of shown) {
    const tickerStr = e.ticker ? ` · *${escapeMd(e.ticker)}*` : "";
    const dateStr = formatDateSuffix(e);
    const link = e.sourceUrl ? ` · [filing](${e.sourceUrl})` : "";
    rows.push(
      `${emojiForAction(e.action)} *${escapeMd(e.actionLabel)}* — ${escapeMd(e.presetName)}${tickerStr}${escapeMd(dateStr)}\n` +
        `   ${escapeMd(truncate(e.companyName, 80))} · ${escapeMd(e.amountLabel)}${link}`,
    );
  }
  const overflow = events.length - shown.length;
  if (overflow > 0) rows.push(`_…and ${overflow} more_`);

  const header = `${headerEmoji} *${events.length} new ${categoryLabel} events*`;
  const footer = `\n\n_${escapeMd(matchedRules)}_`;
  const markdown = `${header}\n\n${rows.join("\n\n")}${footer}`;

  const previewNames = events.slice(0, 3).map((e) => e.presetName).join(", ");
  const push: WebPushPayload = {
    title: `${headerEmoji} ${events.length} new ${categoryLabel} events`,
    body: truncate(previewNames + (events.length > 3 ? `, +${events.length - 3} more` : ""), 180),
    tag: `portfolio:${category}`,
    url: "/portfolios",
    data: { kind: "portfolio-batch", category, count: events.length },
  };
  return dispatchAlert({ markdown, push });
}

// ---- Stock (issuer-scoped Form 4) insider events --------------------------

export async function notifyStockInsiderEvent(
  tx: IssuerInsiderTransaction,
): Promise<NotifyResult> {
  const emoji = emojiForAction(tx.action);
  const dateStr = tx.transactionDate
    ? ` on ${tx.transactionDate}`
    : tx.filingDate ? ` (filed ${tx.filingDate})` : "";
  const priceStr = tx.pricePerShare !== null && Number.isFinite(tx.pricePerShare)
    ? ` @ $${tx.pricePerShare.toFixed(2)}` : "";
  const sharesStr = Number.isFinite(tx.shares) && tx.shares > 0
    ? `${formatShares(tx.shares)} shares${priceStr}` : priceStr.trim() || "—";
  const relationLine = tx.reporterRelation ? `\n_${escapeMd(tx.reporterRelation)}_` : "";
  const sourceLine = tx.filingUrl
    ? `\n[Open Form ${escapeMd(tx.formType)} filings](${tx.filingUrl})` : "";
  const securityLine = tx.securityTitle ? `\n_${escapeMd(tx.securityTitle)}_` : "";

  const markdown =
    `${emoji} *${escapeMd(tx.actionLabel)}* — *${escapeMd(tx.ticker)}*\n` +
    `Reporter: *${escapeMd(tx.reporterName)}*${relationLine}\n\n` +
    `${escapeMd(tx.issuerName)}\n` +
    `${escapeMd(sharesStr)}${escapeMd(dateStr)}` +
    securityLine +
    `\n_stock watch: ${escapeMd(tx.ticker)}_` +
    sourceLine;

  const relation = tx.reporterRelation ? ` (${tx.reporterRelation})` : "";
  const push: WebPushPayload = {
    title: `${emoji} ${tx.actionLabel} — ${tx.ticker}`,
    body: `${tx.reporterName}${relation} · ${sharesStr}${dateStr}`,
    tag: `stock:${tx.ticker}`,
    url: "/holders",
    data: { kind: "stock", ticker: tx.ticker, eventId: tx.eventId },
  };
  return dispatchAlert({ markdown, push });
}

export async function notifyStockInsiderBatch(
  ticker: string,
  txs: IssuerInsiderTransaction[],
): Promise<NotifyResult> {
  if (txs.length === 0) return { ok: false, detail: "empty batch" };
  if (txs.length === 1) return notifyStockInsiderEvent(txs[0]!);

  const rows: string[] = [];
  const shown = txs.slice(0, MAX_ITEMS_PER_BATCH);
  for (const tx of shown) {
    const dateStr = tx.transactionDate
      ? ` on ${tx.transactionDate}`
      : tx.filingDate ? ` (filed ${tx.filingDate})` : "";
    const priceStr = tx.pricePerShare !== null && Number.isFinite(tx.pricePerShare)
      ? ` @ $${tx.pricePerShare.toFixed(2)}` : "";
    const sharesStr = Number.isFinite(tx.shares) && tx.shares > 0
      ? `${formatShares(tx.shares)} sh${priceStr}` : priceStr.trim() || "—";
    const relation = tx.reporterRelation ? ` (${escapeMd(tx.reporterRelation)})` : "";
    rows.push(
      `${emojiForAction(tx.action)} *${escapeMd(tx.actionLabel)}* — *${escapeMd(tx.reporterName)}*${relation}\n` +
        `   ${escapeMd(sharesStr)}${escapeMd(dateStr)}`,
    );
  }
  const overflow = txs.length - shown.length;
  if (overflow > 0) rows.push(`_…and ${overflow} more_`);

  const firstUrl = txs[0]!.filingUrl;
  const linkLine = firstUrl ? `\n[Open latest Form 4](${firstUrl})` : "";

  const header = `🏢 *${txs.length} insider transactions* — *${escapeMd(ticker)}*`;
  const footer = `\n\n_stock watch: ${escapeMd(ticker)}_${linkLine}`;
  const markdown = `${header}\n\n${rows.join("\n\n")}${footer}`;

  const previewNames = txs.slice(0, 3).map((t) => t.reporterName).join(", ");
  const push: WebPushPayload = {
    title: `🏢 ${txs.length} insider trades — ${ticker}`,
    body: truncate(previewNames + (txs.length > 3 ? `, +${txs.length - 3} more` : ""), 180),
    tag: `stock:${ticker}`,
    url: "/holders",
    data: { kind: "stock-batch", ticker, count: txs.length },
  };
  return dispatchAlert({ markdown, push });
}

// ---- News watch events ----------------------------------------------------

export async function notifyNewsEvent(
  item: NewsItemInput,
): Promise<NotifyResult> {
  const emoji =
    item.label === "bullish" ? "🟢"
    : item.label === "bearish" ? "🔴" : "⚪️";
  const labelStr = item.label
    ? item.label.charAt(0).toUpperCase() + item.label.slice(1) : "News";
  const scoreStr =
    item.score !== null && Number.isFinite(item.score)
      ? ` · score ${item.score >= 0 ? "+" : ""}${item.score.toFixed(2)}` : "";
  const publisherLine = item.publisher
    ? `_${escapeMd(item.publisher)}_${scoreStr}`
    : scoreStr.replace(/^\s·\s/, "").trim();
  const summaryBlock = item.summary
    ? `\n${escapeMd(truncate(item.summary, 220))}` : "";
  const sourceLine = item.link ? `\n[Read more](${item.link})` : "";

  const markdown =
    `${emoji} *${escapeMd(labelStr)}* — *${escapeMd(item.ticker)}*\n` +
    `${escapeMd(item.title)}\n` +
    (publisherLine ? `${publisherLine}\n` : "") +
    summaryBlock +
    `\n_news watch: ${escapeMd(item.ticker)}_` +
    sourceLine;

  const push: WebPushPayload = {
    title: `${emoji} ${labelStr} news — ${item.ticker}`,
    body: truncate(item.title, 180) + (item.publisher ? ` · ${item.publisher}` : ""),
    tag: `news:${item.ticker}`,
    // Prefer landing inside the PWA so the user stays in the app shell;
    // the news page shows the ticker's headline stream with sentiment.
    url: "/news",
    data: {
      kind: "news",
      ticker: item.ticker,
      link: item.link,
      label: item.label,
    },
  };
  return dispatchAlert({ markdown, push });
}

export async function notifyNewsBatch(
  ticker: string,
  items: NewsItemInput[],
): Promise<NotifyResult> {
  if (items.length === 0) return { ok: false, detail: "empty batch" };
  if (items.length === 1) return notifyNewsEvent(items[0]!);

  const rows: string[] = [];
  const shown = items.slice(0, MAX_ITEMS_PER_BATCH);
  for (const item of shown) {
    const emoji =
      item.label === "bullish" ? "🟢"
      : item.label === "bearish" ? "🔴" : "⚪️";
    const scoreStr =
      item.score !== null && Number.isFinite(item.score)
        ? ` · ${item.score >= 0 ? "+" : ""}${item.score.toFixed(2)}` : "";
    const publisher = item.publisher ? ` · ${escapeMd(item.publisher)}` : "";
    const link = item.link ? ` · [read](${item.link})` : "";
    rows.push(
      `${emoji} ${escapeMd(truncate(item.title, 160))}${escapeMd(scoreStr)}${publisher}${link}`,
    );
  }
  const overflow = items.length - shown.length;
  if (overflow > 0) rows.push(`_…and ${overflow} more_`);

  const header = `📰 *${items.length} headlines* — *${escapeMd(ticker)}*`;
  const footer = `\n\n_news watch: ${escapeMd(ticker)}_`;
  const markdown = `${header}\n\n${rows.join("\n")}${footer}`;

  const previewTitles = items
    .slice(0, 2)
    .map((i) => truncate(i.title, 60))
    .join(" · ");
  const push: WebPushPayload = {
    title: `📰 ${items.length} headlines — ${ticker}`,
    body: truncate(previewTitles + (items.length > 2 ? ` · +${items.length - 2} more` : ""), 180),
    tag: `news:${ticker}`,
    url: "/news",
    data: { kind: "news-batch", ticker, count: items.length },
  };
  return dispatchAlert({ markdown, push });
}

// ---- Technical-signal alerts -----------------------------------------------

/** English verdict labels used in Telegram/push copy. */
const TS_VERDICT_LABEL: Record<Verdict, string> = {
  strong_buy: "STRONG BUY",
  buy: "BUY",
  hold: "HOLD",
  sell: "SELL",
  strong_sell: "STRONG SELL",
};

/** Emoji per verdict — same palette the UI uses so notifications feel consistent. */
function emojiForVerdict(verdict: Verdict): string {
  if (verdict === "strong_buy") return "🟢";
  if (verdict === "buy") return "🟢";
  if (verdict === "sell") return "🔴";
  if (verdict === "strong_sell") return "🔴";
  return "⚪️";
}

/** Format the [-1, +1] score into the same +42 / -18 shape the card shows. */
function formatScorePct(score: number): string {
  const pct = Math.round(score * 100);
  return `${pct >= 0 ? "+" : ""}${pct}`;
}

/** Compact top-3 rows for the notification body. */
function topContribLine(signal: TechnicalSignal): string {
  if (signal.rows.length === 0) return "no contributing signals";
  const top = signal.rows
    .slice()
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3);
  return top
    .map((r) => `${r.weight > 0 ? "+" : ""}${r.weight}·${r.key.split(".").pop()}`)
    .join(", ");
}

/**
 * Daily digest — the user asked "at 09:30 send me the current verdict".
 * `context` describes when the digest was fired (the user's local wall
 * clock + timezone) so they can immediately verify it's the right one.
 */
export async function notifyTechnicalDigest(
  ticker: string,
  signal: TechnicalSignal,
  context: { localDate: string; localTime: string; timezone: string },
): Promise<NotifyResult> {
  const emoji = emojiForVerdict(signal.verdict);
  const label = TS_VERDICT_LABEL[signal.verdict];
  const scoreStr = formatScorePct(signal.score);
  const coveragePct = Math.round(signal.coverage * 100);
  const agreementPct =
    signal.agreement === null ? null : Math.round(signal.agreement * 100);

  const meta =
    `Score: *${scoreStr}* / 100\n` +
    `Coverage: ${coveragePct}% · Agreement: ${agreementPct === null ? "—" : `${agreementPct}%`}\n` +
    `Regime: ${signal.regime} · ${signal.bullishCount}↑ / ${signal.bearishCount}↓`;

  const contribs = topContribLine(signal);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ticker)}*\n` +
    `_daily digest ${escapeMd(context.localDate)} ${escapeMd(context.localTime)} (${escapeMd(context.timezone)})_\n\n` +
    `${meta}\n\n` +
    `Top signals: ${escapeMd(contribs)}\n` +
    `\n_Open the app for the full breakdown._`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ticker} (${scoreStr})`,
    body: `Daily technical digest · ${contribs}`,
    tag: `technical:${ticker}`,
    url: "/signal#technical",
    data: {
      kind: "technical-digest",
      ticker,
      verdict: signal.verdict,
      score: signal.score,
      localTime: context.localTime,
      timezone: context.timezone,
    },
  };
  return dispatchAlert({ markdown, push });
}

/**
 * On-change alert. Fires when the verdict band crosses since the last
 * evaluation, e.g. hold → buy or buy → strong_sell. Includes the delta
 * so users can gauge how big the shift was.
 */
export async function notifyTechnicalChange(
  ticker: string,
  signal: TechnicalSignal,
  context: { previousVerdict: Verdict; previousScore: number | null },
): Promise<NotifyResult> {
  const emoji = emojiForVerdict(signal.verdict);
  const label = TS_VERDICT_LABEL[signal.verdict];
  const prevLabel = TS_VERDICT_LABEL[context.previousVerdict];
  const scoreStr = formatScorePct(signal.score);
  const prevScoreStr =
    context.previousScore === null
      ? "?"
      : formatScorePct(context.previousScore);
  const contribs = topContribLine(signal);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ticker)}*\n` +
    `_verdict changed: ${escapeMd(prevLabel)} → ${escapeMd(label)}_\n\n` +
    `Score: *${scoreStr}* / 100 (was ${prevScoreStr})\n` +
    `Regime: ${signal.regime} · ${signal.bullishCount}↑ / ${signal.bearishCount}↓\n\n` +
    `Top signals: ${escapeMd(contribs)}`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ticker}`,
    body: `Verdict changed: ${prevLabel} → ${label} (${scoreStr})`,
    tag: `technical:${ticker}`,
    url: "/signal#technical",
    data: {
      kind: "technical-change",
      ticker,
      previous: context.previousVerdict,
      verdict: signal.verdict,
      score: signal.score,
    },
  };
  return dispatchAlert({ markdown, push });
}

// ---- 6-Signal Resonance alerts ---------------------------------------------
//
// Structural mirror of the technical-signal helpers above. Verdicts
// come from a different enum (`ResonanceVerdict`), and the payload
// leans on alignment counts (0-6 bullish, 0-6 bearish) rather than a
// normalised score, but the two-channel (digest + on-change) shape is
// identical so users learn one mental model.

const RS_VERDICT_LABEL: Record<ResonanceVerdict, string> = {
  buy: "BUY (6-Signal)",
  holding: "HOLDING",
  sell: "SELL (6-Signal)",
  avoid: "AVOID",
  out: "OUT",
  warmup: "WARMUP",
};

function emojiForResonance(verdict: ResonanceVerdict): string {
  if (verdict === "buy") return "🟡"; // TDX-yellow ("买入信号 COLORYELLOW")
  if (verdict === "holding") return "🟣"; // magenta ("持有 COLORMAGENTA")
  if (verdict === "sell") return "🔴";
  if (verdict === "avoid") return "🟠";
  return "⚪️";
}

/**
 * Human-readable line summarising which checks are currently aligned.
 * Renders the 6 short indicator IDs (MACD/KDJ/RSI/LWR/BBI/MTM) with a
 * `↑` / `↓` / `·` per check so users can eyeball the composition
 * without opening the app.
 */
function resonanceComposition(result: ResonanceResult): string {
  if (result.checks.length === 0) return "no checks ready";
  return result.checks
    .map((c) => {
      const glyph = !c.ready ? "·" : c.bullish ? "↑" : "↓";
      return `${c.id}${glyph}`;
    })
    .join(" ");
}

/**
 * Daily digest for the 6-Signal Resonance. Fires at the user's
 * configured `daily_time` in their timezone. Content emphasises the
 * *composition* of the six checks rather than the verdict alone —
 * users of this strategy tend to want to see "5 aligned, MACD is
 * dragging" rather than a single word.
 */
export async function notifyResonanceDigest(
  ticker: string,
  result: ResonanceResult,
  context: { localDate: string; localTime: string; timezone: string },
): Promise<NotifyResult> {
  const emoji = emojiForResonance(result.verdict);
  const label = RS_VERDICT_LABEL[result.verdict];
  const composition = resonanceComposition(result);

  const streakLine =
    result.streak > 0
      ? `Bullish streak: ${result.streak} bar${result.streak === 1 ? "" : "s"}`
      : result.streak < 0
        ? `Bearish streak: ${-result.streak} bar${result.streak === -1 ? "" : "s"}`
        : "No active alignment";

  const meta =
    `Alignment: *${result.alignedCount}/6↑* · *${result.bearishAlignedCount}/6↓*\n` +
    `${streakLine}\n` +
    (result.freshBuy
      ? "✨ *Fresh BUY trigger on this bar*\n"
      : result.freshSell
        ? "✨ *Fresh SELL trigger on this bar*\n"
        : "");

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ticker)}*\n` +
    `_6-Signal Resonance daily digest ${escapeMd(context.localDate)} ${escapeMd(context.localTime)} (${escapeMd(context.timezone)})_\n\n` +
    `${meta}\n` +
    `Checks: \`${escapeMd(composition)}\`\n` +
    `\n_Open the Signal page for the full check-by-check breakdown._`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ticker}`,
    body: `${result.alignedCount}↑ / ${result.bearishAlignedCount}↓ · ${composition}`,
    tag: `resonance:${ticker}`,
    url: "/signal#resonance",
    data: {
      kind: "resonance-digest",
      ticker,
      verdict: result.verdict,
      alignedCount: result.alignedCount,
      bearishCount: result.bearishAlignedCount,
      freshBuy: result.freshBuy,
      freshSell: result.freshSell,
      localTime: context.localTime,
      timezone: context.timezone,
    },
  };
  return dispatchAlert({ markdown, push });
}

/**
 * On-change alert for the 6-Signal Resonance. Fires when the verdict
 * crosses since the previous evaluation. Includes both the old and
 * new alignment counts so users can gauge the size of the shift.
 */
export async function notifyResonanceChange(
  ticker: string,
  result: ResonanceResult,
  context: {
    previousVerdict: ResonanceVerdict;
    previousAlignedCount: number | null;
    previousBearishCount: number | null;
  },
): Promise<NotifyResult> {
  const emoji = emojiForResonance(result.verdict);
  const label = RS_VERDICT_LABEL[result.verdict];
  const prevLabel = RS_VERDICT_LABEL[context.previousVerdict];
  const composition = resonanceComposition(result);

  const prevAligned =
    context.previousAlignedCount === null ? "?" : String(context.previousAlignedCount);
  const prevBearish =
    context.previousBearishCount === null ? "?" : String(context.previousBearishCount);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ticker)}*\n` +
    `_6-Signal Resonance: ${escapeMd(prevLabel)} → ${escapeMd(label)}_\n\n` +
    `Alignment: *${result.alignedCount}/6↑* (was ${prevAligned}) · ` +
    `*${result.bearishAlignedCount}/6↓* (was ${prevBearish})\n` +
    (result.freshBuy
      ? "✨ *Fresh BUY trigger on this bar*\n"
      : result.freshSell
        ? "✨ *Fresh SELL trigger on this bar*\n"
        : "") +
    `\nChecks: \`${escapeMd(composition)}\``;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ticker}`,
    body: `Resonance ${prevLabel} → ${label} · ${result.alignedCount}↑/${result.bearishAlignedCount}↓`,
    tag: `resonance:${ticker}`,
    url: "/signal#resonance",
    data: {
      kind: "resonance-change",
      ticker,
      previous: context.previousVerdict,
      verdict: result.verdict,
      alignedCount: result.alignedCount,
      bearishCount: result.bearishAlignedCount,
      freshBuy: result.freshBuy,
      freshSell: result.freshSell,
    },
  };
  return dispatchAlert({ markdown, push });
}

// ---- Sector 6-Signal Resonance alerts --------------------------------------
//
// Structurally identical to the per-ticker resonance notifiers above,
// but the "subject" is a market segment (e.g. "Artificial
// Intelligence") rather than a single ticker. The resonance math is
// still computed on a single instrument — the segment's proxy ETF —
// so we surface both the segment name (what the user subscribed to)
// AND the proxy ticker (what was actually measured) so nobody's left
// wondering "wait, why does this alert mention AIQ?".
//
// Deep link points at the segment detail page rather than the
// /signal ticker page, since that's where the same 6-Signal
// Resonance card is rendered for the sector.

/**
 * Context passed to sector-resonance notifiers. Kept as a plain
 * bag rather than a class so the engine (which already has these
 * fields hoisted from the segment definition) doesn't have to build
 * a wrapper type.
 */
export interface SectorNotifyContext {
  segmentId: string;
  segmentName: string;
  proxyTicker: string;
}

/**
 * Daily digest for the 6-Signal Resonance on a market segment's
 * proxy ETF. Content mirrors `notifyResonanceDigest` but the header
 * emphasises the segment, and the push `tag` is scoped by
 * `sector-resonance:<segment_id>` so multiple sector subscriptions
 * don't overwrite each other in the notification tray.
 */
export async function notifySectorResonanceDigest(
  ctx: SectorNotifyContext,
  result: ResonanceResult,
  context: { localDate: string; localTime: string; timezone: string },
): Promise<NotifyResult> {
  const emoji = emojiForResonance(result.verdict);
  const label = RS_VERDICT_LABEL[result.verdict];
  const composition = resonanceComposition(result);

  const streakLine =
    result.streak > 0
      ? `Bullish streak: ${result.streak} bar${result.streak === 1 ? "" : "s"}`
      : result.streak < 0
        ? `Bearish streak: ${-result.streak} bar${result.streak === -1 ? "" : "s"}`
        : "No active alignment";

  const meta =
    `Alignment: *${result.alignedCount}/6↑* · *${result.bearishAlignedCount}/6↓*\n` +
    `${streakLine}\n` +
    (result.freshBuy
      ? "✨ *Fresh BUY trigger on this bar*\n"
      : result.freshSell
        ? "✨ *Fresh SELL trigger on this bar*\n"
        : "");

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ctx.segmentName)}*\n` +
    `_Sector 6-Signal Resonance daily digest ${escapeMd(context.localDate)} ${escapeMd(context.localTime)} (${escapeMd(context.timezone)})_\n` +
    `_Measured on proxy ETF *${escapeMd(ctx.proxyTicker)}*_\n\n` +
    `${meta}\n` +
    `Checks: \`${escapeMd(composition)}\`\n` +
    `\n_Open the segment page for the full check-by-check breakdown._`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ctx.segmentName}`,
    body: `${result.alignedCount}↑ / ${result.bearishAlignedCount}↓ · ${composition} · ${ctx.proxyTicker}`,
    tag: `sector-resonance:${ctx.segmentId}`,
    url: `/market/segments/${ctx.segmentId}`,
    data: {
      kind: "sector-resonance-digest",
      segmentId: ctx.segmentId,
      segmentName: ctx.segmentName,
      proxyTicker: ctx.proxyTicker,
      verdict: result.verdict,
      alignedCount: result.alignedCount,
      bearishCount: result.bearishAlignedCount,
      freshBuy: result.freshBuy,
      freshSell: result.freshSell,
      localTime: context.localTime,
      timezone: context.timezone,
    },
  };
  return dispatchAlert({ markdown, push });
}

/**
 * On-change alert for the sector 6-Signal Resonance. Fires when
 * the proxy ETF's verdict crosses since the previous evaluation.
 */
export async function notifySectorResonanceChange(
  ctx: SectorNotifyContext,
  result: ResonanceResult,
  context: {
    previousVerdict: ResonanceVerdict;
    previousAlignedCount: number | null;
    previousBearishCount: number | null;
  },
): Promise<NotifyResult> {
  const emoji = emojiForResonance(result.verdict);
  const label = RS_VERDICT_LABEL[result.verdict];
  const prevLabel = RS_VERDICT_LABEL[context.previousVerdict];
  const composition = resonanceComposition(result);

  const prevAligned =
    context.previousAlignedCount === null
      ? "?"
      : String(context.previousAlignedCount);
  const prevBearish =
    context.previousBearishCount === null
      ? "?"
      : String(context.previousBearishCount);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ctx.segmentName)}*\n` +
    `_Sector 6-Signal Resonance: ${escapeMd(prevLabel)} → ${escapeMd(label)}_\n` +
    `_Measured on proxy ETF *${escapeMd(ctx.proxyTicker)}*_\n\n` +
    `Alignment: *${result.alignedCount}/6↑* (was ${prevAligned}) · ` +
    `*${result.bearishAlignedCount}/6↓* (was ${prevBearish})\n` +
    (result.freshBuy
      ? "✨ *Fresh BUY trigger on this bar*\n"
      : result.freshSell
        ? "✨ *Fresh SELL trigger on this bar*\n"
        : "") +
    `\nChecks: \`${escapeMd(composition)}\``;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ctx.segmentName}`,
    body: `Sector resonance ${prevLabel} → ${label} · ${result.alignedCount}↑/${result.bearishAlignedCount}↓ · ${ctx.proxyTicker}`,
    tag: `sector-resonance:${ctx.segmentId}`,
    url: `/market/segments/${ctx.segmentId}`,
    data: {
      kind: "sector-resonance-change",
      segmentId: ctx.segmentId,
      segmentName: ctx.segmentName,
      proxyTicker: ctx.proxyTicker,
      previous: context.previousVerdict,
      verdict: result.verdict,
      alignedCount: result.alignedCount,
      bearishCount: result.bearishAlignedCount,
      freshBuy: result.freshBuy,
      freshSell: result.freshSell,
    },
  };
  return dispatchAlert({ markdown, push });
}

// ---- Sector Technical Signal alerts ---------------------------------------
//
// Same story as `notifySectorResonance*` above but for the multi-
// indicator Technical Signal scorer. The scorer runs on the segment's
// proxy ETF (resolved by the engine), so the notification body
// surfaces both the segment name (what the user subscribed to) AND
// the proxy ticker (what was actually measured). Deep link points at
// the segment detail page rather than /signal.
//
// The two helpers reuse `TS_VERDICT_LABEL`, `emojiForVerdict` and
// `topContribLine()` from the per-ticker technical alerts, so a
// STRONG_BUY on the AI sector looks and feels identical to a
// STRONG_BUY on NVDA — same emoji, same "top signals" tail, same
// score-out-of-100 phrasing. Only the header labels the subscription
// as sector-scoped.

/**
 * Daily digest — the user asked "at 09:30 send me today's technical
 * verdict for this sector". Body mirrors `notifyTechnicalDigest`
 * verbatim but the header calls out the segment + proxy so users
 * aren't left wondering why a "Tech sector" digest mentions XLK.
 */
export async function notifySectorTechnicalDigest(
  ctx: SectorNotifyContext,
  signal: TechnicalSignal,
  context: { localDate: string; localTime: string; timezone: string },
): Promise<NotifyResult> {
  const emoji = emojiForVerdict(signal.verdict);
  const label = TS_VERDICT_LABEL[signal.verdict];
  const scoreStr = formatScorePct(signal.score);
  const coveragePct = Math.round(signal.coverage * 100);
  const agreementPct =
    signal.agreement === null ? null : Math.round(signal.agreement * 100);

  const meta =
    `Score: *${scoreStr}* / 100\n` +
    `Coverage: ${coveragePct}% · Agreement: ${agreementPct === null ? "—" : `${agreementPct}%`}\n` +
    `Regime: ${signal.regime} · ${signal.bullishCount}↑ / ${signal.bearishCount}↓`;

  const contribs = topContribLine(signal);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ctx.segmentName)}*\n` +
    `_Sector Technical Signal daily digest ${escapeMd(context.localDate)} ${escapeMd(context.localTime)} (${escapeMd(context.timezone)})_\n` +
    `_Measured on proxy ETF *${escapeMd(ctx.proxyTicker)}*_\n\n` +
    `${meta}\n\n` +
    `Top signals: ${escapeMd(contribs)}\n` +
    `\n_Open the segment page for the full breakdown._`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ctx.segmentName} (${scoreStr})`,
    body: `Sector technical digest · ${contribs} · ${ctx.proxyTicker}`,
    tag: `sector-technical:${ctx.segmentId}`,
    url: `/market/segments/${ctx.segmentId}`,
    data: {
      kind: "sector-technical-digest",
      segmentId: ctx.segmentId,
      segmentName: ctx.segmentName,
      proxyTicker: ctx.proxyTicker,
      verdict: signal.verdict,
      score: signal.score,
      localTime: context.localTime,
      timezone: context.timezone,
    },
  };
  return dispatchAlert({ markdown, push });
}

/**
 * On-change alert for the sector Technical Signal. Fires when the
 * verdict band crosses since the previous evaluation.
 */
export async function notifySectorTechnicalChange(
  ctx: SectorNotifyContext,
  signal: TechnicalSignal,
  context: { previousVerdict: Verdict; previousScore: number | null },
): Promise<NotifyResult> {
  const emoji = emojiForVerdict(signal.verdict);
  const label = TS_VERDICT_LABEL[signal.verdict];
  const prevLabel = TS_VERDICT_LABEL[context.previousVerdict];
  const scoreStr = formatScorePct(signal.score);
  const prevScoreStr =
    context.previousScore === null
      ? "?"
      : formatScorePct(context.previousScore);
  const contribs = topContribLine(signal);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ctx.segmentName)}*\n` +
    `_Sector Technical Signal: ${escapeMd(prevLabel)} → ${escapeMd(label)}_\n` +
    `_Measured on proxy ETF *${escapeMd(ctx.proxyTicker)}*_\n\n` +
    `Score: *${scoreStr}* / 100 (was ${prevScoreStr})\n` +
    `Regime: ${signal.regime} · ${signal.bullishCount}↑ / ${signal.bearishCount}↓\n\n` +
    `Top signals: ${escapeMd(contribs)}`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ctx.segmentName}`,
    body: `Sector technical ${prevLabel} → ${label} · ${scoreStr} · ${ctx.proxyTicker}`,
    tag: `sector-technical:${ctx.segmentId}`,
    url: `/market/segments/${ctx.segmentId}`,
    data: {
      kind: "sector-technical-change",
      segmentId: ctx.segmentId,
      segmentName: ctx.segmentName,
      proxyTicker: ctx.proxyTicker,
      previous: context.previousVerdict,
      verdict: signal.verdict,
      score: signal.score,
    },
  };
  return dispatchAlert({ markdown, push });
}

// ---- Master-verdict alerts -------------------------------------------------
//
// Fuses the technical, resonance, fundamentals, sentiment and F&G
// signals into a single BUY/SELL band, and pings the user on that
// combined verdict rather than any individual sub-scorer.
//
// Same 5-band `Verdict` vocabulary as the technical scorer, so we
// reuse `TS_VERDICT_LABEL` + `emojiForVerdict` + `formatScorePct`
// above. The distinguishing UX signal in the notification body is
// the `topReasons` list and the coverage/agreement chips — that's
// what tells the reader "this is the fused verdict, not just the
// technical one".

/**
 * One-line summary of the biggest drivers behind the master verdict.
 * Mirrors `topContribLine()` for the technical signal — capped at
 * three entries so the Telegram body stays scannable on a phone.
 */
function masterTopReasonsLine(reasons: MasterSource[]): string {
  if (reasons.length === 0) return "no meaningful drivers";
  return reasons
    .slice(0, 3)
    .map((r) => {
      const contrib = r.contribution ?? 0;
      const pct = Math.round(contrib * 100);
      const sign = pct >= 0 ? "+" : "";
      return `${sign}${pct}·${r.labelEn.toLowerCase().split(" ")[0]}`;
    })
    .join(", ");
}

/**
 * Daily digest — the user asked "at 09:30 send me today's combined
 * verdict". Body includes coverage and agreement so the reader can
 * gauge how trustable today's summary is (high coverage + high
 * agreement = strongest possible signal).
 */
export async function notifyMasterDigest(
  ticker: string,
  verdict: MasterVerdict,
  context: { localDate: string; localTime: string; timezone: string },
): Promise<NotifyResult> {
  const emoji = emojiForVerdict(verdict.verdict);
  const label = TS_VERDICT_LABEL[verdict.verdict];
  const scoreStr = formatScorePct(verdict.score);
  const coveragePct = Math.round(verdict.coverage * 100);
  const agreementPct =
    verdict.agreement === null ? null : Math.round(verdict.agreement * 100);
  const reasonsLine = masterTopReasonsLine(verdict.topReasons);

  const meta =
    `Score: *${scoreStr}* / 100\n` +
    `Coverage: ${coveragePct}% · Agreement: ${agreementPct === null ? "—" : `${agreementPct}%`}\n` +
    `Regime: ${verdict.regime}`;

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ticker)}* _(Master Verdict)_\n` +
    `_daily digest ${escapeMd(context.localDate)} ${escapeMd(context.localTime)} (${escapeMd(context.timezone)})_\n\n` +
    `${meta}\n\n` +
    `Top drivers: ${escapeMd(reasonsLine)}\n` +
    `\n_Open the app for the full breakdown._`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ticker} (${scoreStr})`,
    body: `Master verdict digest · ${reasonsLine}`,
    tag: `master:${ticker}`,
    url: "/signal",
    data: {
      kind: "master-digest",
      ticker,
      verdict: verdict.verdict,
      score: verdict.score,
      coverage: verdict.coverage,
      localTime: context.localTime,
      timezone: context.timezone,
    },
  };
  return dispatchAlert({ markdown, push });
}

/**
 * On-change alert. Fires when the master verdict band crosses since
 * the last evaluation (e.g. hold → buy or buy → strong_sell). The
 * body carries the score delta AND the coverage delta because a
 * verdict change while coverage jumps from 50% → 90% is a very
 * different signal from a change on already-full coverage.
 */
export async function notifyMasterChange(
  ticker: string,
  verdict: MasterVerdict,
  context: {
    previousVerdict: Verdict;
    previousScore: number | null;
    previousCoverage: number | null;
  },
): Promise<NotifyResult> {
  const emoji = emojiForVerdict(verdict.verdict);
  const label = TS_VERDICT_LABEL[verdict.verdict];
  const prevLabel = TS_VERDICT_LABEL[context.previousVerdict];
  const scoreStr = formatScorePct(verdict.score);
  const prevScoreStr =
    context.previousScore === null
      ? "?"
      : formatScorePct(context.previousScore);
  const coveragePct = Math.round(verdict.coverage * 100);
  const prevCoverageStr =
    context.previousCoverage === null
      ? "?"
      : `${Math.round(context.previousCoverage * 100)}%`;
  const reasonsLine = masterTopReasonsLine(verdict.topReasons);

  const markdown =
    `${emoji} *${label}* — *${escapeMd(ticker)}* _(Master Verdict)_\n` +
    `_verdict changed: ${escapeMd(prevLabel)} → ${escapeMd(label)}_\n\n` +
    `Score: *${scoreStr}* / 100 (was ${prevScoreStr})\n` +
    `Coverage: ${coveragePct}% (was ${prevCoverageStr}) · Regime: ${verdict.regime}\n\n` +
    `Top drivers: ${escapeMd(reasonsLine)}`;

  const push: WebPushPayload = {
    title: `${emoji} ${label} — ${ticker}`,
    body: `Master verdict: ${prevLabel} → ${label} (${scoreStr})`,
    tag: `master:${ticker}`,
    url: "/signal",
    data: {
      kind: "master-change",
      ticker,
      previous: context.previousVerdict,
      verdict: verdict.verdict,
      score: verdict.score,
      coverage: verdict.coverage,
    },
  };
  return dispatchAlert({ markdown, push });
}

// ---- Portfolio delisting / bankruptcy risk alerts --------------------------
//
// Fires when the risk analyser detects a NEW critical/high signal for
// a symbol under monitoring. The push body leads with the strongest
// signal so the user knows the takeaway at a glance; the Telegram
// markdown carries the full list plus the freshest news deep-link.
//
// See `lib/portfolio-risk/engine.ts` for the change-detection rules
// (fingerprint diff + severity gate + hourly throttle).

const RISK_SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
};

function emojiForRiskSeverity(sev: RiskSeverity): string {
  if (sev === "critical") return "🚨";
  if (sev === "high") return "⚠️";
  return "🟡";
}

/**
 * Short, human-readable label for a `RiskSignalId`. Duplicated with
 * the i18n dictionary intentionally — the notifier runs server-side
 * with no i18n context, and users of an English-first Telegram bot
 * expect English copy anyway. The tab UI reads the i18n strings.
 */
function labelForSignal(id: RiskSignalId): string {
  switch (id) {
    case "news.bankruptcy": return "Bankruptcy filing";
    case "news.delisting": return "Delisting notice";
    case "news.goingConcern": return "Going-concern / audit issue";
    case "news.sec": return "SEC action";
    case "news.tradingHalt": return "Trading halt";
    case "data.noBars": return "No price data";
    case "bars.stale": return "Stale price data";
    case "price.collapse90d": return "Price collapse (90d)";
    case "price.drawdown60d": return "Severe drawdown";
    case "price.drawdown40d": return "Elevated drawdown";
    case "price.subOneExtended": return "Sub-$1 for extended period";
    case "price.subOne": return "Sub-$1 close";
    case "volume.collapse": return "Volume collapse";
  }
}

export async function notifyPortfolioRisk(
  ticker: string,
  assessment: RiskAssessment,
  context: {
    previousSeverity: RiskSeverity | null;
    previousSignals: RiskSignalId[];
  },
): Promise<NotifyResult> {
  const sev = assessment.overallSeverity;
  if (sev === null || assessment.signals.length === 0) {
    // Shouldn't happen — the engine only calls us when a signal
    // fired — but guard so we never send an empty payload.
    return { ok: false, detail: "no signals to notify about" };
  }
  const emoji = emojiForRiskSeverity(sev);
  const sevLabel = RISK_SEVERITY_LABEL[sev];

  // "New" signals = present now, absent last time. Highlighted so the
  // user can see what actually changed vs. what's still true from
  // yesterday.
  const prevSet = new Set(context.previousSignals);
  const newSignals = assessment.signals.filter((s) => !prevSet.has(s.id));

  const priceLine =
    assessment.latestClose !== null
      ? `Latest close: $${assessment.latestClose.toFixed(assessment.latestClose < 1 ? 3 : 2)}` +
        (assessment.drawdown90d !== null
          ? ` · 90d drawdown ${Math.round(assessment.drawdown90d * 100)}%`
          : "")
      : "No price data available";

  const bulletFor = (id: RiskSignalId) =>
    `• ${escapeMd(labelForSignal(id))}`;

  const highlighted =
    newSignals.length > 0
      ? `*New signals*:\n${newSignals.map((s) => bulletFor(s.id)).join("\n")}`
      : `*Signals*:\n${assessment.signals.map((s) => bulletFor(s.id)).join("\n")}`;

  // The freshest news signal — if any — gets a "Read more" deep-link
  // so users can immediately see the source article that tripped the
  // alert. Prefer critical over high when multiple news signals fired.
  const newsSignal = assessment.signals
    .filter((s) => s.id.startsWith("news."))
    .sort((a, b) => {
      const sev = (x: RiskSeverity) => (x === "critical" ? 2 : x === "high" ? 1 : 0);
      const bySev = sev(b.severity) - sev(a.severity);
      if (bySev !== 0) return bySev;
      const ta = a.sourcePublishedAt ? Date.parse(a.sourcePublishedAt) : 0;
      const tb = b.sourcePublishedAt ? Date.parse(b.sourcePublishedAt) : 0;
      return tb - ta;
    })[0];
  const newsLink =
    newsSignal && newsSignal.sourceUrl && newsSignal.sourceTitle
      ? `\n\n[${escapeMd(truncate(newsSignal.sourceTitle, 80))}](${newsSignal.sourceUrl})`
      : "";

  const transitionLine =
    context.previousSeverity && context.previousSeverity !== sev
      ? `\n_${RISK_SEVERITY_LABEL[context.previousSeverity]} → ${sevLabel}_`
      : "";

  const markdown =
    `${emoji} *Portfolio risk — ${sevLabel}* — *${escapeMd(ticker)}*` +
    `${transitionLine}\n\n` +
    `${priceLine}\n\n` +
    `${highlighted}` +
    newsLink +
    `\n\n_Open the app → My Portfolio → Risks tab for the full breakdown._`;

  // Push body: lead with the top signal so users see the takeaway on
  // the notification tray without opening.
  const topLabel = labelForSignal(assessment.signals[0]!.id);
  const bodyExtra =
    assessment.signals.length > 1
      ? ` · +${assessment.signals.length - 1} more`
      : "";
  const push: WebPushPayload = {
    title: `${emoji} ${sevLabel} risk — ${ticker}`,
    body: `${topLabel}${bodyExtra}`,
    tag: `portfolio-risk:${ticker}`,
    // Deep-link to the Risks tab.
    url: `/my-portfolio?tab=risks&ticker=${encodeURIComponent(ticker)}`,
    data: {
      kind: "portfolio-risk",
      ticker,
      severity: sev,
      signals: assessment.signals.map((s) => s.id),
      fingerprint: assessment.fingerprint,
    },
  };
  return dispatchAlert({ markdown, push });
}

// ---------------------------------------------------------------------------
// Manual test endpoints — exposed to the /bot page's Test buttons
// ---------------------------------------------------------------------------

/** Round-trip sanity check for the Telegram channel only. */
export async function testConnection(): Promise<NotifyResult> {
  if (!telegramConfigured()) {
    return {
      ok: false,
      detail: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set.",
    };
  }
  return sendTelegram(
    "📡 *Stock Analysis* — connection test successful. Alerts are wired up.",
  );
}

/** Send a fixed test payload to every registered Web Push subscriber. */
export async function testWebPush(): Promise<NotifyResult> {
  if (!webPushConfigured()) {
    return { ok: false, detail: "VAPID keys are not initialised yet." };
  }
  if (pushSubscriberCount() === 0) {
    return { ok: false, detail: "No devices are subscribed to push notifications." };
  }
  const res = await sendWebPushBatch({
    title: "📡 Stock Analysis",
    body: "Push notifications are wired up. You'll receive alerts here.",
    tag: "test",
    url: "/bot",
    data: { kind: "test" },
  });
  return { ok: res.sent > 0, detail: res.detail };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function formatShares(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Telegram Markdown (legacy) escapes just enough to survive most SEC
 * company names. `parse_mode: 'Markdown'` (v1) only trips on `_`, `*`,
 * `\``, and `[`, so we only escape those.
 */
function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}
