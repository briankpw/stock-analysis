/**
 * Curated market-segment universe.
 *
 * Each segment bundles:
 *   1. A **proxy ETF** — a single ticker whose price action we treat as
 *      the segment's health thermometer. ETFs are picked so that they
 *      track the theme closely (SMH for semis, XLV for healthcare, etc.)
 *      and are liquid enough for stable daily bars.
 *   2. A hand-picked list of **constituent leaders** — the household-name
 *      companies retail investors identify with the theme, in rough order
 *      of size / mind-share. Deliberately *not* a full index-membership
 *      dump: retail readers want the leaders, not row 143 of an ETF's
 *      long tail.
 *
 * The segments page uses the proxy ETF to compute a bullish / bearish
 * verdict (via `computeTechnicalSignal`) and the constituent list to
 * populate the "which companies are in this bucket" drilldown.
 *
 * Sizing guidance: 15–25 constituents per bucket is the sweet spot —
 * enough for the heatmap to look substantive, few enough that the
 * detail-page fan-out (each ticker triggers a Yahoo history + quote
 * fetch, both cached for 15 minutes) stays quick on a cold cache.
 * Prefer US-listed ADRs over foreign primaries, and if you swap a
 * proxy ETF verify the new one has ≥1 year of history.
 */

import type { Locale } from "./state";

export interface Segment {
  /** Stable URL slug. Never change once shipped — the /market/segments/[id] route pins to it. */
  id: string;
  /** Human name (English source of truth). */
  name: string;
  /** Optional Simplified Chinese translation. Falls back to `name`. */
  nameZh?: string;
  /** One-liner shown under the header on the detail page. */
  description: string;
  descriptionZh?: string;
  /** Single ticker used as the theme thermometer (an ETF). */
  proxyEtf: string;
  /** Human name of the proxy ETF for the "Tracked by" tag. */
  proxyEtfName: string;
  /** Household-name constituents, rough size order. */
  tickers: string[];
}

export interface IndexDef {
  id: string;
  ticker: string;
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
}

// ---------------------------------------------------------------------------
// Broad-market indices — always shown at the top of the segments page so
// users see the macro backdrop before drilling into a theme.
// ---------------------------------------------------------------------------

export const INDICES: readonly IndexDef[] = [
  {
    id: "sp500",
    ticker: "^GSPC",
    name: "S&P 500",
    nameZh: "标普 500",
    description: "500 largest US public companies — the default US-market benchmark.",
    descriptionZh: "美国最大 500 家上市公司——美股默认基准。",
  },
  {
    id: "nasdaq",
    ticker: "^IXIC",
    name: "Nasdaq Composite",
    nameZh: "纳斯达克综合",
    description: "All Nasdaq-listed stocks — tech-heavy, growth-tilted.",
    descriptionZh: "纳斯达克所有上市股票——偏科技、偏成长。",
  },
  {
    id: "nasdaq100",
    ticker: "^NDX",
    name: "Nasdaq 100",
    nameZh: "纳斯达克 100",
    description: "100 largest non-financial Nasdaq names — the 'big tech' benchmark.",
    descriptionZh: "纳斯达克前 100 大非金融公司——'大科技'基准。",
  },
  {
    id: "dow",
    ticker: "^DJI",
    name: "Dow Jones",
    nameZh: "道琼斯工业",
    description: "30 blue-chip US industrials, price-weighted.",
    descriptionZh: "美国 30 只蓝筹工业股，按价格加权。",
  },
  {
    id: "russell2000",
    ticker: "^RUT",
    name: "Russell 2000",
    nameZh: "罗素 2000",
    description: "US small-cap benchmark — leading gauge of domestic risk appetite.",
    descriptionZh: "美国小盘股基准——反映本土风险偏好。",
  },
  {
    id: "vix",
    ticker: "^VIX",
    name: "VIX",
    nameZh: "波动率指数",
    description:
      "Expected 30-day S&P 500 volatility. High VIX = fearful market; below 15 = complacent.",
    descriptionZh:
      "对未来 30 日标普 500 波动的预期。VIX 高 = 市场恐慌；低于 15 = 麻痹自满。",
  },
  {
    id: "hsi",
    ticker: "^HSI",
    name: "Hang Seng",
    nameZh: "恒生指数",
    description: "Hong Kong's headline index — read for China / HK-listed risk.",
    descriptionZh: "香港市场基准——观察中概与港股风险。",
  },
  {
    id: "nikkei",
    ticker: "^N225",
    name: "Nikkei 225",
    nameZh: "日经 225",
    description: "Japan's blue-chip index — cyclical + yen-linked.",
    descriptionZh: "日本蓝筹基准——周期性、与日元汇率挂钩。",
  },
  {
    id: "sse-composite",
    ticker: "000001.SS",
    name: "SSE Composite",
    nameZh: "上证综指",
    description: "Shanghai Stock Exchange — the on-shore China A-share benchmark.",
    descriptionZh: "上海证券交易所——中国 A 股在岸市场基准。",
  },
  {
    id: "csi300",
    ticker: "000300.SS",
    name: "CSI 300",
    nameZh: "沪深 300",
    description: "Top 300 Shanghai + Shenzhen A-shares — cleanest China large-cap read.",
    descriptionZh: "沪深两市规模前 300 只 A 股——最干净的中国大盘读数。",
  },
  {
    id: "dax",
    ticker: "^GDAXI",
    name: "DAX",
    nameZh: "德国 DAX",
    description: "Germany's 40 largest listed companies — Europe's industrial bellwether.",
    descriptionZh: "德国规模最大的 40 家上市公司——欧洲工业风向标。",
  },
  {
    id: "ftse100",
    ticker: "^FTSE",
    name: "FTSE 100",
    nameZh: "富时 100",
    description: "UK large-caps — commodity-heavy, USD-earner tilt.",
    descriptionZh: "英国大盘蓝筹——大宗商品和美元营收权重较高。",
  },
  {
    id: "cac40",
    ticker: "^FCHI",
    name: "CAC 40",
    nameZh: "法国 CAC 40",
    description: "France's 40 largest listed companies — luxury + industrial mix.",
    descriptionZh: "法国规模最大的 40 家上市公司——奢侈品与工业混合体。",
  },
  {
    id: "kospi",
    ticker: "^KS11",
    name: "KOSPI",
    nameZh: "韩国 KOSPI",
    description: "South Korea's headline index — semis, autos, and shipbuilding weight.",
    descriptionZh: "韩国主要基准指数——半导体、汽车与造船板块权重高。",
  },
  {
    id: "asx200",
    ticker: "^AXJO",
    name: "ASX 200",
    nameZh: "澳洲 ASX 200",
    description: "Australia's 200 largest listed companies — miner-heavy, commodity-driven.",
    descriptionZh: "澳大利亚规模最大的 200 家上市公司——采矿股权重高、随大宗商品波动。",
  },
  {
    id: "sensex",
    ticker: "^BSESN",
    name: "BSE Sensex",
    nameZh: "印度 Sensex",
    description: "India's 30-name blue-chip index — reads emerging-market growth appetite.",
    descriptionZh: "印度 30 只蓝筹股基准——反映新兴市场成长偏好。",
  },
  {
    id: "tsx",
    ticker: "^GSPTSE",
    name: "S&P/TSX Composite",
    nameZh: "加拿大 TSX",
    description: "Canada's benchmark — banks and energy dominate the weights.",
    descriptionZh: "加拿大股市基准——银行与能源板块权重占主导。",
  },
  {
    id: "wti-crude",
    ticker: "CL=F",
    name: "WTI Crude Oil",
    nameZh: "WTI 原油",
    description:
      "Front-month WTI futures — US crude benchmark, drives energy stocks and inflation.",
    descriptionZh: "近月 WTI 期货——美国原油基准，牵动能源股与通胀预期。",
  },
  {
    id: "gold-spot",
    ticker: "GC=F",
    name: "Gold Futures",
    nameZh: "黄金期货",
    description: "COMEX gold futures — safe-haven bid; inverse to real rates + USD.",
    descriptionZh: "COMEX 黄金期货——避险资产，与实际利率和美元反向。",
  },
  {
    id: "dxy",
    ticker: "DX-Y.NYB",
    name: "US Dollar Index (DXY)",
    nameZh: "美元指数",
    description:
      "USD vs. basket of major currencies. Rising DXY = headwind for commodities and EM.",
    descriptionZh: "美元对一篮子主要货币汇率。DXY 上行 = 大宗商品与新兴市场承压。",
  },
  {
    id: "ust10y",
    ticker: "^TNX",
    name: "US 10-Year Yield",
    nameZh: "美国 10 年期国债收益率",
    description: "10-year Treasury yield — the discount rate under every valuation model.",
    descriptionZh: "10 年期美国国债收益率——所有估值模型背后的贴现率。",
  },
  {
    id: "bitcoin",
    ticker: "BTC-USD",
    name: "Bitcoin",
    nameZh: "比特币",
    description:
      "24/7 crypto majors' bellwether — moves with global liquidity and risk appetite.",
    descriptionZh: "7×24 加密龙头——跟随全球流动性与风险偏好波动。",
  },
] as const;

// ---------------------------------------------------------------------------
// Segments — thematic baskets. Ordered by rough current-cycle popularity;
// the UI will surface them in the order defined here.
// ---------------------------------------------------------------------------

export const SEGMENTS: readonly Segment[] = [
  {
    id: "ai",
    name: "Artificial Intelligence",
    nameZh: "人工智能",
    description:
      "Chip suppliers, hyperscalers, and pure-play platform names powering the LLM buildout.",
    descriptionZh:
      "为大模型建设提供算力、云基础设施与应用平台的芯片、云厂商和纯 AI 概念公司。",
    proxyEtf: "AIQ",
    proxyEtfName: "Global X Artificial Intelligence & Technology ETF",
    tickers: [
      "NVDA", "MSFT", "GOOGL", "META", "AMZN", "AAPL", "TSLA", "AVGO", "TSM",
      "ORCL", "CRM", "NOW", "ADBE", "PLTR", "AMD", "INTC", "QCOM", "MU", "MRVL",
      "ARM", "ANET", "SMCI", "DELL", "HPE", "VRT", "SNOW", "MDB", "CRWD", "IBM",
      "CDNS", "SNPS", "AI", "PATH", "ACN",
    ],
  },
  {
    id: "semiconductors",
    name: "Semiconductors",
    nameZh: "半导体",
    description:
      "Fabless designers, foundries, and equipment makers — the physical layer behind every AI, EV, and cloud story.",
    descriptionZh:
      "无晶圆设计公司、晶圆代工与设备厂商——AI、电动车、云计算故事背后的物理层。",
    proxyEtf: "SMH",
    proxyEtfName: "VanEck Semiconductor ETF",
    tickers: [
      "NVDA", "TSM", "AVGO", "ASML", "AMD", "QCOM", "TXN", "MU", "INTC", "LRCX",
      "AMAT", "KLAC", "MRVL", "MCHP", "ADI", "ON", "NXPI", "SMCI", "STM", "ARM",
      "GFS", "SWKS", "WOLF", "QRVO", "ENTG", "POWI", "MPWR", "LSCC", "TER", "RMBS",
      "ALGM", "UMC", "COHR", "ACLS",
    ],
  },
  {
    id: "cloud",
    name: "Cloud & SaaS",
    nameZh: "云与 SaaS",
    description:
      "Hyperscalers plus best-of-breed subscription-software franchises — the recurring-revenue engine of tech.",
    descriptionZh: "云厂商与订阅制软件龙头——科技行业的经常性收入引擎。",
    proxyEtf: "WCLD",
    proxyEtfName: "WisdomTree Cloud Computing Fund",
    tickers: [
      "MSFT", "GOOGL", "AMZN", "ORCL", "CRM", "NOW", "ADBE", "SNOW", "SHOP",
      "WDAY", "DDOG", "MDB", "ZM", "DOCU", "TEAM", "HUBS", "NET", "OKTA", "ZS",
      "TWLO", "GTLB", "S", "VEEV", "BILL", "ESTC", "CFLT", "FROG", "PATH", "ASAN",
      "PD", "U", "BRZE", "APP", "DBX", "PANW",
    ],
  },
  {
    id: "software",
    name: "Enterprise Software",
    nameZh: "企业软件",
    description:
      "Application, platform, and infrastructure software — the highest-margin corner of tech.",
    descriptionZh: "应用、平台与基础软件——科技行业中利润率最高的一块。",
    proxyEtf: "IGV",
    proxyEtfName: "iShares Expanded Tech-Software Sector ETF",
    tickers: [
      "MSFT", "ORCL", "CRM", "ADBE", "SAP", "INTU", "NOW", "PANW", "SNPS",
      "CDNS", "WDAY", "FTNT", "TEAM", "HUBS", "MDB", "DDOG", "SNOW", "PLTR",
      "ROP", "ADSK", "VEEV", "ANSS", "TYL", "PTC", "IBM", "TWLO", "ZS", "CRWD",
      "GEN", "OKTA", "U", "ESTC", "APP", "PATH",
    ],
  },
  {
    id: "cybersecurity",
    name: "Cybersecurity",
    nameZh: "网络安全",
    description:
      "Endpoint, network, and cloud-security platforms — a defensive-tech theme with long-cycle secular demand.",
    descriptionZh:
      "端点、网络与云安全平台——具有长期结构性需求的防御性科技板块。",
    proxyEtf: "CIBR",
    proxyEtfName: "First Trust NASDAQ Cybersecurity ETF",
    tickers: [
      "CRWD", "PANW", "ZS", "FTNT", "S", "NET", "OKTA", "CYBR", "TENB", "QLYS",
      "RBRK", "CHKP", "RPD", "GEN", "VRSN", "FFIV", "AKAM", "VRNS", "RDWR", "JAMF",
      "NABL", "ATEN", "FSLY", "BB", "DGII", "DBX", "MITK", "CSCO", "TWLO", "MSFT",
    ],
  },
  {
    id: "fintech",
    name: "Fintech & Payments",
    nameZh: "金融科技与支付",
    description:
      "Card networks, payment processors, and next-gen digital-money platforms.",
    descriptionZh: "卡组织、支付处理与新一代数字支付平台。",
    proxyEtf: "FINX",
    proxyEtfName: "Global X FinTech ETF",
    tickers: [
      "V", "MA", "PYPL", "SQ", "COIN", "FIS", "FI", "ADP", "PAYX", "SOFI",
      "AFRM", "HOOD", "NU", "MELI", "ADYEY", "MQ", "BILL", "GPN", "JKHY", "SSNC",
      "TW", "MKTX", "NDAQ", "STNE", "DLO", "RELY", "FLYW", "WEX", "TOST", "PAYO",
      "LC", "UPST", "CPAY",
    ],
  },
  {
    id: "ev",
    name: "Electric Vehicles & Autonomy",
    nameZh: "电动车与自动驾驶",
    description:
      "OEMs, autonomy stacks, and legacy automakers making the EV transition — high-beta, headline-driven.",
    descriptionZh:
      "整车厂、自动驾驶方案商与转型电动化的传统车企——高波动、新闻敏感。",
    proxyEtf: "DRIV",
    proxyEtfName: "Global X Autonomous & Electric Vehicles ETF",
    tickers: [
      "TSLA", "NIO", "RIVN", "LCID", "F", "GM", "LI", "XPEV", "BYDDY", "VWAGY",
      "TM", "HMC", "STLA", "PSNY", "MBLY", "APTV", "QS", "CHPT", "BLNK", "NKLA",
      "WKHS", "EVGO", "WBX", "PLUG", "ALB", "ALTM", "SQM", "PII", "NIU", "LEV",
      "HYLN", "BLDP",
    ],
  },
  {
    id: "bigtech",
    name: "Big Tech (Mega-cap)",
    nameZh: "科技巨头",
    description:
      "The 'Magnificent Seven' and their neighbours — dominates every US large-cap index by weight.",
    descriptionZh: "'Magnificent Seven'及其近邻——按权重主导美股大盘指数。",
    proxyEtf: "XLK",
    proxyEtfName: "Technology Select Sector SPDR",
    tickers: [
      "AAPL", "MSFT", "GOOGL", "GOOG", "META", "AMZN", "NVDA", "TSLA", "NFLX",
      "AVGO", "ORCL", "ADBE", "CRM", "AMD", "PLTR", "INTC", "CSCO", "QCOM", "IBM",
      "NOW", "INTU", "SNOW", "PANW", "CRWD", "ANET", "MU", "MRVL", "TXN", "ACN",
      "UBER", "TSM", "ARM",
    ],
  },
  {
    id: "healthcare",
    name: "Healthcare",
    nameZh: "医疗保健",
    description:
      "Diversified pharma, medical devices, and payers — defensive with pockets of growth (GLP-1, oncology).",
    descriptionZh:
      "多元化药企、医疗器械与支付方——防御性板块，含 GLP-1、肿瘤等成长口袋。",
    proxyEtf: "XLV",
    proxyEtfName: "Health Care Select Sector SPDR",
    tickers: [
      "LLY", "JNJ", "UNH", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "ISRG",
      "AMGN", "SYK", "BMY", "GILD", "MDT", "CVS", "ELV", "CI", "HCA", "REGN",
      "VRTX", "BSX", "ZTS", "BDX", "NVO", "EW", "IDXX", "HUM", "MCK", "DXCM",
      "IQV", "WAT", "RMD", "A", "MTD", "CNC", "COR",
    ],
  },
  {
    id: "glp1",
    name: "GLP-1 & Obesity",
    nameZh: "GLP-1 与减重药",
    description:
      "Weight-loss and diabetes drug makers plus device suppliers riding the GLP-1 wave.",
    descriptionZh: "受益于 GLP-1 浪潮的减重与糖尿病药物公司及其上下游供应商。",
    proxyEtf: "XLV",
    proxyEtfName: "Health Care Select Sector SPDR (proxy)",
    tickers: [
      "LLY", "NVO", "PFE", "AMGN", "VKTX", "TERN", "ALT", "STVN", "MRK", "RHHBY",
      "AZN", "ROIV", "BHVN", "WST", "DXCM", "MDT", "ABBV", "REGN", "ISRG", "ZBH",
      "SNY", "TAK", "GH", "NBIX",
    ],
  },
  {
    id: "biotech",
    name: "Biotech",
    nameZh: "生物科技",
    description:
      "Innovative drug developers — episodic, catalyst-driven, more volatile than large-cap pharma.",
    descriptionZh: "创新药公司——事件驱动、波动性显著高于大型制药股。",
    proxyEtf: "XBI",
    proxyEtfName: "SPDR S&P Biotech ETF",
    tickers: [
      "VRTX", "REGN", "GILD", "AMGN", "BIIB", "MRNA", "ILMN", "BMRN", "INCY",
      "BEAM", "CRSP", "NTLA", "EDIT", "SRPT", "IONS", "EXEL", "ALNY", "ALKS",
      "MDGL", "KRTX", "RXRX", "RVMD", "LEGN", "ARWR", "CDNA", "ROIV", "SGMO",
      "JAZZ", "ARGX", "XENE", "NBIX", "BHVN", "IMCR", "ITCI",
    ],
  },
  {
    id: "financials",
    name: "Financials",
    nameZh: "金融",
    description:
      "Money-center banks, brokers, and asset managers — reads the credit cycle and rate direction.",
    descriptionZh: "大型商业银行、经纪商与资产管理公司——反映信用周期与利率方向。",
    proxyEtf: "XLF",
    proxyEtfName: "Financial Select Sector SPDR",
    tickers: [
      "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP", "USB",
      "PNC", "TFC", "CB", "MMC", "SPGI", "ICE", "CME", "COF", "AIG", "MET",
      "PRU", "ALL", "TRV", "HIG", "DFS", "SYF", "MCO", "RJF", "LNC", "AON",
      "WTW", "PGR", "AJG", "BX",
    ],
  },
  {
    id: "regional-banks",
    name: "Regional Banks",
    nameZh: "美国地区性银行",
    description:
      "Mid-size US commercial banks — sensitive to net-interest-margin and CRE credit quality.",
    descriptionZh: "美国中型商业银行——对净息差与商业地产资产质量敏感。",
    proxyEtf: "KRE",
    proxyEtfName: "SPDR S&P Regional Banking ETF",
    tickers: [
      "USB", "PNC", "TFC", "FITB", "MTB", "RF", "KEY", "CFG", "HBAN", "ZION",
      "WAL", "CMA", "FHN", "SNV", "CFR", "PB", "EWBC", "FLG", "BANC", "ASB",
      "WTFC", "FCNCA", "HOMB", "INDB", "VLY", "OZK", "WAFD", "UMBF", "TCBI", "CATY",
      "PPBI", "WBS", "ONB",
    ],
  },
  {
    id: "energy",
    name: "Energy (Oil & Gas)",
    nameZh: "能源（油气）",
    description:
      "Majors and shale — cyclical, driven by crude prices and geopolitical premium.",
    descriptionZh: "石油巨头与页岩公司——周期性板块，受原油价格与地缘政治溢价驱动。",
    proxyEtf: "XLE",
    proxyEtfName: "Energy Select Sector SPDR",
    tickers: [
      "XOM", "CVX", "COP", "EOG", "SLB", "PSX", "MPC", "OXY", "HES", "VLO",
      "DVN", "FANG", "HAL", "BKR", "APA", "OKE", "WMB", "HP", "NOV", "FTI",
      "TRGP", "KMI", "LNG", "CQP", "TPL", "MTDR", "PR", "CTRA", "EQT", "AR",
      "CRK", "MGY", "SM", "CIVI",
    ],
  },
  {
    id: "clean-energy",
    name: "Clean Energy & Solar",
    nameZh: "清洁能源与太阳能",
    description:
      "Solar, storage, and utility-scale wind — rate-sensitive; big beta to policy shifts.",
    descriptionZh: "太阳能、储能与陆上风电——对利率敏感，对政策变化高度弹性。",
    proxyEtf: "ICLN",
    proxyEtfName: "iShares Global Clean Energy ETF",
    tickers: [
      "ENPH", "FSLR", "SEDG", "NEE", "PLUG", "RUN", "ARRY", "BE", "NOVA", "BEP",
      "CWEN", "HASI", "JKS", "CSIQ", "SHLS", "FLNC", "STEM", "NEP", "AMPS", "ORA",
      "MAXN", "DQ", "BLDP", "GEV", "AY", "CLNE", "SLDP", "WBX", "CHPT", "EVGO",
    ],
  },
  {
    id: "uranium-nuclear",
    name: "Uranium & Nuclear",
    nameZh: "铀与核能",
    description:
      "Uranium miners, enrichers, and reactor builders — beneficiaries of the AI-power buildout.",
    descriptionZh: "铀矿开采、浓缩与反应堆建设——受益于 AI 电力需求的增长。",
    proxyEtf: "URA",
    proxyEtfName: "Global X Uranium ETF",
    tickers: [
      "CCJ", "URNM", "NXE", "DNN", "LEU", "SMR", "OKLO", "BWXT", "CEG", "VST",
      "ETR", "UEC", "URG", "GEV", "BW", "NRG", "PPL", "EXC", "NGG", "AEP",
      "NEE", "TLN", "DUK", "AES", "SO", "D",
    ],
  },
  {
    id: "consumer-discretionary",
    name: "Consumer Discretionary",
    nameZh: "非必需消费",
    description:
      "Retail, autos, restaurants, travel — pro-cyclical, follows employment + real-income trends.",
    descriptionZh: "零售、汽车、餐饮、旅游——顺周期，跟随就业与实际收入走向。",
    proxyEtf: "XLY",
    proxyEtfName: "Consumer Discretionary Select Sector SPDR",
    tickers: [
      "AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "TGT", "BKNG", "ABNB",
      "TJX", "MAR", "CMG", "ORLY", "GM", "F", "LULU", "DHI", "LEN", "EBAY",
      "ETSY", "DPZ", "YUM", "RCL", "CCL", "NCLH", "MGM", "LVS", "WYNN", "RH",
      "W", "CROX", "DECK", "HLT",
    ],
  },
  {
    id: "consumer-staples",
    name: "Consumer Staples",
    nameZh: "必需消费",
    description:
      "Household + food + beverages — classic defensive; owns pricing power through cycles.",
    descriptionZh: "日用品、食品与饮料——经典防御板块，具穿越周期的定价能力。",
    proxyEtf: "XLP",
    proxyEtfName: "Consumer Staples Select Sector SPDR",
    tickers: [
      "WMT", "PG", "KO", "COST", "PEP", "PM", "MO", "MDLZ", "CL", "TGT",
      "KMB", "GIS", "SYY", "KHC", "STZ", "MNST", "HSY", "CHD", "DEO", "EL",
      "BF-B", "TAP", "CLX", "KVUE", "SJM", "K", "HRL", "TSN", "ADM", "CAG",
      "KDP", "MKC", "CPB",
    ],
  },
  {
    id: "retail",
    name: "Retail",
    nameZh: "零售",
    description:
      "Big-box, off-price, e-commerce, and specialty retail — pulses with US consumer wallet share.",
    descriptionZh: "大型综合店、折扣店、电商与特色零售——反映美国消费者钱包份额变动。",
    proxyEtf: "XRT",
    proxyEtfName: "SPDR S&P Retail ETF",
    tickers: [
      "AMZN", "WMT", "COST", "HD", "LOW", "TGT", "TJX", "DG", "DLTR", "ROST",
      "BBY", "KR", "ULTA", "GPS", "M", "KSS", "AAP", "AZO", "FIVE", "BURL",
      "OLLI", "DKS", "CVNA", "URBN", "ANF", "AEO", "PVH", "RL", "TPR", "CPRI",
      "LEVI", "GES", "CHWY",
    ],
  },
  {
    id: "communications",
    name: "Communication Services",
    nameZh: "通讯服务",
    description:
      "Advertising, streaming, telecom — an unusual mix that combines Google/Meta with the phone companies.",
    descriptionZh: "广告、流媒体与电信运营——把 Google/Meta 与电信公司并置的复合板块。",
    proxyEtf: "XLC",
    proxyEtfName: "Communication Services Select Sector SPDR",
    tickers: [
      "GOOGL", "GOOG", "META", "NFLX", "TMUS", "DIS", "VZ", "T", "CMCSA",
      "CHTR", "TTD", "EA", "TTWO", "WBD", "PARA", "SPOT", "PINS", "SNAP",
      "RBLX", "FOXA", "FOX", "NWSA", "LYV", "WMG", "SIRI", "IHRT", "LBRDA",
      "LBRDK", "TRIP", "YELP", "MTCH", "BMBL",
    ],
  },
  {
    id: "media-streaming",
    name: "Media & Streaming",
    nameZh: "媒体与流媒体",
    description:
      "Streaming pure-plays, studios, and legacy media transitioning to direct-to-consumer.",
    descriptionZh: "纯流媒体、影视制作与向 DTC 转型的传统媒体。",
    proxyEtf: "PBS",
    proxyEtfName: "Invesco Dynamic Media ETF",
    tickers: [
      "NFLX", "DIS", "SPOT", "ROKU", "WBD", "PARA", "FUBO", "WMG", "SIRI",
      "IHRT", "LYV", "CMCSA", "FOX", "FOXA", "NWSA", "IMAX", "AMC", "CNK",
      "MSGE", "CURI", "TTWO", "EA", "T", "VZ", "TMUS", "MSGS", "ATUS", "MDIA",
      "GTN", "SBGI", "TGNA",
    ],
  },
  {
    id: "gaming",
    name: "Gaming & Esports",
    nameZh: "游戏与电竞",
    description:
      "AAA studios, mobile publishers, and hardware — cyclical with big long-tail on major title cycles.",
    descriptionZh: "3A 工作室、手游发行与硬件——受大作发布周期驱动的周期性板块。",
    proxyEtf: "HERO",
    proxyEtfName: "Global X Video Games & Esports ETF",
    tickers: [
      "NVDA", "EA", "TTWO", "RBLX", "U", "MSFT", "SONY", "NTES", "SE", "TCEHY",
      "BILI", "DKNG", "PENN", "CZR", "LNW", "IGT", "AAPL", "GOOGL", "META",
      "AMD", "SMCI", "UBSFY", "CRSR", "LOGI", "HUYA", "DOYU", "APP", "MSGS",
      "SGHC", "GAMB", "GENI",
    ],
  },
  {
    id: "industrials",
    name: "Industrials",
    nameZh: "工业",
    description:
      "Machinery, aerospace, transportation, defence — early-cycle leader; reads capex + reshoring.",
    descriptionZh: "机械、航空航天、运输与国防——早周期领跑者，反映资本开支与产业回流。",
    proxyEtf: "XLI",
    proxyEtfName: "Industrial Select Sector SPDR",
    tickers: [
      "CAT", "BA", "GE", "HON", "UPS", "LMT", "RTX", "DE", "UNP", "MMM",
      "ETN", "EMR", "ITW", "PH", "GD", "NOC", "CSX", "FDX", "TDG", "NSC",
      "WM", "RSG", "WCN", "WAB", "PWR", "JCI", "LII", "ODFL", "HWM", "GNRC",
      "PCAR", "IEX", "URI", "CARR",
    ],
  },
  {
    id: "defense-aerospace",
    name: "Defense & Aerospace",
    nameZh: "国防与航空航天",
    description:
      "Prime contractors and suppliers — long backlog, budget-cycle exposed, geopolitics-sensitive.",
    descriptionZh: "主承包商与供应商——订单周期长，受预算与地缘政治影响显著。",
    proxyEtf: "ITA",
    proxyEtfName: "iShares U.S. Aerospace & Defense ETF",
    tickers: [
      "RTX", "LMT", "BA", "NOC", "GD", "TDG", "HEI", "HII", "LHX", "TXT",
      "AXON", "PLTR", "KTOS", "LDOS", "AVAV", "HWM", "BWXT", "MRCY", "ERJ",
      "CW", "BAESY", "SPR", "MOG-A", "ESLT", "EADSY", "CACI", "SAIC", "ATRO",
      "RKLB", "WWD", "AIR", "HXL", "MOG-B", "TGI",
    ],
  },
  {
    id: "robotics",
    name: "Robotics & Automation",
    nameZh: "机器人与自动化",
    description:
      "Industrial automation, factory robotics, and enabling components — reads capex intent.",
    descriptionZh: "工业自动化、工厂机器人及零部件——反映企业资本开支意愿。",
    proxyEtf: "ROBO",
    proxyEtfName: "ROBO Global Robotics & Automation Index ETF",
    tickers: [
      "ABBNY", "ISRG", "ROK", "EMR", "SIEGY", "FANUY", "YASKY", "TER", "IRBT",
      "PRLB", "MKSI", "COHR", "OMCL", "CGNX", "FARO", "MIDD", "HOLI", "PLXS",
      "ATKR", "ROP", "WWD", "KTOS", "AVAV", "DDD", "SSYS", "NDSN", "IEX", "OSIS",
      "EPAC", "AIT", "GTLS",
    ],
  },
  {
    id: "space",
    name: "Space",
    nameZh: "太空",
    description:
      "Launch, satellite, and space-tech names — long-cycle theme with defense + comms overlap.",
    descriptionZh: "火箭发射、卫星与太空科技——长周期主题，与国防、通讯板块重叠。",
    proxyEtf: "UFO",
    proxyEtfName: "Procure Space ETF",
    tickers: [
      "RKLB", "LMT", "BA", "NOC", "IRDM", "MAXR", "PL", "ASTS", "SPIR", "LUNR",
      "RTX", "SPCE", "VSAT", "SATS", "HEI", "TDG", "AVAV", "KTOS", "PLTR", "MRCY",
      "TER", "HWM", "GD", "CW", "LHX",
    ],
  },
  {
    id: "airlines-travel",
    name: "Airlines & Travel",
    nameZh: "航空与旅游",
    description:
      "US network carriers, low-cost operators, OTAs, and cruise lines — sensitive to fuel + consumer confidence.",
    descriptionZh:
      "美国干线与低成本航司、在线旅行社与邮轮公司——对油价与消费者信心敏感。",
    proxyEtf: "JETS",
    proxyEtfName: "U.S. Global Jets ETF",
    tickers: [
      "DAL", "UAL", "AAL", "LUV", "ALK", "JBLU", "BKNG", "EXPE", "ABNB",
      "MAR", "H", "CCL", "RCL", "NCLH", "SAVE", "RYAAY", "HLT", "IHG", "WH",
      "HTZ", "CAR", "SKYW", "ATSG", "MESA", "ULCC", "AZUL", "GOL", "TRIP",
      "TCOM", "PLYA",
    ],
  },
  {
    id: "homebuilders",
    name: "Homebuilders & Housing",
    nameZh: "住宅建筑",
    description:
      "US homebuilders and materials suppliers — leads to housing starts and mortgage-rate direction.",
    descriptionZh: "美国房屋建筑商与建材供应商——引领新开工数据、跟随房贷利率方向。",
    proxyEtf: "XHB",
    proxyEtfName: "SPDR S&P Homebuilders ETF",
    tickers: [
      "DHI", "LEN", "NVR", "PHM", "TOL", "MTH", "TMHC", "KBH", "MHO", "BLD",
      "IBP", "SHW", "MAS", "AZEK", "LGIH", "FND", "LII", "MHK", "CCS", "TREX",
      "EXP", "PATK", "ROCK", "SITE", "BXC", "FBIN", "JELD", "USG", "BECN",
      "GRBK", "MDC",
    ],
  },
  {
    id: "utilities",
    name: "Utilities",
    nameZh: "公用事业",
    description:
      "Regulated power, gas, and water — bond-proxy defensive; increasingly a play on data-center power demand.",
    descriptionZh:
      "受管制电力、天然气与水务——类债券防御板块；日益成为数据中心供电概念的载体。",
    proxyEtf: "XLU",
    proxyEtfName: "Utilities Select Sector SPDR",
    tickers: [
      "NEE", "SO", "DUK", "CEG", "AEP", "SRE", "D", "PCG", "EXC", "XEL",
      "PEG", "ED", "VST", "AWK", "ETR", "EIX", "EVRG", "DTE", "WEC", "PPL",
      "ES", "AEE", "CMS", "NI", "LNT", "ATO", "OGE", "PNW", "IDA", "WTRG",
      "AES", "NRG",
    ],
  },
  {
    id: "materials",
    name: "Materials",
    nameZh: "原材料",
    description:
      "Chemicals, packaging, and industrial gases — reads global manufacturing + housing demand.",
    descriptionZh: "化工、包装与工业气体——反映全球制造业与住房需求。",
    proxyEtf: "XLB",
    proxyEtfName: "Materials Select Sector SPDR",
    tickers: [
      "LIN", "SHW", "APD", "ECL", "FCX", "NEM", "DOW", "DD", "CTVA", "NUE",
      "PPG", "MLM", "VMC", "STLD", "IFF", "PKG", "BALL", "ATR", "ALB", "CE",
      "EMN", "CBT", "CRH", "OLN", "AVY", "WLK", "SEE", "AVNT", "IP", "SW",
      "AXTA", "RPM",
    ],
  },
  {
    id: "metals-mining",
    name: "Metals & Mining",
    nameZh: "金属与采矿",
    description:
      "Copper, iron ore, and steel — the industrial-commodity beta play; tightly tied to China demand.",
    descriptionZh: "铜、铁矿石与钢铁——工业商品的贝塔载体，与中国需求高度相关。",
    proxyEtf: "XME",
    proxyEtfName: "SPDR S&P Metals & Mining ETF",
    tickers: [
      "FCX", "NUE", "STLD", "CLF", "X", "AA", "RIO", "BHP", "VALE", "TECK",
      "SCCO", "MP", "ATI", "RS", "CENX", "CDE", "HBM", "ERO", "TROX", "CMC",
      "WOR", "CSTM", "PKX", "SXCP", "USAP", "OC", "OII", "GGB", "TX", "MTX",
    ],
  },
  {
    id: "gold-miners",
    name: "Gold Miners",
    nameZh: "黄金矿业",
    description:
      "Producers and royalty companies — geared beta to the gold spot price.",
    descriptionZh: "金矿开采与特许权公司——对金价具有高杠杆的贝塔敞口。",
    proxyEtf: "GDX",
    proxyEtfName: "VanEck Gold Miners ETF",
    tickers: [
      "NEM", "GOLD", "FNV", "AEM", "WPM", "KGC", "AU", "PAAS", "RGLD", "GFI",
      "HMY", "SBSW", "EGO", "OR", "SSRM", "IAG", "NGD", "CDE", "AGI", "HL",
      "MTA", "FSM", "MAG", "EQX", "IAUX", "USAS", "SVM", "GORO", "BVN", "GATO",
      "DRD", "OGC",
    ],
  },
  {
    id: "real-estate",
    name: "Real Estate (REITs)",
    nameZh: "房地产（REITs）",
    description:
      "Data-center, industrial, tower, and residential REITs — rate-sensitive; big dividend component.",
    descriptionZh: "数据中心、工业、通信塔与住宅 REITs——对利率敏感，股息占比高。",
    proxyEtf: "XLRE",
    proxyEtfName: "Real Estate Select Sector SPDR",
    tickers: [
      "PLD", "AMT", "EQIX", "CCI", "PSA", "O", "WELL", "SPG", "DLR", "SBAC",
      "EXR", "AVB", "EQR", "VICI", "IRM", "CBRE", "ARE", "INVH", "ESS", "MAA",
      "UDR", "CPT", "REG", "KIM", "SUI", "ELS", "FR", "STAG", "HST", "NNN",
      "MPW", "DOC", "BXP", "SLG",
    ],
  },
  {
    id: "data-centers",
    name: "Data Centers & AI Power",
    nameZh: "数据中心与 AI 电力",
    description:
      "Data-center REITs plus utilities and equipment suppliers benefiting from AI compute demand.",
    descriptionZh: "数据中心 REITs 加上受益于 AI 算力需求的电力与设备供应商。",
    proxyEtf: "XLRE",
    proxyEtfName: "Real Estate Select Sector SPDR (proxy)",
    tickers: [
      "EQIX", "DLR", "IRM", "CEG", "VST", "TLN", "NEE", "SMCI", "NVDA", "ANET",
      "AVGO", "DELL", "HPE", "APH", "CDW", "PSTG", "NTAP", "COHR", "VRT", "FLEX",
      "JBL", "CIEN", "ARM", "MRVL", "TSM", "AMD", "SLB", "GEV", "ETR", "AEP",
    ],
  },
  {
    id: "china-tech",
    name: "China Tech",
    nameZh: "中概科技",
    description:
      "US-listed ADRs and HK dual-listings — regulatory-headline sensitive; often trades on stimulus expectations.",
    descriptionZh:
      "美国上市 ADR 与港股双重上市——对政策新闻敏感，常随刺激预期而波动。",
    proxyEtf: "KWEB",
    proxyEtfName: "KraneShares CSI China Internet ETF",
    tickers: [
      "BABA", "PDD", "JD", "NTES", "TCEHY", "BIDU", "TME", "BILI", "TCOM",
      "VIPS", "ZTO", "IQ", "BEKE", "FUTU", "TIGR", "WB", "YMM", "MOMO", "TAL",
      "EDU", "HTHT", "ATHM", "QFIN", "NOAH", "LKNCY", "DADA", "YSG", "FINV",
      "XPEV", "LI",
    ],
  },
  {
    id: "emerging-markets",
    name: "Emerging Markets",
    nameZh: "新兴市场",
    description:
      "Household-name EM ADRs across India, LatAm, and Southeast Asia — high-beta to the dollar cycle.",
    descriptionZh: "印度、拉美与东南亚的主流新兴市场 ADR——与美元周期高度相关。",
    proxyEtf: "EEM",
    proxyEtfName: "iShares MSCI Emerging Markets ETF",
    tickers: [
      "TSM", "BABA", "PDD", "INFY", "WIT", "HDB", "IBN", "MELI", "NU", "SE",
      "GRAB", "VALE", "PBR", "ITUB", "AMX", "TCOM", "BRFS", "CPNG", "GLBE",
      "BAP", "FMX", "YPF", "BSBR", "ORAN", "TIMB", "SBS", "UGP", "SID", "GGB",
      "TX", "GOL", "AZUL",
    ],
  },
  {
    id: "cannabis",
    name: "Cannabis",
    nameZh: "大麻",
    description:
      "US MSOs and Canadian LPs — a small, highly-regulated basket that trades on policy headlines.",
    descriptionZh: "美国 MSO 与加拿大 LP——盘子小、强监管，随政策消息波动。",
    proxyEtf: "MSOS",
    proxyEtfName: "AdvisorShares Pure US Cannabis ETF",
    tickers: [
      "TLRY", "CGC", "CRON", "ACB", "SNDL", "HITI", "GTBIF", "TCNNF", "CURLF",
      "VRNOF", "AYRWF", "IIPR", "OGI", "SMG", "GRWG", "CBIO", "SHF", "PLTH",
      "NLBS",
    ],
  },
  {
    id: "blockchain-crypto",
    name: "Blockchain & Crypto",
    nameZh: "区块链与加密",
    description:
      "Miners, exchanges, and infrastructure — a levered play on Bitcoin's price cycle.",
    descriptionZh: "矿工、交易所与基础设施——比特币价格周期的杠杆载体。",
    proxyEtf: "BLOK",
    proxyEtfName: "Amplify Transformational Data Sharing ETF",
    tickers: [
      "COIN", "MSTR", "MARA", "RIOT", "CLSK", "HUT", "BITF", "CIFR", "IREN",
      "WULF", "HIVE", "APLD", "CORZ", "BYON", "CAN", "BTBT", "BTCS", "EBON",
      "TSLA", "SQ", "PYPL", "GLXY", "NVDA", "AMD", "PLTR", "SOFI",
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function findSegment(id: string): Segment | null {
  return SEGMENTS.find((s) => s.id === id) ?? null;
}

export function findIndex(id: string): IndexDef | null {
  return INDICES.find((i) => i.id === id) ?? null;
}

export function segmentName(seg: Segment, locale: Locale): string {
  return locale === "zh-CN" && seg.nameZh ? seg.nameZh : seg.name;
}

export function segmentDescription(seg: Segment, locale: Locale): string {
  return locale === "zh-CN" && seg.descriptionZh ? seg.descriptionZh : seg.description;
}

export function indexName(ix: IndexDef, locale: Locale): string {
  return locale === "zh-CN" && ix.nameZh ? ix.nameZh : ix.name;
}

export function indexDescription(ix: IndexDef, locale: Locale): string {
  return locale === "zh-CN" && ix.descriptionZh ? ix.descriptionZh : ix.description;
}
