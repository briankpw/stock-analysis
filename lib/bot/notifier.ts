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

// ---------------------------------------------------------------------------
// Batch (grouped) senders
// ---------------------------------------------------------------------------
//
// Each engine tick can produce many notify-eligible events. Sending one
// Telegram message per event floods the chat. Instead we bucket events by
// their natural "category" (portfolio → people/politicians/funds; stock →
// ticker; news → ticker; bot → ticker) and post one grouped message per
// bucket per tick.
//
// * Batches with a single item delegate to the existing singular formatter
//   so the UX for the common "1 event per tick" case is unchanged.
// * Each grouped message caps at MAX_ITEMS_PER_BATCH rows and adds an
//   "…and N more" line to stay under Telegram's 4096-char limit.
// * Failure to send is reported once for the whole batch — callers should
//   still record each individual event in their dedup store so a failed
//   Telegram send doesn't cause a re-notification on the next tick.

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

/**
 * Batch-send several bot strategy signals that fired on the same ticker
 * during a single tick. All signals in `signals` are assumed to relate
 * to `ticker`.
 */
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
  return sendText(`${header}\n\n${rows.join("\n\n")}`);
}

/**
 * Batch-send several portfolio-watch events that share the same event
 * category (e.g. all politicians, all people, or all funds). `matchedRules`
 * is a display string summarising the union of watch rules that matched
 * across the batch.
 */
export async function notifyPortfolioBatch(
  category: "people" | "politicians" | "funds",
  events: PortfolioEvent[],
  matchedRules: string,
): Promise<NotifyResult> {
  if (events.length === 0) return { ok: false, detail: "empty batch" };
  if (events.length === 1) return notifyPortfolioEvent(events[0]!, matchedRules);

  const categoryLabel =
    category === "politicians"
      ? "politician"
      : category === "people"
        ? "insider"
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
  return sendText(`${header}\n\n${rows.join("\n\n")}${footer}`);
}

/**
 * Batch-send several SEC Form 4 insider transactions filed at the same
 * issuer (`ticker`) during a single stock-watch tick.
 */
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
      : tx.filingDate
        ? ` (filed ${tx.filingDate})`
        : "";
    const priceStr =
      tx.pricePerShare !== null && Number.isFinite(tx.pricePerShare)
        ? ` @ $${tx.pricePerShare.toFixed(2)}`
        : "";
    const sharesStr =
      Number.isFinite(tx.shares) && tx.shares > 0
        ? `${formatShares(tx.shares)} sh${priceStr}`
        : priceStr.trim() || "—";
    const relation = tx.reporterRelation ? ` (${escapeMd(tx.reporterRelation)})` : "";
    rows.push(
      `${emojiForAction(tx.action)} *${escapeMd(tx.actionLabel)}* — *${escapeMd(tx.reporterName)}*${relation}\n` +
        `   ${escapeMd(sharesStr)}${escapeMd(dateStr)}`,
    );
  }
  const overflow = txs.length - shown.length;
  if (overflow > 0) rows.push(`_…and ${overflow} more_`);

  // Any of the txs' filingUrl works for a "see filings" link — SEC's
  // browse-edgar view for the issuer is more useful than a per-accession
  // deep-link when the batch spans multiple filings, but we settle for
  // the first filing's URL to avoid another network call.
  const firstUrl = txs[0]!.filingUrl;
  const linkLine = firstUrl ? `\n[Open latest Form 4](${firstUrl})` : "";

  const header = `🏢 *${txs.length} insider transactions* — *${escapeMd(ticker)}*`;
  const footer = `\n\n_stock watch: ${escapeMd(ticker)}_${linkLine}`;
  return sendText(`${header}\n\n${rows.join("\n\n")}${footer}`);
}

/**
 * Batch-send several news headlines for the same `ticker` picked up in
 * one news-watch tick.
 */
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
      item.label === "bullish"
        ? "🟢"
        : item.label === "bearish"
          ? "🔴"
          : "⚪️";
    const scoreStr =
      item.score !== null && Number.isFinite(item.score)
        ? ` · ${item.score >= 0 ? "+" : ""}${item.score.toFixed(2)}`
        : "";
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
  return sendText(`${header}\n\n${rows.join("\n")}${footer}`);
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
