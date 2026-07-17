/**
 * Telegram Bot API client — uses the native `fetch` in Node 18+ so we
 * avoid pulling in a full Telegram SDK just to POST a `sendMessage` call.
 */

import { settings, telegramConfigured } from "../config";
import type { Signal } from "./strategy";
import type { PortfolioEvent } from "../portfolio-watch/events";
import type { IssuerInsiderTransaction } from "../stock-watch/sec-issuer";
import type { NewsItemInput } from "../news-watch/store";

export interface NotifyResult {
  ok: boolean;
  detail: string;
}

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

async function sendText(text: string): Promise<NotifyResult> {
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

/** Format + send a trade signal. */
export async function notifySignal(
  ticker: string,
  signal: Signal,
): Promise<NotifyResult> {
  const emoji = signal.type === "BUY" ? "🟢" : signal.type === "SELL" ? "🔴" : "⚪️";
  const priceStr =
    signal.price === null ? "—" : `$${signal.price.toFixed(2)}`;
  const barStr = signal.barTs
    ? new Date(signal.barTs).toISOString().slice(0, 16).replace("T", " ")
    : "—";
  const text =
    `${emoji} *${signal.type}* · *${ticker}*\n` +
    `_${signal.strategy}_\n\n` +
    `Price: ${priceStr}\n` +
    `Bar: ${barStr} UTC\n` +
    `\n${signal.reason}`;
  return sendText(text);
}

/**
 * Format + send a "someone-you-follow traded" alert.
 *
 * Kept intentionally short so Telegram renders it in the notification
 * preview panel. The `matchedRules` string lets the user trace this
 * alert back to the toggle they enabled (e.g. "person watch: Pelosi",
 * "ticker watch: NVDA").
 */
export async function notifyPortfolioEvent(
  event: PortfolioEvent,
  matchedRules: string,
): Promise<NotifyResult> {
  const emoji =
    event.action === "BUY" ? "🟢"
    : event.action === "SELL" ? "🔴"
    : "⚪️";
  const categoryLabel =
    event.category === "politicians" ? "Politician"
    : event.category === "people" ? "Insider"
    : "Fund manager";
  const tickerStr = event.ticker ? ` · *${escapeMd(event.ticker)}*` : "";
  const dateStr = event.tradeDate
    ? ` on ${event.tradeDate}`
    : event.filingDate
      ? ` (filed ${event.filingDate})`
      : "";
  const sourceLine = event.sourceUrl
    ? `\n[Open filing](${event.sourceUrl})`
    : "";

  const text =
    `${emoji} *${escapeMd(event.actionLabel)}* — ${escapeMd(event.presetName)}${tickerStr}\n` +
    `_${categoryLabel}_${dateStr}\n\n` +
    `${escapeMd(event.companyName)}\n` +
    `${escapeMd(event.amountLabel)}\n` +
    `\n_${escapeMd(matchedRules)}_` +
    sourceLine;
  return sendText(text);
}

/**
 * Format + send a "someone at ${TICKER} just filed a Form 4" alert.
 *
 * These come from the issuer-centric SEC feed (any Form 4 filed at the
 * company we're watching), regardless of whether the reporter is one
 * of our tracked people/politicians/funds.
 */
export async function notifyStockInsiderEvent(
  tx: IssuerInsiderTransaction,
): Promise<NotifyResult> {
  const emoji =
    tx.action === "BUY" ? "🟢"
    : tx.action === "SELL" ? "🔴"
    : "⚪️";
  const dateStr = tx.transactionDate
    ? ` on ${tx.transactionDate}`
    : tx.filingDate
      ? ` (filed ${tx.filingDate})`
      : "";
  const priceStr = tx.pricePerShare !== null && Number.isFinite(tx.pricePerShare)
    ? ` @ $${tx.pricePerShare.toFixed(2)}`
    : "";
  const sharesStr = Number.isFinite(tx.shares) && tx.shares > 0
    ? `${formatShares(tx.shares)} shares${priceStr}`
    : priceStr.trim() || "—";
  const relationLine = tx.reporterRelation
    ? `\n_${escapeMd(tx.reporterRelation)}_`
    : "";
  const sourceLine = tx.filingUrl
    ? `\n[Open Form ${escapeMd(tx.formType)} filings](${tx.filingUrl})`
    : "";
  const securityLine = tx.securityTitle
    ? `\n_${escapeMd(tx.securityTitle)}_`
    : "";

  const text =
    `${emoji} *${escapeMd(tx.actionLabel)}* — *${escapeMd(tx.ticker)}*\n` +
    `Reporter: *${escapeMd(tx.reporterName)}*${relationLine}\n\n` +
    `${escapeMd(tx.issuerName)}\n` +
    `${escapeMd(sharesStr)}${dateStr}` +
    securityLine +
    `\n_stock watch: ${escapeMd(tx.ticker)}_` +
    sourceLine;
  return sendText(text);
}

/**
 * Format + send a "new headline for ${TICKER}" alert.
 *
 * Fires from the news-watch engine whenever a subscribed ticker
 * has a link we haven't seen before. Includes sentiment chip so
 * the user can scan bullish/bearish without opening the story.
 */
export async function notifyNewsEvent(
  item: NewsItemInput,
): Promise<NotifyResult> {
  const emoji =
    item.label === "bullish" ? "🟢"
    : item.label === "bearish" ? "🔴"
    : "⚪️";
  const labelStr = item.label
    ? item.label.charAt(0).toUpperCase() + item.label.slice(1)
    : "News";
  const scoreStr =
    item.score !== null && Number.isFinite(item.score)
      ? ` · score ${item.score >= 0 ? "+" : ""}${item.score.toFixed(2)}`
      : "";
  const publisherLine = item.publisher
    ? `_${escapeMd(item.publisher)}_${scoreStr}`
    : scoreStr.replace(/^\s·\s/, "").trim();
  const summaryBlock = item.summary
    ? `\n${escapeMd(truncate(item.summary, 220))}`
    : "";
  const sourceLine = item.link ? `\n[Read more](${item.link})` : "";

  const text =
    `${emoji} *${escapeMd(labelStr)}* — *${escapeMd(item.ticker)}*\n` +
    `${escapeMd(item.title)}\n` +
    (publisherLine ? `${publisherLine}\n` : "") +
    summaryBlock +
    `\n_news watch: ${escapeMd(item.ticker)}_` +
    sourceLine;
  return sendText(text);
}

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

/** Simple round-trip sanity check surfaced by the Bot page's "Test" button. */
export async function testConnection(): Promise<NotifyResult> {
  if (!telegramConfigured()) {
    return {
      ok: false,
      detail: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set.",
    };
  }
  return sendText(
    "📡 *Key Stock* — connection test successful. Alerts are wired up.",
  );
}
