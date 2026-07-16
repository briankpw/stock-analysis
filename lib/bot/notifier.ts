/**
 * Telegram Bot API client — uses the native `fetch` in Node 18+ so we
 * avoid pulling in a full Telegram SDK just to POST a `sendMessage` call.
 */

import { settings, telegramConfigured } from "../config";
import type { Signal } from "./strategy";

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
