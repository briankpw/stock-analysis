/**
 * Plain-English guides for every metric shown in the dashboard —
 * ported verbatim from the Python `src/knowledge.py` so beginner-mode
 * copy is identical across the two apps.
 */

export type Direction = "higher_better" | "lower_better" | "context";

export interface Hint {
  what: string;
  direction: Direction;
  ruleOfThumb?: string;
}

export const METRIC_HINTS: Readonly<Record<string, Hint>> = {
  // ---- Price & Volume -------------------------------------------------
  "Last Close": { what: "Most recent closing price for the stock.", direction: "context" },
  "Period Return": {
    what: "Total percentage change from the first to the last day in the selected period.",
    direction: "higher_better",
    ruleOfThumb: "Positive means the stock rose over the window.",
  },
  "52W High": { what: "Highest closing price in the last 52 weeks — a natural resistance reference.", direction: "context" },
  "52W Low": { what: "Lowest closing price in the last 52 weeks — a natural support reference.", direction: "context" },
  "Annualized Volatility": {
    what: "How much the price bounces around, scaled to a full year. High = wild ride, low = calm.",
    direction: "lower_better",
    ruleOfThumb: "Under 20% is calm; 20-40% is normal; over 40% is choppy.",
  },
  "Avg Volume (20d)": {
    what: "Average shares traded per day over the last 20 sessions — a liquidity gauge.",
    direction: "higher_better",
    ruleOfThumb: "More volume = easier to buy or sell without moving the price.",
  },
  "Last Volume": { what: "Number of shares traded on the most recent day.", direction: "context" },

  // ---- Valuation ------------------------------------------------------
  "Market Cap": {
    what: "Total value of all shares (price × shares outstanding). Tells you how big the company is.",
    direction: "context",
    ruleOfThumb: "Small cap < $2B · Mid cap $2-10B · Large cap $10-200B · Mega cap > $200B.",
  },
  "Enterprise Value": { what: "What it would cost to buy the whole company: market cap + debt − cash.", direction: "context" },
  "Trailing P/E": {
    what: "Price ÷ earnings from the past year. How much you're paying for each dollar the company earned.",
    direction: "lower_better",
    ruleOfThumb: "Under 15 = cheap · 15-25 = typical · Over 30 = expensive (or high-growth).",
  },
  "Forward P/E": {
    what: "Price ÷ expected earnings for the next year. A forward-looking version of P/E.",
    direction: "lower_better",
    ruleOfThumb: "Compare to Trailing P/E — if forward is lower, earnings are expected to grow.",
  },
  "PEG Ratio": {
    what: "P/E adjusted for growth. Answers: 'is this stock cheap given how fast it's growing?'",
    direction: "lower_better",
    ruleOfThumb: "Under 1 = potentially undervalued relative to growth · Over 2 = premium.",
  },
  "Price / Book": {
    what: "Price ÷ book value per share. How much you're paying above the company's net accounting worth.",
    direction: "lower_better",
    ruleOfThumb: "Under 1 = trading below book · 1-3 = typical · Over 5 = premium.",
  },
  "Price / Sales (TTM)": {
    what: "Price ÷ revenue per share. Useful for unprofitable companies where P/E doesn't work.",
    direction: "lower_better",
    ruleOfThumb: "Under 2 = cheap · 2-5 = normal · Over 10 = very rich.",
  },
  "EV / EBITDA": {
    what: "Enterprise value ÷ operating cash-generating power. Great for comparing across debt levels.",
    direction: "lower_better",
    ruleOfThumb: "Under 10 = usually reasonable · 10-15 = fair · Over 20 = expensive.",
  },
  "EV / Revenue": { what: "Enterprise value ÷ annual revenue. Similar to P/S but includes debt.", direction: "lower_better" },

  // ---- Profitability --------------------------------------------------
  "Gross Margins": {
    what: "% of revenue left after paying for the raw goods/services sold. Product-level efficiency.",
    direction: "higher_better",
    ruleOfThumb: "Software/luxury: 60%+ · Retail: 20-40% · Commodities: 5-15%.",
  },
  "Operating Margins": {
    what: "% of revenue left after all operating expenses. Business-level efficiency.",
    direction: "higher_better",
    ruleOfThumb: "Over 15% is healthy for most industries; over 25% is excellent.",
  },
  "Profit Margins": {
    what: "% of revenue that ends up as net profit after everything (taxes, interest, one-offs).",
    direction: "higher_better",
    ruleOfThumb: "Under 5% = thin · 5-15% = solid · Over 20% = exceptional.",
  },
  "EBITDA Margins": { what: "Earnings before interest, tax, depreciation, amortisation — as a % of revenue.", direction: "higher_better" },
  "Return on Assets": {
    what: "Profit generated per dollar of assets. How well management uses what the company owns.",
    direction: "higher_better",
    ruleOfThumb: "Over 5% is decent · Over 10% is strong · Over 15% is exceptional.",
  },
  "Return on Equity": {
    what: "Profit generated per dollar of shareholder equity. Warren Buffett's favourite metric.",
    direction: "higher_better",
    ruleOfThumb: "Over 15% is strong · Over 20% is excellent. Watch for very high values from heavy debt.",
  },

  // ---- Financial Health -----------------------------------------------
  "Total Cash": { what: "Cash + short-term investments on the balance sheet — the company's rainy-day fund.", direction: "higher_better" },
  "Total Debt": {
    what: "All interest-bearing debt (short + long term).",
    direction: "lower_better",
    ruleOfThumb: "Compare to cash and earnings — debt is fine if productive, bad if crushing.",
  },
  "Debt / Equity": {
    what: "Debt ÷ shareholder equity. How leveraged the company is.",
    direction: "lower_better",
    ruleOfThumb: "Under 1 = conservative · 1-2 = moderate · Over 2 = highly leveraged.",
  },
  "Current Ratio": {
    what: "Short-term assets ÷ short-term liabilities. Can they pay the bills coming due?",
    direction: "higher_better",
    ruleOfThumb: "Above 1.5 = healthy · 1-1.5 = tight · Under 1 = liquidity risk.",
  },
  "Quick Ratio": {
    what: "Like Current Ratio but stricter — excludes inventory (which may not sell quickly).",
    direction: "higher_better",
    ruleOfThumb: "Above 1 is comfortable.",
  },
  "Free Cash Flow": { what: "Cash left after all operating and capex spending — money the company can actually return to owners.", direction: "higher_better" },
  "Operating Cash Flow": { what: "Cash generated by day-to-day operations (before big capex).", direction: "higher_better" },

  // ---- Growth ---------------------------------------------------------
  "Revenue (TTM)": { what: "Total sales over the trailing 12 months.", direction: "higher_better" },
  "Revenue / Share": { what: "Revenue divided by shares outstanding.", direction: "higher_better" },
  "Revenue Growth (YoY)": {
    what: "How much revenue grew vs. the same quarter/year ago.",
    direction: "higher_better",
    ruleOfThumb: "Over 10% is strong · Over 25% is a fast grower · Negative means shrinking sales.",
  },
  "Earnings Growth (YoY)": {
    what: "How much net income grew vs. the same period a year ago.",
    direction: "higher_better",
    ruleOfThumb: "Should ideally track revenue growth or beat it (margin expansion).",
  },
  "EPS (TTM)": { what: "Earnings per share over the trailing 12 months.", direction: "higher_better" },
  "EPS (Forward)": { what: "Expected earnings per share over the next 12 months (analyst consensus).", direction: "higher_better" },

  // ---- Dividend -------------------------------------------------------
  "Dividend Rate": { what: "Annual dividend paid per share, in local currency.", direction: "higher_better" },
  "Dividend Yield": {
    what: "Annual dividend ÷ stock price — the % 'interest' you get from holding the stock.",
    direction: "higher_better",
    ruleOfThumb: "2-4% = typical · Over 6% = attractive but check sustainability · Very high can mean price crashed.",
  },
  "Payout Ratio": {
    what: "% of earnings paid out as dividends. Above 100% means paying out more than earned.",
    direction: "lower_better",
    ruleOfThumb: "Under 60% = sustainable · 60-80% = tight · Over 100% = warning sign.",
  },
  "5Y Avg Yield": { what: "Average dividend yield over the last 5 years — a stability check.", direction: "context" },
};

export const SIGNAL_HINTS: Readonly<Record<string, Hint>> = {
  Trend: {
    what: "Where the moving-average lines say the price is heading (Bullish = up, Bearish = down).",
    direction: "context",
    ruleOfThumb: "Bullish trends favour holding; bearish trends favour caution.",
  },
  "RSI(14)": {
    what: "Relative Strength Index — measures whether recent moves are 'overheated' (0-100 scale).",
    direction: "context",
    ruleOfThumb: "Below 30 = oversold (possible bounce) · Above 70 = overbought (possible pullback).",
  },
  MACD: {
    what: "Moving Average Convergence Divergence — a momentum indicator based on two moving averages.",
    direction: "context",
    ruleOfThumb: "MACD crossing above signal line = bullish · Crossing below = bearish.",
  },
  Bollinger: {
    what: "Price relative to Bollinger Bands (a moving-average ± volatility corridor).",
    direction: "context",
    ruleOfThumb: "Near upper band = potentially expensive · Near lower band = potentially cheap.",
  },
};

export const GROUP_INTROS: Readonly<Record<string, string>> = {
  "Price & Volume":
    "How the stock has actually behaved recently — its price range, how volatile it's been, and how actively it trades.",
  Valuation:
    "How **expensive** the stock is right now, compared to what the company earns, owns, or brings in as sales. Lower usually = better value — but a bargain-priced stock may be cheap for a reason.",
  Profitability:
    "**Efficiency** metrics: does the company keep a lot of what it earns, or does it burn through revenue on costs? Higher margins usually = a stronger business model.",
  "Financial Health":
    "The **balance sheet** view: can the company pay its bills, service its debt, and weather a downturn?",
  "Growth & Earnings":
    "Is the company **growing**, and how fast? Investors typically pay a premium for faster growth.",
  Dividend:
    "If the company shares profits with owners as cash, this is where you see how much and how sustainable it is.",
};

export const PAGE_INTROS: Readonly<Record<string, string>> = {
  overview:
    "A one-glance summary. The four indicators below are computed from the price history — they don't say **what to do**, but they tell you what's happening right now. Hover each one for details.",
  ratios:
    "Every card below is one 'lens' on the company. Read left-to-right, top-to-bottom — you don't need to understand every number. Values are colour-coded against common rules of thumb (see the legend below the header). In Beginner mode each row also shows whether higher or lower is usually better — hover the **?** icon for the details.",
  charts:
    "Candles = daily price action (green = up day, red = down day). Bars below = how many shares changed hands. Toggle overlays to add moving averages or Bollinger Bands.",
  indicators:
    "Three classic momentum indicators. **RSI** flags overbought/oversold conditions, **MACD** tracks momentum shifts, and the returns histogram shows how volatile day-to-day moves are.",
  news: "Recent headlines about this company, each scored **bullish / bearish / neutral** using a finance-tuned sentiment lexicon. The badge at the top blends the latest stories (newer = more weight) into a single reading — think of it as a gauge of **market chatter**, not a trading signal.",
  holders:
    "Who actually owns the shares. **Internal** = insiders (executives, directors, officers) who must report every trade. **External** = institutions (hedge funds, pensions, asset managers) and mutual funds that file positions quarterly. Heavy insider **buying** or steady institutional **accumulation** is usually a positive sign; broad insider selling can be neutral (diversification, tax) or a warning if clustered.",
  portfolios:
    "See what famous people are trading. **Politicians (House only)** — House members must file a **Periodic Transaction Report (PTR)** within 45 days of every stock trade under the STOCK Act. We pull the official filing list from the House Clerk and preview each PDF inline; every trade — ticker, buy/sell, amount range — is inside the document. Senators file to a different portal we can't scrape yet. **Fund managers** (Buffett, Ackman, Burry, etc.) file quarterly **13F reports** with the SEC listing every US-listed stock they own — long positions only; short bets are hidden.",
  paper:
    "A simulated brokerage account. You start with virtual cash, place orders at the most recent close, and see your P&L over time. **No real money moves** — perfect for learning.",
  bot: "The alert bot watches strategies (SMA crossover, RSI reversion, MACD cross) continuously in the background. When a buy or sell signal fires, it can ping your Telegram. It never places orders.",
};

export function metricHint(label: string): Hint | undefined {
  return METRIC_HINTS[label];
}

export function signalHint(label: string): Hint | undefined {
  return SIGNAL_HINTS[label];
}

export function groupIntro(title: string): string {
  return GROUP_INTROS[title] ?? "";
}

export function pageIntro(pageKey: string): string {
  return PAGE_INTROS[pageKey] ?? "";
}
