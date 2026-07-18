/**
 * Bilingual beginner-mode knowledge base. Every entry has an English
 * source-of-truth (`en`) and an optional Simplified Chinese (`zh-CN`)
 * translation. Accessors take a `locale` argument and fall back to
 * English when the target locale is missing.
 */

import type { Locale } from "@/lib/state";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type Direction = "higher_better" | "lower_better" | "context";

export interface Hint {
  what: string;
  direction: Direction;
  ruleOfThumb?: string;
}

export interface TermDef {
  /** Display override — e.g. "简单移动均线" for the "SMA" key in zh-CN. */
  label?: string;
  what: string;
  deeper?: string;
}

type Localized<T> = { en: T; "zh-CN"?: T };

function pick<T>(v: Localized<T>, locale: Locale): T {
  return v[locale] ?? v.en;
}

// ---------------------------------------------------------------------------
// Metric hints — every ratio / stat that appears on the Ratios page.
// English is verbatim from src/knowledge.py so behaviour is unchanged
// across the two apps; Chinese is a from-scratch translation.
// ---------------------------------------------------------------------------

const METRIC_HINTS: Readonly<Record<string, Localized<Hint>>> = {
  // ---- Price & Volume -------------------------------------------------
  "Last Close": {
    en: { what: "Most recent closing price for the stock.", direction: "context" },
    "zh-CN": { what: "该股票最新的收盘价。", direction: "context" },
  },
  "Period Return": {
    en: {
      what: "Total percentage change from the first to the last day in the selected period.",
      direction: "higher_better",
      ruleOfThumb: "Positive means the stock rose over the window.",
    },
    "zh-CN": {
      what: "所选时间段内首日至末日的总涨跌幅。",
      direction: "higher_better",
      ruleOfThumb: "正值表示该期间股价上涨。",
    },
  },
  "52W High": {
    en: { what: "Highest closing price in the last 52 weeks — a natural resistance reference.", direction: "context" },
    "zh-CN": { what: "过去 52 周的最高收盘价——常被视为天然的阻力位。", direction: "context" },
  },
  "52W Low": {
    en: { what: "Lowest closing price in the last 52 weeks — a natural support reference.", direction: "context" },
    "zh-CN": { what: "过去 52 周的最低收盘价——常被视为天然的支撑位。", direction: "context" },
  },
  "Annualized Volatility": {
    en: {
      what: "How much the price bounces around, scaled to a full year. High = wild ride, low = calm.",
      direction: "lower_better",
      ruleOfThumb: "Under 20% is calm; 20-40% is normal; over 40% is choppy.",
    },
    "zh-CN": {
      what: "股价的波动程度按年度缩放。数值高 = 波动剧烈，数值低 = 相对平稳。",
      direction: "lower_better",
      ruleOfThumb: "< 20% 平稳；20-40% 正常；> 40% 波动剧烈。",
    },
  },
  "Avg Volume (20d)": {
    en: {
      what: "Average shares traded per day over the last 20 sessions — a liquidity gauge.",
      direction: "higher_better",
      ruleOfThumb: "More volume = easier to buy or sell without moving the price.",
    },
    "zh-CN": {
      what: "过去 20 个交易日的日均成交股数——衡量流动性的指标。",
      direction: "higher_better",
      ruleOfThumb: "成交量越大 = 越容易买卖而不显著影响价格。",
    },
  },
  "Last Volume": {
    en: { what: "Number of shares traded on the most recent day.", direction: "context" },
    "zh-CN": { what: "最近一个交易日的成交股数。", direction: "context" },
  },

  // ---- Valuation ------------------------------------------------------
  "Market Cap": {
    en: {
      what: "Total value of all shares (price × shares outstanding). Tells you how big the company is.",
      direction: "context",
      ruleOfThumb: "Small cap < $2B · Mid cap $2-10B · Large cap $10-200B · Mega cap > $200B.",
    },
    "zh-CN": {
      what: "全部股份的总价值（股价 × 已发行股数）。反映公司规模。",
      direction: "context",
      ruleOfThumb: "小盘 < 20 亿美元 · 中盘 20-100 亿 · 大盘 100-2000 亿 · 超大盘 > 2000 亿。",
    },
  },
  "Enterprise Value": {
    en: { what: "What it would cost to buy the whole company: market cap + debt − cash.", direction: "context" },
    "zh-CN": { what: "整体收购公司的成本：市值 + 债务 − 现金。", direction: "context" },
  },
  "Trailing P/E": {
    en: {
      what: "Price ÷ earnings from the past year. How much you're paying for each dollar the company earned.",
      direction: "lower_better",
      ruleOfThumb: "Under 15 = cheap · 15-25 = typical · Over 30 = expensive (or high-growth).",
    },
    "zh-CN": {
      what: "股价 ÷ 过去一年每股收益。为公司每赚 1 美元所付出的价格。",
      direction: "lower_better",
      ruleOfThumb: "< 15 便宜 · 15-25 普通 · > 30 昂贵（或成长股）。",
    },
  },
  "Forward P/E": {
    en: {
      what: "Price ÷ expected earnings for the next year. A forward-looking version of P/E.",
      direction: "lower_better",
      ruleOfThumb: "Compare to Trailing P/E — if forward is lower, earnings are expected to grow.",
    },
    "zh-CN": {
      what: "股价 ÷ 未来一年的预期每股收益。前瞻性的市盈率。",
      direction: "lower_better",
      ruleOfThumb: "与追溯 P/E 对比 — 前瞻 P/E 更低说明预期盈利在增长。",
    },
  },
  "PEG Ratio": {
    en: {
      what: "P/E adjusted for growth. Answers: 'is this stock cheap given how fast it's growing?'",
      direction: "lower_better",
      ruleOfThumb: "Under 1 = potentially undervalued relative to growth · Over 2 = premium.",
    },
    "zh-CN": {
      what: "按成长率调整后的市盈率。回答：\"考虑成长速度，该股票便宜吗？\"",
      direction: "lower_better",
      ruleOfThumb: "< 1 相对成长可能被低估 · > 2 溢价。",
    },
  },
  "Price / Book": {
    en: {
      what: "Price ÷ book value per share. How much you're paying above the company's net accounting worth.",
      direction: "lower_better",
      ruleOfThumb: "Under 1 = trading below book · 1-3 = typical · Over 5 = premium.",
    },
    "zh-CN": {
      what: "股价 ÷ 每股账面价值。相对于账面净资产多付了多少倍。",
      direction: "lower_better",
      ruleOfThumb: "< 1 低于账面价值 · 1-3 普通 · > 5 溢价。",
    },
  },
  "Price / Sales (TTM)": {
    en: {
      what: "Price ÷ revenue per share. Useful for unprofitable companies where P/E doesn't work.",
      direction: "lower_better",
      ruleOfThumb: "Under 2 = cheap · 2-5 = normal · Over 10 = very rich.",
    },
    "zh-CN": {
      what: "股价 ÷ 每股营收。对无盈利公司（P/E 失效时）尤其有用。",
      direction: "lower_better",
      ruleOfThumb: "< 2 便宜 · 2-5 正常 · > 10 相当昂贵。",
    },
  },
  "EV / EBITDA": {
    en: {
      what: "Enterprise value ÷ operating cash-generating power. Great for comparing across debt levels.",
      direction: "lower_better",
      ruleOfThumb: "Under 10 = usually reasonable · 10-15 = fair · Over 20 = expensive.",
    },
    "zh-CN": {
      what: "企业价值 ÷ 经营现金创造能力。适用于跨不同负债水平的公司比较。",
      direction: "lower_better",
      ruleOfThumb: "< 10 一般合理 · 10-15 尚可 · > 20 昂贵。",
    },
  },
  "EV / Revenue": {
    en: { what: "Enterprise value ÷ annual revenue. Similar to P/S but includes debt.", direction: "lower_better" },
    "zh-CN": { what: "企业价值 ÷ 年营收。类似 P/S，但包含债务因素。", direction: "lower_better" },
  },

  // ---- Profitability --------------------------------------------------
  "Gross Margins": {
    en: {
      what: "% of revenue left after paying for the raw goods/services sold. Product-level efficiency.",
      direction: "higher_better",
      ruleOfThumb: "Software/luxury: 60%+ · Retail: 20-40% · Commodities: 5-15%.",
    },
    "zh-CN": {
      what: "支付售出商品/服务原料成本后剩余的营收占比。产品级效率。",
      direction: "higher_better",
      ruleOfThumb: "软件/奢侈品：60%+ · 零售：20-40% · 大宗商品：5-15%。",
    },
  },
  "Operating Margins": {
    en: {
      what: "% of revenue left after all operating expenses. Business-level efficiency.",
      direction: "higher_better",
      ruleOfThumb: "Over 15% is healthy for most industries; over 25% is excellent.",
    },
    "zh-CN": {
      what: "扣除全部经营费用后剩余的营收占比。业务级效率。",
      direction: "higher_better",
      ruleOfThumb: "多数行业 > 15% 健康；> 25% 优秀。",
    },
  },
  "Profit Margins": {
    en: {
      what: "% of revenue that ends up as net profit after everything (taxes, interest, one-offs).",
      direction: "higher_better",
      ruleOfThumb: "Under 5% = thin · 5-15% = solid · Over 20% = exceptional.",
    },
    "zh-CN": {
      what: "扣除全部（税、利息、一次性项目）后成为净利润的营收占比。",
      direction: "higher_better",
      ruleOfThumb: "< 5% 薄利 · 5-15% 稳健 · > 20% 极佳。",
    },
  },
  "EBITDA Margins": {
    en: { what: "Earnings before interest, tax, depreciation, amortisation — as a % of revenue.", direction: "higher_better" },
    "zh-CN": { what: "息税折旧摊销前利润占营收的比例。", direction: "higher_better" },
  },
  "Return on Assets": {
    en: {
      what: "Profit generated per dollar of assets. How well management uses what the company owns.",
      direction: "higher_better",
      ruleOfThumb: "Over 5% is decent · Over 10% is strong · Over 15% is exceptional.",
    },
    "zh-CN": {
      what: "每 1 美元资产创造的利润。反映管理层运用公司资产的效率。",
      direction: "higher_better",
      ruleOfThumb: "> 5% 尚可 · > 10% 强劲 · > 15% 极佳。",
    },
  },
  "Return on Equity": {
    en: {
      what: "Profit generated per dollar of shareholder equity. Warren Buffett's favourite metric.",
      direction: "higher_better",
      ruleOfThumb: "Over 15% is strong · Over 20% is excellent. Watch for very high values from heavy debt.",
    },
    "zh-CN": {
      what: "每 1 美元股东权益创造的利润。巴菲特最爱的指标。",
      direction: "higher_better",
      ruleOfThumb: "> 15% 强劲 · > 20% 优秀。数值过高需警惕是否由高杠杆推动。",
    },
  },

  // ---- Financial Health -----------------------------------------------
  "Total Cash": {
    en: { what: "Cash + short-term investments on the balance sheet — the company's rainy-day fund.", direction: "higher_better" },
    "zh-CN": { what: "资产负债表上的现金 + 短期投资——公司的应急储备。", direction: "higher_better" },
  },
  "Total Debt": {
    en: {
      what: "All interest-bearing debt (short + long term).",
      direction: "lower_better",
      ruleOfThumb: "Compare to cash and earnings — debt is fine if productive, bad if crushing.",
    },
    "zh-CN": {
      what: "全部计息负债（短期 + 长期）。",
      direction: "lower_better",
      ruleOfThumb: "与现金和盈利对比——用途高效则无妨，压顶则堪忧。",
    },
  },
  "Debt / Equity": {
    en: {
      what: "Debt ÷ shareholder equity. How leveraged the company is.",
      direction: "lower_better",
      ruleOfThumb: "Under 1 = conservative · 1-2 = moderate · Over 2 = highly leveraged.",
    },
    "zh-CN": {
      what: "负债 ÷ 股东权益。公司杠杆水平。",
      direction: "lower_better",
      ruleOfThumb: "< 1 保守 · 1-2 适中 · > 2 高杠杆。",
    },
  },
  "Current Ratio": {
    en: {
      what: "Short-term assets ÷ short-term liabilities. Can they pay the bills coming due?",
      direction: "higher_better",
      ruleOfThumb: "Above 1.5 = healthy · 1-1.5 = tight · Under 1 = liquidity risk.",
    },
    "zh-CN": {
      what: "短期资产 ÷ 短期负债。能否偿付即将到期的负债？",
      direction: "higher_better",
      ruleOfThumb: "> 1.5 健康 · 1-1.5 偏紧 · < 1 流动性风险。",
    },
  },
  "Quick Ratio": {
    en: {
      what: "Like Current Ratio but stricter — excludes inventory (which may not sell quickly).",
      direction: "higher_better",
      ruleOfThumb: "Above 1 is comfortable.",
    },
    "zh-CN": {
      what: "类似流动比率但更严格——不含存货（存货未必能快速变现）。",
      direction: "higher_better",
      ruleOfThumb: "> 1 较为宽松。",
    },
  },
  "Free Cash Flow": {
    en: { what: "Cash left after all operating and capex spending — money the company can actually return to owners.", direction: "higher_better" },
    "zh-CN": { what: "扣除全部经营与资本支出后的剩余现金——真正可回馈股东的资金。", direction: "higher_better" },
  },
  "Operating Cash Flow": {
    en: { what: "Cash generated by day-to-day operations (before big capex).", direction: "higher_better" },
    "zh-CN": { what: "日常经营（在大额资本支出前）产生的现金流。", direction: "higher_better" },
  },

  // ---- Growth ---------------------------------------------------------
  "Revenue (TTM)": {
    en: { what: "Total sales over the trailing 12 months.", direction: "higher_better" },
    "zh-CN": { what: "过去 12 个月的总营收。", direction: "higher_better" },
  },
  "Revenue / Share": {
    en: { what: "Revenue divided by shares outstanding.", direction: "higher_better" },
    "zh-CN": { what: "营收除以已发行股数。", direction: "higher_better" },
  },
  "Revenue Growth (YoY)": {
    en: {
      what: "How much revenue grew vs. the same quarter/year ago.",
      direction: "higher_better",
      ruleOfThumb: "Over 10% is strong · Over 25% is a fast grower · Negative means shrinking sales.",
    },
    "zh-CN": {
      what: "相较去年同期营收的增长幅度。",
      direction: "higher_better",
      ruleOfThumb: "> 10% 强劲 · > 25% 高速成长 · 负数意味营收萎缩。",
    },
  },
  "Earnings Growth (YoY)": {
    en: {
      what: "How much net income grew vs. the same period a year ago.",
      direction: "higher_better",
      ruleOfThumb: "Should ideally track revenue growth or beat it (margin expansion).",
    },
    "zh-CN": {
      what: "相较去年同期净利润的增长幅度。",
      direction: "higher_better",
      ruleOfThumb: "理想情况应贴近或超过营收增速（说明利润率在扩张）。",
    },
  },
  "EPS (TTM)": {
    en: { what: "Earnings per share over the trailing 12 months.", direction: "higher_better" },
    "zh-CN": { what: "过去 12 个月的每股收益。", direction: "higher_better" },
  },
  "EPS (Forward)": {
    en: { what: "Expected earnings per share over the next 12 months (analyst consensus).", direction: "higher_better" },
    "zh-CN": { what: "未来 12 个月的预期每股收益（分析师一致预期）。", direction: "higher_better" },
  },

  // ---- Dividend -------------------------------------------------------
  "Dividend Rate": {
    en: { what: "Annual dividend paid per share, in local currency.", direction: "higher_better" },
    "zh-CN": { what: "每股年度股息（以本币计）。", direction: "higher_better" },
  },
  "Dividend Yield": {
    en: {
      what: "Annual dividend ÷ stock price — the % 'interest' you get from holding the stock.",
      direction: "higher_better",
      ruleOfThumb: "2-4% = typical · Over 6% = attractive but check sustainability · Very high can mean price crashed.",
    },
    "zh-CN": {
      what: "年度股息 ÷ 股价——持有股票获得的\"利息\"百分比。",
      direction: "higher_better",
      ruleOfThumb: "2-4% 常见 · > 6% 具吸引力但需查证可持续性 · 极高可能意味着股价暴跌。",
    },
  },
  "Payout Ratio": {
    en: {
      what: "% of earnings paid out as dividends. Above 100% means paying out more than earned.",
      direction: "lower_better",
      ruleOfThumb: "Under 60% = sustainable · 60-80% = tight · Over 100% = warning sign.",
    },
    "zh-CN": {
      what: "以股息形式派发的利润占比。> 100% 表示派出的多于所赚。",
      direction: "lower_better",
      ruleOfThumb: "< 60% 可持续 · 60-80% 偏紧 · > 100% 警示信号。",
    },
  },
  "5Y Avg Yield": {
    en: { what: "Average dividend yield over the last 5 years — a stability check.", direction: "context" },
    "zh-CN": { what: "过去 5 年平均股息率——检验派息稳定性。", direction: "context" },
  },
};

// ---------------------------------------------------------------------------
// Signal hints — the four indicator tiles on the Overview page.
// ---------------------------------------------------------------------------

const SIGNAL_HINTS: Readonly<Record<string, Localized<Hint>>> = {
  Trend: {
    en: {
      what: "Where the moving-average lines say the price is heading (Bullish = up, Bearish = down).",
      direction: "context",
      ruleOfThumb: "Bullish trends favour holding; bearish trends favour caution.",
    },
    "zh-CN": {
      what: "均线所示的价格方向（多头 = 上涨，空头 = 下跌）。",
      direction: "context",
      ruleOfThumb: "多头趋势倾向持有；空头趋势倾向谨慎。",
    },
  },
  "RSI(14)": {
    en: {
      what: "Relative Strength Index — measures whether recent moves are 'overheated' (0-100 scale).",
      direction: "context",
      ruleOfThumb: "Below 30 = oversold (possible bounce) · Above 70 = overbought (possible pullback).",
    },
    "zh-CN": {
      what: "相对强弱指标——评估近期涨跌是否\"过热\"（0-100 区间）。",
      direction: "context",
      ruleOfThumb: "< 30 超卖（可能反弹） · > 70 超买（可能回调）。",
    },
  },
  MACD: {
    en: {
      what: "Moving Average Convergence Divergence — a momentum indicator based on two moving averages.",
      direction: "context",
      ruleOfThumb: "MACD crossing above signal line = bullish · Crossing below = bearish.",
    },
    "zh-CN": {
      what: "指数平滑异同移动平均——基于两条均线的动量指标。",
      direction: "context",
      ruleOfThumb: "MACD 上穿信号线 = 多头 · 下穿 = 空头。",
    },
  },
  Bollinger: {
    en: {
      what: "Price relative to Bollinger Bands (a moving-average ± volatility corridor).",
      direction: "context",
      ruleOfThumb: "Near upper band = potentially expensive · Near lower band = potentially cheap.",
    },
    "zh-CN": {
      what: "股价相对布林带的位置（均线 ± 波动通道）。",
      direction: "context",
      ruleOfThumb: "接近上轨 = 可能偏贵 · 接近下轨 = 可能偏便宜。",
    },
  },
};

// ---------------------------------------------------------------------------
// Group intros — beginner blurb at the top of each metric group card.
// ---------------------------------------------------------------------------

const GROUP_INTROS: Readonly<Record<string, Localized<string>>> = {
  "Price & Volume": {
    en: "How the stock has actually behaved recently — its price range, how volatile it's been, and how actively it trades.",
    "zh-CN": "该股票近期的实际表现——价格区间、波动情况以及交易活跃度。",
  },
  Valuation: {
    en: "How **expensive** the stock is right now, compared to what the company earns, owns, or brings in as sales. Lower usually = better value — but a bargain-priced stock may be cheap for a reason.",
    "zh-CN": "该股票相对于公司的**盈利、资产或销售额**当前有多**贵**。数值越低通常意味性价比更高——但便宜可能有便宜的原因。",
  },
  Profitability: {
    en: "**Efficiency** metrics: does the company keep a lot of what it earns, or does it burn through revenue on costs? Higher margins usually = a stronger business model.",
    "zh-CN": "**效率**指标：公司能留住多少所赚，还是营收被成本大量吞噬？利润率越高通常代表商业模式越强。",
  },
  "Financial Health": {
    en: "The **balance sheet** view: can the company pay its bills, service its debt, and weather a downturn?",
    "zh-CN": "**资产负债表**视角：公司能否偿付账单、履行债务并度过下行？",
  },
  "Growth & Earnings": {
    en: "Is the company **growing**, and how fast? Investors typically pay a premium for faster growth.",
    "zh-CN": "公司在**成长**吗，速度如何？投资者通常愿意为更快的成长支付溢价。",
  },
  Dividend: {
    en: "If the company shares profits with owners as cash, this is where you see how much and how sustainable it is.",
    "zh-CN": "若公司以现金形式与股东共享利润，这里显示派息金额及其可持续性。",
  },
};

// ---------------------------------------------------------------------------
// Page intros — beginner block shown at the top of each page.
// ---------------------------------------------------------------------------

const PAGE_INTROS: Readonly<Record<string, Localized<string>>> = {
  overview: {
    en: "A one-glance summary. The four indicators below are computed from the price history — they don't say **what to do**, but they tell you what's happening right now. Hover each one for details.",
    "zh-CN": "一目了然的摘要。下方四个指标由价格历史计算得出——它们不会告诉你**该做什么**，只会告诉你**当前发生了什么**。悬停可查看详情。",
  },
  ratios: {
    en: "Every card below is one 'lens' on the company. Read left-to-right, top-to-bottom — you don't need to understand every number. Values are colour-coded against common rules of thumb (see the legend below the header). In Beginner mode each row also shows whether higher or lower is usually better — hover the **?** icon for the details.",
    "zh-CN": "下方每张卡片都是观察公司的一个\"透镜\"。从左到右、从上到下阅读——你无需理解每一个数字。数值按经验法则做了颜色标注（见标题下方的图例）。在入门模式下，每一行还会显示越高或越低通常更好——悬停 **?** 图标查看细节。",
  },
  charts: {
    en: "**Top:** candles = daily price action (green = up day, red = down day), bars below = shares traded. Toggle overlays for moving averages or Bollinger Bands. **Below:** classic momentum indicators — **RSI** flags overbought/oversold, **MACD** tracks momentum shifts, **KDJ** and **Support/Resistance** map turning points, and the returns histogram shows how volatile day-to-day moves are.",
    "zh-CN": "**上方**：K 线 = 每日价格走势（绿 = 上涨日，红 = 下跌日），下方柱状 = 当日成交股数。可切换叠加均线或布林带。**下方**：经典动量指标——**RSI** 标记超买/超卖，**MACD** 追踪动量变化，**KDJ** 与 **支撑/阻力** 定位拐点，回报直方图显示每日波动的分布。",
  },
  indicators: {
    en: "Three classic momentum indicators. **RSI** flags overbought/oversold conditions, **MACD** tracks momentum shifts, and the returns histogram shows how volatile day-to-day moves are.",
    "zh-CN": "三个经典动量指标。**RSI** 标记超买/超卖，**MACD** 追踪动量变化，回报直方图显示每日波动的分布。",
  },
  signal: {
    en: "The composite **should I trade?** view. Three verdicts stacked from broadest to narrowest: the **Master Verdict** blends technicals, fundamentals, news sentiment and market mood into a single score with a full source breakdown; the **Technical Signal** aggregates the price-based indicators (trend, RSI, MACD, Bollinger, S/R, KDJ); and the **6-Signal Resonance** strategy only fires when six fast-tuned momentum checks all agree on the same bar. Cross-check them — real conviction is when all three lean the same way.",
    "zh-CN": "综合的**是否交易？**视图。三个判定从最广到最窄逐层叠加：**综合结论**将技术面、基本面、新闻情绪与市场情绪加权融合为一个总分，并给出完整的来源明细；**技术信号**汇总所有基于价格的指标（趋势、RSI、MACD、布林、支撑/阻力、KDJ）；**六指标共振**策略仅在六项快速动量检查于同一根 K 线上全部同向时触发。相互印证——三者同时看多/看空时信心才最坚定。",
  },
  news: {
    en: "Recent headlines about this company, each scored **bullish / bearish / neutral** using a finance-tuned sentiment lexicon. The badge at the top blends the latest stories (newer = more weight) into a single reading — think of it as a gauge of **market chatter**, not a trading signal.",
    "zh-CN": "关于该公司的近期新闻，每条使用金融调优过的情绪词典打分为**多头 / 空头 / 中性**。顶部徽章按时间加权（更新的权重更大）综合最新新闻——把它当作**市场舆情**的度量，而非交易信号。",
  },
  holders: {
    en: "Who actually owns the shares. **Internal** = insiders (executives, directors, officers) who must report every trade. **External** = institutions (hedge funds, pensions, asset managers) and mutual funds that file positions quarterly. Heavy insider **buying** or steady institutional **accumulation** is usually a positive sign; broad insider selling can be neutral (diversification, tax) or a warning if clustered.",
    "zh-CN": "股份实际由谁持有。**内部** = 内部人士（高管、董事、officer），须申报每一笔交易。**外部** = 按季度申报持仓的机构（对冲基金、养老金、资产管理公司）和共同基金。密集的内部**买入**或机构持续**加仓**通常是正面信号；广泛的内部卖出可能中性（分散、税务）或在集中出现时构成警示。",
  },
  portfolios: {
    en: "See what famous people are trading. **Politicians (House only)** — House members must file a **Periodic Transaction Report (PTR)** within 45 days of every stock trade under the STOCK Act. We pull the official filing list from the House Clerk and preview each PDF inline; every trade — ticker, buy/sell, amount range — is inside the document. Senators file to a different portal we can't scrape yet. **Fund managers** (Buffett, Ackman, Burry, etc.) file quarterly **13F reports** with the SEC listing every US-listed stock they own — long positions only; short bets are hidden.",
    "zh-CN": "看看知名人士在交易什么。**政治人物（仅众议院）** — 依据 STOCK 法案，众议员每笔股票交易须在 45 天内提交 **定期交易报告（PTR）**。我们从众议院书记员处抓取官方文件列表并内嵌预览每一份 PDF；每一笔交易——代码、买/卖、金额区间——都在文件中。参议员的文件在另一个我们尚未接入的门户。**基金经理**（巴菲特、Ackman、Burry 等）按季度向 SEC 提交 **13F 报告**，披露其持有的所有美国上市股票——仅长仓；空仓不披露。",
  },
  paper: {
    en: "A simulated brokerage account. You start with virtual cash, place orders at the most recent close, and see your P&L over time. **No real money moves** — perfect for learning.",
    "zh-CN": "一个模拟券商账户。你从虚拟现金开始，以最近收盘价下单，追踪你的盈亏。**不涉及真实资金**——最适合学习。",
  },
  bot: {
    en: "The alert bot watches strategies (SMA crossover, RSI reversion, MACD cross) continuously in the background. When a buy or sell signal fires, it can ping your Telegram. It never places orders.",
    "zh-CN": "提醒机器人在后台持续监控策略（SMA 均线交叉、RSI 回归、MACD 交叉）。当买入或卖出信号触发时，可推送到你的 Telegram。它不会真的下单。",
  },
  market: {
    en: "Market-wide mood, updated every US market close. CNN's **Fear & Greed Index** blends seven signals — momentum, breadth, put/call, VIX, junk-bond spreads and safe-haven demand — into a single 0–100 gauge. Extreme readings are usually **contrarian**: buy when the crowd is fearful, be cautious when they're greedy. This same reading is also folded into the **Buy / Sell Signal** on the Price & Volume page as a market-backdrop check.",
    "zh-CN": "全市场情绪，美股每次收盘后更新。CNN 的**恐惧与贪婪指数**融合七项信号——动量、广度、认沽/认购、VIX、垃圾债利差、避险需求——形成 0–100 的单一读数。极值通常具有**逆向**含义：他人恐惧时买入，他人贪婪时谨慎。此读数同时被引入价格与成交量页面的**买入/卖出信号**，作为市场大背景校验。",
  },
  segments: {
    en: "Where's the money flowing? Each **theme** on this page is tracked by a **proxy ETF** — a single liquid ticker whose trend gives the whole segment a clean bull/neutral/bear read (SMA regime + RSI + MACD, same recipe the Overview page uses). Broad **indices** (S&P 500, Nasdaq, VIX, Hang Seng, …) sit at the top so you always see the macro backdrop first. Click any theme card to drill down into its **household-name constituents** with per-ticker prices, RSI, and trend chips.",
    "zh-CN": "钱正在流向哪里？页面上的每个**主题**都由一只**代理 ETF**追踪——用单一高流动性代码给出板块整体的多/中/空判读（SMA 趋势制度 + RSI + MACD，与概览页同一套配方）。顶部固定展示大盘**指数**（标普 500、纳斯达克、VIX、恒生……），先看大背景。点击任何主题卡片可进入该板块的**代表性成分股**，逐股展示价格、RSI 与趋势。",
  },
  "my-portfolio": {
    en: "**Bring your own trades.** Export a transaction CSV from your broker or portfolio-tracker app (MyStocksPortfolio, MooMoo, Webull, etc.) and drop it here. The file is parsed **in your browser** and kept only on this device — nothing is uploaded, nothing is shared.\n\nTwo views: **Positions** groups everything by stock so you can see shares held, average cost, live market value, today's dollar change, unrealized P&L, and profit already booked from past sells. **Transactions** lists every raw buy/sell/watch entry from the CSV. Grand totals are shown **per currency** — USD and HKD trades never get mixed together. Click any symbol to make it the active ticker for the rest of the app.",
    "zh-CN": "**导入你的真实交易。** 从券商或投资组合软件（MyStocksPortfolio、MooMoo、Webull 等）导出交易 CSV，将文件拖到此处。文件在**浏览器内**解析，仅保存在本设备——不会上传，不会分享。\n\n提供两种视图：**持仓**按股票分组，显示持股数、平均成本、实时市值、当日盈亏、未实现盈亏，以及历次卖出已实现的收益。**交易明细**则列出 CSV 中的每一笔买入 / 卖出 / 关注记录。总计按**币种分别汇总**——美元与港币不会混算。点击任意代码可将其设为全站的当前分析代码。",
  },
};

// ---------------------------------------------------------------------------
// Technical-terms glossary (bilingual). Same content as the earlier English
// build; every entry now has a zh-CN definition with a localized label.
// ---------------------------------------------------------------------------

const TECHNICAL_TERMS: Readonly<Record<string, Localized<TermDef>>> = {
  // -------------- Price & chart basics ------------------------------------
  Candlestick: {
    en: {
      what: "A daily price bar showing four numbers at once: open, high, low, and close.",
      deeper:
        "Body = open→close (green if up-day, red if down-day). Wicks = the day's high and low outside the body. A long wick means price tried to move there but got rejected.",
    },
    "zh-CN": {
      label: "K 线（蜡烛图）",
      what: "一根日 K 线同时显示四个价格：开盘、最高、最低、收盘。",
      deeper: "实体 = 开盘→收盘（涨日绿，跌日红）。影线 = 实体外的当日最高与最低价。长影线意味价格曾触及该处但被拒回。",
    },
  },
  OHLC: {
    en: { what: "Open, High, Low, Close — the four prices a single candle summarises." },
    "zh-CN": { label: "OHLC（开高低收）", what: "开盘、最高、最低、收盘——单根 K 线概括的四个价格。" },
  },
  Wick: {
    en: { what: "The thin line above/below a candle body — shows the day's high and low prices that weren't the open or close." },
    "zh-CN": { label: "影线", what: "K 线实体上下方的细线——显示当日除开盘/收盘之外触及的最高与最低。" },
  },
  Volume: {
    en: {
      what: "Number of shares that changed hands that day. High volume = strong conviction behind the move.",
      deeper: "A price move on unusually high volume is more meaningful than one on quiet volume. Compare to the 20-day average.",
    },
    "zh-CN": {
      label: "成交量",
      what: "当日易主的股数。成交量高 = 走势背后有强烈共识。",
      deeper: "在异常高成交量下的价格变动比清淡成交下更具意义。请与 20 日均量对比。",
    },
  },
  Liquidity: {
    en: { what: "How easily you can buy/sell without moving the price. Driven mainly by volume." },
    "zh-CN": { label: "流动性", what: "在不显著移动价格的前提下买卖的难易程度。主要由成交量决定。" },
  },
  SMA: {
    en: {
      what: "Simple Moving Average — the average closing price over the last N days.",
      deeper:
        "Traders watch SMA 20 (short-term trend), SMA 50 (medium), and SMA 200 (long-term). Price crossing above/below a key SMA often marks a trend change.",
    },
    "zh-CN": {
      label: "SMA（简单移动均线）",
      what: "简单移动平均线——过去 N 日收盘价的算术平均。",
      deeper: "交易者关注 SMA 20（短期趋势）、SMA 50（中期）、SMA 200（长期）。价格上穿/下穿关键 SMA 常标志趋势变化。",
    },
  },
  "Bollinger Bands": {
    en: {
      what: "A moving-average line with two bands drawn 2 standard deviations above and below it.",
      deeper:
        "Price near the upper band = statistically expensive relative to recent history; near the lower band = statistically cheap. About 95% of daily closes fall inside the bands.",
    },
    "zh-CN": {
      label: "布林带",
      what: "以移动均线为中轴，上下各画 2 倍标准差的两条通道。",
      deeper: "股价靠近上轨 = 相对近期统计上偏贵；靠近下轨 = 统计上偏便宜。约 95% 的日收盘落在通道内。",
    },
  },
  "Standard Deviation": {
    en: { what: "A measure of how spread out numbers are — bigger = more variability." },
    "zh-CN": { label: "标准差", what: "衡量数据离散程度的指标——数值越大代表变化越剧烈。" },
  },
  Support: {
    en: { what: "A price level where buyers have shown up before, so price tends to bounce off it." },
    "zh-CN": { label: "支撑位", what: "此前买盘曾出现的价位，价格常在此反弹。" },
  },
  Resistance: {
    en: { what: "A price level where sellers have shown up before, so price tends to stall or fall from it." },
    "zh-CN": { label: "阻力位", what: "此前卖盘曾出现的价位，价格常在此停滞或回落。" },
  },
  "52-Week High": {
    en: { what: "Highest close in the last year. Often acts as a psychological resistance level." },
    "zh-CN": { label: "52 周新高", what: "过去一年的最高收盘价。常作为心理阻力位。" },
  },
  "52-Week Low": {
    en: { what: "Lowest close in the last year. Often acts as psychological support." },
    "zh-CN": { label: "52 周新低", what: "过去一年的最低收盘价。常作为心理支撑位。" },
  },
  Volatility: {
    en: {
      what: "How much the price bounces around. High volatility = wild swings; low = calm.",
      deeper: "We annualise daily volatility × √252 to compare across time windows.",
    },
    "zh-CN": {
      label: "波动率",
      what: "价格上下波动的幅度。波动率高 = 剧烈震荡；低 = 平稳。",
      deeper: "我们以日波动率 × √252 年化，便于跨时间窗口比较。",
    },
  },
  "Period Return": {
    en: { what: "% change from the first to the last day of the selected time window." },
    "zh-CN": { label: "期间回报率", what: "所选时间窗内首日到末日的百分比变动。" },
  },

  // -------------- Momentum indicators -------------------------------------
  RSI: {
    en: {
      what: "Relative Strength Index — a 0-100 momentum gauge based on the size of recent up-days vs down-days.",
      deeper: "Above 70 → 'overbought' (possible pullback ahead). Below 30 → 'oversold' (possible bounce). The 14-day RSI is the classic setting.",
    },
    "zh-CN": {
      label: "RSI（相对强弱指标）",
      what: "0-100 区间的动量指标，基于近期涨日与跌日的力度比较。",
      deeper: "> 70 \"超买\"（可能回调）；< 30 \"超卖\"（可能反弹）。14 日 RSI 是经典参数。",
    },
  },
  Overbought: {
    en: { what: "Recent up-moves have been so strong that a pullback is statistically more likely." },
    "zh-CN": { label: "超买", what: "近期涨势过强，统计上回调的概率上升。" },
  },
  Oversold: {
    en: { what: "Recent down-moves have been so strong that a bounce is statistically more likely." },
    "zh-CN": { label: "超卖", what: "近期跌势过强，统计上反弹的概率上升。" },
  },
  MACD: {
    en: {
      what: "Moving Average Convergence Divergence — the difference between a fast and a slow moving average.",
      deeper:
        "MACD line = 12-day EMA − 26-day EMA. Signal line = 9-day EMA of MACD. The histogram is the gap between them; when MACD crosses above the signal, that's a bullish momentum signal, and vice versa.",
    },
    "zh-CN": {
      label: "MACD",
      what: "指数平滑异同移动平均——快线与慢线之差。",
      deeper: "MACD 线 = 12 日 EMA − 26 日 EMA；信号线 = MACD 的 9 日 EMA。柱状图为两者之差；MACD 上穿信号线为多头动量信号，反之为空头。",
    },
  },
  "Signal Line": {
    en: { what: "A smoothed version of the MACD line used as a trigger — MACD crossing it flags momentum shifts." },
    "zh-CN": { label: "信号线", what: "MACD 的平滑版本，作为触发线——MACD 穿越信号线代表动量变化。" },
  },
  Histogram: {
    en: { what: "In MACD context: the gap between MACD line and signal line. Bars grow when momentum is accelerating." },
    "zh-CN": { label: "柱状图（MACD）", what: "MACD 场景中：MACD 线与信号线之差。动量加速时柱变长。" },
  },
  EMA: {
    en: { what: "Exponential Moving Average — like SMA but weights recent days more, so it reacts to price changes faster." },
    "zh-CN": { label: "EMA（指数移动均线）", what: "指数移动平均——类似 SMA 但对近期日子加大权重，因此反应更快。" },
  },
  "Golden Cross": {
    en: { what: "When the 50-day SMA crosses above the 200-day SMA — a bullish long-term signal." },
    "zh-CN": { label: "黄金交叉", what: "50 日 SMA 上穿 200 日 SMA——长期多头信号。" },
  },
  "Death Cross": {
    en: { what: "When the 50-day SMA crosses below the 200-day SMA — a bearish long-term signal." },
    "zh-CN": { label: "死亡交叉", what: "50 日 SMA 下穿 200 日 SMA——长期空头信号。" },
  },
  "Bull Market": {
    en: {
      what: "A period of sustained rising prices — conventionally, +20% from a recent low.",
      deeper: "Reads best on an index or ETF (broad move) rather than a single stock. Segments can be 'bullish' inside a wider bear market and vice versa — that's what the segment page is for.",
    },
    "zh-CN": {
      label: "牛市",
      what: "股价持续上涨的阶段——常规定义为从近期低点反弹 +20% 以上。",
      deeper: "多用于观察指数或 ETF 的整体走势，而非单只个股。个别板块可以在整体熊市中呈现\"牛\"，反之亦然——这正是板块分析页面的用途。",
    },
  },
  "Bear Market": {
    en: {
      what: "A period of sustained falling prices — conventionally, −20% from a recent high.",
      deeper: "Not every pullback is a bear market — a 10-19% drop is usually called a 'correction'. Bear markets typically last months to years, not days.",
    },
    "zh-CN": {
      label: "熊市",
      what: "股价持续下跌的阶段——常规定义为从近期高点回落 -20% 以上。",
      deeper: "并非所有下跌都是熊市——10-19% 的回落通常称为\"回调\"。熊市持续时间通常以月至年计，而非几天。",
    },
  },
  ETF: {
    en: {
      what: "Exchange-Traded Fund — a basket of stocks that trades like a single ticker.",
      deeper: "The segment page uses ETFs as 'theme thermometers': SMH tracks semiconductors, XLV tracks healthcare, KWEB tracks China internet, etc. One ETF is far more diagnostic of a segment's health than any single stock.",
    },
    "zh-CN": {
      label: "ETF（交易所交易基金）",
      what: "交易所交易基金——一篮子股票以单一代码在交易所买卖。",
      deeper: "板块页面把 ETF 用作\"主题温度计\"：SMH 追踪半导体、XLV 追踪医疗、KWEB 追踪中概互联网等。用一只 ETF 判断板块健康度远比看单一个股更可靠。",
    },
  },
  "Unrealized P&L": {
    en: {
      what: "Profit or loss on shares you still hold — 'on paper' money that only turns real when you sell.",
      deeper: "Formula: (current price − average cost) × shares held. It moves up and down every second the market is open. Positive numbers feel good but aren't cash yet; negative numbers only become losses if you actually sell at that price.",
    },
    "zh-CN": {
      label: "未实现盈亏",
      what: "仍在持有股票上的账面盈亏——只有真正卖出时才会变成实际收益或亏损。",
      deeper: "公式：(当前价 − 平均成本) × 持股数。开盘期间每秒都在变动。数字为正让人开心，但尚未变现；数字为负也只有真正在这个价位卖出时才会变成亏损。",
    },
  },
  "Realized P&L": {
    en: {
      what: "Profit or loss you've already locked in by selling shares — real money that hits your account.",
      deeper: "Computed against your average cost at the moment of each sell: (sell price − avg cost) × shares sold − commission. Partial sells count. Positive means you took profit; negative means you took a loss. Realized P&L never changes with tomorrow's price — it's already booked.",
    },
    "zh-CN": {
      label: "已实现盈亏",
      what: "通过卖出股票已经落袋（或已确认亏损）的金额——真金白银进出账户。",
      deeper: "按每次卖出时的平均成本计算：(卖出价 − 平均成本) × 卖出股数 − 佣金。部分卖出同样计入。正数代表获利了结；负数代表止损。已实现盈亏不会随明日价格变化——已经入账。",
    },
  },
  Divergence: {
    en: { what: "When price makes a new high/low but the indicator (RSI/MACD) doesn't — often a warning that the trend is losing steam." },
    "zh-CN": { label: "背离", what: "价格创新高/新低但指标（RSI/MACD）没有——常是趋势动能减弱的警告。" },
  },
  KDJ: {
    en: {
      what: "A momentum oscillator popular on Chinese trading platforms — three lines (K, D, J) that measure where today's close sits inside the recent trading range.",
      deeper: "K is the fast line, D is a smoothed version of K, and J = 3K − 2D (a leading line that can exceed 0-100). Rules of thumb: K crossing above D = bullish (\"golden cross\"), K below D = bearish. Above 80 = overbought, below 20 = oversold. Standard parameters (9, 3, 3): 9-bar range with 3-period smoothing on K and D.",
    },
    "zh-CN": {
      label: "KDJ 指标",
      what: "中国交易软件常用的动量摆动指标——由 K、D、J 三条线组成，衡量当日收盘价在近期波动区间中的位置。",
      deeper: "K 为快线，D 为 K 的平滑值，J = 3K − 2D（是可超出 0-100 的领先线）。经验法则：K 上穿 D 为多头（\"金叉\"），K 下穿 D 为空头。> 80 超买，< 20 超卖。标准参数 (9, 3, 3)：9 根 K 线的区间，K 与 D 各做 3 期平滑。",
    },
  },
  "Stochastic Oscillator": {
    en: {
      what: "A momentum indicator that compares the current close to the high-low range over a lookback window, producing a 0-100 reading.",
      deeper: "The formula is RSV = (close − lowest low) / (highest high − lowest low) × 100. KDJ is a Chinese-market variant that adds a smoothed 'D' line and a leading 'J' line on top of the raw stochastic.",
    },
    "zh-CN": {
      label: "随机指标（KD/KDJ 的原型）",
      what: "动量指标——将当前收盘价与近期最高价 / 最低价区间进行比较，产生 0-100 的读数。",
      deeper: "计算公式 RSV =（收盘价 − 区间最低）÷（区间最高 − 区间最低）× 100。KDJ 是中国市场对该指标的变体，在原始随机值基础上加上平滑的 D 线与领先的 J 线。",
    },
  },
  "Daily Returns Distribution": {
    en: { what: "A histogram of each day's percent change. Wide bell = choppy stock; narrow spike = calm stock." },
    "zh-CN": { label: "日回报率分布", what: "每日百分比变动的直方图。宽钟形 = 波动大；集中尖峰 = 平稳。" },
  },

  // -------------- Valuation ratios ----------------------------------------
  "P/E Ratio": {
    en: {
      what: "Price ÷ Earnings-per-share — how many dollars you're paying for each dollar the company earned last year.",
      deeper: "Under 15 = cheap-ish; 15-25 = typical; over 30 = expensive (fine for fast growers, worrying for mature businesses). Negative P/E means the company lost money.",
    },
    "zh-CN": {
      label: "市盈率（P/E）",
      what: "股价 ÷ 每股收益——为公司去年每赚 1 美元你付出的美元数。",
      deeper: "< 15 便宜；15-25 普通；> 30 昂贵（成长股无妨，成熟公司需警惕）。负值意味公司亏损。",
    },
  },
  "Forward P/E": {
    en: { what: "P/E based on expected earnings for the next year instead of the past year." },
    "zh-CN": { label: "前瞻市盈率", what: "基于未来一年预期盈利的 P/E（而非过去一年）。" },
  },
  "PEG Ratio": {
    en: {
      what: "P/E divided by earnings growth rate — asks 'is this stock cheap for how fast it's growing?'",
      deeper: "Under 1 = potentially undervalued given growth. Over 2 = premium.",
    },
    "zh-CN": {
      label: "PEG 比率",
      what: "P/E 除以盈利增长率——询问\"考虑成长速度，这只股票便宜吗？\"",
      deeper: "< 1 相对成长可能被低估；> 2 溢价。",
    },
  },
  "P/B Ratio": {
    en: { what: "Price divided by book value per share — how much you're paying above what the balance sheet says the company is worth." },
    "zh-CN": { label: "市净率（P/B）", what: "股价除以每股账面价值——相对资产负债表账面价值多付了多少倍。" },
  },
  "P/S Ratio": {
    en: { what: "Price divided by revenue per share. Useful for unprofitable companies where P/E doesn't work." },
    "zh-CN": { label: "市销率（P/S）", what: "股价除以每股营收。对无盈利公司（P/E 失效时）尤其有用。" },
  },
  "EV/EBITDA": {
    en: { what: "Enterprise value ÷ operating cash-generating power. Better than P/E when comparing companies with different debt levels." },
    "zh-CN": { label: "EV/EBITDA 倍数", what: "企业价值 ÷ 经营现金创造能力。比 P/E 更适合跨不同负债水平公司的比较。" },
  },
  "Market Cap": {
    en: {
      what: "Total value of all shares (price × shares outstanding) — the company's size.",
      deeper: "Small cap < $2B · Mid $2-10B · Large $10-200B · Mega > $200B.",
    },
    "zh-CN": {
      label: "市值",
      what: "全部股份的总价值（股价 × 已发行股数）——公司规模。",
      deeper: "小盘 < 20 亿美元 · 中盘 20-100 亿 · 大盘 100-2000 亿 · 超大盘 > 2000 亿。",
    },
  },
  "Enterprise Value": {
    en: { what: "What it would cost to buy the whole company: market cap + debt − cash." },
    "zh-CN": { label: "企业价值", what: "整体收购公司的成本：市值 + 债务 − 现金。" },
  },
  "Book Value": {
    en: { what: "Company's net worth on paper: total assets minus total liabilities." },
    "zh-CN": { label: "账面价值", what: "公司账面净资产：总资产 − 总负债。" },
  },

  // -------------- Profitability -------------------------------------------
  "Gross Margin": {
    en: { what: "% of revenue left after paying for the raw goods/services sold. Product-level efficiency." },
    "zh-CN": { label: "毛利率", what: "支付售出商品/服务原料成本后剩余的营收占比。产品级效率。" },
  },
  "Operating Margin": {
    en: { what: "% of revenue left after all operating costs (salaries, rent, marketing). Business-level efficiency." },
    "zh-CN": { label: "营业利润率", what: "扣除全部经营成本（薪酬、租金、营销）后剩余的营收占比。业务级效率。" },
  },
  "Profit Margin": {
    en: { what: "% of revenue that ends up as bottom-line profit after everything (taxes, interest, one-offs)." },
    "zh-CN": { label: "净利率", what: "扣除全部（税、利息、一次性项目）后成为净利润的营收占比。" },
  },
  EBITDA: {
    en: { what: "Earnings Before Interest, Tax, Depreciation, and Amortisation — a rough proxy for cash operating power." },
    "zh-CN": { label: "EBITDA", what: "息税折旧摊销前利润——现金经营能力的粗略代理指标。" },
  },
  ROE: {
    en: {
      what: "Return on Equity — profit generated per dollar of shareholder equity. Warren Buffett's favourite metric.",
      deeper: "Over 15% is strong. Watch for very high ROE driven by heavy debt.",
    },
    "zh-CN": {
      label: "ROE（净资产收益率）",
      what: "每 1 美元股东权益创造的利润。巴菲特最爱的指标。",
      deeper: "> 15% 强劲。数值过高需警惕是否由高杠杆推动。",
    },
  },
  ROA: {
    en: { what: "Return on Assets — profit per dollar of everything the company owns." },
    "zh-CN": { label: "ROA（资产收益率）", what: "每 1 美元资产（公司所有资产）创造的利润。" },
  },
  EPS: {
    en: { what: "Earnings Per Share — net income divided by shares outstanding. Positive = profitable." },
    "zh-CN": { label: "EPS（每股收益）", what: "净利润除以已发行股数。正值 = 盈利。" },
  },
  TTM: {
    en: { what: "Trailing Twelve Months — the sum of the last 4 quarters of results. A rolling annual number." },
    "zh-CN": { label: "TTM（过去 12 个月）", what: "过去四个季度业绩之和。滚动年度数据。" },
  },
  YoY: {
    en: { what: "Year-over-Year — comparing this year (or quarter) to the same one a year ago." },
    "zh-CN": { label: "YoY（同比）", what: "本年（或本季）与去年同期的对比。" },
  },

  // -------------- Financial health ----------------------------------------
  "Debt / Equity": {
    en: {
      what: "Total debt divided by shareholder equity — how much the company is running on borrowed money.",
      deeper: "Under 1 = conservative · 1-2 = moderate · Over 2 = highly leveraged.",
    },
    "zh-CN": {
      label: "负债/权益（D/E）",
      what: "总负债除以股东权益——公司多大程度上依赖借来的资金。",
      deeper: "< 1 保守 · 1-2 适中 · > 2 高杠杆。",
    },
  },
  "Current Ratio": {
    en: {
      what: "Short-term assets ÷ short-term liabilities. Can the company pay bills coming due in the next year?",
      deeper: "Above 1.5 = healthy · 1-1.5 = tight · Under 1 = liquidity risk.",
    },
    "zh-CN": {
      label: "流动比率",
      what: "短期资产 ÷ 短期负债。能否偿付未来一年到期的账单？",
      deeper: "> 1.5 健康 · 1-1.5 偏紧 · < 1 流动性风险。",
    },
  },
  "Quick Ratio": {
    en: { what: "Like current ratio but stricter — excludes inventory (which may not sell quickly)." },
    "zh-CN": { label: "速动比率", what: "类似流动比率但更严格——不含存货（存货未必能快速变现）。" },
  },
  "Free Cash Flow": {
    en: { what: "Cash left after operating expenses and capital investment. Money the company can actually return to owners." },
    "zh-CN": { label: "自由现金流", what: "扣除经营费用和资本投入后剩余的现金。真正可回馈股东的资金。" },
  },
  "Operating Cash Flow": {
    en: { what: "Cash generated purely by day-to-day operations, before big capital projects." },
    "zh-CN": { label: "经营性现金流", what: "纯粹由日常经营（在大额资本项目前）产生的现金。" },
  },

  // -------------- Dividends -----------------------------------------------
  Dividend: {
    en: { what: "A cash payment a company makes to shareholders, usually quarterly." },
    "zh-CN": { label: "股息", what: "公司向股东派发的现金，通常按季度进行。" },
  },
  "Dividend Yield": {
    en: {
      what: "Annual dividend ÷ stock price — the % 'interest' you earn just from holding.",
      deeper: "2-4% is typical for dividend stocks. Above 6% often signals distress (yield rose because price crashed).",
    },
    "zh-CN": {
      label: "股息率",
      what: "年度股息 ÷ 股价——仅靠持有获得的\"利息\"百分比。",
      deeper: "股息股通常 2-4%。高于 6% 常提示困境（股价暴跌导致股息率被动抬高）。",
    },
  },
  "Payout Ratio": {
    en: { what: "% of earnings paid out as dividends. Above 100% means the company is paying out more than it earns." },
    "zh-CN": { label: "派息比率", what: "以股息形式派发的利润占比。> 100% 意味派出的多于所赚。" },
  },

  // -------------- Ownership -----------------------------------------------
  Insider: {
    en: {
      what: "Someone with a formal role at the company: executive, director, officer, or ≥10% owner.",
      deeper: "Insiders must report every trade in the company's stock to the SEC within 2 business days (Form 4). Watch for clusters of buying by multiple insiders — that's a stronger positive signal than isolated selling.",
    },
    "zh-CN": {
      label: "内部人士",
      what: "在公司担任正式角色的人：高管、董事、officer 或持股 ≥10%。",
      deeper: "内部人士必须在交易发生后 2 个工作日内向 SEC 申报（Form 4）。关注多位内部人士集中买入——这是比零星卖出更强的正面信号。",
    },
  },
  "Institutional Holder": {
    en: { what: "A large money-manager (hedge fund, pension, asset manager) required to report positions quarterly on Form 13F." },
    "zh-CN": { label: "机构持有者", what: "需按季度通过 Form 13F 申报持仓的大型资产管理者（对冲基金、养老金、资产管理公司）。" },
  },
  "Mutual Fund": {
    en: { what: "A pooled investment vehicle that buys a basket of stocks on behalf of retail investors." },
    "zh-CN": { label: "共同基金", what: "为零售投资者代持股票篮子的集合投资工具。" },
  },
  ETF: {
    en: { what: "Exchange-Traded Fund — a mutual-fund-like basket of stocks that trades on an exchange like a single stock." },
    "zh-CN": { label: "ETF（交易所交易基金）", what: "类似共同基金的股票篮子，但像单只股票一样在交易所交易。" },
  },
  Float: {
    en: { what: "The portion of a company's shares that are actually available for the public to trade (excludes insider-locked shares)." },
    "zh-CN": { label: "流通股", what: "公司股份中实际可供公众交易的部分（不含被内部锁定的股份）。" },
  },
  "% Held": {
    en: { what: "The holder's stake as a percentage of all shares outstanding." },
    "zh-CN": { label: "持股比例", what: "持有者持股占已发行股份总数的百分比。" },
  },
  "% of Float": {
    en: { what: "The holder's stake as a percentage of the publicly-tradable share pool." },
    "zh-CN": { label: "占流通股比例", what: "持有者持股占公众可交易股份的百分比。" },
  },
  Direct: {
    en: { what: "Shares titled personally in the insider's own name." },
    "zh-CN": { label: "直接持有", what: "以内部人士本人名义登记的股份。" },
  },
  Indirect: {
    en: { what: "Shares owned through a trust, LLC, spouse, or other entity the insider controls." },
    "zh-CN": { label: "间接持有", what: "通过信托、LLC、配偶或其他内部人士控制的实体持有的股份。" },
  },
  "Form 3": {
    en: { what: "First-time filing when someone becomes an insider — declares their starting holdings." },
    "zh-CN": { label: "Form 3 表格", what: "成为内部人士时的首次申报——申报起始持仓。" },
  },
  "Form 4": {
    en: { what: "Every insider stock transaction: buy, sell, gift, option exercise, tax withholding, etc. Due within 2 business days." },
    "zh-CN": { label: "Form 4 表格", what: "内部人士的每一笔股票交易：买、卖、赠与、期权行使、代扣税等。须在 2 个工作日内申报。" },
  },
  "Form 5": {
    en: { what: "Annual clean-up filing for insider transactions that didn't make it into a Form 4." },
    "zh-CN": { label: "Form 5 表格", what: "对未纳入 Form 4 的内部交易进行年度补报的文件。" },
  },
  "Form 13F": {
    en: {
      what: "Quarterly report from institutional managers with >$100M under management, listing every US-listed long position.",
      deeper: "13F is why we can see what Buffett, Ackman, Burry, etc. are buying. But it lags reality by up to 45 days and hides short positions and non-US holdings.",
    },
    "zh-CN": {
      label: "Form 13F 表格",
      what: "管理规模 > 1 亿美元的机构经理季度报告，列出其所有美国上市多头持仓。",
      deeper: "13F 让我们能看到巴菲特、Ackman、Burry 等人的买入。但最多滞后 45 天，且不含空头与非美股持仓。",
    },
  },
  "13F-HR": {
    en: { what: "The standard 13F quarterly holdings report. 'HR' = Holdings Report." },
    "zh-CN": { label: "13F-HR 表格", what: "标准 13F 季度持仓报告。'HR' = 持仓报告（Holdings Report）。" },
  },
  "Section 16": {
    en: { what: "The part of securities law that requires officers, directors, and ≥10% owners to publicly report their trades (Forms 3/4/5)." },
    "zh-CN": { label: "第 16 节（Section 16）", what: "证券法中要求高管、董事及持股 ≥10% 者公开申报交易的条款（Forms 3/4/5）。" },
  },
  "Non-Derivative": {
    en: {
      what: "Actual shares (common stock, preferred stock) — not options, warrants, or RSUs.",
      deeper: "We only surface non-derivative holdings so 'how many shares does X own?' has a straightforward answer.",
    },
    "zh-CN": {
      label: "非衍生证券",
      what: "真实股份（普通股、优先股）——不含期权、认股权证、RSU。",
      deeper: "我们只展示非衍生持仓，让\"X 持有多少股\"有直接答案。",
    },
  },
  Derivative: {
    en: { what: "Contract whose value derives from an underlying stock: options, warrants, RSUs, etc." },
    "zh-CN": { label: "衍生证券", what: "价值源自底层股票的合约：期权、认股权证、RSU 等。" },
  },
  "Reporting Owner": {
    en: { what: "The person or entity filing a Form 3/4/5 — the insider whose trades are being disclosed." },
    "zh-CN": { label: "申报所有人", what: "提交 Form 3/4/5 的个人或实体——即被披露交易的内部人士。" },
  },
  CIK: {
    en: { what: "Central Index Key — SEC's unique 10-digit ID for every filer (company or person)." },
    "zh-CN": { label: "CIK 编号", what: "SEC 分配给每位申报者（公司或个人）的唯一 10 位编号。" },
  },
  Cusip: {
    en: { what: "A 9-character code that uniquely identifies a US-traded security." },
    "zh-CN": { label: "CUSIP 代码", what: "唯一标识美国证券的 9 位字符编码。" },
  },
  Accession: {
    en: { what: "The unique ID SEC EDGAR assigns to a single filing document." },
    "zh-CN": { label: "EDGAR 文件编号", what: "SEC EDGAR 分配给单份文件的唯一 ID。" },
  },

  // -------------- Political trading ---------------------------------------
  "STOCK Act": {
    en: { what: "US law (Stop Trading on Congressional Knowledge Act) requiring members of Congress and their spouses to disclose every stock trade within 45 days." },
    "zh-CN": { label: "STOCK 法案", what: "美国《禁止基于国会知情交易法》，要求国会议员及其配偶在 45 天内披露每笔股票交易。" },
  },
  PTR: {
    en: {
      what: "Periodic Transaction Report — the STOCK Act filing House members submit for each trade.",
      deeper: "House PTRs report dollar amounts as ranges (e.g. $1,001-$15,000), not exact figures, so net-position estimates are always ranges.",
    },
    "zh-CN": {
      label: "PTR（定期交易报告）",
      what: "众议员依 STOCK 法案针对每笔交易提交的定期交易报告。",
      deeper: "众议院 PTR 以金额区间披露（如 $1,001-$15,000），非精确数字，因此净持仓估计始终以区间呈现。",
    },
  },
  "House Clerk": {
    en: { what: "The office that publishes House Representatives' financial disclosures at disclosures-clerk.house.gov." },
    "zh-CN": { label: "众议院书记员", what: "在 disclosures-clerk.house.gov 发布众议员财务披露的办公室。" },
  },

  // -------------- Sentiment / News ----------------------------------------
  Bullish: {
    en: { what: "Optimistic — the headline/indicator suggests the stock is likely to rise." },
    "zh-CN": { label: "多头 / 看涨", what: "乐观——新闻/指标暗示股价可能上涨。" },
  },
  Bearish: {
    en: { what: "Pessimistic — the headline/indicator suggests the stock is likely to fall." },
    "zh-CN": { label: "空头 / 看跌", what: "悲观——新闻/指标暗示股价可能下跌。" },
  },
  "Sentiment Score": {
    en: {
      what: "A −1 to +1 rating of a headline's tone. We use a finance-tuned VADER lexicon.",
      deeper: "Above +0.15 = bullish · Below −0.15 = bearish · In between = neutral. The overall page score is time-weighted so newer stories count more.",
    },
    "zh-CN": {
      label: "情绪得分",
      what: "新闻情绪的 −1 到 +1 打分。使用金融调优过的 VADER 词典。",
      deeper: "> +0.15 多头 · < −0.15 空头 · 之间为中性。页面总分按时间加权，越新的新闻权重越大。",
    },
  },
  VADER: {
    en: { what: "Valence Aware Dictionary and sEntiment Reasoner — a rule-based sentiment analyser tuned for short social-media-style text." },
    "zh-CN": { label: "VADER 情绪分析", what: "一个针对短篇社交媒体文本调优的基于规则的情绪分析器。" },
  },
  Impact: {
    en: { what: "How strong a headline is emotionally, regardless of direction. High-impact = big words like 'crash', 'surge', 'bankruptcy'." },
    "zh-CN": { label: "影响力", what: "不论方向，新闻情感强度的度量。高影响力 = 出现\"暴跌、飙升、破产\"等强词汇。" },
  },
  "Fear & Greed Index": {
    en: {
      what: "CNN's daily 0-100 gauge of US-market sentiment. Under 25 = extreme fear · 25-45 = fear · 45-55 = neutral · 55-75 = greed · Over 75 = extreme greed.",
      deeper: "It blends seven market signals: S&P 500 momentum vs its 125-day MA, the number of new 52-week highs vs lows, up-volume vs down-volume, the 5-day put/call ratio, VIX vs its 50-day MA, junk-bond yield spreads, and stock vs bond returns. Extreme readings are often contrarian: buy fear, sell greed.",
    },
    "zh-CN": {
      label: "恐惧与贪婪指数",
      what: "CNN 每日发布的美国市场情绪指数，取值 0-100。< 25 极度恐惧 · 25-45 恐惧 · 45-55 中性 · 55-75 贪婪 · > 75 极度贪婪。",
      deeper: "由七个指标合成：标普 500 vs 125 日均线的动量、52 周新高/新低数量对比、涨跌成交量之比、5 日认沽/认购比率、VIX vs 50 日均线、垃圾债利差、股票与债券的回报差。极端值常被视为反向信号：贪婪时谨慎，恐惧时留意机会。",
    },
  },
  "Technical Signal": {
    en: {
      what: "A weighted vote across nine checks — trend regime, recent SMA crosses, MACD, RSI, Bollinger position, short-term return with volume, KDJ, support/resistance proximity, and the market-wide Fear & Greed extremes — that produces a Buy / Hold / Sell verdict.",
      deeper: "Each contributing signal gets a signed weight (positive = bullish, negative = bearish). The net vote is normalised by the maximum possible weight and then scaled by an agreement factor (perfect agreement × 1, perfect conflict × 0.5) to produce a final score in −100 to +100. Above +50 = Strong Buy · +15 to +50 = Buy · −15 to +15 = Hold · −50 to −15 = Sell · below −50 = Strong Sell. When conviction is low (few signals firing or a lot of disagreement), a Buy or Sell label is downgraded to Hold. Fear & Greed is folded in contrarian-style: crowd panic reads as a mild buy, crowd euphoria as a mild sell. Educational only — not investment advice.",
    },
    "zh-CN": {
      label: "技术面信号",
      what: "对九项检查进行加权投票：趋势状态、近期均线交叉、MACD、RSI、布林带位置、含量能的短期回报、KDJ、支撑/阻力位邻近度，以及全市场恐惧与贪婪的极端读数——生成 买入 / 观望 / 卖出 的综合判断。",
      deeper: "每个信号带有一个有符号权重（正 = 看多，负 = 看空）。净得分除以理论最大权重后，再乘以一个「共识系数」（完全一致 ×1，完全冲突 ×0.5），得到 −100 到 +100 的最终分值。> +50 强烈买入 · +15 到 +50 买入 · −15 到 +15 观望 · −50 到 −15 卖出 · < −50 强烈卖出。当可信度较低（触发信号少或分歧大）时，会将「买入/卖出」下调为「观望」。恐惧与贪婪按逆向方式引入：群体恐慌视为弱买入，群体狂热视为弱卖出。仅供学习参考，非投资建议。",
    },
  },
  Conviction: {
    en: {
      what: "How much to trust the headline verdict itself — a chip that reads High / Medium / Low based on how many signals fired and how much they agreed.",
      deeper: "High = at least half of the 9 signals fired AND at least 60% of the fired weight is one-directional. Low = few signals fired or they disagreed heavily. On Low conviction, any Buy or Sell label is safety-downgraded to Hold — the picture is too thin or too conflicted to act on.",
    },
    "zh-CN": {
      label: "判断可信度",
      what: "对头部结论本身的可信程度——分为「高/中/低」三档，取决于触发信号数量与一致程度。",
      deeper: "高 = 9 项信号至少半数触发 且 触发权重中至少 60% 同向。低 = 触发信号较少 或 分歧较大。低可信度时会将「买入/卖出」安全下调为「观望」——当前证据过于薄弱或矛盾，不足以采取行动。",
    },
  },
  Agreement: {
    en: {
      what: "How one-directional the firing signals are, from 0 (perfect split) to 100% (unanimous).",
      deeper: "Formally |Σ bull − Σ bear| ÷ (Σ bull + Σ bear). Multiplied against the raw score as an 'agreement factor' (0.5 + 0.5 × agreement) so a 40/60 split gets a gentler score than a 90/10 rout — the label is a summary of the tape's clarity, not just its direction.",
    },
    "zh-CN": {
      label: "一致度",
      what: "触发信号的方向一致程度，从 0（完全对立）到 100%（完全一致）。",
      deeper: "定义为 |Σ 看多 − Σ 看空| ÷ (Σ 看多 + Σ 看空)。将其乘以原始得分作为「共识系数」（0.5 + 0.5 × 一致度）—— 40/60 分歧会得到比 90/10 压倒性一致更温和的分数。可信度不仅关乎方向，也关乎明确度。",
    },
  },
  Contrarian: {
    en: {
      what: "Investing against the crowd — buying when everyone else is selling in panic, selling when everyone is chasing gains. Popularised by Warren Buffett's line: 'Be fearful when others are greedy, and greedy when others are fearful.'",
      deeper: "Contrarian reasoning treats extreme sentiment as a signal that the market has priced too far in one direction. It's why the CNN Fear & Greed Index's extreme readings are often read as buy (fear) or sell (greed) triggers rather than confirmation.",
    },
    "zh-CN": {
      label: "逆向投资",
      what: "与人群反向操作——他人恐慌抛售时买入，他人追涨时卖出。巴菲特名言：\"他人贪婪时我恐惧，他人恐惧时我贪婪\"即是此意。",
      deeper: "逆向思维把极端情绪视为市场定价过度的信号。这也是为什么 CNN 恐惧与贪婪指数的极端读数常被视为买入（恐惧）或卖出（贪婪）触发点，而非顺势确认。",
    },
  },
  VIX: {
    en: {
      what: "The Cboe Volatility Index — the market's expectation of S&P 500 volatility over the next 30 days, derived from option prices. Under 15 = calm · 15-25 = normal · above 25 = stressed · above 40 = panic.",
      deeper: "Often called the 'fear gauge'. It rises when option buyers pay up for protection, which is usually when the market is falling. On the market-segment page the stance chip is inverted from the raw VIX trend so a rising VIX (falling stocks) reads as bearish for an equity holder. VIX is one of the seven inputs to CNN's Fear & Greed Index.",
    },
    "zh-CN": {
      label: "VIX 波动率指数",
      what: "芝加哥期权交易所波动率指数——由期权价格推导出的市场对未来 30 天标普 500 波动率的预期。< 15 平静 · 15-25 正常 · > 25 紧张 · > 40 恐慌。",
      deeper: "常被称为\"恐慌指数\"。当期权买方为对冲支付更高成本时上升，通常伴随市场下跌。在市场板块页面上，VIX 的看多/看空标签相对于原始价格已经反转——VIX 上行（股市承压）对股票持有者显示看空。VIX 是 CNN 恐惧与贪婪指数的七项输入之一。",
    },
  },
  DXY: {
    en: {
      what: "US Dollar Index — the value of the US dollar against a basket of six major currencies (EUR, JPY, GBP, CAD, SEK, CHF). Above 100 = dollar historically strong; below 95 = historically weak.",
      deeper: "A rising DXY is a headwind for US multinationals with foreign earnings, for commodity prices (which are USD-denominated), and for emerging-market equities and debt. The market-segment page therefore inverts DXY's stance chip: an uptrend on the dollar reads as bearish for a globally-exposed equity portfolio.",
    },
    "zh-CN": {
      label: "美元指数",
      what: "衡量美元对一篮子六种主要货币（欧元、日元、英镑、加元、瑞典克朗、瑞郎）的价值。> 100 表示美元历史强势；< 95 表示历史弱势。",
      deeper: "美元走强对海外营收占比高的美国跨国公司、以美元计价的大宗商品、以及新兴市场股票与债券构成阻力。因此在市场板块页面上，美元指数的看多/看空标签相对于原始价格反转——DXY 上行对全球化股票组合来说显示为看空。",
    },
  },
  "10Y Yield": {
    en: {
      what: "The yield on the 10-year US Treasury note — the world's benchmark risk-free rate and the discount rate behind essentially every valuation model.",
      deeper: "Rising yields compress equity valuation multiples (higher discount rate = lower present value of future earnings) and pressure rate-sensitive sectors like REITs, utilities, and growth tech. The market-segment page inverts the ^TNX stance chip: an uptrend on 10Y yields reads as bearish for equities.",
    },
    "zh-CN": {
      label: "10 年期国债收益率",
      what: "10 年期美国国债的收益率——全球基准无风险利率，也是几乎所有估值模型背后的贴现率。",
      deeper: "收益率上行会压缩股票估值倍数（贴现率上升 = 未来现金流现值下降），并对利率敏感板块（REITs、公用事业、成长型科技）构成压力。市场板块页面因此反转 ^TNX 的看多/看空标签——收益率上行对股市显示为看空。",
    },
  },
  "Put/Call Ratio": {
    en: {
      what: "Volume of put options divided by volume of call options. Above 1 = more downside protection being bought (bearish crowd); well below 1 = more upside speculation (bullish crowd).",
      deeper: "The 5-day version feeds directly into CNN's Fear & Greed. Extremes are read contrarian-ly — very high ratios often mark short-term bottoms because everyone is already hedged.",
    },
    "zh-CN": {
      label: "认沽/认购比率",
      what: "认沽期权成交量除以认购期权成交量。> 1 表示更多下行保护买入（人群偏空）；< 1 表示更多上行投机（人群偏多）。",
      deeper: "5 日均值直接输入 CNN 恐惧与贪婪指数。极值常被逆向解读——极高比率往往标志短期底部，因为所有人都已在对冲。",
    },
  },
  "Market Breadth": {
    en: {
      what: "How broadly a market's advance or decline is participating across stocks. Strong breadth = most stocks moving together; weak breadth = a few mega-caps carrying the index.",
      deeper: "Common measures include the advance/decline line, new 52-week highs vs lows, and up-volume vs down-volume. Poor breadth in a rising market is a warning that leadership is thinning out.",
    },
    "zh-CN": {
      label: "市场广度",
      what: "指数上涨或下跌时，参与其中的股票范围有多广。广度强 = 大多数个股同向；广度弱 = 少数大市值股票拉动指数。",
      deeper: "常用指标包括涨跌家数线、52 周新高对新低、涨跌成交量对比。上涨市场中广度转弱是领涨面变窄的警示。",
    },
  },
  "Safe Haven Demand": {
    en: {
      what: "How much investors are preferring bonds over stocks over the last 20 trading days. When bonds outperform, investors are seeking safety (bearish for stocks); when stocks outperform, appetite is on (bullish).",
      deeper: "One of CNN's seven Fear & Greed inputs — measured as the difference between S&P 500 and 10-year Treasury total returns over the trailing 20 days.",
    },
    "zh-CN": {
      label: "避险需求",
      what: "衡量过去 20 个交易日投资者对债券相对股票的偏好。债券跑赢 = 追求避险（股票偏空）；股票跑赢 = 风险偏好上升（偏多）。",
      deeper: "CNN 恐惧与贪婪的七项输入之一——由标普 500 与 10 年期国债过去 20 天总回报之差衡量。",
    },
  },

  // -------------- Paper trading -------------------------------------------
  "Paper Trading": {
    en: { what: "A simulated brokerage account. Same interface as real trading but no real money moves." },
    "zh-CN": { label: "模拟交易", what: "模拟券商账户。与真实交易相同界面，但不涉及真实资金。" },
  },
  "Cost Basis": {
    en: { what: "What you paid on average for each share you still hold." },
    "zh-CN": { label: "成本基础", what: "你仍持有的每股平均支付价格。" },
  },
  "Avg Cost": {
    en: { what: "Average price paid per share for your current position (cost basis divided by shares held)." },
    "zh-CN": { label: "平均成本", what: "当前持仓的平均每股成本（成本基础除以持股数）。" },
  },
  "Realised P&L": {
    en: { what: "Profit or loss you actually locked in by closing (selling) positions." },
    "zh-CN": { label: "已实现盈亏", what: "通过卖出平仓真正锁定的盈亏。" },
  },
  "Unrealised P&L": {
    en: { what: "Paper profit or loss on positions you still hold. Turns into realised P&L when you sell." },
    "zh-CN": { label: "未实现盈亏", what: "仍在持仓的账面盈亏。卖出时转为已实现盈亏。" },
  },
  Position: {
    en: { what: "The shares of a specific ticker you currently own." },
    "zh-CN": { label: "持仓", what: "你当前持有的某个代码的股数。" },
  },
  Long: {
    en: { what: "You own the shares and profit if the price goes up." },
    "zh-CN": { label: "多头持仓", what: "你持有股份，价格上涨则获利。" },
  },
  Short: {
    en: { what: "You borrow and sell shares hoping to buy them back cheaper. Profit if price falls." },
    "zh-CN": { label: "空头持仓", what: "借入并卖出股份，期望更便宜时买回。价格下跌则获利。" },
  },
  "Market Value": {
    en: { what: "Current price × shares held — what your position would fetch if you sold right now." },
    "zh-CN": { label: "市值", what: "当前价 × 持股数——立刻卖出可获得的金额。" },
  },
  "Stop-Loss": {
    en: {
      what: "A pre-set price at which the position is automatically sold to cap the downside.",
      deeper: "In this paper account the guard fires on the next price check whenever the live price falls to or below the level, closing the whole position at that price with the trade note ‘Stop-loss triggered’.",
    },
    "zh-CN": {
      label: "止损",
      what: "预设一个价格，当股价跌至该价格时自动卖出，用于限制亏损。",
      deeper: "在本模拟账户中，只要最新价触及或跌破该水平，下次刷新时就会以该价格全仓卖出，并在交易记录中标注「止损触发」。",
    },
  },
  "Take-Profit": {
    en: {
      what: "A pre-set price at which the position is automatically sold to lock in gains.",
      deeper: "In this paper account the guard fires on the next price check whenever the live price rises to or above the level, closing the whole position at that price with the trade note ‘Take-profit triggered’.",
    },
    "zh-CN": {
      label: "止盈",
      what: "预设一个价格，当股价涨至该价格时自动卖出，用于锁定利润。",
      deeper: "在本模拟账户中，只要最新价触及或高于该水平，下次刷新时就会以该价格全仓卖出，并在交易记录中标注「止盈触发」。",
    },
  },
  ATR: {
    en: {
      what: "Average True Range — a running estimate of how far a stock typically moves in one bar, including gaps.",
      deeper: "True Range on each bar is max(high-low, |high-prevClose|, |low-prevClose|); ATR is the Wilder-smoothed average of that. A common risk-management rule is to place stops ~2× ATR away from entry so normal volatility doesn't shake you out.",
    },
    "zh-CN": {
      label: "ATR（平均真实波幅）",
      what: "衡量个股每根 K 线的典型波动幅度（含跳空缺口）的滚动指标。",
      deeper: "每根 K 线的真实波幅 = max(高-低, |高-前收|, |低-前收|)，ATR 为其经 Wilder 平滑后的均值。风控上常把止损放在 ~2×ATR 之外，以避免被正常波动扫出。",
    },
  },
  "Risk-Reward": {
    en: {
      what: "The ratio of how much you stand to gain if the trade works vs how much you'll lose if it doesn't.",
      deeper: "Computed as (take-profit − entry) ÷ (entry − stop-loss). A 1:2 ratio means you risk $1 to make $2; most swing-trading playbooks aim for at least 1:1.5 so a modest win rate still comes out ahead.",
    },
    "zh-CN": {
      label: "风险回报比",
      what: "若交易顺利可赚的金额 与 若失败会亏的金额 的比值。",
      deeper: "计算方式为（止盈 − 入场）÷（入场 − 止损）。1:2 表示每承担 1 美元风险追求 2 美元收益；大多数波段策略要求至少 1:1.5，以确保胜率不高时仍能盈利。",
    },
  },
  "Bracket Order": {
    en: {
      what: "An entry ticket that attaches a stop-loss and/or take-profit at the same time the buy fills, so both protective levels are wired up from day one.",
      deeper: "In this simulator a bracket sets the guard levels on the resulting position row in the same transaction as the fill. Both levels are optional and apply to the whole merged position (not just the new lot), matching how retail brokers handle bracket adds to an existing holding.",
    },
    "zh-CN": {
      label: "带保护单",
      what: "在买入的同时挂上止损或止盈价位，让保护档位从第一天就生效。",
      deeper: "在本模拟盘中，带保护单会在同一笔事务里为合并后的仓位设置守护档位。止损与止盈皆可留空；若已有底仓，新档位会覆盖整张仓位（而非仅本次加仓），与主流券商的处理方式一致。",
    },
  },
  "Win Rate": {
    en: {
      what: "The share of closed sell trades that ended in a gain.",
      deeper: "Computed as winning-sells ÷ total-sells. A high win rate feels good but tells you nothing on its own — a strategy that wins 80% of the time can still lose money if the 20% losers are large. Always read it alongside the average win, average loss and payoff ratio.",
    },
    "zh-CN": {
      label: "胜率",
      what: "已完成的卖出交易中盈利笔数的比例。",
      deeper: "计算方式为「盈利卖出 ÷ 全部卖出」。胜率单独看意义有限——如果 20% 的亏损远大于 80% 的盈利，总账仍会是负。请同时参考平均盈利、平均亏损与盈亏比。",
    },
  },
  "Avg Win": {
    en: { what: "The average realised profit across sells that closed in the money — i.e. what a typical winning trade puts in your pocket." },
    "zh-CN": { label: "平均盈利", what: "所有盈利卖出交易的已实现盈利平均值——即一次典型盈利交易能带来的收益。" },
  },
  "Avg Loss": {
    en: { what: "The average realised loss across sells that closed below cost basis — what a typical losing trade takes out of your account." },
    "zh-CN": { label: "平均亏损", what: "所有亏损卖出交易的已实现亏损平均值——即一次典型亏损交易的损失金额。" },
  },
  "Payoff Ratio": {
    en: {
      what: "Average win divided by the absolute value of average loss. > 1 means your winners are bigger than your losers.",
      deeper: "Combine with win rate to sanity-check a strategy: if the ratio is 2 : 1 you can win only ~34% of the time and still break even. A ratio below 1 needs a very high win rate to be worthwhile.",
    },
    "zh-CN": {
      label: "盈亏比",
      what: "平均盈利 ÷ |平均亏损|。大于 1 表示单笔盈利大于亏损。",
      deeper: "与胜率结合判断策略：盈亏比 2 : 1 时胜率仅约 34% 即可保本；低于 1 则需要极高胜率才有价值。",
    },
  },
  "Round Trip": {
    en: {
      what: "One full open→close cycle on a symbol (shares go from zero, up, back to zero).",
      deeper: "A round trip can contain multiple buys (scaling in) and multiple sells (scaling out) — it counts as one round trip regardless. The counter increments the moment the position reaches zero again.",
    },
    "zh-CN": {
      label: "完整回合",
      what: "一只标的一次「建仓 → 平仓」的完整周期（持股从 0 增加，再回到 0）。",
      deeper: "一个回合可以包含多次加仓与多次减仓，仍算作 1 回合。持股再次归零时计数 +1。",
    },
  },

  // -------------- Alert bot / strategies ----------------------------------
  "SMA Crossover": {
    en: { what: "A signal fired when the short-term moving average crosses the long-term one — up-cross = bullish, down-cross = bearish." },
    "zh-CN": { label: "SMA 均线交叉", what: "短期均线穿越长期均线时触发的信号——上穿多头，下穿空头。" },
  },
  "RSI Reversion": {
    en: { what: "A signal that fires when RSI leaves an extreme zone — coming back up through 30 (bull) or down through 70 (bear)." },
    "zh-CN": { label: "RSI 回归", what: "RSI 离开极端区域时触发的信号——上穿 30（多头）或下穿 70（空头）。" },
  },
  "MACD Cross": {
    en: { what: "A signal that fires when MACD crosses its signal line — up-cross = bullish, down-cross = bearish." },
    "zh-CN": { label: "MACD 交叉", what: "MACD 穿越信号线时触发的信号——上穿多头，下穿空头。" },
  },
  Backtest: {
    en: { what: "Running a strategy over historical data to see how it would have performed." },
    "zh-CN": { label: "回测", what: "在历史数据上运行策略以查看其表现。" },
  },
  Signal: {
    en: { what: "A discrete BUY/SELL/HOLD event produced by a strategy at a specific time." },
    "zh-CN": { label: "信号", what: "策略在特定时刻产生的离散 买入/卖出/持有 事件。" },
  },
  "Cross Event": {
    en: { what: "The exact moment one line moves through another (e.g. MACD line crossing the signal line). Only the crossing candle is a fresh signal." },
    "zh-CN": { label: "交叉事件", what: "一条线穿越另一条线的确切时刻（如 MACD 线穿越信号线）。只有穿越那一根 K 线才算新信号。" },
  },

  // -------------- 6-Signal Resonance & its component indicators --------------
  "6-Signal Resonance": {
    en: {
      what: "A moomoo / TongDaXin-style strategy that fires a BUY only when six fast-tuned momentum checks (MACD, KDJ, RSI, LWR, BBI, MTM) are all bullish on the same bar.",
      deeper: "The idea is a coincidence filter: any single indicator produces false positives constantly, but the odds of six independent ones flipping bullish by accident are much lower. Entries are rare and may lag a bar or two behind the true low, but false starts are also fewer. HOLDING lasts as long as all six stay aligned; the strategy has no built-in exit rule other than the alignment breaking.",
    },
    "zh-CN": {
      label: "六指标共振",
      what: "一种源自 moomoo / 通达信的策略：只有当 MACD、KDJ、RSI、LWR、BBI、MTM 六项快速动量检查在同一根 K 线全部看多时才触发买入。",
      deeper: "本质是一个「巧合过滤器」：单一指标常有假信号，但六项独立指标同时看多的偶发概率显著更低。代价是入场机会稀少，且可能相对最低点滞后一两根 K 线，但假信号也随之减少。只要六项保持对齐即持续「持有」；策略本身没有内置退出规则，只以对齐被打破作为离场依据。",
    },
  },
  Resonance: {
    en: {
      what: "In multi-indicator strategies, the state where several independent signals simultaneously agree. Used as a stronger version of any single signal.",
      deeper: "Popularised on Chinese trading platforms (通达信 / 同花顺 / MooMoo) as 共振. The reasoning: independent noisy signals rarely all agree by accident, so simultaneous alignment carries more information than any individual reading.",
    },
    "zh-CN": {
      label: "共振",
      what: "在多指标策略中，多个独立信号同时给出相同方向的状态。作为单一信号的加强版使用。",
      deeper: "在通达信 / 同花顺 / moomoo 等中文交易平台上广为流传。逻辑：多条独立的噪声信号很少会偶然同向，因此同时对齐比任一单一信号更具信息量。",
    },
  },
  BBI: {
    en: {
      what: "Bull-Bear Index — the average of four short-term simple moving averages (typically 3, 5, 8, 13). One line that summarises where price is relative to short-timeframe consensus.",
      deeper: "BBI = mean(MA3, MA5, MA8, MA13). Close above BBI is read as bullish (price leading the average), close below as bearish. It's popular on Chinese platforms as a lightweight alternative to plotting multiple MAs at once.",
    },
    "zh-CN": {
      label: "BBI 多空指数",
      what: "多空指数——四条短周期简单均线（常用 3、5、8、13）的平均值。用一条线概括价格相对于短时间尺度共识的位置。",
      deeper: "BBI = 平均(MA3, MA5, MA8, MA13)。收盘价高于 BBI 视为多头（价格领先均线），低于则视为空头。在中文平台上作为多均线的轻量替代广受欢迎。",
    },
  },
  LWR: {
    en: {
      what: "Larry Williams %R — a range-based oscillator: where in the recent high-low range does today's close sit? Values sit in [-100, 0]; near 0 = at the top, near -100 = at the bottom.",
      deeper: "LWR = −(HHV(H, N) − Close) / (HHV(H, N) − LLV(L, N)) × 100. The 6-signal resonance strategy uses a smoothed variant (LWR1 = smoothed %R, LWR2 = smoothed LWR1) and reads LWR1 > LWR2 as bullish momentum turning up inside the range.",
    },
    "zh-CN": {
      label: "威廉指标（LWR / %R）",
      what: "Larry Williams %R——一种区间型摆动指标：今天收盘价位于近期高低区间的哪个位置？取值 [-100, 0]，接近 0 表示位于区间顶部，接近 -100 表示位于底部。",
      deeper: "LWR = −(HHV(H, N) − 收盘) / (HHV(H, N) − LLV(L, N)) × 100。「六指标共振」中采用平滑版本（LWR1 = 一次平滑 %R，LWR2 = 平滑 LWR1），LWR1 > LWR2 视为区间内动量向上翻转。",
    },
  },
  MTM: {
    en: {
      what: "Momentum — the raw bar-to-bar change in price. MTM = Close − Close[1]. Positive = up-day, negative = down-day; the size tells you how strong the move was.",
      deeper: "The 6-signal resonance strategy uses a double-smoothed variant: it divides an EMA of signed momentum by an EMA of absolute momentum to get a signed ratio in [-100, +100], run at two speeds (MMS fast, MMM slow). Fast above slow is read as accelerating momentum, and it's more responsive than plain price MAs at turning points.",
    },
    "zh-CN": {
      label: "动量指标 MTM",
      what: "动量——最原始的日间价格变化：MTM = 收盘 − 上一根收盘。正值 = 上涨日，负值 = 下跌日；数值大小表示强度。",
      deeper: "「六指标共振」中使用双重平滑版本：将有向动量的 EMA 除以绝对动量的 EMA，得到 [-100, +100] 的有向比率，并以两种速度运行（MMS 快，MMM 慢）。快线高于慢线视为动量加速，比单纯的价格均线在拐点处更灵敏。",
    },
  },

  // -------------- Resonance "Recent status" legend states --------------
  // These describe what each coloured tick in the trailing-bars strip
  // means. Semantics mirror `ResonanceHistoryEntry.state` in
  // lib/resonance.ts.
  "Buy day": {
    en: {
      what: "A bar where all six checks turned bullish for the first time — this is the actual BUY trigger, not a continuation.",
      deeper: "In the underlying TDX script this is the yellow STICKLINE(买入信号) bar. The strategy only fires an entry alert on these days; subsequent bars where the six stay aligned are 'Hold days' instead.",
    },
    "zh-CN": {
      label: "买入日",
      what: "六项检查首次全部转多的那一根 K 线——真正的「买入」触发日，而不是延续。",
      deeper: "对应通达信原始脚本中的黄色 STICKLINE(买入信号) 柱。策略只在这些日子发出入场提醒；之后仍保持对齐的 K 线属于「持有日」。",
    },
  },
  "Hold day": {
    en: {
      what: "A bar where the six-way bullish alignment carries over from the prior bar — you're already in the trade and the setup is still valid.",
      deeper: "Corresponds to the magenta STICKLINE(共振) bar in the source TDX script. No fresh signal is emitted — hold days simply confirm that the entry conditions haven't broken yet.",
    },
    "zh-CN": {
      label: "持有日",
      what: "六项检查的多头对齐从上一根 K 线延续下来——已在仓位内，条件仍然成立。",
      deeper: "对应源脚本中的洋红色 STICKLINE(共振) 柱。持有日不发出新信号，只是确认入场条件仍未破坏。",
    },
  },
  "Sell day": {
    en: {
      what: "A bar where all six checks turned bearish for the first time — the symmetric bearish counterpart of a Buy day.",
      deeper: "Fires only on the transition bar. Reading these off the strip tells you when a bearish alignment first showed up — subsequent bars that stay bearish are 'Avoid days'.",
    },
    "zh-CN": {
      label: "卖出日",
      what: "六项检查首次全部转空的那一根 K 线——「买入日」在空头一侧的对称信号。",
      deeper: "只在转换那根 K 线触发。之后仍然全空的 K 线属于「回避日」。",
    },
  },
  "Avoid day": {
    en: {
      what: "A bar where the six-way bearish alignment carries over from the prior bar — the bearish counterpart of a Hold day. Stay flat / stay short.",
      deeper: "The strategy reads this as a persistent bearish regime. Long entries on these bars have historically the worst hit rate in the backtest, so the label is a deliberate warning.",
    },
    "zh-CN": {
      label: "回避日",
      what: "六项检查的空头对齐从上一根 K 线延续下来——「持有日」在空头侧的对称形态。空仓 / 保持空头。",
      deeper: "策略视为持续的空头环境。在这些 K 线上做多，在回测中命中率最低——「回避」二字是刻意的警示。",
    },
  },
  Out: {
    en: {
      what: "A bar where neither side is fully aligned — some checks are bullish, some bearish, no consensus. Sit on the sidelines.",
      deeper: "The strategy has no partial-entry rule: if the six aren't all in agreement, there is no trade. Long 'Out' stretches are normal and expected — the coincidence filter is a rare-event detector.",
    },
    "zh-CN": {
      label: "空仓",
      what: "六项检查未在任一方向全部对齐——多空混杂，没有共识。建议观望。",
      deeper: "策略不接受「部分入场」：只要六项没有完全一致，就没有交易。长时间的「空仓」区间是正常的——共振本质上是稀有事件过滤器。",
    },
  },

  // -------------- Market segments / heatmap vocabulary ---------------
  // Terms that show up on the /market/segments and /market/segments/[id]
  // pages — the segment overview grid, the "weight by" toggle in the
  // heatmap, and the constituent table. Kept as their own block so the
  // segment KeyTerms strip stays self-contained and easy to reason about.
  Heatmap: {
    en: {
      what: "A grid where each tile represents one company (or one segment). Tile size shows how big it is on the chosen weight; tile colour shows how the price changed today — green for up, red for down.",
      deeper: "Uses a squarified treemap layout — the algorithm packs rectangles into the available box while keeping their aspect ratios as close to 1:1 as possible, so both huge and tiny tiles remain readable at a glance.",
    },
    "zh-CN": {
      label: "热力图",
      what: "以网格形式展示：每一块代表一家公司（或一个板块）。块的大小表示按所选权重的规模；块的颜色表示当日涨跌——绿色上涨、红色下跌。",
      deeper: "使用平方化 Treemap 布局算法：在有限的框内摆放矩形，同时尽量让长宽比接近 1:1，无论是超大还是极小的方块都能被清晰识别。",
    },
  },
  Treemap: {
    en: {
      what: "Same idea as a heatmap — rectangles inside a bigger rectangle, sized to represent a value. 'Treemap' is the technical name for the layout algorithm; 'heatmap' is the everyday name for the resulting visualization.",
    },
    "zh-CN": {
      label: "Treemap（树状图）",
      what: "本质上就是热力图——将若干矩形嵌入到一个大矩形内，面积代表数值。「Treemap」是布局算法的技术名称，「热力图」则是最终视觉呈现的日常叫法。",
    },
  },
  Weighting: {
    en: {
      what: "The rule that decides how big each tile in a heatmap gets. The 'Weight by' toggle lets you swap between Market Cap, Dollar Volume, Volume (shares), Absolute Change, and Equal.",
      deeper: "Different weightings answer different questions. Market Cap shows where the money sits, Dollar Volume shows where today's money is flowing, Volume (shares) shows retail-style participation, Absolute Change highlights the biggest movers regardless of size, and Equal is a pure grid where colour is all that matters.",
    },
    "zh-CN": {
      label: "权重方式",
      what: "决定热力图中每一块面积大小的规则。「Weight by」切换器可在市值、成交额、成交量（股数）、绝对涨跌幅、等权之间切换。",
      deeper: "不同权重方式回答不同问题：市值反映资金分布，成交额反映今日资金去向，成交量（股数）反映零售参与，绝对涨跌幅突出今日最强波动的标的，等权则完全用颜色说话。",
    },
  },
  Change: {
    en: {
      what: "Percentage change in price compared with the previous close. Positive is up, negative is down. In the heatmap, colour intensity scales with the magnitude of the change.",
      direction: "context",
    },
    "zh-CN": {
      label: "涨跌幅",
      what: "相对于上一交易日收盘价的百分比变化。正为上涨，负为下跌。热力图中的颜色深浅随涨跌幅绝对值增强。",
    },
  },
  "Absolute Change": {
    en: {
      what: "The size of today's price move, ignoring direction — a −4% and a +4% day count the same. Weighting by absolute change turns the heatmap into a 'today's biggest movers' view where volatility, not size, drives the layout.",
      deeper: "Useful for spotting a small-cap breakout that would be invisible if you weighted by market cap. Pair with the colour to distinguish +movers from −movers.",
    },
    "zh-CN": {
      label: "绝对涨跌幅",
      what: "只看当日价格波动的大小，不看方向——−4% 与 +4% 权重相同。按绝对涨跌幅加权，热力图便变为「今日最活跃个股」视角：主导布局的是波动而非规模。",
      deeper: "适合发现小盘股的爆发，这些标的在按市值加权的图中往往被完全淹没。请配合颜色区分上涨或下跌。",
    },
  },
  "Dollar Volume": {
    en: {
      what: "Today's turnover in dollars — price × shares traded. Weighting by dollar volume shows where money actually moved today, which is often a better 'crowd interest' gauge than share count alone.",
      deeper: "A high-priced stock with modest share volume can still dominate dollar volume, while a $2 stock trading tens of millions of shares may barely register. Dollar volume is what institutional desks actually compete for.",
    },
    "zh-CN": {
      label: "成交额（美元）",
      what: "当日的成交总金额——价格 × 成交股数。按成交额加权，可以显示今日资金实际流向何处，通常比单纯的股数更能反映「资金关注度」。",
      deeper: "高价股即使股数不多，其成交额仍可占据主导；而 $2 的低价股即使成交上千万股，成交额也可能几乎看不到。成交额才是机构席位真正争夺的资源。",
    },
  },
  "Volume (shares)": {
    en: {
      what: "Number of shares that changed hands today, ignoring price. Weighting by share volume can over-represent low-priced stocks — the same $1M turnover looks huge on a $2 stock and tiny on a $2,000 stock.",
      deeper: "For a true 'money interest' read, use Dollar Volume instead. Share volume is more useful for spotting concentration of retail activity in penny names.",
    },
    "zh-CN": {
      label: "成交量（股数）",
      what: "当日易主的股数，不考虑价格。按股数加权容易放大低价股——同样是 100 万美元的成交，在 $2 的股票上看起来巨大，在 $2000 的股票上则微不足道。",
      deeper: "如需真实的「资金关注度」，请改用成交额（美元）。股数更适合捕捉低价股中散户资金的集中程度。",
    },
  },
  "Equal Weight": {
    en: {
      what: "Every tile gets the same size — the layout becomes a pure grid and only the colours vary. Useful when you want to compare colour patterns without the biggest stocks dominating your eye.",
      deeper: "The S&P 500 Equal Weight index (RSP) uses the same idea to avoid mega-cap concentration; a heatmap on equal weight is the visual analogue.",
    },
    "zh-CN": {
      label: "等权",
      what: "每一块面积相同——布局变成一个纯粹的网格，只有颜色在变化。适合在不被大市值股票视觉主导的情况下比较颜色分布。",
      deeper: "标普 500 等权指数（RSP）背后正是同样的思路，用以规避超大市值股的过度集中；等权热力图就是这种思路的视觉对应。",
    },
  },
  Constituents: {
    en: {
      what: "The individual companies that make up a segment, sector, or index. Also what shows up in the 'Companies in this segment' table.",
      deeper: "For themed segments we curate ~15–25 representative tickers per segment; for benchmark indices the constituents are the officially-published members (e.g. all S&P 500 companies for the SPX segment).",
    },
    "zh-CN": {
      label: "成分股",
      what: "构成某个板块、行业或指数的具体公司。也就是「本板块内公司」表格中列出的那些标的。",
      deeper: "对于主题板块，我们精选每个板块约 15–25 只代表性个股；对于基准指数，成分股为官方公布的名单（如 SPX 板块的成分股即为标普 500 全体成员）。",
    },
  },
  Sector: {
    en: {
      what: "A broad classification of companies by industry — technology, financials, energy, healthcare, etc. Widely used because sectors tend to move together on macro news.",
      deeper: "The GICS (Global Industry Classification Standard) has 11 sectors, from Information Technology to Real Estate. In this app 'Sector' and 'Segment' are used loosely to mean the same thing.",
    },
    "zh-CN": {
      label: "行业",
      what: "按业务将公司做的宽口径归类——科技、金融、能源、医疗等。因宏观新闻常引发同行业联动，故被广泛使用。",
      deeper: "GICS（全球行业分类标准）共 11 个行业，从信息技术到房地产。在本应用中「行业（Sector）」与「板块（Segment）」被宽松互用。",
    },
  },
  Segment: {
    en: {
      what: "In this app, a curated grouping of related tickers — could be a classic sector (Financials), a theme (AI infrastructure), or a benchmark index (S&P 500). Every segment has a proxy ETF plus a hand-picked list of constituents.",
    },
    "zh-CN": {
      label: "板块",
      what: "本应用中的板块是一组精选的相关标的——可以是传统行业（如金融）、主题（如 AI 基础设施），也可以是基准指数（如标普 500）。每个板块都有一只代理 ETF 及一份精选成分股列表。",
    },
  },
  "Proxy ETF": {
    en: {
      what: "A single ticker used to represent a whole segment's price behaviour — e.g. XLK for US technology, GLD for gold. The segment's overall Buy/Sell verdict is computed on the proxy ETF's chart.",
      deeper: "Proxies are chosen for liquidity and low tracking error against the segment's true composition. They're a shortcut: they don't replace analysing individual constituents, they just give you a single line to read the whole segment at a glance.",
    },
    "zh-CN": {
      label: "代理 ETF",
      what: "用一只代表性的 ETF 来体现整个板块的价格表现——例如 XLK 代表美国科技、GLD 代表黄金。板块的整体买卖判断即基于代理 ETF 的走势计算。",
      deeper: "代理 ETF 的选择基于流动性以及与板块真实构成之间较低的跟踪误差。它只是一条捷径：无法取代对个别成分股的分析，但可用一根线一眼把握整个板块。",
    },
  },
};

// ---------------------------------------------------------------------------
// Aliases — accept whatever spelling the caller passes.
// ---------------------------------------------------------------------------

const TERM_ALIASES: Readonly<Record<string, string>> = {
  // ---- Segments / heatmap vocabulary aliases ----
  // Accept the wording used inside the "Weight by" toggle labels, plus
  // common short-hands so a user typing "%change" or "market cap
  // weighting" still hits the right glossary entry.
  "% change": "Change",
  "%change": "Change",
  "price change": "Change",
  "daily change": "Change",
  "abs change": "Absolute Change",
  "absolute % change": "Absolute Change",
  "$ volume": "Dollar Volume",
  "turnover": "Dollar Volume",
  "share volume": "Volume (shares)",
  "shares volume": "Volume (shares)",
  "equal": "Equal Weight",
  "equal-weight": "Equal Weight",
  "equal weighting": "Equal Weight",
  "cap-weight": "Weighting",
  "market cap weight": "Weighting",
  "market cap weighting": "Weighting",
  "weight by": "Weighting",
  "weight-by": "Weighting",
  "constituent": "Constituents",
  "member": "Constituents",
  "members": "Constituents",
  "components": "Constituents",
  "industry": "Sector",
  "gics": "Sector",
  "theme": "Segment",
  "themes": "Segment",
  "sub-sector": "Segment",
  "proxy": "Proxy ETF",
  "tracker etf": "Proxy ETF",
  "sector etf": "Proxy ETF",
  "candle": "Candlestick",
  "candlesticks": "Candlestick",
  "moving average": "SMA",
  "sma20": "SMA",
  "sma 20": "SMA",
  "sma50": "SMA",
  "sma 50": "SMA",
  "sma200": "SMA",
  "sma 200": "SMA",
  "sma 20 / 50 / 200": "SMA",
  "bollinger": "Bollinger Bands",
  "bb": "Bollinger Bands",
  "bollinger band": "Bollinger Bands",
  "rsi(14)": "RSI",
  "rsi 14": "RSI",
  "relative strength index": "RSI",
  "macd (12, 26, 9)": "MACD",
  "moving average convergence divergence": "MACD",
  "trailing p/e": "P/E Ratio",
  "p/e": "P/E Ratio",
  "pe ratio": "P/E Ratio",
  "price / earnings": "P/E Ratio",
  "price/earnings": "P/E Ratio",
  "price/book": "P/B Ratio",
  "price / book": "P/B Ratio",
  "price to book": "P/B Ratio",
  "price/sales": "P/S Ratio",
  "price / sales": "P/S Ratio",
  "peg": "PEG Ratio",
  "ev/ebitda": "EV/EBITDA",
  "ev / ebitda": "EV/EBITDA",
  "market capitalization": "Market Cap",
  "market capitalisation": "Market Cap",
  "gross margins": "Gross Margin",
  "operating margins": "Operating Margin",
  "profit margins": "Profit Margin",
  "return on equity": "ROE",
  "return on assets": "ROA",
  "earnings per share": "EPS",
  "eps (ttm)": "EPS",
  "eps (forward)": "EPS",
  "eps ttm": "EPS",
  "trailing twelve months": "TTM",
  "year over year": "YoY",
  "year-over-year": "YoY",
  "debt/equity": "Debt / Equity",
  "d/e": "Debt / Equity",
  "fcf": "Free Cash Flow",
  "ocf": "Operating Cash Flow",
  "dividend yield": "Dividend Yield",
  "insider": "Insider",
  "insiders": "Insider",
  "insider transactions": "Insider",
  "institution": "Institutional Holder",
  "institutions": "Institutional Holder",
  "institutional": "Institutional Holder",
  "13f": "Form 13F",
  "13f filing": "Form 13F",
  "13f-hr": "13F-HR",
  "13f-hr/a": "13F-HR",
  "form 13f-hr": "13F-HR",
  "form 3/4/5": "Form 4",
  "non-derivative security": "Non-Derivative",
  "non derivative": "Non-Derivative",
  "reporting owner cik": "CIK",
  "cusip number": "Cusip",
  "central index key": "CIK",
  "accession number": "Accession",
  "stock act": "STOCK Act",
  "periodic transaction report": "PTR",
  "ptr filing": "PTR",
  "house clerk feed": "House Clerk",
  "impact score": "Impact",
  "cost basis / avg cost": "Cost Basis",
  "unrealised": "Unrealised P&L",
  "unrealized": "Unrealised P&L",
  "unrealized p&l": "Unrealised P&L",
  "realized": "Realised P&L",
  "realized p&l": "Realised P&L",
  "p&l": "Realised P&L",
  "long position": "Long",
  "short position": "Short",
  "bracket": "Bracket Order",
  "bracket order": "Bracket Order",
  "protective levels": "Bracket Order",
  "win rate": "Win Rate",
  "hit rate": "Win Rate",
  "avg win": "Avg Win",
  "average win": "Avg Win",
  "avg loss": "Avg Loss",
  "average loss": "Avg Loss",
  "payoff ratio": "Payoff Ratio",
  "win-loss ratio": "Payoff Ratio",
  "profit factor": "Payoff Ratio",
  "round trip": "Round Trip",
  "roundtrip": "Round Trip",
  "closed cycle": "Round Trip",
  "sma cross": "SMA Crossover",
  "sma-crossover": "SMA Crossover",
  "macd-cross": "MACD Cross",
  "rsi-reversion": "RSI Reversion",
  "bullish score": "Bullish",
  "bearish score": "Bearish",
  "52w high": "52-Week High",
  "52 week high": "52-Week High",
  "52w low": "52-Week Low",
  "52 week low": "52-Week Low",
  "annualized volatility": "Volatility",
  "annualised volatility": "Volatility",
  "period return": "Period Return",
  "returns distribution": "Daily Returns Distribution",
  "returns histogram": "Daily Returns Distribution",
  "daily returns": "Daily Returns Distribution",
  "6 signal resonance": "6-Signal Resonance",
  "six signal resonance": "6-Signal Resonance",
  "six-signal resonance": "6-Signal Resonance",
  "六指标共振": "6-Signal Resonance",
  "共振": "Resonance",
  "resonance strategy": "6-Signal Resonance",
  "bull-bear index": "BBI",
  "bbi index": "BBI",
  "多空指数": "BBI",
  "larry williams %r": "LWR",
  "williams %r": "LWR",
  "williams r": "LWR",
  "%r": "LWR",
  "威廉指标": "LWR",
  "momentum": "MTM",
  "动量": "MTM",
};

// ---------------------------------------------------------------------------
// Display labels — translations of the exact strings emitted by lib/ratios.ts
// and lib/insights.ts. Kept as a compact dictionary (not a full Hint) so the
// UI can localize the visible row label without having to touch the server
// build pipeline.
// ---------------------------------------------------------------------------

const RATIO_LABELS: Readonly<Record<string, Localized<string>>> = {
  // ---- Price & Volume ----
  "Last Close":              { en: "Last Close",              "zh-CN": "最新收盘价" },
  "Period Return":           { en: "Period Return",           "zh-CN": "期间回报" },
  "52W High":                { en: "52W High",                "zh-CN": "52 周高点" },
  "52W Low":                 { en: "52W Low",                 "zh-CN": "52 周低点" },
  "Annualized Volatility":   { en: "Annualized Volatility",   "zh-CN": "年化波动率" },
  "Avg Volume (20d)":        { en: "Avg Volume (20d)",        "zh-CN": "20 日均量" },
  "Last Volume":             { en: "Last Volume",             "zh-CN": "最新成交量" },
  History:                   { en: "History",                 "zh-CN": "历史数据" },

  // ---- Valuation ----
  "Market Cap":              { en: "Market Cap",              "zh-CN": "市值" },
  "Enterprise Value":        { en: "Enterprise Value",        "zh-CN": "企业价值" },
  "Trailing P/E":            { en: "Trailing P/E",            "zh-CN": "追溯市盈率" },
  "Forward P/E":             { en: "Forward P/E",             "zh-CN": "前瞻市盈率" },
  "PEG Ratio":               { en: "PEG Ratio",               "zh-CN": "PEG 比率" },
  "Price / Book":            { en: "Price / Book",            "zh-CN": "市净率（P/B）" },
  "Price / Sales (TTM)":     { en: "Price / Sales (TTM)",     "zh-CN": "市销率（P/S，TTM）" },
  "EV / EBITDA":             { en: "EV / EBITDA",             "zh-CN": "EV / EBITDA" },
  "EV / Revenue":            { en: "EV / Revenue",            "zh-CN": "EV / 营收" },

  // ---- Profitability ----
  "Gross Margins":           { en: "Gross Margins",           "zh-CN": "毛利率" },
  "Operating Margins":       { en: "Operating Margins",       "zh-CN": "营业利润率" },
  "Profit Margins":          { en: "Profit Margins",          "zh-CN": "净利率" },
  "EBITDA Margins":          { en: "EBITDA Margins",          "zh-CN": "EBITDA 利润率" },
  "Return on Assets":        { en: "Return on Assets",        "zh-CN": "资产收益率（ROA）" },
  "Return on Equity":        { en: "Return on Equity",        "zh-CN": "净资产收益率（ROE）" },

  // ---- Financial Health ----
  "Total Cash":              { en: "Total Cash",              "zh-CN": "现金总额" },
  "Total Debt":              { en: "Total Debt",              "zh-CN": "负债总额" },
  "Debt / Equity":           { en: "Debt / Equity",           "zh-CN": "负债 / 权益（D/E）" },
  "Current Ratio":           { en: "Current Ratio",           "zh-CN": "流动比率" },
  "Quick Ratio":             { en: "Quick Ratio",             "zh-CN": "速动比率" },
  "Free Cash Flow":          { en: "Free Cash Flow",          "zh-CN": "自由现金流" },
  "Operating Cash Flow":     { en: "Operating Cash Flow",     "zh-CN": "经营现金流" },

  // ---- Growth ----
  "Revenue (TTM)":           { en: "Revenue (TTM)",           "zh-CN": "营收（TTM）" },
  "Revenue / Share":         { en: "Revenue / Share",         "zh-CN": "每股营收" },
  "Revenue Growth (YoY)":    { en: "Revenue Growth (YoY)",    "zh-CN": "营收同比增长" },
  "Earnings Growth (YoY)":   { en: "Earnings Growth (YoY)",   "zh-CN": "盈利同比增长" },
  "EPS (TTM)":               { en: "EPS (TTM)",               "zh-CN": "每股收益（TTM）" },
  "EPS (Forward)":           { en: "EPS (Forward)",           "zh-CN": "每股收益（前瞻）" },

  // ---- Dividend ----
  "Dividend Rate":           { en: "Dividend Rate",           "zh-CN": "每股股息（年）" },
  "Dividend Yield":          { en: "Dividend Yield",          "zh-CN": "股息率" },
  "Payout Ratio":            { en: "Payout Ratio",            "zh-CN": "派息比率" },
  "5Y Avg Yield":            { en: "5Y Avg Yield",            "zh-CN": "5 年平均股息率" },
};

const GROUP_TITLES: Readonly<Record<string, Localized<string>>> = {
  "Price & Volume":     { en: "Price & Volume",     "zh-CN": "价格与成交量" },
  Valuation:            { en: "Valuation",          "zh-CN": "估值" },
  Profitability:        { en: "Profitability",      "zh-CN": "盈利能力" },
  "Financial Health":   { en: "Financial Health",   "zh-CN": "财务健康" },
  "Growth & Earnings":  { en: "Growth & Earnings",  "zh-CN": "成长与盈利" },
  Dividend:             { en: "Dividend",           "zh-CN": "股息" },
};

// ---------------------------------------------------------------------------
// Locale-aware accessors — every consumer passes the current locale in.
// A missing locale silently falls back to English so partial translations
// never crash the UI.
// ---------------------------------------------------------------------------

export function metricHint(label: string, locale: Locale = "en"): Hint | undefined {
  const entry = METRIC_HINTS[label];
  return entry ? pick(entry, locale) : undefined;
}

/**
 * Localize a metric row label emitted by `lib/ratios.ts`. Unknown labels
 * fall through unchanged so third-party additions render as-is.
 */
export function metricLabel(label: string, locale: Locale = "en"): string {
  const entry = RATIO_LABELS[label];
  return entry ? pick(entry, locale) : label;
}

/** Localize a MetricGroup.title. Unknown titles fall through unchanged. */
export function groupTitle(title: string, locale: Locale = "en"): string {
  const entry = GROUP_TITLES[title];
  return entry ? pick(entry, locale) : title;
}

export function signalHint(label: string, locale: Locale = "en"): Hint | undefined {
  const entry = SIGNAL_HINTS[label];
  return entry ? pick(entry, locale) : undefined;
}

export function groupIntro(title: string, locale: Locale = "en"): string {
  const entry = GROUP_INTROS[title];
  return entry ? pick(entry, locale) : "";
}

export function pageIntro(pageKey: string, locale: Locale = "en"): string {
  const entry = PAGE_INTROS[pageKey];
  return entry ? pick(entry, locale) : "";
}

/**
 * Look up a technical term by any reasonable spelling. Returns undefined
 * when the term isn't in our glossary (safe for the caller to render the
 * text plainly). The returned `TermDef.label` (if present) is the display
 * name in the requested locale — the canonical key is a stable English
 * identifier used only for lookups.
 */
export function termDef(term: string, locale: Locale = "en"): TermDef | undefined {
  const raw = term.trim();
  if (!raw) return undefined;

  const resolveKey = (): string | null => {
    if (TECHNICAL_TERMS[raw]) return raw;
    const lower = raw.toLowerCase();
    for (const key of Object.keys(TECHNICAL_TERMS)) {
      if (key.toLowerCase() === lower) return key;
    }
    const alias = TERM_ALIASES[lower];
    return alias && TECHNICAL_TERMS[alias] ? alias : null;
  };

  const key = resolveKey();
  if (!key) return undefined;
  return pick(TECHNICAL_TERMS[key], locale);
}

// Re-export the raw dictionaries so tests / tooling can enumerate them.
export {
  METRIC_HINTS,
  SIGNAL_HINTS,
  GROUP_INTROS,
  PAGE_INTROS,
  TECHNICAL_TERMS,
  RATIO_LABELS,
  GROUP_TITLES,
};
