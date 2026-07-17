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
import type { Signal } from "./strategy";
import type { PortfolioEvent } from "../portfolio-watch/events";
import type { IssuerInsiderTransaction } from "../stock-watch/sec-issuer";
import type { NewsItemInput } from "../news-watch/store";
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

async function sendTelegram(text: string): Promise<NotifyResult> {
  if (!telegramConfigured()) {
    return { ok: false, detail: "Telegram not configured" };
  }
  try {
    const res = await fetch(TG_API(settings.bot.telegramBotToken, "sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.bot.telegramChatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, detail: "sent" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
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

function formatBarTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

function formatDateSuffix(event: PortfolioEvent): string {
  return event.tradeDate
    ? ` on ${event.tradeDate}`
    : event.filingDate
      ? ` (filed ${event.filingDate})`
      : "";
}

// ---- Bot strategy signals --------------------------------------------------

/** Format + send a single trade signal. */
export async function notifySignal(
  ticker: string,
  signal: Signal,
): Promise<NotifyResult> {
  const emoji = emojiForAction(signal.type);
  const priceStr = signal.price === null ? "—" : `$${signal.price.toFixed(2)}`;
  const barStr = formatBarTs(signal.barTs);
  const markdown =
    `${emoji} *${signal.type}* · *${ticker}*\n` +
    `_${signal.strategy}_\n\n` +
    `Price: ${priceStr}\n` +
    `Bar: ${barStr} UTC\n` +
    `\n${signal.reason}`;

  const push: WebPushPayload = {
    title: `${emoji} ${signal.type} — ${ticker}`,
    body: `${signal.strategy} @ ${priceStr} · ${truncate(signal.reason, 120)}`,
    tag: `signal:${ticker}`,
    url: "/bot",
    data: { kind: "signal", ticker, type: signal.type },
  };
  return dispatchAlert({ markdown, push });
}

export async function notifySignalsBatch(
  ticker: string,
  signals: Signal[],
): Promise<NotifyResult> {
  if (signals.length === 0) return { ok: false, detail: "empty batch" };
  if (signals.length === 1) return notifySignal(ticker, signals[0]!);

  const rows: string[] = [];
  const shown = signals.slice(0, MAX_ITEMS_PER_BATCH);
  for (const s of shown) {
    const priceStr = s.price === null ? "—" : `$${s.price.toFixed(2)}`;
    const barStr = formatBarTs(s.barTs);
    rows.push(
      `${emojiForAction(s.type)} *${escapeMd(s.type)}* — _${escapeMd(s.strategy)}_ @ ${escapeMd(priceStr)}\n` +
        `   Bar: ${escapeMd(barStr)} UTC · ${escapeMd(truncate(s.reason, 140))}`,
    );
  }
  const overflow = signals.length - shown.length;
  if (overflow > 0) rows.push(`_…and ${overflow} more_`);

  const header = `📊 *${signals.length} signals* — *${escapeMd(ticker)}*`;
  const markdown = `${header}\n\n${rows.join("\n\n")}`;

  const pushBody = signals
    .slice(0, 3)
    .map((s) => `${s.type} (${s.strategy})`)
    .join(", ") + (signals.length > 3 ? `, +${signals.length - 3} more` : "");

  const push: WebPushPayload = {
    title: `📊 ${signals.length} signals — ${ticker}`,
    body: pushBody,
    tag: `signal:${ticker}`,
    url: "/bot",
    data: { kind: "signal-batch", ticker, count: signals.length },
  };
  return dispatchAlert({ markdown, push });
}

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
