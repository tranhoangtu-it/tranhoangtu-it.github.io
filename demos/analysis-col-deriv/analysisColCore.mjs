/**
 * Analysis Col — Deriv WebSocket v3 Statistical Digit, Volatility & Risk Engine
 * Endpoint: wss://ws.binaryws.com/websockets/v3?app_id=1089
 * Zero external dependencies — works identically in Browser ES Modules & Node.js 20+.
 */

export const DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3";
export const DEFAULT_APP_ID = 1089;

export const VOLATILITY_MARKETS = [
  { symbol: "R_10", labelEs: "Volatility 10 Index", labelEn: "Volatility 10 Index", pipSize: 3 },
  { symbol: "R_25", labelEs: "Volatility 25 Index", labelEn: "Volatility 25 Index", pipSize: 3 },
  { symbol: "R_50", labelEs: "Volatility 50 Index", labelEn: "Volatility 50 Index", pipSize: 4 },
  { symbol: "R_75", labelEs: "Volatility 75 Index", labelEn: "Volatility 75 Index", pipSize: 4 },
  { symbol: "R_100", labelEs: "Volatility 100 Index", labelEn: "Volatility 100 Index", pipSize: 2 }
];

/**
 * Preserves trailing zeros via pipSize so ticks like 1245.30 yield last digit 0 (not 3).
 */
export function extractLastDigit(quote, pipSize = 2) {
  const num = Number(quote);
  if (!Number.isFinite(num)) return 0;
  const fixed = num.toFixed(Math.max(0, Math.min(8, pipSize)));
  const ch = fixed.charAt(fixed.length - 1);
  return Number(ch) || 0;
}

export function analyzeTickWindow(ticks = [], pipSize = 2, overBarrier = 5, underBarrier = 4) {
  if (!Array.isArray(ticks) || ticks.length === 0) {
    return {
      sampleSize: 0,
      lastDigits: [],
      digitCounts: Array(10).fill(0),
      digitPct: Array(10).fill(0),
      evenPct: 0,
      oddPct: 0,
      overPct: 0,
      underPct: 0,
      risePct: 0,
      fallPct: 0,
      hotDigit: 0,
      coldDigit: 0,
      volatilityStd: 0,
      signal: { action: "WAIT", confidence: 0, contractType: null, barrier: null, labelEs: "ESPERA (Recopilando ticks...)", labelEn: "WAIT (Collecting ticks...)" }
    };
  }

  const quotes = ticks.map((t) => (typeof t === "number" ? t : Number(t.quote)));
  const digits = quotes.map((q) => extractLastDigit(q, pipSize));
  const counts = Array(10).fill(0);
  let even = 0;
  let over = 0;
  let under = 0;

  for (const d of digits) {
    counts[d] += 1;
    if (d % 2 === 0) even += 1;
    if (d > overBarrier) over += 1;
    if (d < underBarrier) under += 1;
  }

  let rises = 0;
  let falls = 0;
  for (let i = 1; i < quotes.length; i += 1) {
    if (quotes[i] > quotes[i - 1]) rises += 1;
    else if (quotes[i] < quotes[i - 1]) falls += 1;
  }

  const n = digits.length;
  const dirTotal = Math.max(1, rises + falls);
  const digitPct = counts.map((c) => Number(((c / n) * 100).toFixed(1)));
  const evenPct = Number(((even / n) * 100).toFixed(1));
  const oddPct = Number((100 - evenPct).toFixed(1));
  const overPct = Number(((over / n) * 100).toFixed(1));
  const underPct = Number(((under / n) * 100).toFixed(1));
  const risePct = Number(((rises / dirTotal) * 100).toFixed(1));
  const fallPct = Number(((falls / dirTotal) * 100).toFixed(1));

  let hotDigit = 0;
  let coldDigit = 0;
  for (let d = 1; d < 10; d += 1) {
    if (counts[d] > counts[hotDigit]) hotDigit = d;
    if (counts[d] < counts[coldDigit]) coldDigit = d;
  }

  const mean = quotes.reduce((a, b) => a + b, 0) / n;
  const variance = quotes.reduce((acc, q) => acc + (q - mean) ** 2, 0) / n;
  const volatilityStd = Number(Math.sqrt(variance).toFixed(pipSize + 1));

  const signal = computeSignal({
    sampleSize: n,
    recentDigits: digits.slice(-15),
    evenPct,
    oddPct,
    overPct,
    underPct,
    risePct,
    fallPct,
    hotDigit,
    digitPct,
    overBarrier,
    underBarrier
  });

  return {
    sampleSize: n,
    lastDigits: digits.slice(-20),
    digitCounts: counts,
    digitPct,
    evenPct,
    oddPct,
    overPct,
    underPct,
    risePct,
    fallPct,
    hotDigit,
    coldDigit,
    volatilityStd,
    signal
  };
}

function computeSignal({
  sampleSize,
  recentDigits,
  evenPct,
  oddPct,
  overPct,
  underPct,
  risePct,
  fallPct,
  hotDigit,
  digitPct,
  overBarrier,
  underBarrier
}) {
  if (sampleSize < 12) {
    return {
      action: "WAIT",
      confidence: 0,
      contractType: null,
      barrier: null,
      labelEs: `ESPERA (${sampleSize}/12 ticks mínimos)`,
      labelEn: `WAIT (${sampleSize}/12 min ticks)`
    };
  }

  const recentOver = recentDigits.filter((d) => d > overBarrier).length / recentDigits.length;
  const recentUnder = recentDigits.filter((d) => d < underBarrier).length / recentDigits.length;

  const candidates = [];

  // 1. Combined Over + Positive Price Momentum (Client Requirement #1)
  if (overPct >= 48 && recentOver >= 0.5 && risePct >= 52) {
    const conf = Math.min(96, Math.round(55 + (overPct - 45) * 1.2 + (risePct - 50) * 0.8));
    candidates.push({
      action: "BUY_NOW",
      confidence: conf,
      contractType: "DIGITOVER",
      barrier: overBarrier,
      labelEs: `COMPRA AHORA · Pon Over ${overBarrier} (Confianza ${conf}%)`,
      labelEn: `BUY NOW · Place Over ${overBarrier} (Confidence ${conf}%)`
    });
  }

  // 2. Combined Under + Negative Price Momentum
  if (underPct >= 48 && recentUnder >= 0.5 && fallPct >= 52) {
    const conf = Math.min(96, Math.round(55 + (underPct - 45) * 1.2 + (fallPct - 50) * 0.8));
    candidates.push({
      action: "BUY_NOW",
      confidence: conf,
      contractType: "DIGITUNDER",
      barrier: underBarrier,
      labelEs: `COMPRA AHORA · Pon Under ${underBarrier} (Confianza ${conf}%)`,
      labelEn: `BUY NOW · Place Under ${underBarrier} (Confidence ${conf}%)`
    });
  }

  // 3. Strong Even / Odd Dominance
  if (evenPct >= 62) {
    const conf = Math.min(94, Math.round(56 + (evenPct - 55) * 1.5));
    candidates.push({
      action: "BUY_NOW",
      confidence: conf,
      contractType: "DIGITEVEN",
      barrier: null,
      labelEs: `COMPRA AHORA · Pon Par / Even (${conf}%)`,
      labelEn: `BUY NOW · Place Even (${conf}%)`
    });
  } else if (oddPct >= 62) {
    const conf = Math.min(94, Math.round(56 + (oddPct - 55) * 1.5));
    candidates.push({
      action: "BUY_NOW",
      confidence: conf,
      contractType: "DIGITODD",
      barrier: null,
      labelEs: `COMPRA AHORA · Pon Impar / Odd (${conf}%)`,
      labelEn: `BUY NOW · Place Odd (${conf}%)`
    });
  }

  // 4. Strong Directional Rise / Fall Trend
  if (risePct >= 66) {
    const conf = Math.min(92, Math.round(54 + (risePct - 55) * 1.4));
    candidates.push({
      action: "BUY_NOW",
      confidence: conf,
      contractType: "CALL",
      barrier: null,
      labelEs: `COMPRA AHORA · Pon Rise / Subida (${conf}%)`,
      labelEn: `BUY NOW · Place Rise / Call (${conf}%)`
    });
  } else if (fallPct >= 66) {
    const conf = Math.min(92, Math.round(54 + (fallPct - 55) * 1.4));
    candidates.push({
      action: "BUY_NOW",
      confidence: conf,
      contractType: "PUT",
      barrier: null,
      labelEs: `COMPRA AHORA · Pon Fall / Bajada (${conf}%)`,
      labelEn: `BUY NOW · Place Fall / Put (${conf}%)`
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  if (candidates.length > 0 && candidates[0].confidence >= 64) {
    return { ...candidates[0], hotDigit, hotDigitPct: digitPct[hotDigit] };
  }

  return {
    action: "WAIT",
    confidence: 45,
    contractType: null,
    barrier: null,
    hotDigit,
    labelEs: `ESPERA · Mercado en equilibrio (Dígito caliente: ${hotDigit})`,
    labelEn: `WAIT · Market balanced (Hot digit: ${hotDigit})`
  };
}

export function analyzeCandles(candles = []) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { count: 0, avgRange: 0, bullishPct: 0, momentumBias: "NEUTRAL" };
  }
  let rangeSum = 0;
  let bullish = 0;
  for (const c of candles) {
    const open = Number(c.open);
    const close = Number(c.close);
    const high = Number(c.high);
    const low = Number(c.low);
    rangeSum += Math.max(0, high - low);
    if (close >= open) bullish += 1;
  }
  const bullishPct = Number(((bullish / candles.length) * 100).toFixed(1));
  const avgRange = Number((rangeSum / candles.length).toFixed(4));
  const momentumBias = bullishPct >= 60 ? "BULLISH" : bullishPct <= 40 ? "BEARISH" : "NEUTRAL";
  return { count: candles.length, avgRange, bullishPct, momentumBias };
}

export function buildDerivBuyPayload({
  symbol,
  contractType,
  stake,
  currency = "USD",
  durationTicks = 1,
  barrier = null
}) {
  const cleanStake = Number(Number(stake).toFixed(2));
  const parameters = {
    amount: cleanStake,
    basis: "stake",
    contract_type: contractType,
    currency,
    duration: durationTicks,
    duration_unit: "t",
    symbol
  };
  if (barrier !== null && barrier !== undefined && String(contractType).startsWith("DIGIT")) {
    if (contractType === "DIGITOVER" || contractType === "DIGITUNDER" || contractType === "DIGITMATCH" || contractType === "DIGITDIFF") {
      parameters.barrier = String(barrier);
    }
  }
  return {
    buy: 1,
    price: cleanStake,
    parameters
  };
}

export class SessionRiskController {
  constructor({
    baseStake = 1.0,
    takeProfit = 10.0,
    stopLoss = 10.0,
    martingaleMultiplier = 1.0,
    maxConsecutiveLosses = 4,
    requireManualApproval = true
  } = {}) {
    this.baseStake = Math.max(0.35, Number(baseStake));
    this.currentStake = this.baseStake;
    this.takeProfit = Math.max(0.5, Number(takeProfit));
    this.stopLoss = Math.max(0.5, Number(stopLoss));
    this.martingaleMultiplier = Math.max(1.0, Math.min(2.5, Number(martingaleMultiplier)));
    this.maxConsecutiveLosses = maxConsecutiveLosses;
    this.requireManualApproval = Boolean(requireManualApproval);

    this.wins = 0;
    this.losses = 0;
    this.consecutiveLosses = 0;
    this.netProfit = 0;
    this.haltedReason = null;
  }

  canOpenTrade({ manualApproved = false } = {}) {
    if (this.netProfit >= this.takeProfit) {
      this.haltedReason = "TAKE_PROFIT_REACHED";
      return { allowed: false, reason: this.haltedReason };
    }
    if (this.netProfit <= -this.stopLoss) {
      this.haltedReason = "STOP_LOSS_REACHED";
      return { allowed: false, reason: this.haltedReason };
    }
    if (this.requireManualApproval && !manualApproved) {
      return { allowed: false, reason: "AWAITING_MANUAL_CONFIRMATION" };
    }
    return { allowed: true, stake: Number(this.currentStake.toFixed(2)) };
  }

  recordSettlement(profitDelta) {
    const pnl = Number(profitDelta) || 0;
    this.netProfit = Number((this.netProfit + pnl).toFixed(2));
    if (pnl > 0) {
      this.wins += 1;
      this.consecutiveLosses = 0;
      this.currentStake = this.baseStake;
    } else if (pnl < 0) {
      this.losses += 1;
      this.consecutiveLosses += 1;
      if (this.consecutiveLosses <= this.maxConsecutiveLosses && this.martingaleMultiplier > 1) {
        this.currentStake = Number((this.currentStake * this.martingaleMultiplier).toFixed(2));
      } else {
        this.currentStake = this.baseStake;
      }
    }

    if (this.netProfit >= this.takeProfit) this.haltedReason = "TAKE_PROFIT_REACHED";
    else if (this.netProfit <= -this.stopLoss) this.haltedReason = "STOP_LOSS_REACHED";

    return this.getSnapshot();
  }

  getSnapshot() {
    return {
      wins: this.wins,
      losses: this.losses,
      netProfit: this.netProfit,
      nextStake: this.currentStake,
      haltedReason: this.haltedReason
    };
  }
}

export class DerivAnalysisColClient {
  constructor({
    appId = DEFAULT_APP_ID,
    wsUrl = DERIV_WS_URL,
    WebSocketImpl = globalThis.WebSocket,
    onTickAnalysis = () => {},
    onAccountAuth = () => {},
    onTradeResult = () => {},
    onError = () => {}
  } = {}) {
    this.endpoint = `${wsUrl}?app_id=${appId}`;
    this.WebSocketImpl = WebSocketImpl;
    this.onTickAnalysis = onTickAnalysis;
    this.onAccountAuth = onAccountAuth;
    this.onTradeResult = onTradeResult;
    this.onError = onError;

    this.ws = null;
    this.account = null;
    this.symbol = "R_100";
    this.pipSize = 2;
    this.ticks = [];
    this.candles = [];
    this.pingTimer = null;
  }

  connect({ apiToken = "", symbol = "R_100", pipSize = 2 } = {}) {
    this.disconnect();
    this.symbol = symbol;
    this.pipSize = pipSize;
    this.ticks = [];
    this.ws = new this.WebSocketImpl(this.endpoint);

    this.ws.addEventListener("open", () => {
      if (apiToken && apiToken.trim()) {
        this.send({ authorize: apiToken.trim() });
      } else {
        this.subscribeMarket(this.symbol);
      }
      this.pingTimer = setInterval(() => this.send({ ping: 1 }), 25_000);
    });

    this.ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        this.handleMessage(msg);
      } catch (err) {
        this.onError(err);
      }
    });

    this.ws.addEventListener("error", (err) => this.onError(err));
  }

  subscribeMarket(symbol, pipSize) {
    if (symbol) this.symbol = symbol;
    if (typeof pipSize === "number") this.pipSize = pipSize;
    this.ticks = [];
    this.send({ forget_all: "ticks" });
    this.send({
      ticks_history: this.symbol,
      adjust_start_time: 1,
      count: 100,
      end: "latest",
      style: "ticks",
      subscribe: 1
    });
    this.send({
      ticks_history: this.symbol,
      adjust_start_time: 1,
      count: 30,
      end: "latest",
      granularity: 60,
      style: "candles"
    });
  }

  handleMessage(msg) {
    if (msg.error) {
      this.onError(msg.error);
      return;
    }

    if (msg.msg_type === "authorize" && msg.authorize) {
      this.account = {
        loginid: msg.authorize.loginid,
        balance: Number(msg.authorize.balance),
        currency: msg.authorize.currency || "USD",
        isVirtual: Boolean(msg.authorize.is_virtual)
      };
      this.onAccountAuth(this.account);
      this.subscribeMarket(this.symbol, this.pipSize);
      this.send({ balance: 1, subscribe: 1 });
      return;
    }

    if (msg.msg_type === "balance" && msg.balance && this.account) {
      this.account.balance = Number(msg.balance.balance);
      this.onAccountAuth({ ...this.account });
      return;
    }

    if (msg.msg_type === "history" && msg.history?.prices) {
      if (typeof msg.pip_size === "number") this.pipSize = msg.pip_size;
      this.ticks = msg.history.prices.map((p) => Number(p)).slice(-120);
      this.emitAnalysis();
      return;
    }

    if (msg.msg_type === "candles" && Array.isArray(msg.candles)) {
      this.candles = msg.candles;
      this.emitAnalysis();
      return;
    }

    if (msg.msg_type === "tick" && msg.tick) {
      if (typeof msg.tick.pip_size === "number") this.pipSize = msg.tick.pip_size;
      this.ticks.push(Number(msg.tick.quote));
      if (this.ticks.length > 120) this.ticks.shift();
      this.emitAnalysis();
      return;
    }

    if (msg.msg_type === "buy" && msg.buy) {
      this.send({ proposal_open_contract: 1, contract_id: msg.buy.contract_id, subscribe: 1 });
      return;
    }

    if (msg.msg_type === "proposal_open_contract" && msg.proposal_open_contract?.is_sold) {
      const poc = msg.proposal_open_contract;
      this.onTradeResult({
        contractId: poc.contract_id,
        profit: Number(poc.profit),
        status: poc.status,
        buyPrice: Number(poc.buy_price),
        sellPrice: Number(poc.sell_price)
      });
    }
  }

  emitAnalysis() {
    const tickStats = analyzeTickWindow(this.ticks, this.pipSize);
    const candleStats = analyzeCandles(this.candles);
    this.onTickAnalysis({
      symbol: this.symbol,
      pipSize: this.pipSize,
      latestQuote: this.ticks.at(-1) ?? null,
      tickStats,
      candleStats
    });
  }

  placeTrade({ contractType, stake, barrier = null, durationTicks = 1 }) {
    if (!this.account) {
      throw new Error("API_TOKEN_NOT_AUTHORIZED");
    }
    const payload = buildDerivBuyPayload({
      symbol: this.symbol,
      contractType,
      stake,
      currency: this.account.currency,
      durationTicks,
      barrier
    });
    this.send(payload);
    return payload;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}
