/**
 * Central UI-string dictionary. Every visible label / button / heading /
 * error message that we want to bilingualize gets an entry here.
 *
 * Keys are dotted namespaces: `<page>.<region>.<slug>`. Missing zh-CN
 * values automatically fall back to English so partial translation is
 * always safe.
 *
 * Technical-term definitions live in `lib/knowledge.ts` instead — the
 * two datasets have different consumers (`<TermTip>` vs the `useT()` hook).
 */

import type { Locale } from "@/lib/state";

/**
 * Each entry maps a locale to its string. Missing locales fall through
 * to English (`en` is the source-of-truth).
 */
export interface Entry {
  en: string;
  "zh-CN"?: string;
}

export const DICT: Readonly<Record<string, Entry>> = {
  // -------- Brand --------
  "brand.name":        { en: "Stock Analysis",      "zh-CN": "股票分析" },
  "brand.subtitle":    { en: "Interactive Dashboard", "zh-CN": "交互式仪表板" },

  // -------- Sidebar sections --------
  "sidebar.view":            { en: "View",       "zh-CN": "视图" },
  "sidebar.appearance":      { en: "Appearance", "zh-CN": "外观" },
  "sidebar.experience":      { en: "Experience", "zh-CN": "经验" },
  "sidebar.language":        { en: "Language",   "zh-CN": "语言" },
  "sidebar.ticker":          { en: "Ticker",     "zh-CN": "股票代码" },
  "sidebar.portfolios":      { en: "Portfolios", "zh-CN": "投资组合" },
  "sidebar.market":          { en: "Market",     "zh-CN": "市场" },
  "sidebar.primaryNav":      { en: "Primary navigation",   "zh-CN": "主导航" },
  "sidebar.portfolioNav":    { en: "Portfolio presets",    "zh-CN": "投资组合预设" },
  "sidebar.toggleMenu":      { en: "Toggle menu",          "zh-CN": "切换菜单" },
  "sidebar.preferences":     { en: "Preferences",          "zh-CN": "偏好设置" },
  "sidebar.togglePreferences": { en: "Toggle preferences", "zh-CN": "切换偏好设置" },
  "sidebar.collapseSidebar": { en: "Collapse sidebar",     "zh-CN": "折叠侧边栏" },
  "sidebar.expandSidebar":   { en: "Expand sidebar",       "zh-CN": "展开侧边栏" },

  // -------- Nav labels --------
  "nav.overview":    { en: "Overview",              "zh-CN": "概览" },
  "nav.ratios":      { en: "Ratios",                "zh-CN": "财务比率" },
  "nav.charts":      { en: "Charts & Indicators",   "zh-CN": "图表与技术指标" },
  "nav.indicators":  { en: "Technical Indicators",  "zh-CN": "技术指标" },
  "nav.signal":      { en: "Technical Signal",     "zh-CN": "技术信号" },
  "nav.news":        { en: "News",                  "zh-CN": "新闻" },
  "nav.holders":     { en: "Holders",               "zh-CN": "持有者" },
  "nav.paper":       { en: "Paper Trading",         "zh-CN": "模拟交易" },
  "nav.myPortfolio": { en: "My Portfolio",          "zh-CN": "我的投资组合" },
  "nav.bot":         { en: "Alert Bot",             "zh-CN": "提醒机器人" },
  "nav.raw":         { en: "Raw Data",              "zh-CN": "原始数据" },
  "nav.market":      { en: "Market Mood",           "zh-CN": "市场情绪" },
  "nav.segments":    { en: "Segments",              "zh-CN": "板块分析" },

  "market.heading":     { en: "Market Mood",                                          "zh-CN": "市场情绪" },
  "market.subheading":  { en: "How the US market is feeling right now — updated every close.", "zh-CN": "美股当前的整体情绪——每次收盘后更新。" },

  // -------- Segments (market-segment analysis pages) --------
  "segments.heading":        { en: "Market Segment Analysis",
                               "zh-CN": "市场板块分析" },
  "segments.subheading":     { en: "Bull-vs-bear read on the themes that move the market — AI, semis, healthcare, energy, and more — plus the household names inside each bucket.",
                               "zh-CN": "AI、半导体、医疗、能源等主要板块的多空判读，以及每个板块内的代表性公司。" },
  "segments.loading":        { en: "Loading segments…", "zh-CN": "板块数据加载中…" },
  "segments.errorTag":       { en: "unavailable",       "zh-CN": "不可用" },
  "segments.price":          { en: "Price",             "zh-CN": "价格" },
  "segments.trackedBy":      { en: "Tracked by {ticker}",  "zh-CN": "以 {ticker} 追踪" },
  "segments.tickerCount":    { en: "{n} companies",     "zh-CN": "{n} 家公司" },

  "segments.stance.bullish": { en: "Bullish", "zh-CN": "看多" },
  "segments.stance.bearish": { en: "Bearish", "zh-CN": "看空" },
  "segments.stance.neutral": { en: "Neutral", "zh-CN": "中性" },

  // -- Stance interpretation tooltips ---------------------------------------
  // Some indices don't have a simple "up = bullish, down = bearish" reading
  // when viewed through an equity-portfolio lens. The stance chip's tooltip
  // uses these strings to explain why. `.title` is the tooltip heading; the
  // per-ticker slugs (vix / tnx / dxy / gold / crude / btc) carry the body.
  // `.default` is the fallback when we haven't hand-written a body for a
  // new inverted/mixed ticker yet.
  "segments.stanceMode.inverted.title":
    { en: "Read as equity-portfolio impact",
      "zh-CN": "以股票组合角度解读" },
  "segments.stanceMode.inverted.default":
    { en: "Chip is inverted from the raw price trend — rising values here typically pressure equities, and vice versa.",
      "zh-CN": "该标签相对于原始价格走势已经反转——此指标上行通常对股票市场构成压力，反之亦然。" },
  "segments.stanceMode.inverted.vix":
    { en: "VIX is the market's fear gauge. When VIX rises the chip flips to bearish because rising fear pressures stock prices, and when VIX falls the chip shows bullish (calm markets).",
      "zh-CN": "VIX 衡量市场恐慌情绪。VIX 上行时标签显示看空——恐慌上升对股价形成压力；VIX 下行时显示看多——市场趋于平静。" },
  "segments.stanceMode.inverted.tnx":
    { en: "The 10-year Treasury yield is the discount rate behind every valuation model. Rising yields (a technical uptrend on ^TNX) compress equity multiples — shown as bearish. Falling yields ease valuations — shown as bullish.",
      "zh-CN": "10 年期美债收益率是所有估值模型背后的贴现率。收益率上行（^TNX 技术性上涨）会压缩股票估值倍数——显示看空；收益率下行则支撑估值——显示看多。" },
  "segments.stanceMode.inverted.dxy":
    { en: "A rising US dollar is a headwind for commodities, emerging markets, and US multinationals with foreign earnings. The chip flips: an uptrend on DXY reads as bearish for a globally-exposed portfolio, a downtrend as bullish.",
      "zh-CN": "美元走强对大宗商品、新兴市场以及海外营收占比高的美国跨国公司构成阻力。因此对全球化投资组合来说，DXY 上行显示看空，下行显示看多。" },

  "segments.stanceMode.mixed.title":
    { en: "Direction alone doesn't say buy or sell",
      "zh-CN": "仅凭方向无法直接得出买卖" },
  "segments.stanceMode.mixed.default":
    { en: "Whether an uptrend here helps or hurts your portfolio depends on which sectors and factors you're exposed to. Treat the chip as a raw price signal, not a portfolio verdict.",
      "zh-CN": "此指标上行对你的组合是利是弊，取决于你实际持仓的板块与风险敞口。请把标签当作纯价格信号，而非组合层面的买卖建议。" },
  "segments.stanceMode.mixed.gold":
    { en: "Gold rises on fear, inflation, and dollar weakness — it can go up while stocks also go up (dollar down, cyclical bull) or fall (risk-off flight to safety). Read gold alongside the dollar and yields, not on its own.",
      "zh-CN": "黄金因避险、通胀预期或美元走弱而上涨，可能与股市同涨（美元走弱、周期性牛市），也可能在股市下跌时（避险资金流入）上涨。请与美元和收益率一起解读。" },
  "segments.stanceMode.mixed.crude":
    { en: "Rising crude helps energy stocks but hurts consumer staples, airlines, and any consumer-discretionary name with fuel or logistics exposure. The chip only says 'oil is going up' — the portfolio impact depends on your sector mix.",
      "zh-CN": "油价上涨利好能源股，但对必需消费、航空以及依赖燃料/物流的可选消费构成压力。该标签只表示「油价在上涨」——对组合的实际影响取决于你持仓的板块结构。" },
  "segments.stanceMode.mixed.btc":
    { en: "Bitcoin is a risk-on barometer with its own liquidity and adoption cycles. It sometimes tracks the Nasdaq closely and sometimes decouples. Read it as its own asset, not as an equity indicator.",
      "zh-CN": "比特币是风险偏好的晴雨表，但也有其独立的流动性与采纳周期。有时与纳斯达克同步，有时独立走出行情。请将其视为独立资产，而非股票市场的先行指标。" },

  "segments.indices.title":  { en: "Broad Indices", "zh-CN": "大盘指数" },
  "segments.indices.hint":   { en: "The macro backdrop — read this first.",
                               "zh-CN": "宏观大环境——请先看这里。" },
  "segments.indices.showAll": {
    en: "Show all ({n} more)",
    "zh-CN": "显示全部（还有 {n} 个）",
  },
  "segments.indices.showLess": {
    en: "Show less",
    "zh-CN": "收起",
  },

  "segments.grid.title":     { en: "Themes & Sectors", "zh-CN": "主题与板块" },
  "segments.grid.hint":      { en: "Each card is tracked by an ETF proxy; click through for constituents.",
                               "zh-CN": "每张卡片以 ETF 代理追踪；点击查看成分股。" },
  "segments.grid.count":     { en: "{n} tracked",       "zh-CN": "{n} 个板块" },

  // Sort dropdown for the Themes & Sectors grid.
  "segments.grid.sortLabel":         { en: "Sort by",       "zh-CN": "排序方式" },
  "segments.grid.sort.default":      { en: "Default",       "zh-CN": "默认" },
  "segments.grid.sort.nameAsc":      { en: "Name (A → Z)",  "zh-CN": "名称（A → Z）" },
  "segments.grid.sort.changeDesc":   { en: "Top gainers",   "zh-CN": "涨幅最大" },
  "segments.grid.sort.changeAsc":    { en: "Top losers",    "zh-CN": "跌幅最大" },
  "segments.grid.sort.sizeDesc":     { en: "Most companies", "zh-CN": "公司数最多" },
  "segments.grid.sort.sizeAsc":      { en: "Fewest companies", "zh-CN": "公司数最少" },

  "segments.mini.trend":     { en: "Trend", "zh-CN": "趋势" },
  "segments.mini.rsi":       { en: "RSI",   "zh-CN": "RSI" },
  "segments.mini.macd":      { en: "MACD",  "zh-CN": "MACD" },

  // Detail page
  "segments.detail.backToSegments": { en: "Back to segments", "zh-CN": "返回板块" },
  "segments.detail.overviewTitle":  { en: "Segment signal",   "zh-CN": "板块信号" },
  "segments.detail.overviewHint":   { en: "Technical read on the proxy ETF that tracks this theme.",
                                       "zh-CN": "追踪本板块的代理 ETF 的技术面判读。" },
  "segments.detail.trackedByFull":  { en: "Tracked by {ticker} — {name}",
                                       "zh-CN": "由 {ticker} 追踪——{name}" },
  "segments.detail.constituentsTitle": { en: "Companies in this segment",
                                          "zh-CN": "本板块的公司" },
  "segments.detail.constituentsHint":  { en: "Household-name leaders — not the full ETF holding list.",
                                          "zh-CN": "代表性龙头公司——并非 ETF 的完整持仓表。" },
  "segments.detail.emptyProxy":     { en: "The proxy ETF for this segment couldn't be loaded right now — try again in a minute.",
                                       "zh-CN": "当前无法加载该板块的代理 ETF——请稍后重试。" },

  "segments.tbl.ticker":     { en: "Ticker",         "zh-CN": "代码" },
  "segments.tbl.price":      { en: "Price",          "zh-CN": "价格" },
  "segments.tbl.change":     { en: "Change",         "zh-CN": "涨跌" },
  "segments.tbl.trend":      { en: "Trend",          "zh-CN": "趋势" },
  "segments.tbl.rsi":        { en: "RSI",            "zh-CN": "RSI" },
  "segments.tbl.macd":       { en: "MACD",           "zh-CN": "MACD" },
  "segments.tbl.stance":     { en: "Stance",         "zh-CN": "多空" },
  "segments.tbl.openStock":  { en: "Open stock analysis for {ticker}",
                               "zh-CN": "打开 {ticker} 的个股分析" },

  // -------- My Portfolio (user CSV upload) --------
  "myPortfolio.heading":     { en: "My Portfolio",
                               "zh-CN": "我的投资组合" },
  "myPortfolio.subheading":  { en: "Upload the CSV your broker/tracker exports and see every trade, watch and cost detail on-device — nothing leaves the browser.",
                               "zh-CN": "上传券商或投资组合软件导出的 CSV，即可在本地查看每一笔交易、关注与成本明细——数据不会离开浏览器。" },

  "myPortfolio.upload.title":         { en: "Import portfolio CSV",
                                        "zh-CN": "导入投资组合 CSV" },
  "myPortfolio.upload.subtitle":      { en: "MyStocksPortfolio-style export supported (any CSV with Symbol, Portfolio, Shares Owned, Cost Per Share, Type, Transaction Date columns).",
                                        "zh-CN": "支持 MyStocksPortfolio 格式（任意包含 Symbol、Portfolio、Shares Owned、Cost Per Share、Type、Transaction Date 等列的 CSV）。" },
  "myPortfolio.upload.dropHere":      { en: "Drop your CSV here",
                                        "zh-CN": "将 CSV 拖放到此处" },
  "myPortfolio.upload.helper":        { en: "or use the button below. Files are read in your browser and stored only on this device.",
                                        "zh-CN": "或点击下方按钮选择文件。文件将在浏览器内解析，仅保存在本设备上。" },
  "myPortfolio.upload.pickButton":    { en: "Choose CSV file",
                                        "zh-CN": "选择 CSV 文件" },
  "myPortfolio.upload.pickLabel":     { en: "Choose a CSV file",
                                        "zh-CN": "选择 CSV 文件" },
  "myPortfolio.upload.reading":       { en: "Reading…",
                                        "zh-CN": "读取中…" },
  "myPortfolio.upload.saveButton":    { en: "Save to my portfolio",
                                        "zh-CN": "保存到我的组合" },
  "myPortfolio.upload.mergeButton":   { en: "Merge ({n} new)",
                                        "zh-CN": "合并（{n} 条新记录）" },
  "myPortfolio.upload.mergeHint":     { en: "Adds only rows that aren't already stored — safe to run every export.",
                                        "zh-CN": "只添加尚未存储的行——每次导出都可以安全运行。" },
  "myPortfolio.upload.replaceButton": { en: "Replace all",
                                        "zh-CN": "全部替换" },
  "myPortfolio.upload.replaceHint":   { en: "Wipe all currently-stored rows and use this CSV as the sole source of truth.",
                                        "zh-CN": "清除当前所有存储的行，仅以此 CSV 为准。" },
  "myPortfolio.upload.confirmReplace":{ en: "Replace ALL currently-imported rows with this CSV? Existing rows not present in the file will be removed. This cannot be undone.",
                                        "zh-CN": "用此 CSV 替换当前所有已导入的行吗？文件中未包含的现有行将被移除。此操作无法撤销。" },
  "myPortfolio.upload.tooLarge":      { en: "That file is unusually large for a portfolio CSV — please pick one under 25 MB.",
                                        "zh-CN": "该文件对于投资组合 CSV 而言过大，请选择小于 25 MB 的文件。" },
  "myPortfolio.upload.readErrorTitle":{ en: "Couldn't read that file",
                                        "zh-CN": "无法读取该文件" },
  "myPortfolio.upload.previewTitle":  { en: "Preview",
                                        "zh-CN": "预览" },

  "myPortfolio.preview.total":        { en: "Rows",         "zh-CN": "行数"   },
  "myPortfolio.preview.buys":         { en: "Buys",         "zh-CN": "买入"   },
  "myPortfolio.preview.sells":        { en: "Sells",        "zh-CN": "卖出"   },
  "myPortfolio.preview.watches":      { en: "Watch",        "zh-CN": "关注"   },
  "myPortfolio.preview.portfolios":   { en: "Portfolios",   "zh-CN": "组合数" },
  "myPortfolio.preview.symbols":      { en: "Symbols",      "zh-CN": "代码数" },
  "myPortfolio.preview.dateRange":    { en: "Transactions between {from} and {to}.",
                                        "zh-CN": "交易日期范围：{from} 至 {to}。" },
  "myPortfolio.preview.portfoliosLabel": { en: "Portfolios found",
                                           "zh-CN": "发现的组合" },
  "myPortfolio.preview.symbolsLabel":    { en: "Symbols found",
                                           "zh-CN": "发现的代码" },
  "myPortfolio.preview.warningsTitle":   { en: "{n} row(s) needed a note",
                                           "zh-CN": "{n} 行需要注意" },
  "myPortfolio.preview.warningLine":     { en: "Line {line}: {message}",
                                           "zh-CN": "第 {line} 行：{message}" },
  "myPortfolio.preview.warningMore":     { en: "…and {n} more.",
                                           "zh-CN": "…还有 {n} 条。" },

  "myPortfolio.preview.alreadyStored":  { en: "Already stored",
                                           "zh-CN": "已存储" },
  "myPortfolio.preview.inFile":         { en: "In this file",
                                           "zh-CN": "本次文件" },
  "myPortfolio.preview.newRows":        { en: "New rows",
                                           "zh-CN": "新增" },
  "myPortfolio.preview.duplicateRows":  { en: "Already imported",
                                           "zh-CN": "已导入" },
  "myPortfolio.preview.upToDate":       { en: "Every row in this file is already in your portfolio — nothing new to add. Use \"Replace all\" only if you want to overwrite existing rows.",
                                           "zh-CN": "此文件中的每一行都已存在于您的组合中——无新记录可添加。仅当您希望覆盖现有行时才使用“全部替换”。" },

  "myPortfolio.imported.at":   { en: "Imported {when}", "zh-CN": "导入时间 {when}" },
  "myPortfolio.imported.rows": { en: "{n} rows",        "zh-CN": "{n} 行"        },
  "myPortfolio.imported.merged":     { en: "+{added} new / {skipped} duplicates skipped",
                                        "zh-CN": "新增 +{added} / 跳过重复 {skipped}" },
  "myPortfolio.imported.mergeHint":  { en: "Last import merged only new rows into the existing store.",
                                        "zh-CN": "上次导入仅将新行合并到现有数据中。" },
  "myPortfolio.imported.replaced":   { en: "Replaced all",
                                        "zh-CN": "已全部替换" },
  "myPortfolio.imported.replaceHint":{ en: "Last import overwrote all previously-stored rows.",
                                        "zh-CN": "上次导入已覆盖之前存储的全部行。" },
  "myPortfolio.clear":         { en: "Clear",           "zh-CN": "清除"          },
  "myPortfolio.confirmClear":  { en: "Remove all imported portfolio rows from this device? You can re-upload the CSV any time.",
                                 "zh-CN": "从本设备移除全部导入的组合数据？您可随时重新上传 CSV。" },

  "myPortfolio.filter.searchLabel":       { en: "Search by symbol or company name",
                                            "zh-CN": "按代码或公司名称搜索" },
  "myPortfolio.filter.searchPlaceholder": { en: "Search symbol or name…",
                                            "zh-CN": "搜索代码或名称…" },
  "myPortfolio.filter.portfolio":     { en: "Portfolio",     "zh-CN": "组合"     },
  "myPortfolio.filter.allPortfolios": { en: "All portfolios", "zh-CN": "全部组合" },
  "myPortfolio.filter.type":          { en: "Type",          "zh-CN": "类型"     },
  "myPortfolio.filter.typeAll":       { en: "All",           "zh-CN": "全部"     },
  "myPortfolio.filter.typeBuy":       { en: "Buys",          "zh-CN": "买入"     },
  "myPortfolio.filter.typeSell":      { en: "Sells",         "zh-CN": "卖出"     },
  "myPortfolio.filter.typeWatch":     { en: "Watch entries", "zh-CN": "关注条目" },
  "myPortfolio.filter.sort":          { en: "Sort",          "zh-CN": "排序"     },
  "myPortfolio.filter.sortNewest":    { en: "Newest first",  "zh-CN": "最新优先" },
  "myPortfolio.filter.sortOldest":    { en: "Oldest first",  "zh-CN": "最早优先" },
  "myPortfolio.filter.sortCsv":       { en: "Original CSV order",
                                        "zh-CN": "按 CSV 原始顺序"  },
  "myPortfolio.filter.reset":         { en: "Reset filters", "zh-CN": "重置筛选" },

  "myPortfolio.table.showing":     { en: "Showing {shown} of {total} rows",
                                      "zh-CN": "显示 {shown} / {total} 行" },
  "myPortfolio.table.emptyStore":  { en: "No portfolio imported yet.",
                                      "zh-CN": "尚未导入投资组合。" },
  "myPortfolio.table.emptyFilter": { en: "No rows match the current filters.",
                                      "zh-CN": "当前筛选条件下无匹配的行。" },
  "myPortfolio.table.buy":         { en: "Buy",   "zh-CN": "买入" },
  "myPortfolio.table.sell":        { en: "Sell",  "zh-CN": "卖出" },
  "myPortfolio.table.watch":       { en: "Watch", "zh-CN": "关注" },
  "myPortfolio.table.watchTooltip":{ en: "Portfolio-header row — the symbol is tracked but no trade is attached.",
                                      "zh-CN": "组合表头行——该代码被追踪但没有交易记录。" },

  "myPortfolio.col.symbol":     { en: "Symbol / Name", "zh-CN": "代码 / 名称" },
  "myPortfolio.col.portfolio":  { en: "Portfolio",     "zh-CN": "组合"        },
  "myPortfolio.col.exchange":   { en: "Exchange",      "zh-CN": "交易所"      },
  "myPortfolio.col.type":       { en: "Type",          "zh-CN": "类型"        },
  "myPortfolio.col.shares":     { en: "Shares",        "zh-CN": "股数"        },
  "myPortfolio.col.cost":       { en: "Cost / share",  "zh-CN": "每股成本"    },
  "myPortfolio.col.gross":      { en: "Gross value",   "zh-CN": "总金额"      },
  "myPortfolio.col.commission": { en: "Commission",    "zh-CN": "佣金"        },
  "myPortfolio.col.date":       { en: "Date / time",   "zh-CN": "日期 / 时间" },
  "myPortfolio.col.fx":         { en: "FX rate",       "zh-CN": "汇率"        },
  "myPortfolio.col.accounting": { en: "Accounting",    "zh-CN": "记账方法"    },

  // -- Tabs (Positions / Transactions) --------------------------------------
  "myPortfolio.tabs.label":         { en: "Portfolio views",
                                       "zh-CN": "组合视图" },
  "myPortfolio.tabs.positions":     { en: "Positions",
                                       "zh-CN": "持仓" },
  "myPortfolio.tabs.transactions":  { en: "Transactions",
                                       "zh-CN": "交易明细" },
  "myPortfolio.tabs.risks":         { en: "Risks",
                                       "zh-CN": "风险" },
  "myPortfolio.tabs.risksBadged":   { en: "Risks — {n} urgent",
                                       "zh-CN": "风险 — {n} 项紧急" },

  // -- Positions table (grouped-by-stock rollup) ----------------------------
  "myPortfolio.positions.title":       { en: "Positions",
                                          "zh-CN": "持仓明细" },
  "myPortfolio.positions.subtitle":    { en: "Grouped by stock. Live prices auto-refresh every 60 seconds while this tab is open.",
                                          "zh-CN": "按股票分组。此标签页打开时价格每 60 秒自动刷新。" },
  "myPortfolio.positions.updatedAt":   { en: "Updated {when}",
                                          "zh-CN": "更新于 {when}" },
  "myPortfolio.positions.rateLimited": { en: "Market data provider is throttling — some quotes may be stale. Existing figures are kept until the next refresh.",
                                          "zh-CN": "行情源目前限流，部分价格可能过期，下次刷新前保留现有数据。" },
  "myPortfolio.positions.statusLabel": { en: "Status filter",
                                          "zh-CN": "状态筛选" },
  "myPortfolio.positions.statusOpen":  { en: "Open positions",
                                          "zh-CN": "持仓中" },
  "myPortfolio.positions.statusClosed":{ en: "Closed only",
                                          "zh-CN": "已平仓" },
  "myPortfolio.positions.statusAll":   { en: "All positions",
                                          "zh-CN": "全部持仓" },
  "myPortfolio.positions.sortValue":   { en: "Sort by market value",
                                          "zh-CN": "按市值排序" },
  "myPortfolio.positions.sortPnl":     { en: "Sort by total P&L",
                                          "zh-CN": "按总盈亏排序" },
  "myPortfolio.positions.sortDay":     { en: "Sort by today's change",
                                          "zh-CN": "按当日涨跌排序" },
  "myPortfolio.positions.sortAlpha":   { en: "Sort A → Z",
                                          "zh-CN": "按代码 A → Z 排序" },
  "myPortfolio.positions.footnote":    { en: "Average cost uses the running weighted average; each sell realizes P&L against the current average. All figures are in each stock's own currency — no FX conversion.",
                                          "zh-CN": "平均成本使用加权移动平均；每次卖出按当时的平均成本计算已实现盈亏。所有数字均以各股票自身币种展示，未做汇率换算。" },

  // -- Winners & losers panel -----------------------------------------------
  "myPortfolio.winners.title": {
    en: "Winners & losers",
    "zh-CN": "涨跌榜",
  },
  "myPortfolio.winners.subtitle": {
    en: "Top {n} best and worst performing open positions by unrealized P&L. Closed positions are excluded — their P&L is history.",
    "zh-CN": "按未实现盈亏排出的前 {n} 名表现最好和最差的持仓。已平仓的头寸不计入 —— 其盈亏已成过去。",
  },
  "myPortfolio.winners.winners": {
    en: "Top winners",
    "zh-CN": "涨幅榜",
  },
  "myPortfolio.winners.losers": {
    en: "Top losers",
    "zh-CN": "跌幅榜",
  },
  "myPortfolio.winners.byPct": {
    en: "By %",
    "zh-CN": "按 %",
  },
  "myPortfolio.winners.byAbs": {
    en: "By $",
    "zh-CN": "按 $",
  },
  "myPortfolio.winners.sortByLabel": {
    en: "Ranking metric",
    "zh-CN": "排序指标",
  },
  "myPortfolio.winners.emptyWinners": {
    en: "No positions in the green yet.",
    "zh-CN": "暂时没有盈利的持仓。",
  },
  "myPortfolio.winners.emptyLosers": {
    en: "No positions in the red — nice.",
    "zh-CN": "没有亏损的持仓 —— 不错。",
  },

  // -- Position row cells ---------------------------------------------------
  "myPortfolio.pos.closed":       { en: "Closed",     "zh-CN": "已平仓" },
  "myPortfolio.pos.watch":        { en: "Watch",      "zh-CN": "关注" },
  "myPortfolio.pos.holding":      { en: "Shares held","zh-CN": "持仓股数" },
  "myPortfolio.pos.avgCost":      { en: "Avg cost {v}",
                                     "zh-CN": "均价 {v}" },
  "myPortfolio.pos.priceToday":   { en: "Price · today",
                                     "zh-CN": "价格 · 今日" },
  "myPortfolio.pos.marketValue":  { en: "Market value",
                                     "zh-CN": "市值" },
  "myPortfolio.pos.pnl":          { en: "Realized · Total",
                                     "zh-CN": "已实现 · 总盈亏" },
  "myPortfolio.pos.realizedTag":  { en: "realized",   "zh-CN": "已实现" },
  "myPortfolio.pos.totalTag":     { en: "Total {v}",  "zh-CN": "总计 {v}" },
  "myPortfolio.pos.tradeSummary": { en: "{buys} buys · {sells} sells",
                                     "zh-CN": "{buys} 次买入 · {sells} 次卖出" },
  "myPortfolio.pos.viewInsights": { en: "View technical insights for this ticker",
                                     "zh-CN": "查看该代码的技术分析" },

  // -- Drilldown (expanded row) ---------------------------------------------
  "myPortfolio.drill.bought":         { en: "Bought",
                                          "zh-CN": "累计买入" },
  "myPortfolio.drill.sold":           { en: "Sold",
                                          "zh-CN": "累计卖出" },
  "myPortfolio.drill.netHeld":        { en: "Currently held",
                                          "zh-CN": "当前持仓" },
  "myPortfolio.drill.totalInvested":  { en: "Cash out (buys)",
                                          "zh-CN": "累计买入金额" },
  "myPortfolio.drill.totalProceeds":  { en: "Cash in (sells)",
                                          "zh-CN": "累计卖出收入" },
  "myPortfolio.drill.commissions":    { en: "Commissions",
                                          "zh-CN": "累计佣金" },
  "myPortfolio.drill.buyCount":       { en: "{n} buy trades",
                                          "zh-CN": "{n} 次买入" },
  "myPortfolio.drill.sellCount":      { en: "{n} sell trades",
                                          "zh-CN": "{n} 次卖出" },
  "myPortfolio.drill.flat":           { en: "Position is flat",
                                          "zh-CN": "已平仓" },
  "myPortfolio.drill.dateRange":      { en: "{from} → {to}",
                                          "zh-CN": "{from} → {to}" },
  "myPortfolio.drill.noTrades":       { en: "No trades recorded for this position.",
                                          "zh-CN": "该持仓没有交易记录。" },
  "myPortfolio.drill.timelineTitle":  { en: "Trade timeline (newest first)",
                                          "zh-CN": "交易时间线（最新在前）" },
  "myPortfolio.drill.openInAnalysis": { en: "Open {symbol} in analysis",
                                          "zh-CN": "在分析页打开 {symbol}" },
  "myPortfolio.drill.timelineFootnote": { en: "Each row shows the running position AFTER that trade. Cash flow: negative = money out (buy), positive = money in (sell). Realized P&L on a sell = (sell price − running average cost) × shares sold − commission.",
                                          "zh-CN": "每一行显示该笔交易之后的持仓状态。现金流：负数 = 支出（买入），正数 = 收入（卖出）。卖出的已实现盈亏 =（卖出价 − 当前平均成本）× 卖出股数 − 佣金。" },

  // Drilldown column labels
  "myPortfolio.drill.col.date":         { en: "Date",           "zh-CN": "日期"       },
  "myPortfolio.drill.col.type":         { en: "Type",           "zh-CN": "类型"       },
  "myPortfolio.drill.col.shares":       { en: "Shares",         "zh-CN": "股数"       },
  "myPortfolio.drill.col.price":        { en: "Price",          "zh-CN": "价格"       },
  "myPortfolio.drill.col.commission":   { en: "Commission",     "zh-CN": "佣金"       },
  "myPortfolio.drill.col.cashFlow":     { en: "Cash flow",      "zh-CN": "现金流"     },
  "myPortfolio.drill.col.afterShares":  { en: "After · shares", "zh-CN": "之后 · 股数" },
  "myPortfolio.drill.col.afterAvg":     { en: "After · avg",    "zh-CN": "之后 · 均价" },
  "myPortfolio.drill.col.realized":     { en: "Realized P&L",   "zh-CN": "已实现盈亏" },
  "myPortfolio.drill.col.afterHint":    { en: "Running position after this trade was applied.",
                                          "zh-CN": "该交易执行之后的持仓状态。" },

  // -- Grand totals bar (per currency) --------------------------------------
  "myPortfolio.summary.positionsSummary": { en: "{open} open · {closed} closed",
                                             "zh-CN": "{open} 持仓 · {closed} 已平仓" },
  "myPortfolio.summary.marketValue":      { en: "Market value",
                                             "zh-CN": "市值" },
  "myPortfolio.summary.investedSub":      { en: "Invested {v}",
                                             "zh-CN": "投入 {v}" },
  "myPortfolio.summary.dayChange":        { en: "Today's change",
                                             "zh-CN": "今日盈亏" },
  "myPortfolio.summary.unrealized":       { en: "Unrealized P&L",
                                             "zh-CN": "未实现盈亏" },
  "myPortfolio.summary.realized":         { en: "Realized P&L",
                                             "zh-CN": "已实现盈亏" },
  "myPortfolio.summary.totalPnl":         { en: "Total P&L",
                                             "zh-CN": "总盈亏" },
  "myPortfolio.summary.commissions":      { en: "Commissions",
                                             "zh-CN": "佣金合计" },
  "myPortfolio.summary.commissionsSub":   { en: "Fees paid to date",
                                             "zh-CN": "累计已付费用" },

  // -------- Portfolio delisting / bankruptcy risk tab --------------------
  // Tab body + notification switch + per-signal detail rows. The
  // signal labels intentionally mirror the server-side notifier
  // labels in `lib/bot/notifier.ts` so users see consistent wording
  // between the app and their Telegram / push channels.
  "portfolioRisk.empty.noHoldings": {
    en: "Import a portfolio to see risk analysis for your holdings.",
    "zh-CN": "导入组合后即可查看持仓的风险分析。",
  },
  "portfolioRisk.loading": {
    en: "Analysing {n} holding(s) for delisting / bankruptcy risk…",
    "zh-CN": "正在分析 {n} 只持仓的退市 / 破产风险…",
  },
  "portfolioRisk.error": {
    en: "Couldn't run the risk check",
    "zh-CN": "无法完成风险分析",
  },
  "portfolioRisk.allClear.title": {
    en: "No urgent risks detected",
    "zh-CN": "未发现紧急风险",
  },
  "portfolioRisk.allClear.body": {
    en: "We checked all {n} of your holdings against news, price behaviour, and listing rules. No delisting or bankruptcy triggers fired.",
    "zh-CN": "已就 {n} 只持仓比对新闻、价格与上市规则，未触发退市或破产信号。",
  },
  "portfolioRisk.severity.critical": { en: "Critical", "zh-CN": "紧急" },
  "portfolioRisk.severity.high":     { en: "High",     "zh-CN": "高危" },
  "portfolioRisk.severity.medium":   { en: "Monitor",  "zh-CN": "关注" },

  // Section headers
  "portfolioRisk.section.needAction": {
    en: "Need action",
    "zh-CN": "需要采取行动",
  },
  "portfolioRisk.section.needAction.hint": {
    en: "These holdings show signals that historically precede a delisting or bankruptcy — review each one and decide whether to hold, hedge, or exit.",
    "zh-CN": "这些持仓出现了历史上常在退市或破产前出现的信号——请逐只判断继续持有、对冲还是卖出。",
  },
  "portfolioRisk.section.monitor": {
    en: "Monitor",
    "zh-CN": "关注中",
  },
  "portfolioRisk.section.monitor.hint": {
    en: "{n} name(s) worth watching — moderate drawdown or sub-$1 close, but no urgent trigger yet.",
    "zh-CN": "{n} 只需继续关注——回撤中等或单日跌破 $1，但暂无紧急触发。",
  },

  // Risk card body
  "portfolioRisk.card.signalCount": {
    en: "{n} signal(s) fired",
    "zh-CN": "触发 {n} 项信号",
  },
  "portfolioRisk.card.snapshot": {
    en: "Latest close {close} · 90-day drawdown {dd}",
    "zh-CN": "最新收盘 {close} · 90 日回撤 {dd}",
  },
  "portfolioRisk.card.openSignal": { en: "Open in Signal",  "zh-CN": "打开信号页" },
  "portfolioRisk.card.openNews":   { en: "Open in News",    "zh-CN": "打开新闻页" },
  "portfolioRisk.card.openChart":  { en: "Open in Charts",  "zh-CN": "打开图表页" },

  // Notification switch
  "portfolioRisk.notify.title": {
    en: "Push me when a holding turns risky",
    "zh-CN": "持仓出现风险时推送通知",
  },
  "portfolioRisk.notify.enabledBody": {
    en: "Monitoring {n} symbol(s). We'll ping you via Telegram and Web-Push whenever a new critical or high-severity signal appears.",
    "zh-CN": "已监控 {n} 只股票。当出现新的紧急或高危信号时，将通过 Telegram 与网页推送通知你。",
  },
  "portfolioRisk.notify.disabledBody": {
    en: "Enable to have the background worker watch your holdings every few minutes and send you a Telegram / push alert on delisting, bankruptcy, or price-collapse signals.",
    "zh-CN": "启用后，后台程序将每隔几分钟检查一次持仓，并在出现退市、破产或价格崩跌等信号时通过 Telegram / 推送通知你。",
  },
  "portfolioRisk.notify.on":         { en: "Notifications on",  "zh-CN": "已启用通知" },
  "portfolioRisk.notify.off":        { en: "Enable",            "zh-CN": "启用" },
  "portfolioRisk.notify.enabled":    { en: "Enabled — you'll be notified for critical & high risks.", "zh-CN": "已启用——将在出现紧急与高危风险时通知你。" },
  "portfolioRisk.notify.disabled":   { en: "Disabled — no more risk pushes.", "zh-CN": "已停用——不再推送风险提醒。" },
  "portfolioRisk.notify.synced":     { en: "Watchlist synced.", "zh-CN": "监控列表已同步。" },
  "portfolioRisk.notify.severity":   { en: "Notify me on:",     "zh-CN": "通知严重程度：" },
  "portfolioRisk.notify.severity.high":     { en: "Critical + High", "zh-CN": "紧急 + 高危" },
  "portfolioRisk.notify.severity.critical": { en: "Critical only",   "zh-CN": "仅紧急" },
  "portfolioRisk.notify.severityHelp": {
    en: "\"Critical\" covers bankruptcy filings, delisting notices, missing price data, and 80%+ collapse. \"High\" adds going-concern, SEC investigations, and sub-$1 for a month.",
    "zh-CN": "「紧急」包括破产申请、退市通知、无价格数据以及 80%+ 崩跌。「高危」在此基础上增加持续经营警告、SEC 调查以及连续跌破 $1。",
  },
  "portfolioRisk.notify.report": {
    en: "+{added} added · −{removed} removed · {total} total",
    "zh-CN": "+{added} 新增 · −{removed} 移除 · 共 {total}",
  },
  "portfolioRisk.notify.lastSync": {
    en: "Synced at {time}",
    "zh-CN": "同步于 {time}",
  },
  "portfolioRisk.notify.syncError": {
    en: "Couldn't sync",
    "zh-CN": "同步失败",
  },
  "portfolioRisk.notify.currentlyRisky": {
    en: "{n} of your holdings match the alert gate right now — you'll be pinged when a NEW signal appears.",
    "zh-CN": "当前有 {n} 只持仓已满足通知条件——出现新信号时会向你推送。",
  },

  // Footer
  "portfolioRisk.footer.checked": {
    en: "Checked {n} holding(s)",
    "zh-CN": "已检查 {n} 只持仓",
  },
  "portfolioRisk.footer.updated": {
    en: "Updated {time}",
    "zh-CN": "更新于 {time}",
  },
  "portfolioRisk.footer.fetchErrors": {
    en: "{n} ticker(s) failed to analyse",
    "zh-CN": "{n} 只未能完成分析",
  },
  "portfolioRisk.footer.skippedForex": {
    en: "{n} forex position(s) skipped — delisting / bankruptcy risk doesn't apply to currency pairs:",
    "zh-CN": "已跳过 {n} 只外汇持仓——退市 / 破产风险不适用于货币对：",
  },
  "portfolioRisk.footer.skippedShort": {
    en: "{n} skipped",
    "zh-CN": "跳过 {n} 项",
  },
  "portfolioRisk.signal.source":     { en: "Read source",  "zh-CN": "查看原文" },

  // Per-signal labels + details. Kept short — the full explanation
  // lives in the tab body below the label.
  "portfolioRisk.signal.news.bankruptcy.label":    { en: "Bankruptcy filing news",                "zh-CN": "破产申请相关新闻" },
  "portfolioRisk.signal.news.bankruptcy.detail":   { en: "Recent headline: \"{title}\". Chapter 7/11 filings usually wipe out common shareholders. Verify the article and consider exiting.", "zh-CN": "近期标题：「{title}」。第 7 章 / 第 11 章破产通常会使普通股股东权益归零，请核实新闻并考虑退出。" },
  "portfolioRisk.signal.news.delisting.label":     { en: "Delisting notice",                      "zh-CN": "退市相关公告" },
  "portfolioRisk.signal.news.delisting.detail":    { en: "Recent headline: \"{title}\". Once a stock delists to the OTC market, it typically loses 30–70% of remaining value overnight.", "zh-CN": "近期标题：「{title}」。股票被转至场外市场后，剩余市值通常一夜之间下跌 30%–70%。" },
  "portfolioRisk.signal.news.goingConcern.label":  { en: "Going-concern / audit warning",         "zh-CN": "持续经营 / 审计警告" },
  "portfolioRisk.signal.news.goingConcern.detail": { en: "Recent headline: \"{title}\". Auditors flagged doubts about the company's ability to survive the next 12 months.", "zh-CN": "近期标题：「{title}」。审计师对公司未来 12 个月的持续经营能力提出质疑。" },
  "portfolioRisk.signal.news.sec.label":           { en: "SEC action",                            "zh-CN": "SEC（美国证监会）行动" },
  "portfolioRisk.signal.news.sec.detail":          { en: "Recent headline: \"{title}\". Formal SEC investigations or charges often precede sharp price falls.", "zh-CN": "近期标题：「{title}」。SEC 正式调查或指控通常伴随股价大幅下跌。" },
  "portfolioRisk.signal.news.tradingHalt.label":   { en: "Trading halted",                        "zh-CN": "交易被停牌" },
  "portfolioRisk.signal.news.tradingHalt.detail":  { en: "Recent headline: \"{title}\". Trading halts are called when material news is pending — the reopen can gap sharply in either direction.", "zh-CN": "近期标题：「{title}」。停牌通常由重大待披露事项触发，复牌后可能出现较大跳空。" },
  "portfolioRisk.signal.data.noBars.label":        { en: "No price data available",               "zh-CN": "无可用价格数据" },
  "portfolioRisk.signal.data.noBars.detail":       { en: "Yahoo Finance returned zero bars for this ticker. That usually means the symbol has been delisted or renamed — verify manually.", "zh-CN": "Yahoo Finance 未返回任何 K 线，通常意味着代码已退市或被更名，请人工核实。" },
  "portfolioRisk.signal.bars.stale.label":         { en: "Price data is stale",                   "zh-CN": "价格数据过期" },
  "portfolioRisk.signal.bars.stale.detail":        { en: "Latest bar is {days} day(s) old ({date}). Trading may be halted or the ticker may have been delisted.", "zh-CN": "最新 K 线已 {days} 天未更新（{date}）。可能正在停牌或已退市。" },
  "portfolioRisk.signal.price.collapse90d.label":  { en: "Price collapse (90 days)",              "zh-CN": "90 日价格崩跌" },
  "portfolioRisk.signal.price.collapse90d.detail": { en: "Down {pct}% from the 90-day peak, now at {price}. Combined with penny-stock territory, this pattern often precedes a listing violation.", "zh-CN": "自 90 日高点下跌 {pct}%，现价 {price}。若已进入低价股区间，通常预示接下来的上市合规问题。" },
  "portfolioRisk.signal.price.drawdown60d.label":  { en: "Severe drawdown",                       "zh-CN": "严重回撤" },
  "portfolioRisk.signal.price.drawdown60d.detail": { en: "Down {pct}% from the 90-day peak — reassess the thesis and position size.", "zh-CN": "自 90 日高点下跌 {pct}%，请重新评估投资逻辑与仓位。" },
  "portfolioRisk.signal.price.drawdown40d.label":  { en: "Elevated drawdown",                     "zh-CN": "回撤偏大" },
  "portfolioRisk.signal.price.drawdown40d.detail": { en: "Down {pct}% from the 90-day peak. Not urgent, but keep monitoring.", "zh-CN": "自 90 日高点下跌 {pct}%，非紧急，但请持续关注。" },
  "portfolioRisk.signal.price.subOneExtended.label":{ en: "Sub-$1 for extended period",           "zh-CN": "长期低于 $1" },
  "portfolioRisk.signal.price.subOneExtended.detail":{ en: "Close was below $1 on {count} of the last {total} sessions — NYSE and NASDAQ both trigger a delisting notice at 30 consecutive trading days below $1.", "zh-CN": "近 {total} 个交易日中有 {count} 天收盘价低于 $1。NYSE 与 NASDAQ 均会在连续 30 个交易日低于 $1 时发出退市通知。" },
  "portfolioRisk.signal.price.subOne.label":       { en: "Sub-$1 close",                          "zh-CN": "收盘价低于 $1" },
  "portfolioRisk.signal.price.subOne.detail":      { en: "Latest close is {price}. Exchange minimum-price rules kick in if this persists for 30 sessions.", "zh-CN": "最新收盘价 {price}。若连续 30 个交易日低于 $1，将触发交易所最低价规则。" },
  "portfolioRisk.signal.volume.collapse.label":    { en: "Volume collapse",                       "zh-CN": "成交量崩塌" },
  "portfolioRisk.signal.volume.collapse.detail":   { en: "5-day average volume is under 20% of the 60-day average — buyers have walked, and exits at a fair price get much harder.", "zh-CN": "近 5 日平均成交量不足 60 日均量的 20%——买盘已明显撤离，按合理价格卖出将变得困难。" },

  // Constituent-table pagination
  "segments.tbl.pager.showing":  { en: "Showing {start}–{end} of {total}",
                                     "zh-CN": "显示第 {start}–{end} 项，共 {total} 项" },
  "segments.tbl.pager.pageSize": { en: "Rows",         "zh-CN": "每页" },
  "segments.tbl.pager.pageOf":   { en: "{page} / {total}",
                                     "zh-CN": "{page} / {total}" },
  "segments.tbl.pager.prev":     { en: "Previous page", "zh-CN": "上一页" },
  "segments.tbl.pager.next":     { en: "Next page",     "zh-CN": "下一页" },

  // Heatmap (segments overview + constituent drilldown)
  "segments.heatmap.title": { en: "Segment heatmap",
                               "zh-CN": "板块热力图" },
  "segments.heatmap.hint":  { en: "Box size = how you weight the theme; colour = today's move.",
                               "zh-CN": "方块大小 = 你选择的权重指标；颜色 = 今日涨跌。" },
  "segments.heatmap.weightLabel":     { en: "Weight by",      "zh-CN": "权重指标" },
  "segments.heatmap.weight.companies":   { en: "Companies",   "zh-CN": "公司数" },
  "segments.heatmap.weight.volume":      { en: "Volume ($)",  "zh-CN": "成交额" },
  "segments.heatmap.weight.absChange":   { en: "|Change|",    "zh-CN": "|涨跌|" },
  "segments.heatmap.weight.marketCap":   { en: "Market cap",  "zh-CN": "市值" },
  "segments.heatmap.weight.dollarVolume":{ en: "Dollar volume","zh-CN": "美元成交额" },
  "segments.heatmap.weight.volumeShares":{ en: "Volume (shares)","zh-CN": "成交量（股）" },
  "segments.heatmap.weight.equal":       { en: "Equal",       "zh-CN": "等权" },

  // Descriptions surfaced in the heatmap legend tooltip / italic hint —
  // plain-English "why this tile is bigger" explanations for beginners.
  "segments.heatmap.weight.companies.desc": {
    en: "Bigger tile = theme covers more listed companies.",
    "zh-CN": "方块越大 = 该板块下上市公司越多。",
  },
  "segments.heatmap.weight.volume.desc": {
    en: "Bigger tile = more money changed hands today (price × shares traded).",
    "zh-CN": "方块越大 = 今日交易金额越多（价格 × 成交量）。",
  },
  "segments.heatmap.weight.absChange.desc": {
    en: "Bigger tile = larger move today, whether up or down.",
    "zh-CN": "方块越大 = 今日涨跌幅越大（不区分方向）。",
  },
  "segments.heatmap.weight.marketCap.desc": {
    en: "Bigger tile = bigger company by market value (shares × price).",
    "zh-CN": "方块越大 = 公司市值越大（股本 × 股价）。",
  },
  "segments.heatmap.weight.dollarVolume.desc": {
    en: "Bigger tile = more dollars traded today (price × shares).",
    "zh-CN": "方块越大 = 今日成交金额越大（价格 × 成交量）。",
  },
  "segments.heatmap.weight.volumeShares.desc": {
    en: "Bigger tile = more shares traded today (regardless of price).",
    "zh-CN": "方块越大 = 今日成交股数越多（不考虑价格）。",
  },
  "segments.heatmap.weight.equal.desc": {
    en: "Every tile is the same size — colour is the only signal.",
    "zh-CN": "所有方块尺寸相同 —— 只看颜色。",
  },

  // Heatmap legend tooltip
  "heatmap.legend.aria":          { en: "How to read this heatmap",
                                     "zh-CN": "如何读懂这张热力图" },
  "heatmap.legend.title":         { en: "How to read this heatmap",
                                     "zh-CN": "如何读懂这张热力图" },
  "heatmap.legend.sizeHeading":   { en: "Size — how big each box is",
                                     "zh-CN": "大小 —— 方块面积代表什么" },
  "heatmap.legend.sizeIntro": {
    en: "The current selection is shown in bold. Switch the toggle to change what \"bigger\" means.",
    "zh-CN": "加粗项为当前选中；切换按钮可改变「更大」的含义。",
  },
  "heatmap.legend.colourHeading": { en: "Colour — today's price move",
                                     "zh-CN": "颜色 —— 今日涨跌" },
  "heatmap.legend.colourIntro": {
    en: "Green = up, red = down, grey = flat. Deeper tint = bigger daily % change.",
    "zh-CN": "绿色代表上涨，红色代表下跌，灰色代表持平。颜色越深 = 今日涨跌幅越大。",
  },
  "heatmap.legend.colourNote": {
    en: "Grey with no number means we don't have a live quote right now (rate-limited or unavailable), not a flat day.",
    "zh-CN": "灰色且无数值 = 暂无实时报价（受限或数据缺失），并非当天持平。",
  },

  // Constituents view toggle (heatmap / table)
  "segments.detail.view.label":   { en: "View",       "zh-CN": "视图" },
  "segments.detail.view.heatmap": { en: "Heatmap",    "zh-CN": "热力图" },
  "segments.detail.view.table":   { en: "Table",      "zh-CN": "表格" },

  "common.refresh":          { en: "Refresh", "zh-CN": "刷新" },

  // -------- Mode / experience / theme / locale toggles --------
  "mode.stock":       { en: "Stock",     "zh-CN": "个股" },
  "mode.portfolio":   { en: "Portfolio", "zh-CN": "组合" },
  "mode.ariaLabel":   { en: "Sidebar view", "zh-CN": "侧边栏视图" },

  "level.beginner":   { en: "Beginner", "zh-CN": "入门" },
  "level.advanced":   { en: "Advanced", "zh-CN": "高级" },
  "level.ariaLabel":  { en: "Experience level", "zh-CN": "经验等级" },

  "theme.light":      { en: "Light",  "zh-CN": "浅色" },
  "theme.dark":       { en: "Dark",   "zh-CN": "深色" },
  "theme.ariaLabel":  { en: "Theme",  "zh-CN": "主题" },

  "locale.en":        { en: "English",  "zh-CN": "English" },
  "locale.zh-CN":     { en: "中文",     "zh-CN": "中文" },
  "locale.ariaLabel": { en: "Language", "zh-CN": "语言" },

  // -------- Ticker picker --------
  "ticker.header":       { en: "Ticker",         "zh-CN": "股票代码" },
  "ticker.placeholder":  { en: "e.g. AAPL",      "zh-CN": "例如 AAPL" },
  "ticker.watchlist":    { en: "Watchlist",      "zh-CN": "关注列表" },
  "ticker.addToList":    { en: "Add to watchlist", "zh-CN": "添加到关注列表" },
  "ticker.removeFromList": { en: "Remove from watchlist", "zh-CN": "从关注列表移除" },
  "ticker.offList":      { en: "{ticker} — not in watchlist", "zh-CN": "{ticker} — 未加入关注" },
  "ticker.periodLabel":  { en: "Period",         "zh-CN": "时间范围" },
  "ticker.intervalLabel":{ en: "Interval",       "zh-CN": "间隔" },

  // -------- Common actions / states --------
  "common.retry":        { en: "Retry",            "zh-CN": "重试" },
  "common.cancel":       { en: "Cancel",           "zh-CN": "取消" },
  "common.add":          { en: "Add",              "zh-CN": "添加" },
  "common.adding":       { en: "Adding…",          "zh-CN": "正在添加…" },
  "common.remove":       { en: "Remove",           "zh-CN": "移除" },
  "common.reset":        { en: "Reset",            "zh-CN": "重置" },
  "common.save":         { en: "Save",             "zh-CN": "保存" },
  "common.close":        { en: "Close",            "zh-CN": "关闭" },
  "common.done":         { en: "Done.",            "zh-CN": "完成。" },
  "common.change":       { en: "Change",           "zh-CN": "更改" },
  "common.search":       { en: "Search",           "zh-CN": "搜索" },
  "common.clearSearch":  { en: "Clear search",     "zh-CN": "清除搜索" },
  "common.loading":      { en: "Loading…",         "zh-CN": "加载中…" },
  "common.noData":       { en: "No data",          "zh-CN": "无数据" },
  "common.rateLimited":  { en: "Rate limited by upstream provider. Please wait a moment and retry.", "zh-CN": "上游数据提供方触发速率限制。请稍候再试。" },
  "error.title":         { en: "Something went wrong", "zh-CN": "发生错误" },
  "rate.title":          { en: "Yahoo Finance is rate-limiting us", "zh-CN": "Yahoo Finance 正在限速" },
  "rate.body":           { en: "We've cached the last successful pull. Try again in a minute or two — Yahoo occasionally throttles high-frequency callers.", "zh-CN": "我们已缓存上一次成功的数据。请一两分钟后重试——Yahoo 偶尔会限制高频调用。" },
  "common.source":       { en: "Source",           "zh-CN": "数据来源" },
  "common.fetchedAt":    { en: "Fetched {time}.",  "zh-CN": "获取于 {time}。" },
  "common.tryAgain":     { en: "Try again in a minute.", "zh-CN": "请稍后再试。" },
  "common.filed":        { en: "filed {when}",     "zh-CN": "{when} 提交" },

  "common.dash":         { en: "—", "zh-CN": "—" },

  // -------- Auto-detected/loading labels per page --------
  "loading.marketData":      { en: "Loading market data…",     "zh-CN": "正在加载市场数据…" },
  "loading.chart":           { en: "Loading chart engine…",    "zh-CN": "正在加载图表引擎…" },
  "loading.ohlcv":           { en: "Loading OHLCV…",           "zh-CN": "正在加载 K 线数据…" },
  "loading.indicators":      { en: "Computing indicators…",    "zh-CN": "正在计算指标…" },
  "loading.rsi":             { en: "Loading RSI…",             "zh-CN": "正在加载 RSI…" },
  "loading.macd":            { en: "Loading MACD…",            "zh-CN": "正在加载 MACD…" },
  "loading.fundamentals":    { en: "Crunching fundamentals…",  "zh-CN": "正在分析基本面…" },
  "loading.headlines":       { en: "Fetching headlines…",      "zh-CN": "正在获取新闻…" },
  "loading.ownership":       { en: "Loading ownership data…",  "zh-CN": "正在加载持仓数据…" },
  "loading.portfolio":       { en: "Loading portfolio…",       "zh-CN": "正在加载投资组合…" },
  "loading.presetList":      { en: "Loading preset list…",     "zh-CN": "正在加载预设列表…" },
  "loading.botStatus":       { en: "Loading bot status…",      "zh-CN": "正在加载机器人状态…" },
  "loading.personFilings":   { en: "Loading SEC filings for {name}…", "zh-CN": "正在加载 {name} 的 SEC 文件…" },
  "loading.politicianFilings":{ en: "Loading filings for {name}…", "zh-CN": "正在加载 {name} 的文件…" },
  "loading.fund13F":         { en: "Loading 13F for {firm}…",   "zh-CN": "正在加载 {firm} 的 13F 文件…" },

  // -------- Overview page --------
  "overview.title":              { en: "Overview",         "zh-CN": "概览" },
  "overview.verdict.label":      { en: "Overall verdict",  "zh-CN": "综合评价" },
  "overview.score":              { en: "Score",            "zh-CN": "得分" },
  "overview.latestSignals":      { en: "Latest signals",   "zh-CN": "最新信号" },
  "overview.asOf":               { en: "as of {time}",     "zh-CN": "截至 {time}" },
  "overview.marketMood":         { en: "Market mood",      "zh-CN": "市场情绪" },
  "overview.snapshot":           { en: "Snapshot",         "zh-CN": "快照" },
  "overview.kpi.lastClose":      { en: "Last Close",       "zh-CN": "最新收盘" },
  "overview.kpi.bars":           { en: "Bars",             "zh-CN": "K 线数量" },
  "overview.kpi.positive":       { en: "Positive signals", "zh-CN": "正面信号" },
  "overview.kpi.concerns":       { en: "Concerns",         "zh-CN": "关注点" },
  "overview.kpi.positiveSub":    { en: "healthy indicators", "zh-CN": "健康指标" },
  "overview.kpi.concernsSub":    { en: "warning indicators", "zh-CN": "警示指标" },
  "overview.positivesTitle":     { en: "Positives ({n})",  "zh-CN": "利好 ({n})" },
  "overview.concernsTitle":      { en: "Concerns ({n})",   "zh-CN": "关注 ({n})" },
  "overview.positivesEmpty":     { en: "Nothing stood out as positive.", "zh-CN": "没有明显的利好因素。" },
  "overview.concernsEmpty":      { en: "No red flags flagged.", "zh-CN": "没有发现警示信号。" },
  "overview.disclaimer":         {
    en: "Overall score is a rule-based aggregate over valuation, profitability, health, growth, dividends, and technicals — not a trading recommendation. Weights: profitability 25%, valuation 20%, health 20%, growth 15%, technicals 10%, momentum 5%, dividend 5%. Yield above 2% is a positive weight; yield above 6% is treated as a warning. Assumes only the fundamentals surfaced by Yahoo Finance.",
    "zh-CN": "综合得分是对估值、盈利能力、财务健康、成长性、股息和技术面的规则化加权聚合——并非交易建议。权重：盈利 25%、估值 20%、健康 20%、成长 15%、技术 10%、动量 5%、股息 5%。股息率高于 2% 计正面权重，高于 6% 视为警示。数据基于 Yahoo Finance 披露的基本面。",
  },

  // -------- Overview: signal tiles --------
  "overview.signal.trend":     { en: "Trend",     "zh-CN": "趋势" },
  "overview.signal.rsi14":     { en: "RSI(14)",   "zh-CN": "RSI(14)" },
  "overview.signal.macd":      { en: "MACD",      "zh-CN": "MACD" },
  "overview.signal.bollinger": { en: "Bollinger", "zh-CN": "布林带" },

  // -------- Overview: verdict labels (VERDICT_LADDER in lib/insights.ts) --------
  "verdict.strong":     { en: "Strong profile",     "zh-CN": "整体强势" },
  "verdict.attractive": { en: "Attractive profile", "zh-CN": "颇具吸引力" },
  "verdict.mixed":      { en: "Mixed signals",      "zh-CN": "信号混杂" },
  "verdict.cautious":   { en: "Cautious profile",   "zh-CN": "需谨慎观察" },
  "verdict.concerning": { en: "Concerning profile", "zh-CN": "存在警示信号" },

  // -------- Insight: category names (lowercase, used in conclusion sentence) --------
  "insight.cat.Valuation":         { en: "valuation",        "zh-CN": "估值" },
  "insight.cat.Profitability":     { en: "profitability",    "zh-CN": "盈利能力" },
  "insight.cat.Financial Health":  { en: "financial health", "zh-CN": "财务健康" },
  "insight.cat.Growth":            { en: "growth",           "zh-CN": "成长性" },
  "insight.cat.Technical":         { en: "technicals",       "zh-CN": "技术面" },
  "insight.cat.Momentum":          { en: "momentum",         "zh-CN": "动量" },
  "insight.cat.Dividend":          { en: "dividend",         "zh-CN": "股息" },

  // -------- Insight: label templates (short chips shown on positives / concerns) --------
  "insight.label.pe":              { en: "P/E {value}",              "zh-CN": "P/E {value}" },
  "insight.label.peg":             { en: "PEG {value}",              "zh-CN": "PEG {value}" },
  "insight.label.pb":              { en: "P/B {value}",              "zh-CN": "P/B {value}" },
  "insight.label.evEbitda":        { en: "EV/EBITDA {value}",        "zh-CN": "EV/EBITDA {value}" },
  "insight.label.roe":             { en: "ROE {value}%",             "zh-CN": "ROE {value}%" },
  "insight.label.roa":             { en: "ROA {value}%",             "zh-CN": "ROA {value}%" },
  "insight.label.opMargin":        { en: "Op. margin {value}%",      "zh-CN": "营业利润率 {value}%" },
  "insight.label.profitMargin":    { en: "Profit margin {value}%",   "zh-CN": "净利率 {value}%" },
  "insight.label.currentRatio":    { en: "Current ratio {value}",    "zh-CN": "流动比率 {value}" },
  "insight.label.de":              { en: "D/E {value}",              "zh-CN": "负债/权益 {value}" },
  "insight.label.fcfPositive":     { en: "FCF positive",             "zh-CN": "自由现金流为正" },
  "insight.label.fcfNegative":     { en: "FCF negative",             "zh-CN": "自由现金流为负" },
  "insight.label.revenueUp":       { en: "Revenue +{value}%",        "zh-CN": "营收 +{value}%" },
  "insight.label.revenueDown":     { en: "Revenue {value}%",         "zh-CN": "营收 {value}%" },
  "insight.label.earningsUp":      { en: "Earnings +{value}%",       "zh-CN": "盈利 +{value}%" },
  "insight.label.earningsDown":    { en: "Earnings {value}%",        "zh-CN": "盈利 {value}%" },
  "insight.label.yield":           { en: "Yield {value}%",           "zh-CN": "股息率 {value}%" },
  "insight.label.payout":          { en: "Payout {value}%",          "zh-CN": "派息比率 {value}%" },
  "insight.label.uptrend":         { en: "Uptrend regime",           "zh-CN": "上升趋势" },
  "insight.label.downtrend":       { en: "Downtrend regime",         "zh-CN": "下降趋势" },
  "insight.label.rsiOverbought":   { en: "Overbought ({number})",    "zh-CN": "超买 ({number})" },
  "insight.label.rsiOversold":     { en: "Oversold ({number})",      "zh-CN": "超卖 ({number})" },
  "insight.label.macdBullish":     { en: "MACD bullish",             "zh-CN": "MACD 多头" },
  "insight.label.macdBearish":     { en: "MACD bearish",             "zh-CN": "MACD 空头" },
  "insight.label.bbAboveUpper":    { en: "Above upper band",         "zh-CN": "价格突破上轨" },
  "insight.label.bbBelowLower":    { en: "Below lower band",         "zh-CN": "价格跌破下轨" },
  "insight.label.r3mUp":           { en: "3M return +{value}%",      "zh-CN": "3 个月回报 +{value}%" },
  "insight.label.r3mDown":         { en: "3M return {value}%",       "zh-CN": "3 个月回报 {value}%" },
  "insight.label.r1yUp":           { en: "1Y return +{value}%",      "zh-CN": "1 年回报 +{value}%" },
  "insight.label.r1yDown":         { en: "1Y return {value}%",       "zh-CN": "1 年回报 {value}%" },
  "insight.label.annVolHigh":      { en: "Ann. vol. {value}%",       "zh-CN": "年化波动 {value}%" },

  // -------- Insight: detail sentences --------
  "insight.detail.pe.negative":          { en: "Negative earnings — the company is unprofitable on a trailing basis.", "zh-CN": "盈利为负——公司在追溯口径下处于亏损状态。" },
  "insight.detail.pe.cheap":             { en: "Trailing P/E below 15 suggests the stock is inexpensive relative to earnings.", "zh-CN": "追溯 P/E 低于 15，相对于盈利股价并不贵。" },
  "insight.detail.pe.rich":              { en: "Trailing P/E above 30 indicates a rich valuation — growth must sustain.", "zh-CN": "追溯 P/E 高于 30，估值偏高——需要成长持续兑现。" },
  "insight.detail.pe.typical":           { en: "Trailing P/E in the typical 15-30 range.", "zh-CN": "追溯 P/E 处于 15-30 的常见区间。" },
  "insight.detail.peg.low":              { en: "PEG below 1 — earnings growth is not yet reflected in the price.", "zh-CN": "PEG 低于 1——成长尚未被股价完全定价。" },
  "insight.detail.peg.high":             { en: "PEG above 2 — the price already anticipates strong earnings growth.", "zh-CN": "PEG 高于 2——股价已提前反映强劲的盈利成长预期。" },
  "insight.detail.pb.low":               { en: "Trading below book value — often a value signal (or a warning sign; check assets).", "zh-CN": "股价低于账面价值——常是价值信号（也可能是警讯，需核查资产质量）。" },
  "insight.detail.pb.high":              { en: "P/B above 5 — either asset-light or overpriced relative to equity.", "zh-CN": "P/B 高于 5——公司或为轻资产模式，或相对权益溢价过高。" },
  "insight.detail.evEbitda.low":         { en: "EV/EBITDA under 10 is typically viewed as attractively valued.", "zh-CN": "EV/EBITDA 低于 10 通常被视为估值具吸引力。" },
  "insight.detail.evEbitda.high":        { en: "EV/EBITDA above 20 signals a premium multiple — sensitive to earnings shocks.", "zh-CN": "EV/EBITDA 高于 20 属高溢价——对盈利冲击尤其敏感。" },
  "insight.detail.roe.high":             { en: "Return on Equity above 15% — the company earns strong returns on shareholder capital.", "zh-CN": "净资产收益率高于 15%——公司为股东资本创造出色回报。" },
  "insight.detail.roe.low":              { en: "Return on Equity below 5% — capital is not being deployed productively.", "zh-CN": "净资产收益率低于 5%——资本未被有效运用。" },
  "insight.detail.roa.high":             { en: "Return on Assets above 7% — efficient use of the balance sheet.", "zh-CN": "资产收益率高于 7%——资产运用效率高。" },
  "insight.detail.roa.low":              { en: "Return on Assets below 2% — the business is not generating much from its assets.", "zh-CN": "资产收益率低于 2%——公司资产产生的利润有限。" },
  "insight.detail.opMargin.high":        { en: "Operating margin above 20% points to pricing power or scale.", "zh-CN": "营业利润率高于 20%——具备定价力或规模优势。" },
  "insight.detail.opMargin.low":         { en: "Operating margin below 5% — thin operating profit cushion.", "zh-CN": "营业利润率低于 5%——经营利润缓冲空间较薄。" },
  "insight.detail.profitMargin.high":    { en: "Net profit margin above 15% converts a large fraction of revenue to shareholders.", "zh-CN": "净利率高于 15%——将大部分营收转化为股东利润。" },
  "insight.detail.profitMargin.negative":{ en: "Negative net margin — the company is currently loss-making.", "zh-CN": "净利率为负——公司当前处于亏损状态。" },
  "insight.detail.currentRatio.high":    { en: "Current ratio above 1.5 — comfortable short-term liquidity.", "zh-CN": "流动比率高于 1.5——短期流动性充裕。" },
  "insight.detail.currentRatio.low":     { en: "Current ratio below 1 — short-term liabilities exceed short-term assets.", "zh-CN": "流动比率低于 1——短期负债超过短期资产。" },
  "insight.detail.de.low":               { en: "Debt-to-Equity below 0.5 — conservative capital structure.", "zh-CN": "负债权益比低于 0.5——资本结构保守。" },
  "insight.detail.de.high":              { en: "Debt-to-Equity above 2 — leverage is elevated; earnings must service the debt.", "zh-CN": "负债权益比高于 2——杠杆偏高，盈利需覆盖债务成本。" },
  "insight.detail.fcf.positive":         { en: "Free cash flow is positive — the business self-funds after capex.", "zh-CN": "自由现金流为正——公司在资本开支后仍可自我造血。" },
  "insight.detail.fcf.negative":         { en: "Free cash flow is negative — external financing may be needed to sustain operations.", "zh-CN": "自由现金流为负——运营可能需要外部融资支持。" },
  "insight.detail.revenue.up":           { en: "Year-over-year revenue growth above 10% — the top line is expanding.", "zh-CN": "同比营收增长高于 10%——收入端持续扩张。" },
  "insight.detail.revenue.down":         { en: "Revenue is contracting versus the prior year.", "zh-CN": "营收较去年同期萎缩。" },
  "insight.detail.earnings.up":          { en: "Year-over-year earnings growth above 10% — bottom-line momentum.", "zh-CN": "同比盈利增长高于 10%——利润端具备动能。" },
  "insight.detail.earnings.down":        { en: "Earnings have contracted materially versus the prior year.", "zh-CN": "盈利较去年同期显著萎缩。" },
  "insight.detail.yield.high":           { en: "Yield above 6% — attractive, but historically high yields often precede a cut. Check payout ratio.", "zh-CN": "股息率高于 6%——看似吸引，但历史上极高股息常预示派息削减，请核查派息比率。" },
  "insight.detail.yield.healthy":        { en: "Healthy dividend yield above 2% — adds to total return.", "zh-CN": "健康的股息率高于 2%——有助于提升总回报。" },
  "insight.detail.payout.low":           { en: "Payout ratio under 60% — dividend is well-covered by earnings.", "zh-CN": "派息比率低于 60%——股息被盈利充分覆盖。" },
  "insight.detail.payout.high":          { en: "Payout ratio above 90% — the dividend consumes nearly all earnings, leaving little cushion.", "zh-CN": "派息比率高于 90%——股息几乎耗尽盈利，缓冲空间有限。" },
  "insight.detail.uptrend":              { en: "SMA 50 is above SMA 200 and price is above SMA 50 — classic golden-cross setup.", "zh-CN": "SMA 50 高于 SMA 200，且价格高于 SMA 50——典型的黄金交叉格局。" },
  "insight.detail.downtrend":            { en: "SMA 50 is below SMA 200 and price is below SMA 50 — death-cross regime.", "zh-CN": "SMA 50 低于 SMA 200，且价格低于 SMA 50——死亡交叉格局。" },
  "insight.detail.rsi.overbought":       { en: "RSI(14) above 70 — short-term momentum is stretched; expect a pullback risk.", "zh-CN": "RSI(14) 高于 70——短线动量偏紧，需警惕回调风险。" },
  "insight.detail.rsi.oversold":         { en: "RSI(14) below 30 — potentially oversold and due for a bounce.", "zh-CN": "RSI(14) 低于 30——可能超卖，具备反弹机会。" },
  "insight.detail.macd.bullish":         { en: "MACD is above its signal line — momentum favours the upside.", "zh-CN": "MACD 位于信号线上方——动量偏向上行。" },
  "insight.detail.macd.bearish":         { en: "MACD is below its signal line — momentum favours the downside.", "zh-CN": "MACD 位于信号线下方——动量偏向下行。" },
  "insight.detail.bb.aboveUpper":        { en: "Price is riding the upper Bollinger band — mean-reversion pressure.", "zh-CN": "价格贴近布林上轨——存在均值回归压力。" },
  "insight.detail.bb.belowLower":        { en: "Price is hugging the lower Bollinger band — potential reversion higher.", "zh-CN": "价格贴近布林下轨——具备向上均值回归的可能。" },
  "insight.detail.r3m.up":               { en: "Positive 3-month return — sustained buying interest.", "zh-CN": "3 个月回报为正——买盘持续。" },
  "insight.detail.r3m.down":             { en: "3-month return worse than -10% — recent selling pressure.", "zh-CN": "3 个月回报低于 -10%——近期抛压较重。" },
  "insight.detail.r1y.up":               { en: "Trailing 1-year return above 15% — outperforming a passive benchmark expectation.", "zh-CN": "过去一年回报高于 15%——跑赢被动基准的常规预期。" },
  "insight.detail.r1y.down":             { en: "Down more than 15% over the past year — persistent underperformance.", "zh-CN": "过去一年下跌超过 15%——持续跑输市场。" },
  "insight.detail.annVol.high":          { en: "Annualised volatility above 50% — high price swings; size positions accordingly.", "zh-CN": "年化波动率高于 50%——价格波动剧烈，请相应控制仓位。" },

  // -------- Overview: conclusion fragments --------
  "conclusion.allPositive":            { en: "**{ticker}** looks broadly favourable — every indicator we checked reads positively", "zh-CN": "**{ticker}** 整体表现向好——我们检查的每一项指标都呈现正面信号" },
  "conclusion.allNegative":            { en: "**{ticker}** shows weakness across the indicators we checked",                        "zh-CN": "**{ticker}** 在我们检查的指标上普遍疲软" },
  "conclusion.mostlyPositive":         { en: "**{ticker}** looks broadly favourable, with {pos} positive signals versus {neg} concerns", "zh-CN": "**{ticker}** 整体表现向好，共 {pos} 项正面信号 vs {neg} 项关注" },
  "conclusion.mostlyNegative":         { en: "**{ticker}** raises meaningful concerns, with {neg} negative signals versus {pos} positives", "zh-CN": "**{ticker}** 存在明显警示，共 {neg} 项负面信号 vs {pos} 项正面" },
  "conclusion.mixed":                  { en: "**{ticker}** shows a mixed picture — {pos} positives balanced by {neg} concerns",     "zh-CN": "**{ticker}** 表现好坏参半——{pos} 项正面被 {neg} 项关注抵消" },
  "conclusion.strengthsOnly":          { en: ". Strengths cluster in **{list}**",                                                    "zh-CN": "。优势集中在 **{list}**" },
  "conclusion.weaknessesOnly":         { en: ". Weaknesses appear in **{list}**",                                                    "zh-CN": "。短板集中在 **{list}**" },
  "conclusion.strengthsAndWeaknesses": { en: ". Strengths cluster in **{strong}**, while weaknesses appear in **{weak}**",           "zh-CN": "。优势集中在 **{strong}**，短板集中在 **{weak}**" },
  "conclusion.notablePositives":       { en: ". Notable positives: {list}. ",                                                        "zh-CN": "。值得关注的正面：{list}。" },
  "conclusion.keyConcerns":            { en: "Key concerns: {list}.",                                                                "zh-CN": "关键关注：{list}。" },
  "conclusion.listSeparator":          { en: "; ",                                                                                   "zh-CN": "；" },
  "conclusion.categoryJoiner":         { en: ", ",                                                                                   "zh-CN": "、" },
  "conclusion.stop":                   { en: ". ",                                                                                   "zh-CN": "。" },

  // -------- Fear & Greed Index (CNN) --------
  "fg.title":                     { en: "Fear & Greed Index",           "zh-CN": "恐惧与贪婪指数" },
  "fg.subtitle":                  { en: "CNN's market sentiment gauge, 0 (extreme fear) to 100 (extreme greed). Updated at each US market close.", "zh-CN": "CNN 市场情绪指标，0（极度恐惧）到 100（极度贪婪）。美股每次收盘后更新。" },
  "fg.loading":                   { en: "Fetching sentiment from CNN…", "zh-CN": "正在从 CNN 获取情绪指数…" },
  "fg.error":                     { en: "Couldn't load Fear & Greed",   "zh-CN": "无法加载恐惧与贪婪指数" },
  "fg.updated":                   { en: "As of {time}",                 "zh-CN": "截至 {time}" },
  "fg.cachedNote":                { en: "Served from server cache.",    "zh-CN": "由服务端缓存提供。" },
  "fg.timeline":                  { en: "Recent history",               "zh-CN": "近期变化" },
  "fg.components":                { en: "Seven underlying indicators",  "zh-CN": "七个基础指标" },

  "fg.prev.close":                { en: "Prev close",   "zh-CN": "前一交易日" },
  "fg.prev.week":                 { en: "1 week ago",   "zh-CN": "一周前" },
  "fg.prev.month":                { en: "1 month ago",  "zh-CN": "一月前" },
  "fg.prev.year":                 { en: "1 year ago",   "zh-CN": "一年前" },

  "fg.rating.extreme_fear":       { en: "Extreme Fear",  "zh-CN": "极度恐惧" },
  "fg.rating.fear":               { en: "Fear",          "zh-CN": "恐惧" },
  "fg.rating.neutral":            { en: "Neutral",       "zh-CN": "中性" },
  "fg.rating.greed":              { en: "Greed",         "zh-CN": "贪婪" },
  "fg.rating.extreme_greed":      { en: "Extreme Greed", "zh-CN": "极度贪婪" },

  "fg.ind.marketMomentum":        { en: "Market Momentum (S&P 500 vs 125-day MA)", "zh-CN": "市场动量（标普 500 vs 125 日均线）" },
  "fg.ind.stockPriceStrength":    { en: "Stock Price Strength (net new 52-week highs)", "zh-CN": "股价强度（52 周新高净变动）" },
  "fg.ind.stockPriceBreadth":     { en: "Stock Price Breadth (volume up vs down)", "zh-CN": "股价广度（成交量涨跌对比）" },
  "fg.ind.putCallOptions":        { en: "Put/Call Ratio (5-day options)",         "zh-CN": "认沽/认购比率（5 日期权）" },
  "fg.ind.vix":                   { en: "Market Volatility (VIX vs 50-day MA)",   "zh-CN": "市场波动率（VIX vs 50 日均线）" },
  "fg.ind.junkBondDemand":        { en: "Junk Bond Demand (yield spread)",        "zh-CN": "垃圾债需求（收益率利差）" },
  "fg.ind.safeHavenDemand":       { en: "Safe Haven Demand (stocks vs bonds)",    "zh-CN": "避险需求（股票 vs 债券）" },

  // -------- Ratios page --------
  "ratios.title":           { en: "Ratios",   "zh-CN": "财务比率" },
  "ratios.legend":          { en: "Value legend", "zh-CN": "数值图例" },
  "ratios.tone.good":       { en: "healthy",  "zh-CN": "健康" },
  "ratios.tone.warn":       { en: "watch",    "zh-CN": "关注" },
  "ratios.tone.bad":        { en: "concern",  "zh-CN": "警示" },
  "ratios.tone.contextNote":{ en: "· uncoloured = context only", "zh-CN": "· 无色 = 仅供参考" },
  "ratios.direction.higher":{ en: "↑ higher = better", "zh-CN": "↑ 越高越好" },
  "ratios.direction.lower": { en: "↓ lower = better",  "zh-CN": "↓ 越低越好" },
  "ratios.loss":            { en: "Loss",  "zh-CN": "亏损" },
  "ratios.loss.tooltipTitle": { en: "Company is currently unprofitable", "zh-CN": "公司目前处于亏损状态" },
  "ratios.loss.tooltipBody":  {
    en: "P/E can't be computed because earnings-per-share are negative — the company posted a net loss over this period. A visible P/E number therefore also means: the company is making money.",
    "zh-CN": "由于每股收益为负，无法计算市盈率——公司在该周期录得净亏损。反之，能看到 P/E 数值即表示公司当前盈利。",
  },

  // -------- Charts page --------
  "charts.title":              { en: "Price & Volume", "zh-CN": "价格与成交量" },
  "charts.overlay.ema":        { en: "EMA 24 / 52 / 200", "zh-CN": "EMA 24 / 52 / 200" },
  "charts.overlay.sma":        { en: "SMA 20 / 50 / 200", "zh-CN": "SMA 20 / 50 / 200" },
  "charts.overlay.bb":         { en: "Bollinger Bands (20, 2σ)", "zh-CN": "布林带 (20, 2σ)" },
  "charts.meta":               { en: "{count} bars · {period} @ {interval}", "zh-CN": "{count} 根 K 线 · {period} @ {interval}" },
  "charts.noHistory":          { en: "No price history.", "zh-CN": "没有价格历史数据。" },
  "charts.indicatorsHeading":  { en: "Technical indicators", "zh-CN": "技术指标" },

  // -------- Technical Signal (Buy/Sell) card --------
  "ts.title":                  { en: "Technical Signal",         "zh-CN": "技术面信号" },
  "ts.subtitle":               { en: "A weighted vote of today's indicators — trend, momentum, mean-reversion, support/resistance, and the market-wide Fear & Greed backdrop.", "zh-CN": "对今日各项指标（趋势、动量、均值回归、支撑/阻力位，以及全市场的恐惧与贪婪背景）加权投票的综合结果。" },
  "ts.scoreLabel":             { en: "Score",                    "zh-CN": "得分" },
  "ts.contributors":           { en: "Contributing signals ({n})", "zh-CN": "参与信号 ({n})" },
  "ts.noContribs":             { en: "Not enough data — every indicator returned neutral.", "zh-CN": "数据不足——所有指标均为中性。" },
  "ts.bullishCount":           { en: "{n} bullish",              "zh-CN": "{n} 项看多" },
  "ts.bearishCount":           { en: "{n} bearish",              "zh-CN": "{n} 项看空" },
  "ts.confidence":             { en: "Confidence {pct}%",        "zh-CN": "置信度 {pct}%" },

  // Conviction chip — how much to trust the headline verdict itself.
  // Combines coverage (how many of the 9 signals fired) with agreement
  // (how one-directional the fires were).
  "ts.conviction.aria":        { en: "Verdict conviction — how much to trust this label",
                                  "zh-CN": "判断可信度——该结论的可靠程度" },
  "ts.conviction.high":        { en: "High conviction",   "zh-CN": "高可信度" },
  "ts.conviction.medium":      { en: "Medium conviction", "zh-CN": "中等可信度" },
  "ts.conviction.low":         { en: "Low conviction",    "zh-CN": "低可信度" },
  "ts.conviction.high.title":  { en: "High conviction",   "zh-CN": "高可信度" },
  "ts.conviction.medium.title":{ en: "Medium conviction", "zh-CN": "中等可信度" },
  "ts.conviction.low.title":   { en: "Low conviction",    "zh-CN": "低可信度" },
  "ts.conviction.high.body": {
    en: "Many of the 9 signals fired ({cov}% coverage) and they agree strongly ({agr}% one-directional). This verdict rests on a solid, consistent read of the tape.",
    "zh-CN": "9 项信号中大量触发（覆盖率 {cov}%）且高度一致（一致度 {agr}%）。该判断建立在稳固而一致的行情读数之上。",
  },
  "ts.conviction.medium.body": {
    en: "A reasonable number of signals fired ({cov}% coverage) with moderate agreement ({agr}% one-directional). Directionally OK, but not overwhelming — expect some back-and-forth.",
    "zh-CN": "触发的信号数量较合理（覆盖率 {cov}%），但一致度中等（{agr}% 同向）。方向可参考，但难称压倒性——短期或有反复。",
  },
  "ts.conviction.low.body": {
    en: "Only a few signals fired ({cov}% coverage) or they disagreed ({agr}% one-directional). We downgrade any 'Buy'/'Sell' label to 'Hold' when conviction is low — the picture is too thin or too conflicted to act on.",
    "zh-CN": "触发信号偏少（覆盖率 {cov}%）或分歧较大（{agr}% 同向）。低可信度时我们会将「买入/卖出」下调为「观望」——当前信号不足以采取行动。",
  },
  "ts.downgradeNotice": {
    en: "Would have been {raw} on raw score — downgraded to Hold because conviction is low. Wait for more signals to align.",
    "zh-CN": "按原始得分本为「{raw}」——因可信度不足已下调至「观望」，请等待更多信号一致。",
  },

  "ts.verdict.strong_buy":     { en: "Strong Buy",   "zh-CN": "强烈买入" },
  "ts.verdict.buy":            { en: "Buy",          "zh-CN": "买入" },
  "ts.verdict.hold":           { en: "Hold",         "zh-CN": "观望" },
  "ts.verdict.sell":           { en: "Sell",         "zh-CN": "卖出" },
  "ts.verdict.strong_sell":    { en: "Strong Sell",  "zh-CN": "强烈卖出" },

  "ts.cat.trend":              { en: "Trend",           "zh-CN": "趋势" },
  "ts.cat.momentum":           { en: "Momentum",        "zh-CN": "动量" },
  "ts.cat.meanReversion":      { en: "Mean reversion",  "zh-CN": "均值回归" },
  "ts.cat.position":           { en: "Position",        "zh-CN": "位置" },
  "ts.cat.levels":             { en: "S/R levels",      "zh-CN": "支撑/阻力位" },

  "ts.disclaimer.label":       { en: "About this signal",       "zh-CN": "关于该信号" },
  "ts.disclaimer.title":       { en: "Educational — not advice", "zh-CN": "仅供学习 · 非投资建议" },
  "ts.disclaimer.body":        {
    en: "The verdict is a transparent weighted vote across the seven technical indicators listed. It considers only price and volume — not fundamentals, news, or your risk tolerance. Do your own research before trading.",
    "zh-CN": "该判断由所列七项技术指标加权投票产生，仅考虑价格与成交量，不含基本面、新闻或个人风险偏好。交易前请自行做进一步研究。",
  },

  // -------- Technical Signal notifications (bell button + settings popover) --
  "ts.alert.button.configured":  { en: "Notifications configured", "zh-CN": "已配置通知" },
  "ts.alert.button.off":         { en: "Set up notifications",     "zh-CN": "设置通知" },
  "ts.alert.chip.off":           { en: "Alerts off",               "zh-CN": "通知已关" },
  "ts.alert.chip.on":            { en: "Alerts on",                "zh-CN": "通知已开" },
  "ts.alert.chip.digest":        { en: "Daily {time} {tz}",        "zh-CN": "每日 {time} {tz}" },
  "ts.alert.title":              { en: "Signal notifications",     "zh-CN": "信号通知" },
  "ts.alert.subtitle":           {
    en: "Get pinged with the current buy/sell verdict for {ticker}. Uses your Telegram + Web-Push channels.",
    "zh-CN": "在指定时间接收 {ticker} 的当前买卖判断，通过 Telegram 与网页推送发送。",
  },
  "ts.alert.close":              { en: "Close",                    "zh-CN": "关闭" },
  "ts.alert.digest.title":       { en: "Daily digest at a time",   "zh-CN": "每日定时摘要" },
  "ts.alert.digest.enable":      { en: "Send me the verdict each day", "zh-CN": "每日发送当前判断" },
  "ts.alert.digest.time":        { en: "Time",                     "zh-CN": "时间" },
  "ts.alert.digest.timezone":    { en: "Timezone",                 "zh-CN": "时区" },
  "ts.alert.digest.hint":        {
    en: "Fires once per day at (or just after) this time. The bot polls every ~15 min, so delivery can be up to 15 min late.",
    "zh-CN": "每天在此时间或稍后触发一次。机器人每 ~15 分钟检查一次，因此可能延迟不超过 15 分钟。",
  },
  "ts.alert.change.title":       { en: "When the verdict changes", "zh-CN": "判断变化时" },
  "ts.alert.change.enable":      { en: "Also notify me on band changes", "zh-CN": "判断档位变化时也通知" },
  "ts.alert.change.strength":    { en: "Only for these verdicts:", "zh-CN": "仅对以下档位通知：" },
  "ts.alert.change.strength.all":         { en: "All (incl. Hold)", "zh-CN": "全部（含观望）" },
  "ts.alert.change.strength.buy_sell":    { en: "Buy or Sell",      "zh-CN": "买入或卖出" },
  "ts.alert.change.strength.strong_only": { en: "Strong only",      "zh-CN": "仅强烈信号" },
  "ts.alert.actions.save":       { en: "Save",                     "zh-CN": "保存" },
  "ts.alert.actions.update":     { en: "Update",                   "zh-CN": "更新" },
  "ts.alert.actions.test":       { en: "Test now",                 "zh-CN": "立即测试" },
  "ts.alert.actions.testTitle":  {
    en: "Fire a one-off digest right now to verify your Telegram / push setup.",
    "zh-CN": "立即发送一次摘要，验证 Telegram / 推送是否正常。",
  },
  "ts.alert.actions.remove":     { en: "Remove",                   "zh-CN": "移除" },
  "ts.alert.status.saved":       { en: "Saved. The worker will pick it up on its next tick.", "zh-CN": "已保存，机器人将在下一次轮询时启用。" },
  "ts.alert.status.removed":     { en: "Alert removed.",           "zh-CN": "通知已移除。" },
  "ts.alert.status.testSent":    { en: "Test digest sent — check Telegram / notifications.", "zh-CN": "测试摘要已发送，请查看 Telegram / 通知。" },
  "ts.alert.status.testFailed":  { en: "Test failed — is Telegram or Web-Push configured?", "zh-CN": "测试失败，请确认 Telegram 或网页推送是否已配置。" },

  // -------- 6-Signal Resonance notifications (bell button + settings popover) --
  // Structural mirror of the ts.alert.* block above — same shape and
  // copy conventions so users only learn the pattern once.
  "rs.alert.button.configured":  { en: "Resonance alerts configured", "zh-CN": "已配置共振通知" },
  "rs.alert.button.off":         { en: "Set up resonance alerts",     "zh-CN": "设置共振通知" },
  "rs.alert.chip.off":           { en: "Alerts off",                  "zh-CN": "通知已关" },
  "rs.alert.chip.on":            { en: "Alerts on",                   "zh-CN": "通知已开" },
  "rs.alert.chip.digest":        { en: "Daily {time} {tz}",           "zh-CN": "每日 {time} {tz}" },
  "rs.alert.title":              { en: "6-Signal Resonance notifications", "zh-CN": "6 信号共振通知" },
  "rs.alert.subtitle":           {
    en: "Get pinged when the 6-signal resonance verdict changes for {ticker}. Uses your Telegram + Web-Push channels.",
    "zh-CN": "当 {ticker} 的 6 信号共振结论发生变化时通知你，通过 Telegram 与网页推送发送。",
  },
  "rs.alert.close":              { en: "Close",                       "zh-CN": "关闭" },
  "rs.alert.digest.title":       { en: "Daily digest at a time",      "zh-CN": "每日定时摘要" },
  "rs.alert.digest.enable":      { en: "Send me the resonance snapshot each day", "zh-CN": "每日发送共振快照" },
  "rs.alert.digest.time":        { en: "Time",                        "zh-CN": "时间" },
  "rs.alert.digest.timezone":    { en: "Timezone",                    "zh-CN": "时区" },
  "rs.alert.digest.hint":        {
    en: "Fires once per day at (or just after) this time. The bot polls every ~15 min, so delivery can be up to 15 min late.",
    "zh-CN": "每天在此时间或稍后触发一次。机器人每 ~15 分钟检查一次，因此可能延迟不超过 15 分钟。",
  },
  "rs.alert.change.title":       { en: "When the resonance changes",  "zh-CN": "共振状态变化时" },
  "rs.alert.change.enable":      { en: "Also notify me when the verdict flips", "zh-CN": "共振结论切换时同时通知" },
  "rs.alert.change.strength":    { en: "Only notify for:",            "zh-CN": "仅在以下情况通知：" },
  "rs.alert.change.strength.all":          { en: "All changes",       "zh-CN": "全部变化" },
  "rs.alert.change.strength.trigger_only": { en: "Fresh Buy / Sell",  "zh-CN": "首次触发 买 / 卖" },
  "rs.alert.change.strength.strong_only":  { en: "Full 6/6 only",     "zh-CN": "仅 6/6 全共振" },
  "rs.alert.change.strength.all.hint":          {
    en: "Every verdict transition — including holding ↔ out and warm-up changes. Most noisy.",
    "zh-CN": "任何结论变化都会通知——包括持有 ↔ 出局与预热期切换。噪音最多。",
  },
  "rs.alert.change.strength.trigger_only.hint": {
    en: "Only the moment a fresh BUY or SELL alignment triggers. Recommended default.",
    "zh-CN": "仅在首次出现 BUY 或 SELL 共振时通知。默认推荐。",
  },
  "rs.alert.change.strength.strong_only.hint":  {
    en: "Only fresh BUY / SELL at full 6/6 alignment. Skips early 5-signal triggers.",
    "zh-CN": "仅在 6 项信号全部对齐（6/6）且首次触发时通知，跳过 5 信号早期触发。",
  },
  "rs.alert.actions.save":       { en: "Save",                        "zh-CN": "保存" },
  "rs.alert.actions.update":     { en: "Update",                      "zh-CN": "更新" },
  "rs.alert.actions.test":       { en: "Test now",                    "zh-CN": "立即测试" },
  "rs.alert.actions.testTitle":  {
    en: "Fire a one-off resonance digest right now to verify your Telegram / push setup.",
    "zh-CN": "立即发送一次共振摘要，验证 Telegram / 推送是否正常。",
  },
  "rs.alert.actions.remove":     { en: "Remove",                      "zh-CN": "移除" },
  "rs.alert.status.saved":       { en: "Saved. The worker will pick it up on its next tick.", "zh-CN": "已保存，机器人将在下一次轮询时启用。" },
  "rs.alert.status.removed":     { en: "Alert removed.",              "zh-CN": "通知已移除。" },
  "rs.alert.status.testSent":    { en: "Test digest sent — check Telegram / notifications.", "zh-CN": "测试摘要已发送，请查看 Telegram / 通知。" },
  "rs.alert.status.testFailed":  { en: "Test failed — is Telegram or Web-Push configured?", "zh-CN": "测试失败，请确认 Telegram 或网页推送是否已配置。" },

  // Localized detail rows (fall back to English `detailEn` if key missing).
  "ts.row.trend.up":                 { en: "Uptrend: price above SMA-50, SMA-50 above SMA-200.", "zh-CN": "上升趋势：价格位于 SMA-50 之上，SMA-50 又位于 SMA-200 之上。" },
  "ts.row.trend.down":               { en: "Downtrend: price below SMA-50, SMA-50 below SMA-200.", "zh-CN": "下降趋势：价格位于 SMA-50 之下，SMA-50 又位于 SMA-200 之下。" },
  "ts.row.trend.goldenCross":        { en: "Golden cross: SMA-50 recently crossed above SMA-200.", "zh-CN": "黄金交叉：SMA-50 近期上穿 SMA-200。" },
  "ts.row.trend.deathCross":         { en: "Death cross: SMA-50 recently crossed below SMA-200.", "zh-CN": "死亡交叉：SMA-50 近期下穿 SMA-200。" },
  "ts.row.macd.bullish":             { en: "MACD line is above its signal line — momentum bullish.", "zh-CN": "MACD 线位于信号线之上——动量偏多。" },
  "ts.row.macd.bearish":             { en: "MACD line is below its signal line — momentum bearish.", "zh-CN": "MACD 线位于信号线之下——动量偏空。" },
  "ts.row.rsi.oversold":             { en: "RSI(14) is oversold — mean-reversion long setup.", "zh-CN": "RSI(14) 处于超卖区——存在均值回归的做多机会。" },
  "ts.row.rsi.overbought":           { en: "RSI(14) is overbought — pullback risk.", "zh-CN": "RSI(14) 处于超买区——存在回调风险。" },
  "ts.row.bb.belowLower":            { en: "Price below the lower Bollinger band — potential reversion higher.", "zh-CN": "价格跌破布林带下轨——存在反弹机会。" },
  "ts.row.bb.aboveUpper":            { en: "Price above the upper Bollinger band — stretched.", "zh-CN": "价格突破布林带上轨——偏离均值。" },
  "ts.row.momentum.up_withVolume":   { en: "Recent 5-day gain is confirmed by above-average volume.", "zh-CN": "近 5 日上涨伴随超均量。" },
  "ts.row.momentum.up":              { en: "Recent 5-day return is positive.", "zh-CN": "近 5 日回报为正。" },
  "ts.row.momentum.down_withVolume": { en: "Recent 5-day decline is confirmed by above-average volume.", "zh-CN": "近 5 日下跌伴随超均量——卖压活跃。" },
  "ts.row.momentum.down":            { en: "Recent 5-day return is negative.", "zh-CN": "近 5 日回报为负。" },
  "ts.row.levels.nearSupport":       { en: "Price is trading near a strong support level.", "zh-CN": "价格已回落至强支撑位附近。" },
  "ts.row.levels.nearResistance":    { en: "Price is testing a strong resistance level.", "zh-CN": "价格正在测试强阻力位。" },
  "ts.row.kdj.goldenCross":          { en: "KDJ golden cross — K just crossed above D.", "zh-CN": "KDJ 金叉——K 线刚上穿 D 线。" },
  "ts.row.kdj.deathCross":           { en: "KDJ death cross — K just crossed below D.", "zh-CN": "KDJ 死叉——K 线刚下穿 D 线。" },
  "ts.row.kdj.oversold":             { en: "KDJ oversold and turning up (K below 20, rising through D).", "zh-CN": "KDJ 超卖回升（K 低于 20 并向上穿 D）。" },
  "ts.row.kdj.overbought":           { en: "KDJ overbought and turning down (K above 80, falling through D).", "zh-CN": "KDJ 超买回落（K 高于 80 并向下穿 D）。" },
  "ts.row.mood.extremeFear":         { en: "Market in Extreme Fear (F&G = {value}) — often a contrarian buy signal.", "zh-CN": "市场处于极度恐惧（恐惧与贪婪 = {value}）——常被视为逆向买入信号。" },
  "ts.row.mood.extremeGreed":        { en: "Market in Extreme Greed (F&G = {value}) — pullback risk, often a contrarian sell signal.", "zh-CN": "市场处于极度贪婪（恐惧与贪婪 = {value}）——存在回调风险，常被视为逆向卖出信号。" },

  // Beginner-mode "How this score is calculated" explainer inside the card.
  "ts.explain.title":         { en: "How this score is calculated",
                                "zh-CN": "该得分是如何计算的" },
  "ts.explain.intro":         { en: "Each signal casts a signed vote — positive if it looks bullish, negative if it looks bearish. We add the votes up and divide by the biggest possible vote to land inside −100 to +100.",
                                "zh-CN": "每项信号投出一张带符号的票——看多为正、看空为负。将所有票相加后除以最大可能票数，得到介于 −100 到 +100 的分值。" },
  "ts.explain.stepsLabel":    { en: "Today's math",       "zh-CN": "今日计算" },
  "ts.explain.stepBullish":   { en: "Bullish weight ({n} signals)",
                                "zh-CN": "看多权重（{n} 项信号）" },
  "ts.explain.stepBearish":   { en: "Bearish weight ({n} signals)",
                                "zh-CN": "看空权重（{n} 项信号）" },
  "ts.explain.stepNet":       { en: "Net (bullish − bearish)",
                                "zh-CN": "净值（看多 − 看空）" },
  "ts.explain.stepMax":       { en: "Max possible weight",
                                "zh-CN": "最大可能权重" },
  "ts.explain.stepScore":     { en: "Final score",        "zh-CN": "最终得分" },
  "ts.explain.stepRawScore":  { en: "Raw score",          "zh-CN": "原始得分" },
  "ts.explain.stepAgreement": { en: "Agreement factor ({pct}% aligned)",
                                "zh-CN": "共识系数（一致度 {pct}%）" },
  "ts.explain.stepFinalScore":{ en: "Adjusted score",     "zh-CN": "调整后得分" },
  "ts.explain.bandsLabel":    { en: "Verdict bands",      "zh-CN": "判断区间" },
  "ts.explain.disclaimer":    { en: "Only price & volume — no news, fundamentals, or your personal risk tolerance are factored in.",
                                "zh-CN": "仅基于价格与成交量——不包含新闻、基本面或个人风险承受力。" },

  // Beginner-mode "All signals reference" section — one row per entry
  // in SIGNAL_CATALOG (lib/technical-signal.ts). If you add a signal
  // there, add a matching triple (label / bullish / bearish) here.
  "ts.catalog.title":        { en: "All signals reference",
                                "zh-CN": "全部信号参考" },
  "ts.catalog.intro":        { en: "The full list of signals we look at, what makes each one vote bullish or bearish, and its weight. Signals firing right now are highlighted.",
                                "zh-CN": "以下是我们考察的全部信号、各自的看多/看空触发条件与权重。今日触发的信号会被高亮显示。" },
  "ts.catalog.colSignal":    { en: "Signal",         "zh-CN": "信号" },
  "ts.catalog.colWeight":    { en: "Weight",         "zh-CN": "权重" },
  "ts.catalog.colBullish":   { en: "Votes bullish (+) when…", "zh-CN": "看多（+）触发条件" },
  "ts.catalog.colBearish":   { en: "Votes bearish (−) when…", "zh-CN": "看空（−）触发条件" },
  "ts.catalog.activeChip":   { en: "Firing today",   "zh-CN": "今日触发" },
  "ts.catalog.silentChip":   { en: "Silent",         "zh-CN": "未触发" },
  "ts.catalog.weightVal":    { en: "±{n}",           "zh-CN": "±{n}" },

  "ts.def.trend.label":      { en: "SMA trend regime",
                                "zh-CN": "SMA 趋势格局" },
  "ts.def.trend.bullish":    { en: "50-day SMA is above the 200-day SMA and price is above the 50-day SMA.",
                                "zh-CN": "50 日 SMA 位于 200 日 SMA 之上，且价格位于 50 日 SMA 之上。" },
  "ts.def.trend.bearish":    { en: "50-day SMA is below the 200-day SMA and price is below the 50-day SMA.",
                                "zh-CN": "50 日 SMA 位于 200 日 SMA 之下，且价格位于 50 日 SMA 之下。" },

  "ts.def.cross.label":      { en: "Golden / death cross",
                                "zh-CN": "黄金交叉 / 死亡交叉" },
  "ts.def.cross.bullish":    { en: "50-day SMA crossed above the 200-day SMA within the last 20 bars (golden cross).",
                                "zh-CN": "近 20 根 K 线内 50 日 SMA 上穿 200 日 SMA（黄金交叉）。" },
  "ts.def.cross.bearish":    { en: "50-day SMA crossed below the 200-day SMA within the last 20 bars (death cross).",
                                "zh-CN": "近 20 根 K 线内 50 日 SMA 下穿 200 日 SMA（死亡交叉）。" },

  "ts.def.macd.label":       { en: "MACD line vs signal",
                                "zh-CN": "MACD 线 vs 信号线" },
  "ts.def.macd.bullish":     { en: "MACD line is above its signal line.",
                                "zh-CN": "MACD 线位于信号线之上。" },
  "ts.def.macd.bearish":     { en: "MACD line is below its signal line.",
                                "zh-CN": "MACD 线位于信号线之下。" },

  "ts.def.rsi.label":        { en: "RSI(14) zone",
                                "zh-CN": "RSI(14) 区域" },
  "ts.def.rsi.bullish":      { en: "RSI(14) is at or below 30 (oversold — mean-reversion buy).",
                                "zh-CN": "RSI(14) ≤ 30（超卖，均值回归买点）。" },
  "ts.def.rsi.bearish":      { en: "RSI(14) is at or above 70 (overbought — pullback risk).",
                                "zh-CN": "RSI(14) ≥ 70（超买，存在回调风险）。" },

  "ts.def.bb.label":         { en: "Bollinger band position",
                                "zh-CN": "布林带位置" },
  "ts.def.bb.bullish":       { en: "Price is at or below the lower band (statistically cheap).",
                                "zh-CN": "价格触及或低于下轨（统计上偏便宜）。" },
  "ts.def.bb.bearish":       { en: "Price is at or above the upper band (statistically expensive).",
                                "zh-CN": "价格触及或高于上轨（统计上偏贵）。" },

  "ts.def.momentum5d.label": { en: "5-day return + volume",
                                "zh-CN": "近 5 日回报 + 成交量" },
  "ts.def.momentum5d.bullish": { en: "5-day return is +5% or better (extra weight if volume is above average).",
                                  "zh-CN": "近 5 日回报 ≥ +5%（若成交量高于均值权重更强）。" },
  "ts.def.momentum5d.bearish": { en: "5-day return is −5% or worse (sellers active if volume is above average).",
                                  "zh-CN": "近 5 日回报 ≤ −5%（若成交量高于均值表明抛压活跃）。" },

  "ts.def.kdj.label":        { en: "KDJ cross / zone",
                                "zh-CN": "KDJ 交叉 / 区域" },
  "ts.def.kdj.bullish":      { en: "K crossed above D in the last 3 bars, OR K is below 20 and turning up (oversold reversal).",
                                "zh-CN": "近 3 根 K 线内 K 上穿 D，或 K < 20 且向上穿 D（超卖反转）。" },
  "ts.def.kdj.bearish":      { en: "K crossed below D in the last 3 bars, OR K is above 80 and turning down (overbought reversal).",
                                "zh-CN": "近 3 根 K 线内 K 下穿 D，或 K > 80 且向下穿 D（超买反转）。" },

  "ts.def.levels.label":     { en: "Support / resistance proximity",
                                "zh-CN": "支撑 / 阻力位邻近度" },
  "ts.def.levels.bullish":   { en: "Price is within 2% of the nearest support level (potential bounce).",
                                "zh-CN": "价格距最近支撑位 2% 以内（可能反弹）。" },
  "ts.def.levels.bearish":   { en: "Price is within 2% of the nearest resistance level (potential rejection).",
                                "zh-CN": "价格距最近阻力位 2% 以内（可能受阻回落）。" },

  "ts.def.mood.label":       { en: "Market mood (Fear & Greed)",
                                "zh-CN": "市场情绪（恐惧与贪婪）" },
  "ts.def.mood.bullish":     { en: "CNN Fear & Greed Index is below 25 (Extreme Fear) — contrarian buy signal.",
                                "zh-CN": "CNN 恐惧与贪婪指数 < 25（极度恐惧）——逆向买入信号。" },
  "ts.def.mood.bearish":     { en: "CNN Fear & Greed Index is above 75 (Extreme Greed) — contrarian sell signal.",
                                "zh-CN": "CNN 恐惧与贪婪指数 > 75（极度贪婪）——逆向卖出信号。" },

  // -------- 6-Signal Resonance strategy card --------
  "resonance.title":            { en: "6-Signal Resonance",                   "zh-CN": "六指标共振" },
  "resonance.subtitle":         { en: "A moomoo-style strategy: BUY fires the moment six fast-tuned momentum checks all turn bullish on the same bar. HOLDING lasts as long as the alignment holds.",
                                  "zh-CN": "移植自 moomoo 常见公式的策略：六项快速动量检查在同一根 K 线同时看多的瞬间发出「买入」；只要六项持续对齐，即维持「持有」。" },
  "resonance.alignedLabel":     { en: "Aligned checks",                       "zh-CN": "对齐数量" },
  "resonance.checksLabel":      { en: "Six checks",                           "zh-CN": "六项检查" },
  "resonance.streak":           { en: "Aligned for {n} bar(s) in a row",      "zh-CN": "已连续对齐 {n} 根 K 线" },
  "resonance.lastBuy":          { en: "Last BUY trigger: {date}",             "zh-CN": "上次买入触发：{date}" },
  "resonance.noBuyYet":         { en: "No BUY trigger fired in the history window.",
                                  "zh-CN": "所显示的历史窗口内暂未触发买入。" },
  "resonance.warmupMessage":    { en: "Warming up — need at least 40 bars for every indicator to be defined. Currently have {n}.",
                                  "zh-CN": "预热中——所有指标就绪需要至少 40 根 K 线，当前仅有 {n} 根。" },

  "resonance.verdict.buy":      { en: "BUY signal",      "zh-CN": "买入信号" },
  "resonance.verdict.holding":  { en: "Holding",         "zh-CN": "持有中"   },
  "resonance.verdict.sell":     { en: "SELL signal",     "zh-CN": "卖出信号" },
  "resonance.verdict.avoid":    { en: "Avoid",           "zh-CN": "回避中"   },
  "resonance.verdict.out":      { en: "Out",             "zh-CN": "空仓"     },
  "resonance.verdict.warmup":   { en: "Warming up",      "zh-CN": "预热中"   },
  "resonance.streakBear":       { en: "Bearish alignment for {n} bar(s) in a row",
                                  "zh-CN": "已连续看空对齐 {n} 根 K 线" },
  "resonance.lastSell":         { en: "Last SELL trigger: {date}",
                                  "zh-CN": "上次卖出触发：{date}" },

  // Recent status strip — the visual counterpart to the TDX script's
  // STICKLINE(共振)/STICKLINE(买入信号)/DRAWICON(买入信号) output. Colours
  // deliberately mirror the TDX defaults (yellow ↔ buy, magenta ↔ hold)
  // so a user familiar with the moomoo chart reads the strip the same
  // way they read the source.
  "resonance.history.title":        { en: "Recent status",
                                       "zh-CN": "近期状态" },
  "resonance.history.subtitle":     { en: "Last {n} bars",
                                       "zh-CN": "近 {n} 根 K 线" },
  "resonance.history.empty":        { en: "No bars in the history window yet.",
                                       "zh-CN": "历史窗口内暂无数据。" },
  "resonance.history.legend.buy":   { en: "Buy day",
                                       "zh-CN": "买入日" },
  "resonance.history.legend.hold":  { en: "Hold day",
                                       "zh-CN": "持有日" },
  "resonance.history.legend.sell":  { en: "Sell day",
                                       "zh-CN": "卖出日" },
  "resonance.history.legend.avoid": { en: "Avoid day",
                                       "zh-CN": "回避日" },
  "resonance.history.legend.out":   { en: "Out",
                                       "zh-CN": "空仓" },
  "resonance.history.tooltip.state":   { en: "State",   "zh-CN": "状态" },
  "resonance.history.tooltip.close":   { en: "Close",   "zh-CN": "收盘" },
  "resonance.history.tooltip.bullish": { en: "Bullish", "zh-CN": "看多" },
  "resonance.history.tooltip.bearish": { en: "Bearish", "zh-CN": "看空" },
  "resonance.history.tooltip.desc.buy":     { en: "Fresh 6-way bullish alignment — the BUY trigger fired on this bar.",
                                              "zh-CN": "六项检查首次全部转多——本根 K 线触发买入信号。" },
  "resonance.history.tooltip.desc.holding": { en: "Bullish alignment carried over from the prior bar — still holding.",
                                              "zh-CN": "多头对齐从上一根 K 线延续——仍在持有。" },
  "resonance.history.tooltip.desc.sell":    { en: "Fresh 6-way bearish alignment — the SELL trigger fired on this bar.",
                                              "zh-CN": "六项检查首次全部转空——本根 K 线触发卖出信号。" },
  "resonance.history.tooltip.desc.avoid":   { en: "Bearish alignment carried over from the prior bar — stay flat / stay short.",
                                              "zh-CN": "空头对齐从上一根 K 线延续——空仓 / 保持空头。" },
  "resonance.history.tooltip.desc.out":     { en: "Neither side fully aligned — no consensus, no trade.",
                                              "zh-CN": "多空皆未完全对齐——无共识，不入场。" },

  "resonance.state.bull":       { en: "Bull",   "zh-CN": "多头" },
  "resonance.state.bear":       { en: "Bear",   "zh-CN": "空头" },
  "resonance.state.warmup":     { en: "—",       "zh-CN": "—"    },

  // Per-check display names, rule summaries and one-line descriptions.
  "resonance.check.macd.name": { en: "MACD (8, 13, 5)",       "zh-CN": "MACD (8, 13, 5)" },
  "resonance.check.macd.desc": { en: "Fast-tuned MACD. DIFF is the short EMA minus the longer one; DEA is its 5-period EMA.",
                                 "zh-CN": "参数加速版 MACD。DIFF = 短周期 EMA 与长周期 EMA 之差；DEA 为 DIFF 的 5 周期 EMA。" },
  "resonance.check.macd.rule": { en: "Bullish when DIFF is above DEA (momentum crossing up).",
                                 "zh-CN": "当 DIFF 位于 DEA 之上时看多（动量上穿）。" },

  "resonance.check.kdj.name":  { en: "KDJ (8, 3, 3)",         "zh-CN": "KDJ (8, 3, 3)" },
  "resonance.check.kdj.desc":  { en: "Stochastic oscillator with an 8-bar look-back. K is the smoothed %K line; D is a further smoothing of K.",
                                 "zh-CN": "回溯 8 根 K 线的随机指标。K 为平滑后的 %K；D 再对 K 做平滑。" },
  "resonance.check.kdj.rule":  { en: "Bullish when K is above D (fast stochastic crossing up).",
                                 "zh-CN": "当 K 位于 D 之上时看多（随机指标金叉倾向）。" },

  "resonance.check.rsi.name":  { en: "RSI 5 vs 13",           "zh-CN": "RSI 5 vs 13" },
  "resonance.check.rsi.desc":  { en: "Two RSIs at different speeds. When the fast one leads the slow one, short-term momentum is stronger than medium-term momentum.",
                                 "zh-CN": "两条不同周期的 RSI。当短周期 RSI 高于长周期 RSI 时，短线动量强于中线动量。" },
  "resonance.check.rsi.rule":  { en: "Bullish when RSI5 is above RSI13.",
                                 "zh-CN": "当 RSI5 位于 RSI13 之上时看多。" },

  "resonance.check.lwr.name":  { en: "LWR (13, 3, 3)",        "zh-CN": "LWR (13, 3, 3)" },
  "resonance.check.lwr.desc":  { en: "Larry Williams %R (13-bar) smoothed twice. Values sit in [-100, 0]; upward turn means price is pushing back toward the top of the range.",
                                 "zh-CN": "对 13 周期 Williams %R 进行两次平滑。取值 [-100, 0]，向上翻转表示价格正推向区间上沿。" },
  "resonance.check.lwr.rule":  { en: "Bullish when the once-smoothed LWR1 is above the twice-smoothed LWR2.",
                                 "zh-CN": "当一次平滑 LWR1 位于二次平滑 LWR2 之上时看多。" },

  "resonance.check.bbi.name":  { en: "BBI (3, 5, 8, 13)",     "zh-CN": "BBI (3, 5, 8, 13)" },
  "resonance.check.bbi.desc":  { en: "Bull-Bear Index — the average of four short moving averages. Blends noise across timeframes into a single reference line.",
                                 "zh-CN": "多空指数——四条短周期均线的平均，将不同时间尺度的噪音合成为一条参考线。" },
  "resonance.check.bbi.rule":  { en: "Bullish when Close is above BBI.",
                                 "zh-CN": "当收盘价位于 BBI 之上时看多。" },

  "resonance.check.mtm.name":  { en: "MTM double-smoothed",   "zh-CN": "MTM 双重平滑" },
  "resonance.check.mtm.desc":  { en: "Momentum smoothed at two speeds. MMS uses (5,3), MMM uses (13,8). Ratio of signed to absolute momentum, so both are in [-100, +100].",
                                 "zh-CN": "对动量做两组不同速度的平滑。MMS 采用 (5,3)，MMM 采用 (13,8)。以有向动量除以绝对动量，取值 [-100, +100]。" },
  "resonance.check.mtm.rule":  { en: "Bullish when the fast MMS is above the slow MMM.",
                                 "zh-CN": "当快线 MMS 位于慢线 MMM 之上时看多。" },

  // Info tooltip on the card header.
  "resonance.disclaimer.label": { en: "About this strategy",   "zh-CN": "关于该策略" },
  "resonance.disclaimer.title": { en: "Educational — not advice", "zh-CN": "仅供学习 · 非投资建议" },
  "resonance.disclaimer.body":  { en: "Direct port of a popular moomoo / TongDaXin (通达信) formula. Six independent momentum checks must all align before a BUY fires — a coincidence filter, not a forecast. Uses only price and volume; ignores news, fundamentals, and your risk tolerance.",
                                  "zh-CN": "移植自 moomoo / 通达信中一段常见公式：只有六项独立动量检查同时看多才触发买入——本质是一个巧合过滤器，并非预测。仅使用价格与成交量，不考虑新闻、基本面或个人风险偏好。" },

  // Beginner-mode explainer block.
  "resonance.explain.title":     { en: "How this strategy fires",
                                   "zh-CN": "策略触发规则详解" },
  "resonance.explain.intro":     { en: "Each of the six checks is a small piece of the puzzle. Any one of them alone will flip bullish/bearish all the time — but requiring all six to agree filters most of that noise out. The trade-off is that entries are rare and can lag by a bar or two.",
                                   "zh-CN": "每一项检查都只是拼图的一小块。单独看，任一指标都会频繁翻转多空——但要求六项同时对齐，可以过滤掉大部分噪音，代价是入场机会较少，且可能滞后一到两根 K 线。" },
  "resonance.explain.ruleLabel": { en: "Rule:",                 "zh-CN": "规则：" },
  "resonance.explain.combineLabel": { en: "Combining the six checks",
                                      "zh-CN": "六项检查的组合规则" },
  "resonance.explain.resonanceExpr": { en: "Resonance = TJ1 AND TJ2 AND … AND TJ6",
                                       "zh-CN": "共振 = TJ1 AND TJ2 AND … AND TJ6" },
  "resonance.explain.resonanceRule": { en: "all six checks bullish on the same bar.",
                                       "zh-CN": "六项检查在同一根 K 线上全部看多。" },
  "resonance.explain.buyExpr":  { en: "Buy Signal = Resonance AND NOT REF(Resonance, 1)",
                                  "zh-CN": "买入信号 = 共振 AND NOT REF(共振,1)" },
  "resonance.explain.buyRule":  { en: "resonance is TRUE now and was FALSE on the previous bar (fresh alignment).",
                                  "zh-CN": "本根 K 线达到共振，且前一根尚未共振（新鲜对齐）。" },
  "resonance.explain.holdExpr": { en: "Hold = Resonance",
                                  "zh-CN": "持有 = 共振" },
  "resonance.explain.holdRule": { en: "resonance stays TRUE — no new trigger, but no reason to exit yet either.",
                                  "zh-CN": "共振持续为真——无新触发，但也无退出理由。" },
  "resonance.explain.disclaimer": { en: "Moomoo / TDX platforms colour red = bull and green = bear (Chinese convention). This card uses green = bull and red = bear to stay consistent with the rest of the dashboard.",
                                    "zh-CN": "moomoo / 通达信平台的颜色约定为「红涨绿跌」；本卡片沿用仪表板其他部分的「绿涨红跌」西方约定。" },

  // -------- Master verdict card (Overview page hero) --------
  //
  // The single consolidated "should I buy or sell?" answer that fuses
  // the technical signal, resonance strategy, fundamentals, news
  // sentiment, and Fear & Greed backdrop into one score + verdict.
  // Verdict labels themselves reuse `ts.verdict.*` for consistency.

  "master.title":              { en: "Master Verdict",                       "zh-CN": "综合结论" },
  "master.subtitle":           { en: "One consolidated buy/sell baseline — weighted average of the technical signal, 6-signal resonance, fundamentals, news sentiment, and market mood.",
                                 "zh-CN": "一个综合的买卖基线——对技术面信号、六指标共振、基本面、新闻情绪与市场情绪进行加权综合。" },
  "master.scoreLabel":         { en: "Master Score",                         "zh-CN": "综合得分" },
  "master.coverageLabel":      { en: "Coverage",                             "zh-CN": "覆盖度" },
  "master.agreementLabel":     { en: "Agreement",                            "zh-CN": "一致性" },
  "master.coverage.tooltip":   { en: "Share of the total weight that had data to vote today. Low coverage = the read is thin (e.g. missing news feed or F&G).",
                                 "zh-CN": "今日实际参与投票的权重占总权重的比例。覆盖度低说明依据不足（如缺少新闻或 F&G 数据）。" },
  "master.agreement.tooltip": { en: "How one-directional the voting sources are. 100% = every voter agreed on direction; 0% = perfectly split.",
                                 "zh-CN": "各来源方向的一致程度。100% = 所有来源方向完全一致；0% = 完全对立。" },
  "master.contribution.tooltip": { en: "Signed contribution to the master score (source score × effective weight, ×100).",
                                    "zh-CN": "该来源对综合得分的带符号贡献（来源得分 × 有效权重 × 100）。" },
  "master.noData":             { en: "Not enough data yet — every source is warming up or unavailable.",
                                 "zh-CN": "数据不足——所有来源均在预热或不可用。" },

  // Regime chip (bull / bear / flat).
  "master.regime.bull":        { en: "Uptrend",   "zh-CN": "上升趋势" },
  "master.regime.bear":        { en: "Downtrend", "zh-CN": "下降趋势" },
  "master.regime.flat":        { en: "No trend",  "zh-CN": "无明显趋势" },
  "master.regime.tooltip":     { en: "Trend regime derived from SMA-50 vs SMA-200 and price vs SMA-50. Used to arbitrate signals that fight the trend (e.g. sentiment discount).",
                                 "zh-CN": "根据 SMA-50 与 SMA-200、以及价格与 SMA-50 的关系判定的趋势状态，用于抑制逆势信号（如新闻情绪减权）。" },

  // Top drivers section.
  "master.reasons.title":      { en: "Top drivers ({n})", "zh-CN": "主要驱动 ({n})" },
  "master.reasons.empty":      { en: "No meaningful drivers today — every source is close to neutral.",
                                 "zh-CN": "今日无显著驱动——所有来源均接近中性。" },

  // Deep-link buttons.
  "master.deep.technical":     { en: "Technical detail →",  "zh-CN": "技术面详情 →"   },
  "master.deep.resonance":     { en: "Resonance detail →",  "zh-CN": "共振策略详情 →" },
  "master.deep.news":          { en: "News detail →",       "zh-CN": "新闻详情 →"     },
  "master.deep.mood":          { en: "Market mood →",       "zh-CN": "市场情绪 →"     },

  // Source labels (used across the top-drivers list and the breakdown table).
  "master.src.technical.label":    { en: "Technical",    "zh-CN": "技术面"   },
  "master.src.resonance.label":    { en: "Resonance",    "zh-CN": "共振策略" },
  "master.src.fundamentals.label": { en: "Fundamentals", "zh-CN": "基本面"   },
  "master.src.sentiment.label":    { en: "News",         "zh-CN": "新闻"     },
  "master.src.mood.label":         { en: "Market mood",  "zh-CN": "市场情绪" },

  // Source rationales. These are one-line explanations of what each
  // sub-scorer is saying today, interpolated with per-source parameters.
  "master.src.technical.rationale":
    { en: "Technical score {score} ({bull} bullish / {bear} bearish signals).",
      "zh-CN": "技术面得分 {score}（{bull} 项看多 / {bear} 项看空）。" },
  "master.src.technical.rationale.downgraded":
    { en: "Technical raw score {rawScore} clamped to {score} (low conviction — {bull} bullish / {bear} bearish).",
      "zh-CN": "技术面原始得分 {rawScore}，因可信度不足调整为 {score}（{bull} 项看多 / {bear} 项看空）。" },
  "master.src.resonance.rationale.buy":
    { en: "Fresh 6/6 bullish alignment — rare high-conviction trigger.",
      "zh-CN": "六指标同时看多——罕见的高确定性触发。" },
  "master.src.resonance.rationale.holding":
    { en: "6/6 bullish alignment holding for {streak} bar(s).",
      "zh-CN": "六指标已连续看多对齐 {streak} 根 K 线。" },
  "master.src.resonance.rationale.sell":
    { en: "Fresh 6/6 bearish alignment — rare high-conviction exit signal.",
      "zh-CN": "六指标同时看空——罕见的高确定性退出信号。" },
  "master.src.resonance.rationale.avoid":
    { en: "6/6 bearish alignment holding for {streak} bar(s).",
      "zh-CN": "六指标已连续看空对齐 {streak} 根 K 线。" },
  "master.src.resonance.rationale.out":
    { en: "Resonance {aligned}/6 bullish, {bearAligned}/6 bearish — no trigger.",
      "zh-CN": "共振 {aligned}/6 看多，{bearAligned}/6 看空——未触发。" },
  "master.src.fundamentals.rationale":
    { en: "Fundamentals overall {overall}/100 ({positives} positives / {negatives} concerns).",
      "zh-CN": "基本面综合 {overall}/100（{positives} 项利好 / {negatives} 项关注）。" },
  "master.src.fundamentals.rationale.value":
    { en: "Fundamentals overall {overall}/100 ({positives} positives / {negatives} concerns).",
      "zh-CN": "基本面综合 {overall}/100（{positives} 项利好 / {negatives} 项关注）。" },
  "master.src.sentiment.rationale":
    { en: "No recent news to score.",
      "zh-CN": "近期无可评分新闻。" },
  "master.src.sentiment.rationale.bullish":
    { en: "News is bullish (score {score}, {bull}↑ / {bear}↓ / {neutral}·).",
      "zh-CN": "新闻偏多头（得分 {score}，{bull}↑ / {bear}↓ / {neutral}·）。" },
  "master.src.sentiment.rationale.bearish":
    { en: "News is bearish (score {score}, {bull}↑ / {bear}↓ / {neutral}·).",
      "zh-CN": "新闻偏空头（得分 {score}，{bull}↑ / {bear}↓ / {neutral}·）。" },
  "master.src.sentiment.rationale.neutral":
    { en: "News is neutral (score {score}, {bull}↑ / {bear}↓ / {neutral}·).",
      "zh-CN": "新闻中性（得分 {score}，{bull}↑ / {bear}↓ / {neutral}·）。" },
  "master.src.sentiment.rationale.unavailable":
    { en: "News feed unavailable — the sentiment source didn't respond.",
      "zh-CN": "新闻源不可用——本次未取得情绪评分。" },
  "master.src.sentiment.rationale.empty":
    { en: "No recent headlines to score today.",
      "zh-CN": "今日暂无可评分的最新新闻。" },
  "master.src.mood.rationale":
    { en: "Market mood is between the extremes — no contrarian vote.",
      "zh-CN": "市场情绪处于中性区间——不产生逆向投票。" },
  "master.src.mood.rationale.extremeFear":
    { en: "Extreme Fear (F&G {fg}) — contrarian buy backdrop.",
      "zh-CN": "极度恐惧（恐惧与贪婪 {fg}）——逆向买入背景。" },
  "master.src.mood.rationale.extremeGreed":
    { en: "Extreme Greed (F&G {fg}) — contrarian sell backdrop.",
      "zh-CN": "极度贪婪（恐惧与贪婪 {fg}）——逆向卖出背景。" },
  "master.src.mood.rationale.fear":
    { en: "F&G at {fg} (fear) — not extreme enough to trigger a contrarian buy vote.",
      "zh-CN": "恐惧与贪婪 {fg}（恐惧区）——尚未极端到触发逆向买入投票。" },
  "master.src.mood.rationale.neutral":
    { en: "F&G at {fg} (neutral) — market mood balanced, no contrarian vote today.",
      "zh-CN": "恐惧与贪婪 {fg}（中性）——市场情绪平衡，今日无逆向投票。" },
  "master.src.mood.rationale.greed":
    { en: "F&G at {fg} (greed) — not extreme enough to trigger a contrarian sell vote.",
      "zh-CN": "恐惧与贪婪 {fg}（贪婪区）——尚未极端到触发逆向卖出投票。" },
  "master.src.mood.rationale.unavailable":
    { en: "Fear & Greed Index unavailable — CNN's data source didn't respond.",
      "zh-CN": "恐惧与贪婪指数不可用——CNN 数据源未响应。" },

  // Breakdown table.
  "master.breakdown.title":         { en: "Full source breakdown",   "zh-CN": "各来源详情" },
  "master.breakdown.source":        { en: "Source",                  "zh-CN": "来源"       },
  "master.breakdown.score":         { en: "Score",                   "zh-CN": "得分"       },
  "master.breakdown.weight":        { en: "Weight",                  "zh-CN": "权重"       },
  "master.breakdown.contribution":  { en: "Contribution",            "zh-CN": "贡献"       },
  "master.breakdown.unavailable":   { en: "n/a",                     "zh-CN": "无数据"     },
  "master.breakdown.noVote":        { en: "no vote",                 "zh-CN": "未投票"     },
  "master.breakdown.regimeDiscounted": { en: "Discounted",           "zh-CN": "已减权"     },
  "master.breakdown.regimeDiscountedTooltip":
    { en: "This source's weight is halved on this bar because it disagrees with the trend regime (e.g. bullish news in a confirmed downtrend).",
      "zh-CN": "该来源在本根 K 线的权重减半，因为其方向与当前趋势相反（如：确立的下降趋势中出现看多新闻）。" },
  "master.breakdown.baseWeight":    { en: "base {pct}%",             "zh-CN": "原始 {pct}%" },

  // Beginner-mode explainer.
  "master.explain.title":        { en: "How this baseline is calculated",
                                    "zh-CN": "综合基线的计算方式" },
  "master.explain.intro":        { en: "We ask each of the five sources for a score between −1 and +1, then take a weighted average. Sources missing data are dropped from the average (and lower the Coverage). Sentiment gets a half-weight when it disagrees strongly with the trend regime.",
                                    "zh-CN": "让五个来源分别给出 −1 到 +1 的分数，再按权重取平均。缺数据的来源会被剔除（导致覆盖度下降）。若新闻情绪明显与趋势相反，其权重减半。" },
  "master.explain.stepsLabel":   { en: "Today's read",             "zh-CN": "今日读数" },
  "master.explain.stepCoverage": { en: "Coverage",                 "zh-CN": "覆盖度"   },
  "master.explain.stepAgreement":{ en: "Agreement",                "zh-CN": "一致性"   },
  "master.explain.stepScore":    { en: "Master score",             "zh-CN": "综合得分" },
  "master.explain.formula":      { en: "score = Σ(source_score × effective_weight) ÷ Σ effective_weight, scaled to −100…+100.",
                                    "zh-CN": "得分 = Σ(来源得分 × 有效权重) ÷ Σ 有效权重，映射到 −100…+100。" },
  "master.explain.weightsLabel": { en: "Source weights",           "zh-CN": "各来源权重" },
  "master.explain.bandsLabel":   { en: "Verdict bands",            "zh-CN": "判断区间"  },
  "master.explain.disclaimer":   { en: "This is an educational aggregation of what today's numbers say — not investment advice. Coverage and Agreement are as important as the headline verdict: a high-coverage, low-agreement read means the market is arguing with itself, and users should treat the verdict with correspondingly less conviction.",
                                    "zh-CN": "本卡片仅将今日数据做透明聚合，并非投资建议。覆盖度与一致性同样重要——覆盖度高但一致性低，说明市场自相矛盾，此时应对结论保持更多怀疑。" },

  // Disclaimer.
  "master.disclaimer.label":     { en: "About the master verdict",  "zh-CN": "关于综合结论" },
  "master.disclaimer.title":     { en: "Educational — not advice",  "zh-CN": "仅供学习 · 非投资建议" },
  "master.disclaimer.body":      { en: "The master verdict blends the technical signal, 6-signal resonance, fundamentals, news sentiment, and market mood using fixed weights. It is a transparent summary of what today's numbers say and does not know your position size, tax situation, or investment horizon. Always do your own research.",
                                    "zh-CN": "综合结论按固定权重将技术面信号、六指标共振、基本面、新闻情绪与市场情绪加权汇总，是对今日数据的透明总结，并不知道您的仓位、税务与投资期限。交易前请自行研究。" },

  // -------- Indicators page --------
  "indicators.title":               { en: "Technical Indicators", "zh-CN": "技术指标" },
  "indicators.rsi.subtitle":        { en: "Momentum oscillator. Above 70 = overbought, below 30 = oversold.", "zh-CN": "动量摆动指标。高于 70 表示超买，低于 30 表示超卖。" },
  "indicators.macd.subtitle":       { en: "MACD line vs signal line; the histogram shows their spread.", "zh-CN": "MACD 线与信号线；柱状图显示两者差距。" },
  "indicators.kdj.subtitle":        { en: "Stochastic oscillator. K/D above 80 = overbought, below 20 = oversold. K crossing above D is bullish.", "zh-CN": "随机指标。K/D 高于 80 为超买，低于 20 为超卖；K 上穿 D 为多头信号。" },
  "indicators.returns.title":       { en: "Daily returns distribution", "zh-CN": "日回报率分布" },
  "indicators.returns.subtitle":    { en: "Histogram of day-over-day percent returns. Wide bell = volatile; tight peak = calm.", "zh-CN": "每日涨跌幅的直方图。宽钟形 = 波动大；集中尖峰 = 平稳。" },
  "indicators.sr.title":            { en: "Support & Resistance", "zh-CN": "支撑位与阻力位" },
  "indicators.sr.subtitle":         { en: "Auto-detected price levels from swing pivots. Dashed lines above the last close are resistance (R1, R2…); below are support (S1, S2…).", "zh-CN": "基于摆动高低点自动识别的价位。收盘价上方的虚线为阻力位（R1、R2…），下方的为支撑位（S1、S2…）。" },

  // -------- News page --------
  "news.title":               { en: "News", "zh-CN": "新闻" },
  "news.overall.bullish":     { en: "Overall tone is bullish", "zh-CN": "整体基调偏多头" },
  "news.overall.bearish":     { en: "Overall tone is bearish", "zh-CN": "整体基调偏空头" },
  "news.overall.neutral":     { en: "Overall tone is neutral", "zh-CN": "整体基调中性" },
  "news.weightedScore":       { en: "Weighted sentiment score", "zh-CN": "加权情绪得分" },
  "news.label.bullish":       { en: "Bullish", "zh-CN": "多头" },
  "news.label.bearish":       { en: "Bearish", "zh-CN": "空头" },
  "news.label.neutral":       { en: "Neutral", "zh-CN": "中性" },
  "news.axis.bullish":        { en: "Bullish", "zh-CN": "多" },
  "news.axis.bearish":        { en: "Bearish", "zh-CN": "空" },
  "news.axis.neutral":        { en: "Neutral", "zh-CN": "中" },
  "news.tab.all":             { en: "All ({n})",     "zh-CN": "全部 ({n})" },
  "news.tab.bullish":         { en: "Bullish ({n})", "zh-CN": "多头 ({n})" },
  "news.tab.bearish":         { en: "Bearish ({n})", "zh-CN": "空头 ({n})" },
  "news.tab.neutral":         { en: "Neutral ({n})", "zh-CN": "中性 ({n})" },
  "news.impact.high":         { en: "High impact",   "zh-CN": "高影响" },
  "news.impact.medium":       { en: "Medium impact", "zh-CN": "中影响" },
  "news.impact.low":          { en: "Low impact",    "zh-CN": "低影响" },
  "news.countBullish":        { en: "{n} bullish",   "zh-CN": "{n} 条多头" },
  "news.countBearish":        { en: "{n} bearish",   "zh-CN": "{n} 条空头" },
  "news.countNeutral":        { en: "{n} neutral",   "zh-CN": "{n} 条中性" },
  "news.empty":               { en: "No stories in this category.", "zh-CN": "该分类下暂无新闻。" },
  "news.emptyForTicker":      { en: "No recent news returned for {ticker}.", "zh-CN": "{ticker} 暂无最近新闻。" },
  "news.disclaimer":          { en: "Sentiment gauged by a finance-tuned VADER lexicon. Score ≥ +0.15 is bullish, ≤ −0.15 is bearish. Overall score is time-weighted (newer stories count more). This is a rough gauge of market chatter, not a trading signal.", "zh-CN": "情绪由一套金融调优过的 VADER 词典评估。得分 ≥ +0.15 为多头，≤ −0.15 为空头。综合得分按时间加权（新新闻权重更大）。仅为市场舆情的粗略指标，非交易信号。" },

  // -------- Holders page --------
  "holders.title":                { en: "Holders", "zh-CN": "持有者" },
  "holders.breakdown":            { en: "Ownership breakdown", "zh-CN": "持股构成" },
  "holders.kpi.insidersHeld":     { en: "Held by insiders (internal)", "zh-CN": "内部人士持股" },
  "holders.kpi.insidersHeldSub":  { en: "CEOs, directors, officers & other reporting insiders", "zh-CN": "CEO、董事、高管及其他申报内部人士" },
  "holders.kpi.institutionsHeld": { en: "Held by institutions (external)", "zh-CN": "机构持股（外部）" },
  "holders.kpi.institutionsHeldSubOfFloat":{ en: "{pct} of float", "zh-CN": "占流通股 {pct}" },
  "holders.kpi.institutionsHeldSubGeneric":{ en: "Mutual funds, hedge funds, pensions", "zh-CN": "共同基金、对冲基金、养老金" },
  "holders.kpi.institutionsCount":{ en: "# of institutions", "zh-CN": "机构数量" },
  "holders.kpi.institutionsCountSub":{ en: "Distinct 13F filers", "zh-CN": "不同的 13F 申报者" },
  "holders.kpi.netInsider":       { en: "Net insider activity", "zh-CN": "内部人士净活动" },
  "holders.kpi.netInsiderSub":    { en: "Last {period} · {buys} buys / {sells} sells", "zh-CN": "近 {period} · {buys} 买入 / {sells} 卖出" },
  "holders.kpi.institutionsNet":  { en: "Institutions net", "zh-CN": "机构净额" },
  "holders.kpi.noWindow":         { en: "No filings in window", "zh-CN": "窗口内无申报" },

  "holders.tab.insiders":        { en: "Insiders ({n})",             "zh-CN": "内部人士 ({n})" },
  "holders.tab.transactions":    { en: "Insider transactions ({n})", "zh-CN": "内部交易 ({n})" },
  "holders.tab.institutions":    { en: "Institutions ({n})",         "zh-CN": "机构 ({n})" },
  "holders.tab.funds":           { en: "Mutual funds ({n})",         "zh-CN": "共同基金 ({n})" },

  "holders.insiders.intro":      { en: "Internal. Executives & directors that must report their personal holdings on SEC Form 4. \"Direct\" = personally titled, \"Indirect\" = through trusts, family members, or entities they control.", "zh-CN": "内部。高管与董事必须通过 SEC Form 4 申报其个人持股。\"直接\" = 以个人名义持有，\"间接\" = 通过信托、家庭成员或其他受控实体持有。" },
  "holders.transactions.intro":  { en: "Recent buys, sells, option exercises and gifts reported by insiders. Sustained insider selling is often neutral (diversification, tax); clustered buying by multiple insiders is a stronger positive signal.", "zh-CN": "内部人士近期申报的买入、卖出、期权行使和赠与。持续的内部卖出通常是中性的（分散、税务）；多位内部人士集中买入是更强的正面信号。" },
  "holders.institutions.intro":  { en: "External. Big-money holders required to disclose positions quarterly on Form 13F: hedge funds, pension plans, asset managers, sovereign wealth. Sorted by size of position.", "zh-CN": "外部。需按季度通过 Form 13F 披露持仓的大额投资者：对冲基金、养老金、资产管理公司、主权财富。按持仓规模排序。" },
  "holders.funds.intro":         { en: "Top mutual funds & ETFs holding this stock. Reported at fund-level (rather than firm-level) — one asset manager can appear multiple times through different funds.", "zh-CN": "持有该股票的头部共同基金与 ETF。按基金层级申报（非公司层级）——同一资产管理公司可能通过不同基金多次出现。" },

  "holders.col.name":            { en: "Name",          "zh-CN": "姓名" },
  "holders.col.role":            { en: "Role",          "zh-CN": "职位" },
  "holders.col.direct":          { en: "Direct",        "zh-CN": "直接" },
  "holders.col.indirect":        { en: "Indirect",      "zh-CN": "间接" },
  "holders.col.totalShares":     { en: "Total shares",  "zh-CN": "总股数" },
  "holders.col.lastActivity":    { en: "Last activity", "zh-CN": "最近活动" },
  "holders.col.filer":           { en: "Filer",         "zh-CN": "申报人" },
  "holders.col.action":          { en: "Action",        "zh-CN": "行为" },
  "holders.col.shares":          { en: "Shares",        "zh-CN": "股数" },
  "holders.col.value":           { en: "Value",         "zh-CN": "金额" },
  "holders.col.date":            { en: "Date",          "zh-CN": "日期" },
  "holders.col.institution":     { en: "Institution",   "zh-CN": "机构" },
  "holders.col.fund":            { en: "Fund",          "zh-CN": "基金" },
  "holders.col.sharesHeld":      { en: "Shares held",   "zh-CN": "持股数" },
  "holders.col.marketValue":     { en: "Market value",  "zh-CN": "市值" },
  "holders.col.pctSharesOut":    { en: "% of shares out", "zh-CN": "占流通股比例" },
  "holders.col.deltaPrior":      { en: "Δ vs prior",    "zh-CN": "较上期变化" },
  "holders.col.reportDate":      { en: "Report date",   "zh-CN": "申报日期" },

  "holders.empty.insiders":      { en: "Yahoo Finance didn't return an insider roster for this ticker.", "zh-CN": "Yahoo Finance 未返回该股票的内部人士名单。" },
  "holders.empty.transactions":  { en: "No insider transactions reported in the recent Yahoo window.", "zh-CN": "近期 Yahoo 时间窗口内没有内部交易记录。" },
  "holders.empty.institution":   { en: "Yahoo Finance didn't return an institutional holder list for this ticker.", "zh-CN": "Yahoo Finance 未返回该股票的机构持有者列表。" },
  "holders.empty.fund":          { en: "Yahoo Finance didn't return a mutual-fund holder list for this ticker.", "zh-CN": "Yahoo Finance 未返回该股票的共同基金持有者列表。" },
  "holders.empty.noHolders.title":  { en: "No holder data", "zh-CN": "无持有者数据" },
  "holders.empty.noHolders.body":   { en: "Yahoo Finance didn't return ownership details for {ticker}. This is common for very small caps, ADRs, or newly listed tickers.", "zh-CN": "Yahoo Finance 未返回 {ticker} 的持股详情。这在小市值、ADR 或新上市股票中很常见。" },
  "holders.footer":              { en: "Source: Yahoo Finance quoteSummary (13F, Form 4, Form 144 filings via SEC EDGAR). Position sizes and %held are as-of each holder's most recent filing — institutions file quarterly, insiders file within 2 business days of a trade. Fetched {time}.", "zh-CN": "数据来源：Yahoo Finance quoteSummary（通过 SEC EDGAR 的 13F、Form 4、Form 144 文件）。持股规模与占比以各持有者最新申报为准——机构按季度申报，内部人士交易后 2 个工作日内申报。获取于 {time}。" },
  "holders.action.buy":          { en: "Buy",   "zh-CN": "买入" },
  "holders.action.sell":         { en: "Sell",  "zh-CN": "卖出" },
  "holders.action.other":        { en: "Other", "zh-CN": "其他" },

  // -------- Paper trading page --------
  "paper.title":              { en: "Paper Trading", "zh-CN": "模拟交易" },
  "paper.card.placeOrder":    { en: "Place an order", "zh-CN": "下单" },
  "paper.card.portfolio":     { en: "Portfolio",     "zh-CN": "投资组合" },
  "paper.card.trades":        { en: "Recent trades", "zh-CN": "近期交易" },
  "paper.side.buy":           { en: "Buy",           "zh-CN": "买入" },
  "paper.side.sell":          { en: "Sell",          "zh-CN": "卖出" },
  "paper.field.symbol":       { en: "Symbol",        "zh-CN": "代码" },
  "paper.field.shares":       { en: "Shares",        "zh-CN": "股数" },
  "paper.field.price":        { en: "Price",         "zh-CN": "价格" },
  "paper.field.note":         { en: "Note (optional)", "zh-CN": "备注（可选）" },
  "paper.field.notePlaceholder":{ en: "Why?",         "zh-CN": "原因？" },
  "paper.disclaimer":         { en: "Simulated brokerage. No real money moves.", "zh-CN": "模拟券商账户。不涉及真实资金。" },
  "paper.submit":             { en: "{side} {n} {ticker}", "zh-CN": "{side} {n} 股 {ticker}" },
  "paper.submitting":         { en: "Submitting…",   "zh-CN": "正在提交…" },
  "paper.resetConfirm":       { en: "Reset the portfolio? All positions and trades will be cleared.", "zh-CN": "重置投资组合？所有持仓与交易将被清除。" },
  "paper.stat.totalValue":    { en: "Total value",   "zh-CN": "总价值" },
  "paper.stat.cash":          { en: "Cash",          "zh-CN": "现金" },
  "paper.stat.positionsValue":{ en: "Positions value", "zh-CN": "持仓价值" },
  "paper.stat.totalPnl":      { en: "Total P&L",     "zh-CN": "总盈亏" },
  "paper.openPositions":      { en: "Open positions", "zh-CN": "在持仓" },
  "paper.avg":                { en: "avg",           "zh-CN": "均价" },
  "paper.last":               { en: "Last",          "zh-CN": "最新" },
  "paper.noTrades":           { en: "No trades yet.", "zh-CN": "暂无交易记录。" },
  "paper.cashAfter":          { en: "Cash →",        "zh-CN": "现金 →" },
  "paper.targets.stopLoss":   { en: "Stop-loss",     "zh-CN": "止损价" },
  "paper.targets.takeProfit": { en: "Take-profit",   "zh-CN": "止盈价" },
  "paper.targets.slChip":     { en: "SL",            "zh-CN": "止损" },
  "paper.targets.tpChip":     { en: "TP",            "zh-CN": "止盈" },
  "paper.targets.set":        { en: "Set SL / TP",   "zh-CN": "设置止损/止盈" },
  "paper.targets.edit":       { en: "Edit SL / TP",  "zh-CN": "修改止损/止盈" },
  "paper.targets.none":       { en: "No SL / TP set", "zh-CN": "未设置止损/止盈" },
  "paper.targets.off":        { en: "Leave blank to disable", "zh-CN": "留空以关闭" },
  "paper.targets.hint":       { en: "Stop-loss auto-sells the whole position when the live price ≤ the level. Take-profit auto-sells when the live price ≥ the level. Leave blank to keep either guard off.", "zh-CN": "当最新价 ≤ 止损价时，全仓自动卖出；当最新价 ≥ 止盈价时，全仓自动卖出。留空即关闭该守护。" },
  "paper.targets.presetsLabel":   { en: "Quick presets",                     "zh-CN": "快速预设" },
  "paper.targets.presetsHint":    { en: "Percentages are relative to your average cost ({avg}). Adjust the fields below if you want a custom level.", "zh-CN": "百分比基于你的平均成本 {avg} 计算。如需自定义可修改下方数值。" },
  "paper.targets.preset.conservative": { en: "Conservative", "zh-CN": "保守" },
  "paper.targets.preset.moderate":     { en: "Moderate",     "zh-CN": "均衡" },
  "paper.targets.preset.aggressive":   { en: "Aggressive",   "zh-CN": "激进" },
  "paper.targets.invalid":    { en: "Prices must be positive numbers.", "zh-CN": "价格必须为正数。" },
  "paper.targets.triggeredTitle": { en: "{n} guard(s) fired since your last visit", "zh-CN": "自上次访问以来 {n} 个守护已触发" },
  "paper.targets.triggeredSL":    { en: "stop-loss at {level} filled at {price} — position closed.", "zh-CN": "止损 {level} 已在 {price} 触发——已全仓卖出。" },
  "paper.targets.triggeredTP":    { en: "take-profit at {level} filled at {price} — position closed.", "zh-CN": "止盈 {level} 已在 {price} 触发——已全仓卖出。" },

  // -------- Smart (data-driven) SL/TP recommendation --------
  "paper.targets.smart.title":     { en: "Smart pick",
                                      "zh-CN": "智能建议" },
  "paper.targets.smart.blurb": {
    en: "Suggest stop-loss and take-profit levels based on this stock's volatility, trend, and nearby support/resistance.",
    "zh-CN": "根据本股的波动率、趋势以及附近的支撑/阻力，为你推荐止损与止盈价位。",
  },
  "paper.targets.smart.suggest":   { en: "Suggest levels",     "zh-CN": "获取建议" },
  "paper.targets.smart.refresh":   { en: "Refresh",            "zh-CN": "刷新建议" },
  "paper.targets.smart.analyzing": { en: "Analysing recent price action…",
                                      "zh-CN": "正在分析近期价格与走势…" },
  "paper.targets.smart.errorTitle":{ en: "Couldn't compute a recommendation",
                                      "zh-CN": "无法计算智能建议" },
  "paper.targets.smart.apply":     { en: "Apply",              "zh-CN": "应用" },
  "paper.targets.smart.forSymbol": {
    en: "For {symbol}, anchored to your average cost {avg}.",
    "zh-CN": "针对 {symbol}，基于你的平均成本 {avg}。",
  },
  "paper.targets.smart.riskReward":{ en: "Risk : Reward",      "zh-CN": "风险 : 回报" },
  "paper.targets.smart.rrHint": {
    en: "You risk $1 for every $X of upside.",
    "zh-CN": "每承担 1 美元风险，可获取 X 美元潜在回报。",
  },
  "paper.targets.smart.whyHeading":{ en: "Why these levels",   "zh-CN": "推荐依据" },
  "paper.targets.smart.disclaimer": {
    en: "Guidance only — not investment advice.",
    "zh-CN": "仅供参考，不构成投资建议。",
  },
  "paper.targets.smart.fallbackBadge": { en: "Estimated",      "zh-CN": "估算" },

  // -------- Bracket order (SL/TP attached at buy time) --------
  "paper.bracket.title":    { en: "Attach protective levels", "zh-CN": "同时设置保护价位" },
  "paper.bracket.attach":   { en: "Set stop-loss / take-profit with this buy", "zh-CN": "在本次买入时同步设置止损 / 止盈" },
  "paper.bracket.hint": {
    en: "Levels apply to the whole resulting position and auto-sell when the live price crosses them. Leave either blank to skip that guard.",
    "zh-CN": "止损 / 止盈将作用于合并后的整张仓位，触发后自动全仓卖出。留空即不启用该守护。",
  },
  "paper.bracket.invalid":  { en: "Stop-loss and take-profit must be positive numbers.", "zh-CN": "止损与止盈必须为正数。" },
  "paper.bracket.needPrice":{ en: "Enter a price before choosing a preset.", "zh-CN": "选择预设前请先填写价格。" },

  // -------- Portfolio-wide analytics --------
  "paper.card.analytics":       { en: "Trading analytics",       "zh-CN": "交易分析" },
  "paper.card.perSymbol":       { en: "Earnings per stock",       "zh-CN": "每只股票盈亏" },
  "paper.stat.realizedPnl":     { en: "Realised P&L",             "zh-CN": "已实现盈亏" },
  "paper.stat.commissions":     { en: "Commissions paid",         "zh-CN": "已付佣金" },
  "paper.analytics.emptyHint":  { en: "Once you close a position, win rate and per-trade averages will show up here.", "zh-CN": "完成一次卖出后，胜率与平均盈亏将显示在这里。" },
  "paper.analytics.winRate":    { en: "Win rate",                 "zh-CN": "胜率" },
  "paper.analytics.avgWin":     { en: "Avg win",                  "zh-CN": "平均盈利" },
  "paper.analytics.avgLoss":    { en: "Avg loss",                 "zh-CN": "平均亏损" },
  "paper.analytics.payoff":     { en: "Payoff ratio",             "zh-CN": "盈亏比" },
  "paper.analytics.payoffHint": { en: "Avg win ÷ |avg loss|. > 1 means winners bigger than losers.", "zh-CN": "平均盈利 ÷ |平均亏损|。大于 1 表示单笔盈利大于亏损。" },
  "paper.analytics.winsOverSells": { en: "{wins} of {total} sells", "zh-CN": "共 {total} 次卖出中 {wins} 次盈利" },
  "paper.analytics.bestSymbol": { en: "Best symbol",              "zh-CN": "最佳标的" },
  "paper.analytics.worstSymbol":{ en: "Worst symbol",             "zh-CN": "最差标的" },
  "paper.analytics.tradesTotal":{ en: "{n} trades",               "zh-CN": "共 {n} 笔交易" },
  "paper.analytics.symbolsTraded":{ en: "{n} symbols traded",     "zh-CN": "涉及 {n} 只标的" },
  "paper.analytics.openSymbols":{ en: "{n} still open",           "zh-CN": "{n} 只仍在持仓" },

  // -------- Per-symbol earnings table --------
  "paper.perSymbol.empty":         { en: "No completed trades yet.",   "zh-CN": "暂无已完成交易。" },
  "paper.perSymbol.flat":          { en: "closed",                    "zh-CN": "已平仓" },
  "paper.perSymbol.col.symbol":    { en: "Symbol",                    "zh-CN": "代码" },
  "paper.perSymbol.col.realizedPnl":{ en: "Realised",                 "zh-CN": "已实现" },
  "paper.perSymbol.col.roundTrips":{ en: "Round trips",               "zh-CN": "完成回合" },
  "paper.perSymbol.col.wl":        { en: "W / L",                     "zh-CN": "胜/负" },
  "paper.perSymbol.col.bestWorst": { en: "Best / worst",              "zh-CN": "最佳/最差" },
  "paper.perSymbol.col.open":      { en: "Open",                      "zh-CN": "持仓" },
  "paper.perSymbol.col.last":      { en: "Last trade",                "zh-CN": "最近交易" },

  // -------- Trades table --------
  "paper.trades.col.when":     { en: "When",     "zh-CN": "时间" },
  "paper.trades.col.symbol":   { en: "Symbol",   "zh-CN": "代码" },
  "paper.trades.col.side":     { en: "Side",     "zh-CN": "方向" },
  "paper.trades.col.shares":   { en: "Shares",   "zh-CN": "股数" },
  "paper.trades.col.price":    { en: "Price",    "zh-CN": "价格" },
  "paper.trades.col.notional": { en: "Notional", "zh-CN": "金额" },
  "paper.trades.col.pnl":      { en: "P&L",      "zh-CN": "盈亏" },
  "paper.trades.col.note":     { en: "Note",     "zh-CN": "备注" },
  "paper.trades.filter.symbol":     { en: "Filter by symbol",   "zh-CN": "按代码筛选" },
  "paper.trades.filter.side":       { en: "Filter by side",     "zh-CN": "按方向筛选" },
  "paper.trades.filter.pnl":        { en: "Filter by P&L",      "zh-CN": "按盈亏筛选" },
  "paper.trades.filter.allSymbols": { en: "All symbols",        "zh-CN": "全部代码" },
  "paper.trades.filter.allSides":   { en: "All sides",          "zh-CN": "全部方向" },
  "paper.trades.filter.allPnl":     { en: "All P&L",            "zh-CN": "全部盈亏" },
  "paper.trades.filter.winsOnly":   { en: "Wins only",          "zh-CN": "仅盈利" },
  "paper.trades.filter.lossesOnly": { en: "Losses only",        "zh-CN": "仅亏损" },
  "paper.trades.filter.clear":      { en: "Clear filters",      "zh-CN": "清除筛选" },
  "paper.trades.filter.noMatch":    { en: "No trades match the current filters.", "zh-CN": "没有符合当前筛选条件的交易。" },
  "paper.trades.showing":           { en: "Showing {visible} of {total}", "zh-CN": "显示 {visible} / {total}" },
  "paper.trades.expandHint":        { en: "Click to edit stop-loss / take-profit", "zh-CN": "点击可编辑止损 / 止盈" },
  "paper.trades.hasTargets":        { en: "Stop-loss / take-profit set on this symbol", "zh-CN": "该标的已设置止损 / 止盈" },
  "paper.trades.expanded.open":     { en: "You hold {n} shares @ avg {avg}", "zh-CN": "持仓 {n} 股，均价 {avg}" },
  "paper.trades.expanded.flatTitle":{ en: "You no longer hold {symbol}", "zh-CN": "已无 {symbol} 持仓" },
  "paper.trades.expanded.flatHint": { en: "Stop-loss and take-profit only apply to open positions. Buy again to re-open a position you can protect.", "zh-CN": "止损 / 止盈仅作用于在持仓位。请重新买入以建立可保护的仓位。" },
  "paper.trades.expanded.tradeAgain":{ en: "Trade {symbol} again", "zh-CN": "再次交易 {symbol}" },

  // Reason bullets emitted by the recommender. Values (in braces) match
  // the `Reason.values` keys in lib/target-recommender.ts.
  "paper.targets.reason.atr": {
    en: "This stock moves ~{atr} per day (about {atrPct}). A {mult}× ATR buffer stops you out only on a real break, not on normal noise.",
    "zh-CN": "该股票每日平均波动约 {atr}（约 {atrPct}）。使用 {mult} 倍 ATR 作为缓冲，只有真正跌破时才会触发止损，避免被日常波动扫出。",
  },
  "paper.targets.reason.trend.bullish": {
    en: "Trend reads {label} — we widen the profit target so winners have room to run.",
    "zh-CN": "当前趋势为「{label}」——适当放宽止盈，让盈利有空间继续奔跑。",
  },
  "paper.targets.reason.trend.bearish": {
    en: "Trend reads {label} — we tighten both sides, since counter-trend trades are lower-probability.",
    "zh-CN": "当前趋势为「{label}」——逆势交易概率较低，止损与止盈都相应收紧。",
  },
  "paper.targets.reason.trend.sideways": {
    en: "Trend reads {label} — a balanced 2:1 reward-to-risk is realistic in a range.",
    "zh-CN": "当前趋势为「{label}」——震荡市中 2:1 的回报/风险比更实际。",
  },
  "paper.targets.reason.support": {
    en: "Nearest support sits at {support}; stop parked just below at {price} so a break of the level really means the thesis is wrong.",
    "zh-CN": "最近的支撑位在 {support}；将止损设在其下方 {price}，一旦跌破即视为判断错误。",
  },
  "paper.targets.reason.resistance": {
    en: "Nearest resistance sits at {resistance}; profit target parked just under it at {price} — take money before the wall.",
    "zh-CN": "最近的阻力位在 {resistance}；将止盈设在其下方 {price}，在触及阻力前锁定盈利。",
  },
  "paper.targets.reason.clampMinRisk": {
    en: "Raw stop was tighter than {limit}; widened to survive spread + normal wiggles.",
    "zh-CN": "初步计算的止损距离小于 {limit}，已放宽以覆盖点差与正常波动。",
  },
  "paper.targets.reason.clampMaxRisk": {
    en: "Raw stop was wider than {limit}; capped so no single position risks too much.",
    "zh-CN": "初步计算的止损距离大于 {limit}，已压缩以避免单一持仓风险过大。",
  },
  "paper.targets.reason.rewardMultiple": {
    en: "Targeting {mult}× reward-to-risk: {risk} risk → {reward} target.",
    "zh-CN": "按 {mult} 倍回报/风险目标：{risk} 风险 → {reward} 收益空间。",
  },
  "paper.targets.reason.fallback": {
    en: "Not enough price history to be data-driven yet — falling back to a moderate 5% / 15% preset.",
    "zh-CN": "历史数据不足，暂时无法给出数据驱动的建议，采用「均衡」预设 -5% / +15%。",
  },

  // -------- Bot page --------
  "bot.title":              { en: "Alert Bot",    "zh-CN": "提醒机器人" },
  "bot.status":             { en: "Status",       "zh-CN": "状态" },
  "bot.enabled":            { en: "Enabled",      "zh-CN": "已启用" },
  "bot.on":                 { en: "ON",           "zh-CN": "开" },
  "bot.off":                { en: "OFF",          "zh-CN": "关" },
  "bot.telegram":           { en: "Telegram",     "zh-CN": "Telegram" },
  "bot.telegram.configured":  { en: "Configured",  "zh-CN": "已配置" },
  "bot.telegram.missing":   { en: "Missing token / chat id", "zh-CN": "缺少 token / chat id" },
  "bot.pollInterval":       { en: "Poll interval", "zh-CN": "轮询间隔" },
  "bot.lastTick":           { en: "Last tick",    "zh-CN": "上次运行" },
  "bot.lastErrors":         { en: "Last errors",  "zh-CN": "最近错误" },
  "bot.runTickNow":         { en: "Run one tick now", "zh-CN": "立即运行一次" },
  "bot.sendTest":           { en: "Send test alert",  "zh-CN": "发送测试通知" },
  "bot.clearHistory":       { en: "Clear signal history for {ticker}", "zh-CN": "清除 {ticker} 的信号历史" },
  "bot.strategies":         { en: "Strategies",   "zh-CN": "策略" },
  "bot.signalHistory":      { en: "Signal history · {ticker}", "zh-CN": "信号历史 · {ticker}" },
  "bot.signalHistoryHint":  { en: "All signals recorded by the bot, most recent first. Only cross-events get sent to Telegram.", "zh-CN": "机器人记录的所有信号，最新在前。仅交叉事件会推送至 Telegram。" },
  "bot.noSignals":          { en: "No signals recorded yet. Run one tick to seed the feed.", "zh-CN": "暂无信号记录。运行一次以填充数据。" },
  "bot.tickComplete":       { en: "Tick complete: {signals} signals, {alerts} alerts sent.", "zh-CN": "运行完成：{signals} 个信号，已发送 {alerts} 条通知。" },
  "bot.alertedViaTelegram": { en: "delivered", "zh-CN": "已送达" },
  "bot.strategy.sma":       { en: "SMA 50/200 crossover", "zh-CN": "SMA 50/200 均线交叉" },
  "bot.strategy.rsi":       { en: "RSI reversion",        "zh-CN": "RSI 回归" },
  "bot.strategy.macd":      { en: "MACD cross",           "zh-CN": "MACD 交叉" },
  "bot.signal.buy":         { en: "BUY",  "zh-CN": "买入" },
  "bot.signal.sell":        { en: "SELL", "zh-CN": "卖出" },
  "bot.signal.hold":        { en: "HOLD", "zh-CN": "持有" },

  // -------- Signal & Resonance alerts summary (on /bot) --------
  "bot.signalAlerts.title": {
    en: "Signal alerts",
    "zh-CN": "信号通知",
  },
  "bot.signalAlerts.subtitle": {
    en: "Every ticker you've enabled a Technical or Resonance alert on. Delete here to stop notifications — open the ticker to change the schedule or strength gate.",
    "zh-CN": "所有你已启用技术信号或共振通知的代码。在此处删除可停止通知——打开代码可更改时间或过滤强度。",
  },
  "bot.signalAlerts.technical.title": {
    en: "Technical signal alerts",
    "zh-CN": "技术信号通知",
  },
  "bot.signalAlerts.technical.hint": {
    en: "Fire when the Technical Signal verdict changes and/or as a daily digest.",
    "zh-CN": "当技术信号判断变化时触发，或按每日摘要发送。",
  },
  "bot.signalAlerts.technical.emptyBefore": {
    en: "None yet. Open a ticker's",
    "zh-CN": "尚无。打开某个代码的",
  },
  "bot.signalAlerts.technical.emptyLink": {
    en: "Technical Signal card",
    "zh-CN": "技术信号卡片",
  },
  "bot.signalAlerts.technical.emptyAfter": {
    en: "and click the bell icon to configure notifications.",
    "zh-CN": "并点击铃铛图标配置通知。",
  },
  "bot.signalAlerts.resonance.title": {
    en: "6-Signal Resonance alerts",
    "zh-CN": "6 信号共振通知",
  },
  "bot.signalAlerts.resonance.hint": {
    en: "Fire when a fresh 6-signal alignment triggers and/or as a daily digest.",
    "zh-CN": "当出现新的 6 信号共振时触发，或按每日摘要发送。",
  },
  "bot.signalAlerts.resonance.emptyBefore": {
    en: "None yet. Open a ticker's",
    "zh-CN": "尚无。打开某个代码的",
  },
  "bot.signalAlerts.resonance.emptyLink": {
    en: "6-Signal Resonance card",
    "zh-CN": "6 信号共振卡片",
  },
  "bot.signalAlerts.resonance.emptyAfter": {
    en: "and click the bell icon to configure notifications.",
    "zh-CN": "并点击铃铛图标配置通知。",
  },
  "bot.signalAlerts.onChange": {
    en: "On change",
    "zh-CN": "变化时",
  },
  "bot.signalAlerts.digestTitle": {
    en: "Daily digest at {time} ({tz})",
    "zh-CN": "每日 {time} ({tz}) 发送摘要",
  },
  "bot.signalAlerts.lastNotified": {
    en: "last fired {when}",
    "zh-CN": "上次触发 {when}",
  },
  "bot.signalAlerts.open": {
    en: "Open {ticker} in analysis",
    "zh-CN": "在分析页面打开 {ticker}",
  },
  "bot.signalAlerts.test": {
    en: "Send a test alert for {ticker}",
    "zh-CN": "为 {ticker} 发送测试通知",
  },
  "bot.signalAlerts.remove": {
    en: "Stop alerting on {ticker}",
    "zh-CN": "停止 {ticker} 的通知",
  },
  "bot.signalAlerts.confirmRemoveTechnical": {
    en: "Stop the Technical Signal alert on {ticker}?",
    "zh-CN": "停止 {ticker} 的技术信号通知？",
  },
  "bot.signalAlerts.confirmRemoveResonance": {
    en: "Stop the 6-Signal Resonance alert on {ticker}?",
    "zh-CN": "停止 {ticker} 的 6 信号共振通知？",
  },
  "bot.signalAlerts.removed": {
    en: "Alert removed for {ticker}.",
    "zh-CN": "已移除 {ticker} 的通知。",
  },
  "bot.signalAlerts.testSent": {
    en: "Test alert sent for {ticker}.",
    "zh-CN": "已为 {ticker} 发送测试通知。",
  },
  "bot.signalAlerts.strength.all": {
    en: "All changes",
    "zh-CN": "所有变化",
  },
  "bot.signalAlerts.strength.buySell": {
    en: "Buy / sell only",
    "zh-CN": "仅买入/卖出",
  },
  "bot.signalAlerts.strength.strongOnly": {
    en: "Strong only",
    "zh-CN": "仅强信号",
  },
  "bot.signalAlerts.strength.triggerOnly": {
    en: "Fresh triggers only",
    "zh-CN": "仅新触发",
  },

  // -------- Portfolios page --------
  "portfolios.title":            { en: "Portfolios", "zh-CN": "投资组合" },
  "portfolios.heading":          { en: "Whose trades are you following?", "zh-CN": "你在跟踪谁的交易？" },
  "portfolios.subheading":       { en: "House-side STOCK Act disclosures (PTR filings), SEC 13F institutional holdings, and individual insider filings (Forms 3/4/5) — all pulled straight from the official sources.", "zh-CN": "众议院侧 STOCK Act 披露（PTR 文件）、SEC 13F 机构持仓、以及个人内部人士文件（Forms 3/4/5）——全部直接来自官方来源。" },
  "portfolios.cat.people":       { en: "People",        "zh-CN": "人物" },
  "portfolios.cat.politicians":  { en: "Politicians",   "zh-CN": "政治人物" },
  "portfolios.cat.funds":        { en: "Fund managers", "zh-CN": "基金经理" },
  "portfolios.cat.people.singular":      { en: "person",        "zh-CN": "人物" },
  "portfolios.cat.politicians.singular": { en: "politician",    "zh-CN": "政治人物" },
  "portfolios.cat.funds.singular":       { en: "fund manager",  "zh-CN": "基金经理" },
  "portfolios.rail.searchPlaceholder":   { en: "Search presets…", "zh-CN": "搜索预设…" },
  "portfolios.rail.recent":              { en: "Recently viewed ({n})", "zh-CN": "最近查看 ({n})" },
  "portfolios.rail.noMatch":             { en: "No presets match \"{q}\".", "zh-CN": "没有匹配 \"{q}\" 的预设。" },
  "portfolios.rail.noneYet":             { en: "No {label} yet.", "zh-CN": "暂无{label}。" },
  "portfolios.rail.addOne":              { en: "Add one", "zh-CN": "添加一个" },
  "portfolios.rail.customBadge":         { en: "custom", "zh-CN": "自定义" },
  "portfolios.rail.customTitle":         { en: "Custom preset (added by you)", "zh-CN": "自定义预设（由你添加）" },
  "portfolios.rail.addAction":           { en: "Add", "zh-CN": "添加" },
  "portfolios.rail.pickPrompt":          { en: "Pick someone on the left to see their trades.", "zh-CN": "从左侧选择一个人物以查看其交易。" },
  "portfolios.dialog.title":             { en: "Add a {singular}", "zh-CN": "添加{singular}" },
  "portfolios.pdf.picker.hint":          { en: "Pick a filing on the left to preview it inline.", "zh-CN": "从左侧选择一份文件以在此内嵌预览。" },
  "portfolios.pdf.openPdf":              { en: "Open PDF", "zh-CN": "打开 PDF" },
  "portfolios.pdf.each":                 { en: "Each PDF lists every trade in that report — ticker, buy/sell/exchange, amount range, and transaction date.", "zh-CN": "每份 PDF 列出该报告中的所有交易——代码、买卖/兑换、金额区间、交易日期。" },
  "portfolios.senate.title":             { en: "Senate filings aren't wired in yet", "zh-CN": "参议院文件尚未接入" },
  "portfolios.stockact.title":           { en: "House Clerk feed unreachable", "zh-CN": "众议院书记员数据源无法访问" },
  "portfolios.sec.throttled":            { en: "SEC EDGAR is throttling us. Try again in a minute.", "zh-CN": "SEC EDGAR 正在限速。请一分钟后重试。" },
  "portfolios.railHint":                 { en: "Pick someone from the sidebar to open their trades. Use the \"+ Add\" button in each sidebar section to track a new person, politician, or fund manager.", "zh-CN": "从侧边栏选择一位以查看其交易。点击每个侧边栏分组中的 \"+ 添加\" 按钮可跟踪新的人物、政治人物或基金经理。" },
  "portfolios.empty.title":              { en: "No preset selected", "zh-CN": "未选择任何预设" },
  "portfolios.empty.body":               { en: "Pick someone from the sidebar, or start a new tracking list here.", "zh-CN": "从侧边栏选择一位，或在此处新建一个跟踪列表。" },
  "portfolios.empty.add":                { en: "Add {label}", "zh-CN": "添加{label}" },
  "portfolios.small.filingsParsed":      { en: "Filings parsed", "zh-CN": "已解析文件数" },
  "portfolios.small.transactions":       { en: "Transactions",   "zh-CN": "交易数" },
  "portfolios.small.companiesHeld":      { en: "Companies held", "zh-CN": "持有公司数" },
  "portfolios.small.ptrFilings":         { en: "PTR filings",    "zh-CN": "PTR 文件数" },
  "portfolios.small.parsedTrades":       { en: "Parsed trades",  "zh-CN": "已解析交易数" },
  "portfolios.small.tickersTouched":     { en: "Tickers touched", "zh-CN": "涉及代码数" },
  "portfolios.small.reportingPeriod":    { en: "Reporting period", "zh-CN": "申报期" },
  "portfolios.small.positions":          { en: "Positions",      "zh-CN": "持仓数" },
  "portfolios.small.portfolioValue":     { en: "Portfolio value", "zh-CN": "组合价值" },

  // -------- Add-form field labels --------
  "form.displayName":     { en: "Display name",        "zh-CN": "显示名称" },
  "form.displayNameHint": { en: "How the name appears in your sidebar. Edit if the SEC formatting looks odd.", "zh-CN": "在侧边栏中显示的名称。若 SEC 格式看起来奇怪可编辑。" },
  "form.role":            { en: "Role",                "zh-CN": "职位" },
  "form.rolePlaceholder": { en: "Company X CEO & Director", "zh-CN": "某公司 CEO 兼董事" },
  "form.namePolitician":  { en: "Name (as it appears on House Clerk filings)", "zh-CN": "姓名（与众议院书记员文件保持一致）" },
  "form.chamber":         { en: "Chamber", "zh-CN": "议会" },
  "form.chamberHouse":    { en: "House (supported)",   "zh-CN": "众议院（已支持）" },
  "form.chamberSenate":   { en: "Senate (data source not wired)", "zh-CN": "参议院（数据源未接入）" },
  "form.party":           { en: "Party", "zh-CN": "党派" },
  "form.party.d":         { en: "Democrat",     "zh-CN": "民主党" },
  "form.party.r":         { en: "Republican",   "zh-CN": "共和党" },
  "form.party.i":         { en: "Independent",  "zh-CN": "独立" },
  "form.roleOptional":    { en: "Role (optional)", "zh-CN": "职位（可选）" },
  "form.manager":         { en: "Manager (optional)", "zh-CN": "经理（可选）" },
  "form.managerHint":     { en: "Human name to display. If left blank we use the firm name.", "zh-CN": "要显示的自然人姓名。留空则使用公司名。" },
  "form.firm":            { en: "Firm", "zh-CN": "公司" },
  "form.noteOptional":    { en: "Note (optional)", "zh-CN": "备注（可选）" },
  "form.personSearchIntro":{ en: "Search by name — we look them up on SEC EDGAR and pull the CIK automatically. Choose the right person from the list.", "zh-CN": "按姓名搜索——我们会在 SEC EDGAR 查询并自动获取 CIK。从列表中选择正确的人物。" },
  "form.fundSearchIntro":  { en: "Search by firm or manager — 13F filers are indexed on SEC EDGAR by the fund entity's registered name (e.g. \"Pershing Square Capital\", \"Ark Investment Management\"). Pick the right one and we'll grab the CIK for you.", "zh-CN": "按公司或经理人搜索——13F 申报人在 SEC EDGAR 上以基金实体的注册名索引（例如 \"Pershing Square Capital\"、\"Ark Investment Management\"）。选中后我们会自动带出 CIK。" },
  "form.politicianDataSource":{ en: "Data source: U.S. House of Representatives Clerk (STOCK Act PTR filings only). Presidents, Cabinet secretaries and other executive-branch officials file with the OGE (Form 278) — not covered here. Senators use efdsearch.senate.gov, also not scraped.", "zh-CN": "数据来源：美国众议院书记员（仅限 STOCK 法案 PTR 文件）。总统、内阁部长及其他行政分支官员使用 OGE 提交（Form 278）——此处未覆盖。参议员使用 efdsearch.senate.gov——同样未抓取。" },
  "form.politicianNameHint":{ en: "Matching is first-name prefix + last-name substring, so middle names are fine. But the person MUST be a current U.S. House Representative for any filings to show.", "zh-CN": "匹配为名字前缀 + 姓氏子串，含中间名亦可。但该人物必须是现任美国众议员，其文件才能显示。" },
  "portfolios.dialog.selectedOn":{ en: "Selected on SEC EDGAR", "zh-CN": "已在 SEC EDGAR 选中" },

  "entitySearch.personPlaceholder":{ en: "Search insiders on SEC EDGAR (e.g. Elon Musk, Tim Cook)", "zh-CN": "在 SEC EDGAR 搜索内部人士（如 Elon Musk、Tim Cook）" },
  "entitySearch.fundPlaceholder":  { en: "Search 13F filers on SEC EDGAR (e.g. Berkshire, Buffett, Ark Invest)", "zh-CN": "在 SEC EDGAR 搜索 13F 申报人（如 Berkshire、Buffett、Ark Invest）" },
  "entitySearch.personAria":       { en: "Search insiders on SEC EDGAR", "zh-CN": "在 SEC EDGAR 搜索内部人士" },
  "entitySearch.fundAria":         { en: "Search fund managers on SEC EDGAR", "zh-CN": "在 SEC EDGAR 搜索基金经理" },
  "entitySearch.noMatch":          { en: "No SEC filers matched \"{q}\". Try a different spelling or the firm name instead of the person.", "zh-CN": "没有匹配 \"{q}\" 的 SEC 申报人。换个拼写或改用公司名而非个人名试试。" },
  "entitySearch.lastFiled":        { en: "last filed {date}", "zh-CN": "最近申报 {date}" },
  "entitySearch.filingCount":      { en: "{n} filings", "zh-CN": "{n} 份文件" },

  // -------- Beginner glossary panel --------
  "keyTerms.title":       { en: "Key terms on this page", "zh-CN": "本页关键术语" },
  "keyTerms.count":       { en: "{n} term · plain-English definitions", "zh-CN": "共 {n} 个术语 · 通俗易懂的解释" },
  "keyTerms.countPlural": { en: "{n} terms · plain-English definitions", "zh-CN": "共 {n} 个术语 · 通俗易懂的解释" },
  "beginner.badge":       { en: "Beginner", "zh-CN": "入门" },

  // -------- Watchlist quick-add button --------
  "watchlist.add":     { en: "Add {symbol} to watchlist",     "zh-CN": "将 {symbol} 添加到关注列表" },
  "watchlist.remove":  { en: "Remove {symbol} from watchlist", "zh-CN": "将 {symbol} 从关注列表移除" },
  "watchlist.inList":  { en: "In watchlist",                    "zh-CN": "已在关注列表" },
  "watchlist.inListTitle":{ en: "{symbol} is in your watchlist","zh-CN": "{symbol} 已在你的关注列表中" },
  "watchlist.addIssuer": {
    en: "Add to watchlist",
    "zh-CN": "添加到关注列表",
  },
  "watchlist.tickerHint": {
    en: "Enter the ticker for {name}. Use the Look up link if you're not sure.",
    "zh-CN": "输入 {name} 的股票代码。如不确定，请使用旁边的“查询”链接。",
  },
  "watchlist.tickerRequired": {
    en: "Please enter a ticker symbol.",
    "zh-CN": "请输入股票代码。",
  },
};

/**
 * Look up a translation, with English fallback for missing zh-CN keys and
 * `{name}` placeholder interpolation.
 */
export function translate(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const entry = DICT[key];
  let value: string;
  if (!entry) {
    value = key;
  } else {
    value = entry[locale] ?? entry.en;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}
