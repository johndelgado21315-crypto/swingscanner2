import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ── Service Worker registration (PWA — caches app shell + API responses) ─────
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {/* SW optional */});
  });
}

// ── Viewport meta injection (mobile) ────────────────────────────────────────
if (typeof document !== "undefined") {
  let vm = document.querySelector('meta[name="viewport"]');
  if (!vm) { vm = document.createElement("meta"); vm.name = "viewport"; document.head.appendChild(vm); }
  vm.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
}

// ── Mobile detection hook ────────────────────────────────────────────────────

// ── Safe array helpers (prevents iOS Safari stack overflow on large arrays) ──
const safeMax = (arr) => arr.reduce((a, b) => a > b ? a : b, -Infinity);
const safeMin = (arr) => arr.reduce((a, b) => a < b ? a : b, Infinity);

function useIsMobile() {
  const [mobile, setMobile] = useState(()=>typeof window!=="undefined"&&window.innerWidth<768);
  useEffect(()=>{
    const h=()=>setMobile(window.innerWidth<768);
    window.addEventListener("resize",h);
    return ()=>window.removeEventListener("resize",h);
  },[]);
  return mobile;
}

// ══════════════════════════════════════════════════════════════════════════════
// BULKOWSKI PATTERN DATABASE — Encyclopedia of Chart Patterns (2nd Ed.)
// All stats: bull market, average gain/loss, break-even failure rate, 
// percentage meeting price target, and Murphy technical definitions
// ══════════════════════════════════════════════════════════════════════════════
const PATTERNS_DB = {
  // Reversal Patterns — Murphy Ch.5, Bulkowski Ch.11-12
  "Double Bottom":        { breakout:"bullish",  reliability:78, avgGain:40, avgLoss:null, failRate:11, targetMet:64, minBars:20, category:"Reversal",   murphyRef:"Ch.5 p.135" },
  "Double Top":           { breakout:"bearish",  reliability:75, avgGain:null, avgLoss:18, failRate:14, targetMet:59, minBars:20, category:"Reversal",   murphyRef:"Ch.5 p.128" },
  "Head and Shoulders":   { breakout:"bearish",  reliability:83, avgGain:null, avgLoss:22, failRate:7,  targetMet:55, minBars:30, category:"Reversal",   murphyRef:"Ch.5 p.120" },
  "Inverse H&S":          { breakout:"bullish",  reliability:89, avgGain:45, avgLoss:null, failRate:4,  targetMet:74, minBars:30, category:"Reversal",   murphyRef:"Ch.5 p.126" },
  "Rounding Bottom":      { breakout:"bullish",  reliability:96, avgGain:43, avgLoss:null, failRate:2,  targetMet:81, minBars:50, category:"Reversal",   murphyRef:"Ch.5 p.131" },
  "Cup with Handle":      { breakout:"bullish",  reliability:61, avgGain:34, avgLoss:null, failRate:18, targetMet:62, minBars:40, category:"Reversal",   murphyRef:"O'Neil/Bulkowski" },
  // Continuation Patterns — Murphy Ch.6, Bulkowski Ch.3-4
  "Ascending Triangle":   { breakout:"bullish",  reliability:77, avgGain:35, avgLoss:null, failRate:12, targetMet:75, minBars:25, category:"Continuation", murphyRef:"Ch.6 p.152" },
  "Descending Triangle":  { breakout:"bearish",  reliability:72, avgGain:null, avgLoss:16, failRate:16, targetMet:68, minBars:25, category:"Continuation", murphyRef:"Ch.6 p.158" },
  "Symmetrical Triangle": { breakout:"neutral",  reliability:54, avgGain:31, avgLoss:null, failRate:25, targetMet:66, minBars:20, category:"Continuation", murphyRef:"Ch.6 p.160" },
  "Bull Flag":            { breakout:"bullish",  reliability:67, avgGain:23, avgLoss:null, failRate:19, targetMet:64, minBars:10, category:"Continuation", murphyRef:"Ch.6 p.168" },
  "Bear Flag":            { breakout:"bearish",  reliability:63, avgGain:null, avgLoss:12, failRate:21, targetMet:58, minBars:10, category:"Continuation", murphyRef:"Ch.6 p.168" },
  "Wedge Rising":         { breakout:"bearish",  reliability:69, avgGain:null, avgLoss:14, failRate:18, targetMet:61, minBars:20, category:"Continuation", murphyRef:"Ch.6 p.173" },
  "Wedge Falling":        { breakout:"bullish",  reliability:74, avgGain:29, avgLoss:null, failRate:15, targetMet:70, minBars:20, category:"Continuation", murphyRef:"Ch.6 p.173" },
  "Rectangle Top":        { breakout:"bearish",  reliability:65, avgGain:null, avgLoss:14, failRate:22, targetMet:57, minBars:20, category:"Continuation", murphyRef:"Ch.6 p.150" },
  "Rectangle Bottom":     { breakout:"bullish",  reliability:68, avgGain:36, avgLoss:null, failRate:21, targetMet:65, minBars:20, category:"Continuation", murphyRef:"Ch.6 p.150" },
  "Broadening Top":       { breakout:"bearish",  reliability:51, avgGain:null, avgLoss:15, failRate:30, targetMet:49, minBars:30, category:"Reversal",   murphyRef:"Ch.6 p.167" },
};

// Swing trader watchlist — diversified across sectors
const DEFAULT_WATCHLIST = [
  // Mega-cap tech
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO","AMD","INTC",
  // Financials
  "JPM","GS","BAC","V","MA","BRK-B",
  // Healthcare
  "UNH","LLY","JNJ","MRK","ABBV","TMO",
  // Consumer
  "WMT","COST","MCD","KO","PEP","PG","HD",
  // Energy / Industrial
  "XOM","CVX","CAT","GE","HON",
  // Growth / Tech
  "CRM","ORCL","NOW","NFLX","CSCO",
  // Other
  "ACN","ABT","IBM","GS",
];

// ══════════════════════════════════════════════════════════════════════════════
// CACHE LAYER — IndexedDB (prices) + localStorage (watchlist) + in-memory (hot)
// ══════════════════════════════════════════════════════════════════════════════
const WL_CACHE_KEY    = "swt_wl_v1";    // localStorage key for custom watchlist
const SCAN_CACHE_TTL  = 20 * 60 * 1000; // 20 min — stale scan triggers bg refresh
const DATA_CACHE_TTL  = 15 * 60 * 1000; // 15 min — per-symbol price TTL

// ── L1: In-memory hot cache (same session, zero-latency) ─────────────────────
const dataCache = {}; // { [sym]: { prices, quote, ts } }

// ── L2: IndexedDB (no 5 MB limit, async, survives page close) ────────────────
const IDB_NAME = "swt_v2";
const idb = (() => {
  let _db = null;
  async function open() {
    if (_db) return _db;
    return new Promise((res, rej) => {
      const r = typeof indexedDB !== "undefined" ? indexedDB.open(IDB_NAME, 1) : null;
      if (!r) { rej(new Error("no idb")); return; }
      r.onupgradeneeded = e => {
        ["prices","scan"].forEach(name => {
          if (!e.target.result.objectStoreNames.contains(name))
            e.target.result.createObjectStore(name, { keyPath: "key" });
        });
      };
      r.onsuccess = e => { _db = e.target.result; res(_db); };
      r.onerror   = rej;
    });
  }
  async function get(store, key) {
    try {
      const db = await open();
      return new Promise(res => {
        const r = db.transaction(store,"readonly").objectStore(store).get(key);
        r.onsuccess = () => res(r.result ?? null);
        r.onerror   = () => res(null);
      });
    } catch { return null; }
  }
  async function put(store, key, val) {
    try {
      const db = await open();
      await new Promise(res => {
        const tx = db.transaction(store,"readwrite");
        tx.objectStore(store).put({ key, ...val });
        tx.oncomplete = res; tx.onerror = res;
      });
    } catch { /* IDB unavailable in some private-mode browsers */ }
  }
  return { get, put };
})();

async function loadScanCache() {
  // Try IDB first (no size limit), fall back to nothing
  const r = await idb.get("scan", "latest");
  if (!r || !Array.isArray(r.stocks) || !r.stocks.length) return null;
  return { stocks: r.stocks, ts: r.ts, stale: Date.now() - r.ts > SCAN_CACHE_TTL };
}

async function saveScanCache(stocks) {
  await idb.put("scan", "latest", { stocks, ts: Date.now() });
}

// ══════════════════════════════════════════════════════════════════════════════
// DATA LAYER — Vercel API route (fast) with CORS proxy fallback
// ══════════════════════════════════════════════════════════════════════════════
const IS_MOBILE = typeof window !== "undefined" && window.innerWidth < 768;

const PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function yahooFetch(path) {
  // Try our own Vercel API route first — fast, no CORS issues
  const symMatch = path.match(/chart\/([^?]+)/);
  const sym = symMatch?.[1];
  const isHistory = /range=\d+mo/.test(path) && path.includes("interval=1d");
  if (sym) {
    try {
      const res = await fetch(`/api/quote?symbol=${sym}&type=${isHistory?"history":"quote"}`,
        { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        if (data?.chart?.result) return data;
      }
    } catch { /* fall through */ }
  }
  // Fallback to CORS proxies (local dev or if API route fails)
  const base = `https://query1.finance.yahoo.com${path}`;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(base), {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(IS_MOBILE ? 15000 : 9000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (typeof data !== "object" || !data) continue;
      return data;
    } catch { continue; }
  }
  throw new Error("All sources failed");
}

async function fetchHistory(symbol) {
  // Mobile fetches 3 months (≈65 bars) instead of 6 — half the data, same pattern coverage
  const range = IS_MOBILE ? "3mo" : "6mo";
  const data = await yahooFetch(`/v8/finance/chart/${symbol}?interval=1d&range=${range}&includePrePost=false`);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const { open, high, low, close, volume } = result.indicators.quote[0];
  return result.timestamp.map((t, i) => ({
    ts: t * 1000,
    open:   open[i]   ?? close[i] ?? 0,
    high:   high[i]   ?? 0,
    low:    low[i]    ?? 0,
    close:  close[i]  ?? 0,
    volume: volume[i] ?? 0,
  })).filter(p => p.close > 0);
}

async function fetchQuote(symbol) {
  const data = await yahooFetch(`/v8/finance/chart/${symbol}?interval=1d&range=1d`);
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("No quote");
  return {
    price:       meta.regularMarketPrice        ?? 0,
    prevClose:   meta.chartPreviousClose        ?? meta.previousClose ?? 0,
    open:        meta.regularMarketOpen         ?? 0,
    dayHigh:     meta.regularMarketDayHigh      ?? 0,
    dayLow:      meta.regularMarketDayLow       ?? 0,
    volume:      meta.regularMarketVolume       ?? 0,
    marketCap:   meta.marketCap                 ?? 0,
    name:        meta.longName ?? meta.shortName ?? symbol,
    exchange:    meta.exchangeName              ?? "",
    marketState: meta.marketState               ?? "REGULAR",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TECHNICAL INDICATORS — Murphy Chapters 9-10
// ══════════════════════════════════════════════════════════════════════════════

// RSI — Wilder's method (Murphy Ch.10 p.225)
function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const diffs = prices.slice(1).map((p, i) => p.close - prices[i].close);
  // Wilder smoothing
  let avgGain = diffs.slice(0, period).filter(d => d > 0).reduce((a,b)=>a+b,0) / period;
  let avgLoss = diffs.slice(0, period).filter(d => d < 0).reduce((a,b)=>a+Math.abs(b),0) / period;
  for (let i = period; i < diffs.length; i++) {
    const g = diffs[i] > 0 ? diffs[i] : 0;
    const l = diffs[i] < 0 ? Math.abs(diffs[i]) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  const rs = avgGain / (avgLoss || 0.0001);
  return Math.round(100 - 100 / (1 + rs));
}

// Full RSI array for divergence detection
function calcRSIArray(prices, period = 14) {
  if (prices.length < period + 1) return prices.map(() => 50);
  const diffs = prices.slice(1).map((p, i) => p.close - prices[i].close);
  const result = new Array(period).fill(50);
  let avgGain = diffs.slice(0, period).filter(d=>d>0).reduce((a,b)=>a+b,0)/period;
  let avgLoss = diffs.slice(0, period).filter(d=>d<0).reduce((a,b)=>a+Math.abs(b),0)/period;
  result.push(Math.round(100 - 100/(1+(avgGain/(avgLoss||0.0001)))));
  for (let i = period; i < diffs.length; i++) {
    avgGain = (avgGain*(period-1)+(diffs[i]>0?diffs[i]:0))/period;
    avgLoss = (avgLoss*(period-1)+(diffs[i]<0?Math.abs(diffs[i]):0))/period;
    result.push(Math.round(100-100/(1+(avgGain/(avgLoss||0.0001)))));
  }
  return result;
}

// MACD — standard 12/26/9 (Murphy Ch.10 p.232)
function calcMACD(prices) {
  const closes = prices.map(p => p.close);
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0, bullish: false };
  const ema = (data, p, start) => {
    const k = 2/(p+1);
    let e = data.slice(0, p).reduce((a,b)=>a+b,0)/p;
    for (let i = p; i < data.length; i++) e = data[i]*k + e*(1-k);
    return e;
  };
  const macd  = ema(closes,12,0) - ema(closes,26,0);
  // Proper signal = 9-period EMA of MACD (simplified)
  const signal = macd * (1 - 2/10);
  const hist   = macd - signal;
  return { macd:+macd.toFixed(3), signal:+signal.toFixed(3), hist:+hist.toFixed(3), bullish: hist > 0 };
}

// EMA array
function calcEMAArray(prices, period) {
  const k = 2/(period+1);
  const result = [];
  let ema = prices[0].close;
  for (const p of prices) { ema = p.close*k + ema*(1-k); result.push(ema); }
  return result;
}

// ATR — Wilder (Murphy Ch.14)
function calcATR(prices, period = 14) {
  if (prices.length < period+1) return prices.length > 1 ? prices[prices.length-1].high - prices[prices.length-1].low : 0;
  const trs = prices.map((p,i) => {
    if (i===0) return p.high - p.low;
    const prev = prices[i-1];
    return Math.max(p.high-p.low, Math.abs(p.high-prev.close), Math.abs(p.low-prev.close));
  });
  // Wilder smoothing
  let atr = trs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i=period; i<trs.length; i++) atr = (atr*(period-1)+trs[i])/period;
  return atr;
}

// Volume analysis
function calcVolume(prices) {
  if (prices.length < 20) return { trend:1, obv:0, avgVol:0 };
  const avg20 = prices.slice(-20).reduce((a,b)=>a+b.volume,0)/20;
  const avg5  = prices.slice(-5).reduce((a,b)=>a+b.volume,0)/5;
  // OBV
  let obv = 0;
  for (let i=1; i<prices.length; i++) {
    if (prices[i].close > prices[i-1].close) obv += prices[i].volume;
    else if (prices[i].close < prices[i-1].close) obv -= prices[i].volume;
  }
  return { trend: avg5/avg20, obv, avgVol: avg20 };
}

// SMA
function calcSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a,b)=>a+b.close,0)/period;
}

// 52-week high/low relative position
function calcRelPosition(prices) {
  const highs = prices.map(p=>p.high);
  const lows  = prices.map(p=>p.low);
  const h52 = safeMax(highs), l52 = safeMin(lows);
  const last = prices[prices.length-1].close;
  return { h52, l52, pct: ((last-l52)/(h52-l52||1))*100 };
}

// Trend strength — ADX-like measure (Murphy Ch.14)
function calcTrendStrength(prices) {
  if (prices.length < 15) return { adx: 25, trending: false };
  const n = Math.min(14, prices.length-1);
  let plusDM=0, minusDM=0, tr=0;
  for (let i=prices.length-n; i<prices.length; i++) {
    const p=prices[i], prev=prices[i-1];
    const upMove   = p.high - prev.high;
    const downMove = prev.low - p.low;
    plusDM  += upMove   > downMove && upMove   > 0 ? upMove   : 0;
    minusDM += downMove > upMove   && downMove > 0 ? downMove : 0;
    tr += Math.max(p.high-p.low, Math.abs(p.high-prev.close), Math.abs(p.low-prev.close));
  }
  const pDI = tr > 0 ? (plusDM/tr)*100 : 0;
  const mDI = tr > 0 ? (minusDM/tr)*100 : 0;
  const adx = (pDI+mDI) > 0 ? Math.abs(pDI-mDI)/(pDI+mDI)*100 : 0;
  return { adx: Math.round(adx), trending: adx > 20, bullTrend: pDI > mDI };
}

// Detect RSI divergence (bullish or bearish)
function detectDivergence(prices) {
  if (prices.length < 30) return { bullDiv: false, bearDiv: false };
  const rsiArr = calcRSIArray(prices);
  const last10p = prices.slice(-10);
  const last10r = rsiArr.slice(-10);
  // Bullish: price makes lower low, RSI makes higher low
  const priceLL = last10p[last10p.length-1].low < safeMin(last10p.slice(0,-1).map(p=>p.low));
  const rsiHL   = last10r[last10r.length-1] > safeMin(last10r.slice(0,-1));
  // Bearish: price makes higher high, RSI makes lower high
  const priceHH = last10p[last10p.length-1].high > safeMax(last10p.slice(0,-1).map(p=>p.high));
  const rsiLH   = last10r[last10r.length-1] < safeMax(last10r.slice(0,-1));
  return { bullDiv: priceLL && rsiHL, bearDiv: priceHH && rsiLH };
}

// ══════════════════════════════════════════════════════════════════════════════
// PATTERN DETECTION ENGINE
// Murphy's Technical Analysis of Financial Markets — Definitions & Rules
// Bulkowski's Encyclopedia of Chart Patterns — Statistics & Confirmation
// ══════════════════════════════════════════════════════════════════════════════
function detectPatterns(prices) {
  try {
    if (prices.length < 20) return null;
    const found = [];
    const n      = prices.length;
    const closes = prices.map(p => p.close);
    const highs  = prices.map(p => p.high);
    const lows   = prices.map(p => p.low);
    const last   = closes[n-1];

    // ── Linear Regression ──────────────────────────────────────────────────
    const linReg = (pts) => {
      const m=pts.length; if(m<2) return {slope:0,intercept:pts[0]?.y??0};
      const sx=pts.reduce((a,p)=>a+p.x,0), sy=pts.reduce((a,p)=>a+p.y,0);
      const sxy=pts.reduce((a,p)=>a+p.x*p.y,0), sxx=pts.reduce((a,p)=>a+p.x*p.x,0);
      const d=m*sxx-sx*sx; if(Math.abs(d)<1e-12) return {slope:0,intercept:sy/m};
      const slope=(m*sxy-sx*sy)/d;
      return {slope, intercept:(sy-slope*sx)/m};
    };
    const at = (lr, x) => lr.slope*x + lr.intercept;

    // ── Swing Pivot Detection — Murphy: N bars clear on each side ──────────
    // Murphy requires at least 3 bars on each side for daily charts (Ch.4 p.73)
    const swingH = (win=3) => {
      const pts=[];
      for (let i=win; i<n-win; i++) {
        let ok=true;
        for (let j=i-win; j<=i+win; j++) { if(j!==i&&highs[j]>=highs[i]){ok=false;break;} }
        if(ok) pts.push({x:i,y:highs[i],i});
      }
      return pts;
    };
    const swingL = (win=3) => {
      const pts=[];
      for (let i=win; i<n-win; i++) {
        let ok=true;
        for (let j=i-win; j<=i+win; j++) { if(j!==i&&lows[j]<=lows[i]){ok=false;break;} }
        if(ok) pts.push({x:i,y:lows[i],i});
      }
      return pts;
    };
    const shRange = (lo,hi,w=3) => swingH(w).filter(p=>p.x>=lo&&p.x<=hi);
    const slRange = (lo,hi,w=3) => swingL(w).filter(p=>p.x>=lo&&p.x<=hi);

    // ── 1. DOUBLE BOTTOM — Murphy p.135 ───────────────────────────────────
    // Two troughs ~equal, neckline = peak between them. Confirmed: close > neckline.
    // Bulkowski: avg gain 40%, reliability 78%
    if (n >= 30) {
      const sl = slRange(n-55, n-1, 4);
      let best = null;
      for (let a=0; a<sl.length-1; a++) {
        for (let b=a+1; b<sl.length; b++) {
          const p1=sl[a], p2=sl[b];
          if (p2.x-p1.x < 12 || p2.x-p1.x > 55) continue; // Murphy: min 4 weeks apart
          const diff = Math.abs(p1.y-p2.y)/p1.y;
          if (diff > 0.03) continue; // strict: within 3% (textbook: roughly equal)
          const peaks = shRange(p1.x+2, p2.x-2, 2);
          if (!peaks.length) continue;
          const peak = peaks.reduce((mx,p)=>p.y>mx.y?p:mx, peaks[0]);
          if (peak.y < p1.y*1.06) continue; // rally must be at least 6% between lows
          const depth = (peak.y - Math.min(p1.y,p2.y)) / peak.y;
          if (!best || diff < Math.abs(best.p1.y-best.p2.y)/best.p1.y)
            best = {p1,p2,peak,diff,depth};
        }
      }
      if (best) {
        const {p1,p2,peak,diff,depth} = best;
        // Multi-factor conf: trough equality + depth + separation + prior trend
        const separation  = Math.min(1,(p2.x-p1.x-12)/43);         // longer = better, up to ~55 bars
        const priorDown   = closes[p1.x] < closes[Math.max(0,p1.x-15)] ? 1 : 0; // downtrend before
        const depthScore  = Math.min(1, depth / 0.25);               // deeper cup = better, cap at 25%
        const conf = Math.min(95, Math.round(
          55
          + (1-diff/0.03)*16          // trough equality: 0–16 pts
          + depthScore*12             // pattern depth: 0–12 pts
          + separation*8              // time separation: 0–8 pts
          + priorDown*4               // prior downtrend present: 0–4 pts
        ));
        found.push({ name:"Double Bottom", conf,
          stage: last>peak.y?"Confirmed":"Forming",
          ...PATTERNS_DB["Double Bottom"],
          geo:{ type:"doubleBottom", startI:p1.x,
            points:[{i:p1.x,v:p1.y,label:"Low 1"},{i:peak.x,v:peak.y,label:"Neckline"},{i:p2.x,v:p2.y,label:"Low 2"}],
            resistance:peak.y, support:Math.min(p1.y,p2.y) }});
      }
    }

    // ── 2. DOUBLE TOP — Murphy p.128 ──────────────────────────────────────
    if (n >= 30) {
      const sh = shRange(n-55, n-1, 4);
      let best = null;
      for (let a=0; a<sh.length-1; a++) {
        for (let b=a+1; b<sh.length; b++) {
          const p1=sh[a], p2=sh[b];
          if (p2.x-p1.x < 12 || p2.x-p1.x > 55) continue; // Murphy: min 4 weeks
          const diff = Math.abs(p1.y-p2.y)/p1.y;
          if (diff > 0.03) continue; // strict: within 3%
          const troughs = slRange(p1.x+2, p2.x-2, 2);
          if (!troughs.length) continue;
          const trough = troughs.reduce((mn,p)=>p.y<mn.y?p:mn, troughs[0]);
          if (trough.y > p1.y*0.94) continue; // decline must be at least 6% between tops
          if (!best || diff < Math.abs(best.p1.y-best.p2.y)/best.p1.y)
            best = {p1,p2,trough,diff};
        }
      }
      if (best) {
        const {p1,p2,trough,diff} = best;
        const separation = Math.min(1,(p2.x-p1.x-12)/43);
        const depth      = (Math.max(p1.y,p2.y) - trough.y) / Math.max(p1.y,p2.y);
        const depthScore = Math.min(1, depth / 0.20);
        const priorUp    = closes[p1.x] > closes[Math.max(0,p1.x-15)] ? 1 : 0;
        const conf = Math.min(95, Math.round(
          55
          + (1-diff/0.03)*16
          + depthScore*12
          + separation*8
          + priorUp*4
        ));
        found.push({ name:"Double Top", conf,
          stage: last<trough.y?"Confirmed":"Forming",
          ...PATTERNS_DB["Double Top"],
          geo:{ type:"doubleTop", startI:p1.x,
            points:[{i:p1.x,v:p1.y,label:"Top 1"},{i:trough.x,v:trough.y,label:"Neckline"},{i:p2.x,v:p2.y,label:"Top 2"}],
            resistance:Math.max(p1.y,p2.y), support:trough.y }});
      }
    }

    // ── 3. HEAD AND SHOULDERS — Murphy p.120 ───────────────────────────────
    // STRICT TEXTBOOK RULES (Murphy Ch.5 p.120, Bulkowski Ch.32):
    //  1. Head must be clearly higher than BOTH shoulders (>4% above each)
    //  2. Shoulders roughly equal HEIGHT (within 5% of each other)
    //  3. Shoulders roughly equal WIDTH from head (within 40%)
    //  4. Neckline near-horizontal: slope < 0.15% per bar (max ~8% over 50 bars)
    //  5. Prior UPTREND required before left shoulder
    //  6. Neckline troughs clearly below both shoulders
    if (n >= 45) {
      const sh = shRange(n-80, n-1, 4);
      let bestHS = null, bestConf = 0;
      for (let hi=1; hi<sh.length-1; hi++) {
        const head = sh[hi];
        const leftC  = sh.slice(0,hi).filter(p=>p.x < head.x-10);
        const rightC = sh.slice(hi+1).filter(p=>p.x > head.x+10);
        for (const lS of leftC) {
          for (const rS of rightC) {
            // Rule 1: Head clearly above both shoulders (>4%)
            if (head.y <= lS.y*1.04) continue;
            if (head.y <= rS.y*1.04) continue;
            // Rule 6: Right shoulder must not exceed head
            if (rS.y >= head.y) continue;
            // Rule 2: Shoulders roughly equal height (within 5%)
            const heightSymm = Math.abs(lS.y-rS.y)/Math.max(lS.y,rS.y);
            if (heightSymm > 0.05) continue;
            // Rule 3: Shoulders roughly equal width from head (within 40%)
            const lDist = head.x - lS.x, rDist = rS.x - head.x;
            if (lDist < 10 || rDist < 10) continue;
            const widthSymm = Math.abs(lDist-rDist)/Math.max(lDist,rDist);
            if (widthSymm > 0.40) continue;
            // Find neckline troughs between shoulders and head
            const lTr = slRange(lS.x+1, head.x-1, 2);
            const rTr = slRange(head.x+1, rS.x-1, 2);
            if (!lTr.length || !rTr.length) continue;
            const nL = lTr.reduce((mn,p)=>p.y<mn.y?p:mn, lTr[0]);
            const nR = rTr.reduce((mn,p)=>p.y<mn.y?p:mn, rTr[0]);
            // Rule 6: Troughs clearly below their respective shoulders
            if (nL.y > lS.y*0.97) continue;
            if (nR.y > rS.y*0.97) continue;
            // Rule 4: Neckline near-horizontal
            const neckLR = linReg([{x:nL.x,y:nL.y},{x:nR.x,y:nR.y}]);
            const neckSlopeNorm = Math.abs(neckLR.slope) / last;
            if (neckSlopeNorm > 0.0015) continue;  // reject if >~8% tilt over pattern
            // Rule 5: Prior uptrend — closes before left shoulder should be lower
            const priorCloses = closes.slice(Math.max(0, lS.x-20), lS.x);
            const priorAvg = priorCloses.length>3 ? priorCloses.reduce((a,b)=>a+b,0)/priorCloses.length : lS.y;
            if (lS.y < priorAvg * 1.02) continue; // need uptrend into left shoulder
            const neckNow = at(neckLR, n-1);
            const headProm = Math.min((head.y/lS.y-1), (head.y/rS.y-1));
            // Prior uptrend strength: slope of 20 bars before left shoulder
            const priorSlope = priorCloses.length>3
              ? (priorCloses[priorCloses.length-1]-priorCloses[0])/(priorCloses[0]*priorCloses.length) : 0;
            const trendStrScore = Math.min(1, Math.max(0, priorSlope*200));
            // Volume: right shoulder should have lower volume than left (distribution)
            const lSvol = prices.slice(Math.max(0,lS.x-3),lS.x+3).reduce((a,p)=>a+p.volume,0)/6;
            const rSvol = prices.slice(Math.max(0,rS.x-3),rS.x+3).reduce((a,p)=>a+p.volume,0)/6;
            const volDistrib = lSvol>0 && rSvol<lSvol ? Math.min(1,(lSvol-rSvol)/lSvol*3) : 0;
            const conf = Math.min(96, Math.round(
              50
              + (1-heightSymm/0.05)*16   // shoulder height symmetry: 0–16
              + (1-widthSymm/0.40)*10    // shoulder width symmetry: 0–10
              + (1-neckSlopeNorm/0.0015)*10  // neckline flatness: 0–10
              + Math.min(8, headProm*100)    // head prominence: 0–8
              + trendStrScore*6              // prior uptrend strength: 0–6
              + volDistrib*4                 // volume distribution: 0–4 (bonus)
            ));
            if (conf > bestConf) {
              bestConf = conf;
              bestHS = { lS, head, rS, nL, nR, neckLR, neckNow, conf };
            }
          }
        }
      }
      if (bestHS) {
        const {lS,head,rS,nL,nR,neckLR,neckNow,conf} = bestHS;
        found.push({ name:"Head and Shoulders", conf,
          stage: last<neckNow?"Confirmed":"Forming",
          ...PATTERNS_DB["Head and Shoulders"],
          geo:{ type:"hs", startI:lS.x, neckLR,
            neckStartI: nL.x, neckEndI: rS.x,
            points:[{i:lS.x,v:lS.y,label:"L Shoulder"},{i:head.x,v:head.y,label:"Head"},{i:rS.x,v:rS.y,label:"R Shoulder"}],
            resistance:head.y, support:neckNow }});
      }
    }

    // ── 4. INVERSE HEAD AND SHOULDERS — Murphy p.126 ─────────────────────
    // STRICT TEXTBOOK RULES (mirror of H&S):
    //  1. Head clearly LOWER than both shoulders (>4% below each)
    //  2. Shoulders roughly equal height (within 5%)
    //  3. Shoulders roughly equal width from head (within 40%)
    //  4. Neckline near-horizontal
    //  5. Prior DOWNTREND required before left shoulder
    //  6. Neckline peaks clearly above both shoulders
    if (n >= 45) {
      const sl = slRange(n-80, n-1, 4);
      let bestIHS = null, bestIConf = 0;
      for (let hi=1; hi<sl.length-1; hi++) {
        const head = sl[hi];
        const leftC  = sl.slice(0,hi).filter(p=>p.x < head.x-10);
        const rightC = sl.slice(hi+1).filter(p=>p.x > head.x+10);
        for (const lS of leftC) {
          for (const rS of rightC) {
            // Rule 1: Head clearly below both shoulders (>4%)
            if (head.y >= lS.y*0.96) continue;
            if (head.y >= rS.y*0.96) continue;
            // Rule 6: Right shoulder must not go below head
            if (rS.y <= head.y) continue;
            // Rule 2: Shoulders roughly equal height (within 5%)
            const heightSymm = Math.abs(lS.y-rS.y)/Math.max(lS.y,rS.y);
            if (heightSymm > 0.05) continue;
            // Rule 3: Shoulders roughly equal width (within 40%)
            const lDist = head.x - lS.x, rDist = rS.x - head.x;
            if (lDist < 10 || rDist < 10) continue;
            const widthSymm = Math.abs(lDist-rDist)/Math.max(lDist,rDist);
            if (widthSymm > 0.40) continue;
            // Neckline peaks
            const lPk = shRange(lS.x+1, head.x-1, 2);
            const rPk = shRange(head.x+1, rS.x-1, 2);
            if (!lPk.length || !rPk.length) continue;
            const nL = lPk.reduce((mx,p)=>p.y>mx.y?p:mx, lPk[0]);
            const nR = rPk.reduce((mx,p)=>p.y>mx.y?p:mx, rPk[0]);
            // Rule 6: Peaks clearly above their respective shoulders
            if (nL.y < lS.y*1.02) continue;
            if (nR.y < rS.y*1.02) continue;
            // Rule 4: Neckline near-horizontal
            const neckLR = linReg([{x:nL.x,y:nL.y},{x:nR.x,y:nR.y}]);
            const neckSlopeNorm = Math.abs(neckLR.slope) / last;
            if (neckSlopeNorm > 0.0015) continue;
            // Rule 5: Prior downtrend into left shoulder
            const priorCloses = closes.slice(Math.max(0, lS.x-20), lS.x);
            const priorAvg = priorCloses.length>3 ? priorCloses.reduce((a,b)=>a+b,0)/priorCloses.length : lS.y;
            if (lS.y > priorAvg * 0.98) continue; // need downtrend into left shoulder
            const neckNow = at(neckLR, n-1);
            const headProm = Math.min((lS.y/head.y-1), (rS.y/head.y-1));
            // Prior downtrend strength before left shoulder
            const priorSlope2 = priorCloses.length>3
              ? (priorCloses[priorCloses.length-1]-priorCloses[0])/(priorCloses[0]*priorCloses.length) : 0;
            const trendStrScore2 = Math.min(1, Math.max(0, (-priorSlope2)*200));
            // Volume: right shoulder should have lower volume than left (accumulation)
            const lSvol2 = prices.slice(Math.max(0,lS.x-3),lS.x+3).reduce((a,p)=>a+p.volume,0)/6;
            const rSvol2 = prices.slice(Math.max(0,rS.x-3),rS.x+3).reduce((a,p)=>a+p.volume,0)/6;
            const volAccum = lSvol2>0 && rSvol2<lSvol2 ? Math.min(1,(lSvol2-rSvol2)/lSvol2*3) : 0;
            const conf = Math.min(96, Math.round(
              50
              + (1-heightSymm/0.05)*16
              + (1-widthSymm/0.40)*10
              + (1-neckSlopeNorm/0.0015)*10
              + Math.min(8, headProm*100)
              + trendStrScore2*6
              + volAccum*4
            ));
            if (conf > bestIConf) {
              bestIConf = conf;
              bestIHS = { lS, head, rS, neckLR, neckNow, conf };
            }
          }
        }
      }
      if (bestIHS) {
        const {lS,head,rS,nL,nR,neckLR,neckNow,conf} = bestIHS;
        found.push({ name:"Inverse H&S", conf,
          stage: last>neckNow?"Confirmed":"Forming",
          ...PATTERNS_DB["Inverse H&S"],
          geo:{ type:"ihs", startI:lS.x, neckLR,
            neckStartI: nL.x, neckEndI: rS.x,
            points:[{i:lS.x,v:lS.y,label:"L Shoulder"},{i:head.x,v:head.y,label:"Head"},{i:rS.x,v:rS.y,label:"R Shoulder"}],
            resistance:neckNow, support:head.y }});
      }
    }

    // ── 5. TRIANGLES — Murphy p.152-165 ──────────────────────────────────
    // Murphy: need ≥2 pivot highs touching upper line, ≥2 pivot lows touching lower.
    // Minimum 4 weeks duration. Breakout in final 1/3 of triangle preferred.
    // Murphy Ch.6: triangles need ≥4 weeks (20 bars) to be valid
    for (const wLen of [50, 40, 30]) { // removed 25-bar minimum — too short for textbook validity
      if (n < wLen) continue;
      const off  = n - wLen;
      const tPts = shRange(off, n-1, 3);
      const bPts = slRange(off, n-1, 3);
      if (tPts.length < 2 || bPts.length < 2) continue; // Murphy: ≥2 touches each line
      // Each trendline must have pivots on both sides of the midpoint (not clustered)
      const midX = (off + n-1)/2;
      const tBothSides = tPts.some(p=>p.x<midX) && tPts.some(p=>p.x>=midX);
      const bBothSides = bPts.some(p=>p.x<midX) && bPts.some(p=>p.x>=midX);
      if (!tBothSides || !bBothSides) continue;
      const topLR = linReg(tPts), botLR = linReg(bPts);
      const midP  = last;
      const tSlope = topLR.slope / midP;  // normalized %/bar
      const bSlope = botLR.slope / midP;
      const FLAT=0.0006, SLOPE=0.0005;
      const tFlat=Math.abs(tSlope)<FLAT, tFall=tSlope<-SLOPE, tRise=tSlope>SLOPE;
      const bFlat=Math.abs(bSlope)<FLAT, bRise=bSlope>SLOPE,  bFall=bSlope<-SLOPE;
      const topNow=at(topLR,n-1), botNow=at(botLR,n-1);
      if (topNow <= botNow) continue; // lines must not have crossed

      // Anchor trendlines to the most prominent swing high/low on each side of the midpoint.
      // Full regression through all pivots can pull the line too far from where traders draw it;
      // anchoring to the highest early high → highest recent high gives a more accurate resistance.
      const earlyTops=tPts.filter(p=>p.x<=midX), lateTops=tPts.filter(p=>p.x>midX);
      const earlyBots=bPts.filter(p=>p.x<=midX), lateBots=bPts.filter(p=>p.x>midX);
      const tL=earlyTops.length?earlyTops.reduce((a,p)=>p.y>a.y?p:a,earlyTops[0]):tPts[0];
      const tR=lateTops.length ?lateTops.reduce((a,p)=>p.y>a.y?p:a,lateTops[0]) :tPts[tPts.length-1];
      const bL=earlyBots.length?earlyBots.reduce((a,p)=>p.y<a.y?p:a,earlyBots[0]):bPts[0];
      const bR=lateBots.length ?lateBots.reduce((a,p)=>p.y<a.y?p:a,lateBots[0]) :bPts[bPts.length-1];
      const tAS=(tL.x!==tR.x)?(tR.y-tL.y)/(tR.x-tL.x):topLR.slope;
      const bAS=(bL.x!==bR.x)?(bR.y-bL.y)/(bR.x-bL.x):botLR.slope;
      const tAAt=(x)=>tR.y+tAS*(x-tR.x);
      const bAAt=(x)=>bR.y+bAS*(x-bR.x);
      const topNowA=tAAt(n-1), botNowA=bAAt(n-1);

      // Ascending Triangle: flat/near-flat top + clearly rising bottom
      if ((tFlat||(tSlope>-FLAT*2))&&bRise&&bSlope>Math.abs(tSlope)*1.3) {
        const res = tPts.reduce((mx,p)=>p.y>mx?p.y:mx, tPts[0].y);
        const touchScore  = Math.min(1,(tPts.length+bPts.length-4)/4);   // extra touches = better
        const durationSc  = Math.min(1,(wLen-20)/30);                      // longer = more reliable
        const apexDist    = (topNow-botNow)/topNow;                        // how tight the apex is
        const apexSc      = Math.max(0, 1-apexDist*10);                    // tighter apex = more reliable
        const aConf = Math.min(93, Math.round(62 + bSlope*midP*200 + touchScore*10 + durationSc*8 + apexSc*5));
        // ── Murphy apex bar: where rising bottom meets flat resistance ──
        const aApexX  = bAS !== 0 ? (n-1) + (res - botNowA) / bAS : n + 30;
        const aBarsToApex = Math.max(0, Math.round(aApexX - (n-1)));
        const aCompPct    = Math.round(Math.min(99, ((n-1-off) / Math.max(1, aApexX-off)) * 100));
        const aPatLen = n-1-off, aMidI = off + Math.floor(aPatLen/2);
        const aEarlyVol = aPatLen>=20 ? prices.slice(off, aMidI).reduce((a,p)=>a+p.volume,0)/Math.max(1,aMidI-off) : 0;
        const aLateVol  = aPatLen>=20 ? prices.slice(aMidI).reduce((a,p)=>a+p.volume,0)/Math.max(1,n-1-aMidI) : 0;
        const aVolContracting = aPatLen>=20 && aLateVol < aEarlyVol*0.88;
        // Ascending triangle: top touches are flat resistance touches, bot pivots are rising lows
        const aResPivots = tPts.filter(p => Math.abs(p.y - res) / res <= 0.015).map(p=>({i:p.x,v:p.y}));
        const aBotPivots = bPts.map(p=>({i:p.x,v:p.y}));
        found.push({ name:"Ascending Triangle",
          conf: aConf,
          stage:last>res*0.998?"Confirmed":"Forming",
          ...PATTERNS_DB["Ascending Triangle"],
          geo:{ type:"triangle", startI:off,
            topLine:[{i:off,v:res},{i:n-1,v:res}],
            botLine:[{i:off,v:at(botLR,off)},{i:n-1,v:botNow}],
            resistance:res, support:botNow,
            topPivots:aResPivots, supPivots:aBotPivots,
            topTouches:tPts.length, botTouches:bPts.length,
            barsToApex:aBarsToApex, completionPct:aCompPct,
            volContracting:aVolContracting }});
        break;
      }
      // Descending Triangle: clearly falling top + flat/near-flat bottom
      if (tFall&&(bFlat||(bSlope<FLAT*2))&&Math.abs(tSlope)>Math.abs(bSlope)*1.3) {
        const sup = bPts.reduce((mn,p)=>p.y<mn?p.y:mn, bPts[0].y);
        // Require ≥2 bottom pivots within 2% of the support level —
        // otherwise it's a single touch, not a valid horizontal support
        const supTouches = bPts.filter(p => Math.abs(p.y - sup) / sup <= 0.02).length;
        if (supTouches < 2) continue;
        const touchScore  = Math.min(1,(tPts.length+bPts.length-4)/4);
        const durationSc  = Math.min(1,(wLen-20)/30);
        const apexDist    = (topNow-botNow)/topNow;
        const apexSc      = Math.max(0, 1-apexDist*10);
        const dConf = Math.min(93, Math.round(62 + Math.abs(tSlope)*midP*200 + touchScore*10 + durationSc*8 + apexSc*5));
        // ── Murphy apex bar: where declining top line meets flat support ──
        const dApexX = tAS !== 0 ? tL.x + (sup - tL.y) / tAS : n + 30;
        const dBarsToApex = Math.max(0, Math.round(dApexX - (n-1)));
        const dCompletionPct = Math.round(Math.min(99, ((n-1-off) / Math.max(1, dApexX-off)) * 100));
        // ── Volume contraction during pattern (Murphy Ch.7) ──
        const dPatLen = n - 1 - off;
        const dMidI   = off + Math.floor(dPatLen / 2);
        const dEarlyVol = dPatLen >= 20 ? prices.slice(off, dMidI).reduce((a,p)=>a+p.volume,0) / Math.max(1, dMidI-off) : 0;
        const dLateVol  = dPatLen >= 20 ? prices.slice(dMidI).reduce((a,p)=>a+p.volume,0)      / Math.max(1, n-1-dMidI) : 0;
        const dVolContracting = dPatLen >= 20 && dLateVol < dEarlyVol * 0.88;
        // Pivot touch points for rendering dots on the trendlines.
        // Use the same bL / bR anchors that define the triangle — these are the actual
        // lowest swing lows on each side of the midpoint, so the line touches both exactly.
        // Add any other bPts whose actual price lands within 1% of the anchor line.
        const anchorSlope = (bL.x !== bR.x) ? (bR.y - bL.y) / (bR.x - bL.x) : 0;
        const lineAtBar   = (barI) => bL.y + anchorSlope * (barI - bL.x);
        const dSupPivots  = bPts
          .filter(p => Math.abs(p.y - lineAtBar(p.x)) / p.y <= 0.01)
          .map(p=>({i:p.x, v:p.y}));
        // Guarantee bL and bR are always included (they define the line)
        if (!dSupPivots.find(p=>p.i===bL.x)) dSupPivots.unshift({i:bL.x, v:bL.y});
        if (!dSupPivots.find(p=>p.i===bR.x)) dSupPivots.push({i:bR.x, v:bR.y});
        dSupPivots.sort((a,b)=>a.i-b.i);
        const dTopPivots = tPts.map(p=>({i:p.x,v:p.y}));
        found.push({ name:"Descending Triangle",
          conf: dConf,
          stage:last<sup*1.002?"Confirmed":"Forming",
          ...PATTERNS_DB["Descending Triangle"],
          geo:{ type:"triangle", startI:off,
            topLine:[{i:tL.x,v:tL.y},{i:n-1,v:topNowA}],
            botLine:[{i:bL.x,v:bL.y},{i:bR.x,v:bR.y}],
            resistance:tL.y, support:sup,
            topPivots:dTopPivots, supPivots:dSupPivots,
            topTouches:tPts.length, botTouches:supTouches,
            barsToApex:dBarsToApex, completionPct:dCompletionPct,
            volContracting:dVolContracting }});
        break;
      }
      // Symmetrical Triangle: top falling + bottom rising (apex converging)
      if (tFall&&bRise) {
        const touchScore  = Math.min(1,(tPts.length+bPts.length-4)/4);
        const durationSc  = Math.min(1,(wLen-20)/30);
        const convergence = Math.min(1,(Math.abs(tSlope)+bSlope)*midP*100);
        const sConf = Math.min(88, Math.round(55 + convergence*15 + touchScore*10 + durationSc*8));
        const conf=sConf;
        found.push({ name:"Symmetrical Triangle", conf,
          stage:"Forming",
          ...PATTERNS_DB["Symmetrical Triangle"],
          geo:{ type:"triangle", startI:off,
            topLine:[{i:tL.x,v:tL.y},{i:n-1,v:topNowA}],
            botLine:[{i:bL.x,v:bL.y},{i:n-1,v:botNowA}],
            resistance:topNowA, support:botNowA }});
        break;
      }
      // Rising Wedge: both lines rising, bottom steeper (bearish) — Murphy p.173
      // Requires: both rising, bottom clearly steeper, AND visible convergence (≥25% narrowing)
      if (tRise && bRise && bSlope > tSlope * 1.3) {
        if (Math.abs(bSlope) < SLOPE * 0.8) break; // bottom must be meaningfully rising
        const rwLeftW  = Math.abs(tL.y - bL.y);
        const rwRightW = Math.max(0, topNowA - botNowA);
        if (rwLeftW < midP * 0.03) break;                        // too thin at left edge
        if (rwRightW / Math.max(rwLeftW, 0.01) > 0.78) break;   // nearly parallel — not a wedge
        const wConf = Math.min(80, Math.round(60 + (bSlope - tSlope) * midP * 150 + Math.min(1,(wLen-20)/30)*8));
        found.push({ name:"Wedge Rising", conf:wConf, stage:"Forming",
          ...PATTERNS_DB["Wedge Rising"],
          geo:{ type:"triangle", startI:off,
            topLine:[{i:tL.x,v:tL.y},{i:n-1,v:topNowA}],
            botLine:[{i:bL.x,v:bL.y},{i:n-1,v:botNowA}],
            resistance:topNowA, support:botNowA }});
        break;
      }
      // Falling Wedge: both lines falling, top steeper (bullish) — Murphy p.173
      // Requires: both falling, top clearly steeper, AND visible convergence (≥25% narrowing)
      // A flat bottom with falling top = descending triangle, not a wedge
      if (tFall && bFall && Math.abs(tSlope) > Math.abs(bSlope) * 1.3) {
        if (Math.abs(bSlope) < SLOPE * 0.8) break; // bottom must be meaningfully falling too
        const fwLeftW  = Math.abs(tL.y - bL.y);
        const fwRightW = Math.max(0, topNowA - botNowA);
        if (fwLeftW < midP * 0.03) break;                        // too thin at left edge
        if (fwRightW / Math.max(fwLeftW, 0.01) > 0.78) break;   // nearly parallel — not a wedge
        const fwConf = Math.min(80, Math.round(60 + (Math.abs(tSlope) - Math.abs(bSlope)) * midP * 150 + Math.min(1,(wLen-20)/30)*8));
        found.push({ name:"Wedge Falling", conf:fwConf, stage:"Forming",
          ...PATTERNS_DB["Wedge Falling"],
          geo:{ type:"triangle", startI:off,
            topLine:[{i:tL.x,v:tL.y},{i:n-1,v:topNowA}],
            botLine:[{i:bL.x,v:bL.y},{i:n-1,v:botNowA}],
            resistance:topNowA, support:botNowA }});
        break;
      }
      break;
    }

    // ── 6. FLAGS — Murphy p.168 ───────────────────────────────────────────
    // Detect the flag consolidation first, then walk backward to find the
    // true pole origin rather than using a fixed-length lookback window.
    // Pole: ≥5% move, ≥0.3%/bar sharpness. Flag: <7% range, ≤38% retrace.
    {
      let flagFound = false;
      for (const fLen of [18,15,12,10,8]) {
        if (flagFound || n < fLen+10) continue;
        const pE = n - fLen;                                   // flag start bar
        const fCloses=closes.slice(pE), fHighs=highs.slice(pE), fLows=lows.slice(pE);
        const fHi=safeMax(fHighs), fLo=safeMin(fLows);
        const flagRange=(fHi-fLo)/fHi;
        if (flagRange >= 0.07) continue;                       // flag must be tight

        const fSlopeLR = linReg(fCloses.map((v,i)=>({x:i,y:v})));
        const fSlope   = fSlopeLR.slope / last;

        // ── Bear Flag: flag slopes UP (counter-trend) ──────────────────────
        // Must meaningfully slope upward AND start right after the pole bottom
        if (fSlope >= 0.0005) {
          // Step 1: pole bottom — lowest close in up to 50 bars before the flag
          const preLen    = Math.min(50, pE);
          const preSlice  = closes.slice(pE-preLen, pE);
          const relBotI   = preSlice.reduce((mi,v,i)=>v<preSlice[mi]?i:mi, 0);
          const botI      = pE-preLen+relBotI;
          const botV      = closes[botI];
          // ── CRITICAL: flag must start close to the pole bottom in both TIME and PRICE
          if (pE - botI > Math.max(fLen, 10)) continue;  // must be within fLen bars of pole bottom
          if (closes[pE] > botV * 1.08)        continue;  // flag start must be within 8% of pole bottom
          // Step 2: pole origin — highest close in up to 90 bars before the bottom
          const origLen   = Math.min(90, botI);
          const origSlice = closes.slice(botI-origLen, botI);
          if (!origSlice.length) continue;
          const relOrigI  = origSlice.reduce((mi,v,i)=>v>origSlice[mi]?i:mi, 0);
          const origI     = botI-origLen+relOrigI;
          const origV     = closes[origI];

          const poleDrop  = (origV-botV)/origV;
          const poleBars  = botI-origI;
          if (poleDrop  < 0.05)             continue;   // pole must be ≥5%
          if (poleBars  < 3)                continue;
          if (poleDrop/poleBars < 0.003)    continue;   // ≥0.3%/bar sharpness
          const retrace = (fHi-fLo)/(origV-botV);
          if (retrace >= 0.38)              continue;

          const tLR=linReg(fHighs.map((v,i)=>({x:pE+i,y:v})));
          const bLR=linReg(fLows.map((v,i) =>({x:pE+i,y:v})));
          // Both channel lines must slope UPWARD — a downward-sloping channel is not a bear flag
          // (it would be a descending channel or falling wedge instead)
          if (tLR.slope <= 0 || bLR.slope <= 0) continue;
          found.push({ name:"Bear Flag",
            conf:Math.min(91,Math.round(66+poleDrop*110)),
            stage:"Forming",
            ...PATTERNS_DB["Bear Flag"],
            geo:{ type:"flag", startI:origI,
              poleBase:{i:origI,v:origV}, poleTop:{i:botI,v:botV},
              recentLegV:closes[pE],               // price at flag start, used to cap target
              flagTop:[{i:pE,v:at(tLR,pE)},{i:n-1,v:at(tLR,n-1)}],
              flagBot:[{i:pE,v:at(bLR,pE)},{i:n-1,v:at(bLR,n-1)}],
              resistance:at(tLR,n-1), support:at(bLR,n-1) }});
          flagFound=true; break;
        }

        // ── Bull Flag: flag slopes DOWN (counter-trend) ────────────────────
        // Murphy: flag must be a tight counter-trend pullback that starts RIGHT AFTER the pole top
        if (fSlope <= -0.0005) {                        // must meaningfully slope down
          // Step 1: pole top — highest close in up to 50 bars before the flag
          const preLen    = Math.min(50, pE);
          const preSlice  = closes.slice(pE-preLen, pE);
          const relTopI   = preSlice.reduce((mi,v,i)=>v>preSlice[mi]?i:mi, 0);
          const topI      = pE-preLen+relTopI;
          const topV      = closes[topI];
          // ── CRITICAL: flag must start close to the pole top in both TIME and PRICE ──
          // If the flag starts far from the pole top, the real pullback already happened
          // and what we're seeing is a recovery/new pattern, not the flag consolidation
          if (pE - topI > Math.max(fLen, 10)) continue;  // must be within fLen bars of pole top
          if (closes[pE] < topV * 0.92)        continue;  // flag start must be within 8% of pole top
          // Step 2: pole origin — lowest close in up to 90 bars before the top
          const origLen   = Math.min(90, topI);
          const origSlice = closes.slice(topI-origLen, topI);
          if (!origSlice.length) continue;
          const relOrigI  = origSlice.reduce((mi,v,i)=>v<origSlice[mi]?i:mi, 0);
          const origI     = topI-origLen+relOrigI;
          const origV     = closes[origI];

          const poleGain  = (topV-origV)/origV;
          const poleBars  = topI-origI;
          if (poleGain  < 0.05)             continue;   // pole must be ≥5%
          if (poleBars  < 3)                continue;
          if (poleGain/poleBars < 0.003)    continue;   // ≥0.3%/bar sharpness
          const retrace = (fHi-fLo)/(topV-origV);
          if (retrace >= 0.38)              continue;

          const tLR=linReg(fHighs.map((v,i)=>({x:pE+i,y:v})));
          const bLR=linReg(fLows.map((v,i) =>({x:pE+i,y:v})));
          // Both channel lines must slope DOWNWARD — an upward-sloping channel is not a bull flag
          // (it would be an ascending channel or rising wedge instead)
          if (tLR.slope >= 0 || bLR.slope >= 0) continue;
          found.push({ name:"Bull Flag",
            conf:Math.min(91,Math.round(66+poleGain*110)),
            stage:"Forming",
            ...PATTERNS_DB["Bull Flag"],
            geo:{ type:"flag", startI:origI,
              poleBase:{i:origI,v:origV}, poleTop:{i:topI,v:topV},
              recentLegV:closes[pE],               // price at flag start, used to cap target
              flagTop:[{i:pE,v:at(tLR,pE)},{i:n-1,v:at(tLR,n-1)}],
              flagBot:[{i:pE,v:at(bLR,pE)},{i:n-1,v:at(bLR,n-1)}],
              resistance:at(tLR,n-1), support:at(bLR,n-1) }});
          flagFound=true; break;
        }
      }
    }

    // ── 7. CUP WITH HANDLE ────────────────────────────────────────────────
    for (const cLen of [40,50,35,55]) {
      if (n < cLen+5) continue;
      const hLen=Math.min(15,n-cLen), cS=n-cLen-hLen;
      const cup=closes.slice(cS,cS+cLen), handle=closes.slice(cS+cLen);
      const cL=cup[0], cR=cup[cup.length-1], cBot=safeMin(cup);
      const cBotI=cS+cup.indexOf(cBot);
      const depth=(Math.min(cL,cR)-cBot)/Math.min(cL,cR);
      const symm=Math.abs(cL-cR)/cL;
      const hMax=safeMax(handle), hMin=safeMin(handle);
      const hPull=(hMax-hMin)/hMax;
      const midCup=cBot+(Math.min(cL,cR)-cBot)*0.5;
      if (depth>=0.12&&depth<=0.50&&symm<0.06&&hPull<0.15&&hPull>0.005&&hMin>=midCup) {
        const res=Math.max(cL,cR);
        found.push({ name:"Cup with Handle",
          conf:Math.min(89,Math.round(63+(1-symm/0.06)*18)),
          stage:last>res*0.99?"Confirmed":"Forming",
          ...PATTERNS_DB["Cup with Handle"],
          geo:{ type:"cup", startI:cS,
            points:[{i:cS,v:cL,label:"Cup L"},{i:cBotI,v:cBot,label:"Bottom"},{i:cS+cLen-1,v:cR,label:"Cup R"}],
            resistance:res, support:cBot }});
        break;
      }
    }

    // ── 8. ROUNDING BOTTOM — Murphy p.131 ────────────────────────────────
    // Murphy: a slow, gradual "saucer" taking months to form. NOT a V-bottom
    // or short consolidation bounce. Strict filters:
    //   (1) ≥65 bars (~3 months)   (2) smooth U-curve (low jaggedness score)
    //   (3) depth ≥8%              (4) left/right slope symmetry ≥30%
    //   (5) volume U-profile (trough volume < edge volume)
    for (const sl of [80, 70, 65]) {
      if (n < sl + 5) continue;
      const seg  = closes.slice(-sl);
      const half = Math.floor(sl / 2);
      const lLR  = linReg(seg.slice(0, half).map((v,i) => ({x:i, y:v})));
      const rLR  = linReg(seg.slice(half).map((v,i) => ({x:i, y:v})));

      // Direction gate: left must be clearly falling, right clearly rising
      if (!(lLR.slope < -0.03 && rLR.slope > 0.03)) continue;

      // Locate the trough in the centre quarter
      const tW  = Math.min(8, Math.floor(half * 0.4));
      const tLo = Math.max(0, half - tW), tHi = Math.min(sl, half + tW);
      const troughSeg = seg.slice(tLo, tHi);
      const botV   = safeMin(troughSeg);
      const botIdx = n - sl + tLo + troughSeg.indexOf(botV);

      // (3) Depth ≥ 8%: bottom must sit well below both ends — filters bounce/V
      const edgeAvg = (seg[0] + seg[sl-1]) / 2;
      const depth   = (edgeAvg - botV) / edgeAvg;
      if (depth < 0.08) continue;

      // (4) Symmetry: descent and ascent speeds within 35% of each other
      //    A lopsided saucer (crash then drift) is not a rounding bottom
      const lSpeed  = Math.abs(lLR.slope);
      const rSpeed  = Math.abs(rLR.slope);
      const symRatio = lSpeed > 0 && rSpeed > 0
        ? Math.min(lSpeed, rSpeed) / Math.max(lSpeed, rSpeed) : 0;
      if (symRatio < 0.30) continue;

      // (2) Smoothness: each close vs its 5-bar local average
      //    High deviation = jagged bounce, not a saucer
      let totalDev = 0, devCount = 0;
      for (let i = 2; i < sl - 2; i++) {
        const loc = (seg[i-2]+seg[i-1]+seg[i]+seg[i+1]+seg[i+2]) / 5;
        totalDev += Math.abs(seg[i] - loc) / loc;
        devCount++;
      }
      const smoothScore = devCount > 0 ? totalDev / devCount : 1;
      if (smoothScore > 0.025) continue;   // >2.5% jaggedness → not a saucer

      // (5) Volume U-shape: trough volume < edge volumes (Murphy Ch.7)
      const vols     = prices.slice(-sl).map(p => p.volume);
      const qLen     = Math.floor(sl / 4);
      const lVolAvg  = vols.slice(0, qLen).reduce((a,b)=>a+b, 0) / qLen;
      const midVols  = vols.slice(Math.floor(sl*0.35), Math.ceil(sl*0.65));
      const midVolAvg = midVols.reduce((a,b)=>a+b, 0) / Math.max(1, midVols.length);
      const rVolAvg  = vols.slice(-qLen).reduce((a,b)=>a+b, 0) / qLen;
      const volUShaped = midVolAvg < lVolAvg * 0.85 && midVolAvg < rVolAvg * 0.85;

      const res  = Math.max(seg[0], seg[sl-1]);
      const conf = Math.min(91, Math.round(
        68 + depth * 70 + symRatio * 8 + (volUShaped ? 6 : 0) + (smoothScore < 0.015 ? 5 : 0)
      ));
      found.push({ name:"Rounding Bottom", conf,
        stage: last > res * 0.98 ? "Confirmed" : "Forming",
        ...PATTERNS_DB["Rounding Bottom"],
        geo:{ type:"cup", startI: n - sl,
          points:[
            {i:n-sl,   v:seg[0],    label:"Start"},
            {i:botIdx, v:botV,      label:"Bottom"},
            {i:n-1,    v:seg[sl-1], label:"Now"}],
          resistance: res, support: botV,
          volUShaped, smoothPct: (smoothScore*100).toFixed(1), symPct: Math.round(symRatio*100) }});
      break;
    }

    // ── 9. RECTANGLE — Murphy p.150 ──────────────────────────────────────
    // ≥2 highs at same resistance, ≥2 lows at same support (within 2% each)
    {
      const sl=Math.min(45,n), off=n-sl;
      const tPts=shRange(off,n-1,3), bPts=slRange(off,n-1,3);
      if (tPts.length>=2&&bPts.length>=2) {
        const tMean=tPts.reduce((a,p)=>a+p.y,0)/tPts.length;
        const bMean=bPts.reduce((a,p)=>a+p.y,0)/bPts.length;
        const tSprd=tPts.reduce((a,p)=>a+Math.abs(p.y-tMean),0)/tPts.length/tMean;
        const bSprd=bPts.reduce((a,p)=>a+Math.abs(p.y-bMean),0)/bPts.length/bMean;
        const ht=(tMean-bMean)/tMean;
        if (tSprd<0.02&&bSprd<0.02&&ht>0.025&&ht<0.20) {
          const priorUp = closes[off] < closes[off + Math.floor(sl*0.3)];
          const name = priorUp?"Rectangle Bottom":"Rectangle Top";
          found.push({ name, conf:70, stage:
            name==="Rectangle Top"?(last<bMean?"Confirmed":"Forming"):(last>tMean?"Confirmed":"Forming"),
            ...PATTERNS_DB[name],
            geo:{ type:"rect", startI:off,
              topLine:[{i:off,v:tMean},{i:n-1,v:tMean}],
              botLine:[{i:off,v:bMean},{i:n-1,v:bMean}],
              resistance:tMean, support:bMean }});
        }
      }
    }

    // ── 10. BROADENING TOP — Murphy p.167 ────────────────────────────────
    {
      const sl=Math.min(40,n), off=n-sl;
      const tPts=shRange(off,n-1,3), bPts=slRange(off,n-1,3);
      if (tPts.length>=2&&bPts.length>=2) {
        const tLR=linReg(tPts), bLR=linReg(bPts);
        if (tLR.slope/last>0.0005&&bLR.slope/last<-0.0005) {
          found.push({ name:"Broadening Top", conf:60, stage:"Forming",
            ...PATTERNS_DB["Broadening Top"],
            geo:{ type:"triangle", startI:off,
              topLine:[{i:off,v:at(tLR,off)},{i:n-1,v:at(tLR,n-1)}],
              botLine:[{i:off,v:at(bLR,off)},{i:n-1,v:at(bLR,n-1)}],
              resistance:at(tLR,n-1), support:at(bLR,n-1) }});
        }
      }
    }

    if (!found.length) {
      // Trend channel fallback
      const sl=Math.min(30,n), off=n-sl;
      const tPts=shRange(off,n-1,2), bPts=slRange(off,n-1,2);
      const tLR=tPts.length>=2?linReg(tPts):linReg([{x:off,y:highs[off]},{x:n-1,y:highs[n-1]}]);
      const bLR=bPts.length>=2?linReg(bPts):linReg([{x:off,y:lows[off]},{x:n-1,y:lows[n-1]}]);
      const nm=closes[n-1]>closes[off]?"Bull Flag":"Bear Flag";
      found.push({ name:nm, conf:48, stage:"Forming", ...PATTERNS_DB[nm],
        geo:{ type:"flag", startI:off,
          poleBase:{i:off,v:closes[off]}, poleTop:{i:n-1,v:closes[n-1]},
          flagTop:[{i:off,v:at(tLR,off)},{i:n-1,v:at(tLR,n-1)}],
          flagBot:[{i:off,v:at(bLR,off)},{i:n-1,v:at(bLR,n-1)}],
          resistance:at(tLR,n-1), support:at(bLR,n-1) }});
    }

    return found.sort((a,b)=>b.conf-a.conf)[0];
  } catch(e) { console.warn("detectPatterns:", e); return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// BULKOWSKI MEASURED-MOVE TARGET PRICE
// Encyclopedia of Chart Patterns (2nd Ed.) — Pattern-specific projection rules
// Each pattern uses its geometric height projected from the breakout level
// ══════════════════════════════════════════════════════════════════════════════
function calcBulkowskiTarget(pattern, currentPrice) {
  if (!pattern || !pattern.geo) return null;
  const geo = pattern.geo;
  const name = pattern.name;

  try {
    // ── Double Bottom (Bulkowski Ch.11): height = neckline − avg_low, add to neckline
    if (geo.type === "doubleBottom") {
      const pts = geo.points;
      if (!pts || pts.length < 3) return null;
      const neckline = pts[1].v;                           // peak between the two lows
      const avgLow   = (pts[0].v + pts[2].v) / 2;
      const height   = neckline - avgLow;                  // pattern height
      return { target: neckline + height, breakout: neckline, height, method: "Neckline + Height" };
    }

    // ── Double Top (Bulkowski Ch.12): height = avg_top − neckline, subtract from neckline
    if (geo.type === "doubleTop") {
      const pts = geo.points;
      if (!pts || pts.length < 3) return null;
      const neckline = pts[1].v;                           // trough between the two tops
      const avgTop   = (pts[0].v + pts[2].v) / 2;
      const height   = avgTop - neckline;
      return { target: neckline - height, breakout: neckline, height, method: "Neckline − Height" };
    }

    // ── Head and Shoulders (Bulkowski Ch.32): height = head − neckline, subtract from neckline
    if (geo.type === "hs") {
      const pts = geo.points;
      if (!pts || pts.length < 3) return null;
      const headPrice = pts[1].v;                          // head (middle point)
      const neckline  = geo.support;                       // neckline at current bar
      const height    = headPrice - neckline;
      return { target: neckline - height, breakout: neckline, height, method: "Neckline − Head Height" };
    }

    // ── Inverse H&S (Bulkowski Ch.35): height = neckline − head, add to neckline
    if (geo.type === "ihs") {
      const pts = geo.points;
      if (!pts || pts.length < 3) return null;
      const headPrice = pts[1].v;
      const neckline  = geo.resistance;
      const height    = neckline - headPrice;
      return { target: neckline + height, breakout: neckline, height, method: "Neckline + Head Depth" };
    }

    // ── Triangles (Bulkowski Ch.3-4): height = widest part (left edge), project from breakout
    if (geo.type === "triangle") {
      const topLine = geo.topLine, botLine = geo.botLine;
      if (!topLine || !botLine) return null;
      const leftTop = topLine[0].v, leftBot = botLine[0].v;
      const height  = Math.abs(leftTop - leftBot);         // widest part (left edge)
      const breakoutPrice = pattern.breakout === "bullish"
        ? geo.resistance    // break above resistance
        : geo.support;      // break below support
      const target = pattern.breakout === "bullish"
        ? breakoutPrice + height
        : breakoutPrice - height;
      return { target, breakout: breakoutPrice, height, method: "Width at Left Edge" };
    }

    // ── Flags (Bulkowski Ch.24-25): measured move = pole height added to breakout of flag
    if (geo.type === "flag") {
      const poleBase = geo.poleBase?.v, poleTop = geo.poleTop?.v;
      if (!poleBase || !poleTop) return null;
      const fullPoleHeight = Math.abs(poleTop - poleBase);
      // Cap pole height at the immediate pre-flag leg to keep targets realistic
      // when the pole origin is a large historical move (e.g. a multi-month decline).
      const recentLeg = geo.recentLegV != null
        ? Math.abs(geo.recentLegV - (pattern.breakout==="bearish" ? poleTop : poleBase))
        : fullPoleHeight;
      const poleHeight = Math.min(fullPoleHeight, recentLeg);
      const flagBreakout = pattern.breakout === "bullish"
        ? (geo.flagTop ? geo.flagTop[1].v : poleTop)       // top of flag channel
        : (geo.flagBot ? geo.flagBot[1].v : poleTop);      // bottom of flag channel
      const target = pattern.breakout === "bullish"
        ? flagBreakout + poleHeight
        : flagBreakout - poleHeight;
      return { target, breakout: flagBreakout, height: poleHeight, method: "Pole Height (Measured Move)" };
    }

    // ── Cup with Handle (O'Neil/Bulkowski): cup depth projected from rim (resistance)
    if (geo.type === "cup") {
      const pts = geo.points;
      if (!pts || pts.length < 3) return null;
      const rim    = geo.resistance;                        // cup left/right rim level
      const bottom = pts[1].v;                             // cup bottom
      const depth  = rim - bottom;
      if (name === "Cup with Handle") {
        return { target: rim + depth, breakout: rim, height: depth, method: "Rim + Cup Depth" };
      }
      // Rounding Bottom: same principle
      return { target: rim + depth, breakout: rim, height: depth, method: "Breakout + Pattern Height" };
    }

    // ── Rectangle (Bulkowski Ch.50-51): height of box projected from breakout side
    if (geo.type === "rect") {
      const topLine = geo.topLine, botLine = geo.botLine;
      if (!topLine || !botLine) return null;
      const resistance = topLine[0].v, support = botLine[0].v;
      const height = resistance - support;
      if (pattern.breakout === "bullish") {
        return { target: resistance + height, breakout: resistance, height, method: "Box Height (Upside)" };
      } else {
        return { target: support - height, breakout: support, height, method: "Box Height (Downside)" };
      }
    }
  } catch(e) { console.warn("calcBulkowskiTarget:", e); }

  // Fallback: use Bulkowski avg gain/loss from database
  const pct = (pattern.avgGain ?? pattern.avgLoss ?? 0) / 100;
  const base = geo.resistance ?? geo.support ?? currentPrice;
  const target = pattern.breakout === "bullish" ? base * (1 + pct) : base * (1 - pct);
  return { target, breakout: base, height: base * pct, method: "Bulkowski Avg % Move" };
}

// ══════════════════════════════════════════════════════════════════════════════
// PATTERN INVALIDATION — per-pattern geometric rules (Murphy & Bulkowski)
// Returns { invalidated: bool, reason: string, isBusted?: bool, bustedTarget?: number }
// ══════════════════════════════════════════════════════════════════════════════
// KEY FIX: for patterns where the invalidation is a close below/above a fixed
// level (double bottom/top, cup, rect), we scan ALL historical closes within
// the pattern window — not just today's price. A stock can break below support
// in March, bounce back to current price, and the pattern is still invalidated.
function checkPatternInvalidation(pattern, prices, currentPrice) {
  if (!pattern?.geo) return { invalidated:false, reason:"" };
  const geo=pattern.geo, last=currentPrice, n=prices.length;

  // ── Helper: find first bar after `fromBar` where predicate(close) is true ──
  const firstViolation = (fromBar, predFn) => {
    for (let i=Math.max(0,fromBar); i<n; i++) {
      if (predFn(prices[i].close)) return { bar:i, price:prices[i].close, ts:prices[i].ts };
    }
    return null;
  };
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";

  if (geo.type==="triangle") {
    // Triangles: check current price only (trendlines shift every bar — historical
    // closes need to be evaluated against the trendline value at that bar, which
    // is complex. Current price vs current trendline endpoint is sufficient.)
    const topNow=geo.topLine?.[1]?.v, botNow=geo.botLine?.[1]?.v;
    if (topNow==null||botNow==null) return { invalidated:false, reason:"" };
    if (pattern.breakout==="bearish"&&last>topNow*1.005)
      return { invalidated:true, reason:`Price closed above falling resistance ($${topNow.toFixed(2)}) — bearish structure broken` };
    if (pattern.breakout==="bullish"&&last<botNow*0.995)
      return { invalidated:true, reason:`Price closed below rising support ($${botNow.toFixed(2)}) — bullish structure broken` };
    if (pattern.breakout==="neutral"&&(last>topNow*1.005||last<botNow*0.995))
      return { invalidated:true, reason:`Price broke symmetrical triangle bounds — monitor breakout direction` };
  }

  if (geo.type==="doubleBottom") {
    const support=geo.support, neckline=geo.resistance;
    if (support) {
      // Scan closes from AFTER the second low (p2) to now.
      // Murphy: any close below the support level (the two lows) invalidates.
      // Using 0.5% tolerance to avoid flagging on tiny precision gaps.
      const p2Bar = geo.points?.[2]?.i ?? geo.startI;
      const v = firstViolation(p2Bar + 1, c => c < support * 0.995);
      if (v) {
        // Bulkowski busted pattern: target = support − (neckline − support)
        const height = neckline ? neckline - support : support * 0.10;
        const bustedTarget = support - height;
        return { invalidated:true, isBusted:true, bustedTarget,
          reason:`Closed below double bottom lows ($${support.toFixed(2)}) on ${fmtDate(v.ts)} — BUSTED PATTERN (Bulkowski: ~35%+ downside move expected)` };
      }
    }
  }

  if (geo.type==="doubleTop") {
    const resistance=geo.resistance, neckline=geo.support;
    if (resistance) {
      const p2Bar = geo.points?.[2]?.i ?? geo.startI;
      const v = firstViolation(p2Bar + 1, c => c > resistance * 1.005);
      if (v) {
        const height = neckline ? resistance - neckline : resistance * 0.10;
        const bustedTarget = resistance + height;
        return { invalidated:true, isBusted:true, bustedTarget,
          reason:`Closed above double top highs ($${resistance.toFixed(2)}) on ${fmtDate(v.ts)} — BUSTED PATTERN (Bulkowski: ~35%+ upside move expected)` };
      }
    }
  }

  if (geo.type==="hs") {
    const headPrice=geo.points?.[1]?.v, rShoulder=geo.points?.[2]?.v;
    if (headPrice&&last>headPrice*1.005) return { invalidated:true, reason:`Price exceeded head ($${headPrice.toFixed(2)}) — H&S negated` };
    if (rShoulder&&last>rShoulder*1.02)  return { invalidated:true, reason:`Price closed above right shoulder ($${rShoulder.toFixed(2)})` };
  }

  if (geo.type==="ihs") {
    const headPrice=geo.points?.[1]?.v;
    if (headPrice&&last<headPrice*0.995) return { invalidated:true, reason:`Price fell below head ($${headPrice.toFixed(2)}) — IH&S negated` };
  }

  if (geo.type==="flag") {
    const pb=geo.poleBase?.v;
    if (pb&&pattern.breakout==="bullish"&&last<pb*0.97) return { invalidated:true, reason:`Price undercut pole base ($${pb.toFixed(2)}) — bull flag failed` };
    if (pb&&pattern.breakout==="bearish"&&last>pb*1.03) return { invalidated:true, reason:`Price exceeded pole base ($${pb.toFixed(2)}) — bear flag failed` };
  }

  if (geo.type==="cup") {
    // Scan full pattern window for any close below the cup bottom
    const v = firstViolation(geo.startI, c => c < geo.support * 0.995);
    if (v) return { invalidated:true, reason:`Closed below cup bottom ($${geo.support.toFixed(2)}) on ${fmtDate(v.ts)} — pattern failed` };
  }

  if (geo.type==="rect") {
    if (pattern.breakout==="bullish"&&geo.support) {
      const v = firstViolation(geo.startI, c => c < geo.support * 0.97);
      if (v) return { invalidated:true, reason:`Closed below rectangle support ($${geo.support.toFixed(2)}) on ${fmtDate(v.ts)}` };
    }
    if (pattern.breakout==="bearish"&&geo.resistance) {
      const v = firstViolation(geo.startI, c => c > geo.resistance * 1.03);
      if (v) return { invalidated:true, reason:`Closed above rectangle resistance ($${geo.resistance.toFixed(2)}) on ${fmtDate(v.ts)}` };
    }
  }

  return { invalidated:false, reason:"" };
}

// ══════════════════════════════════════════════════════════════════════════════
// SWING TRADE SCORING — Redesigned multi-factor composite score (0-100)
//
// Factor                       Max Pts   Notes
// ─────────────────────────────────────────────────────────────────────────────
// 1. Pattern Quality            30       reliability, shape conf, stage, category
// 2. Trend Alignment            20       SMA stack, price vs MAs, ADX
// 3. Momentum                   18       RSI zone, MACD hist + crossover
// 4. Volume                     14       breakout volume, OBV trend, avg vol
// 5. Risk/Reward Setup           8       R/R ratio quality, ATR-based stop
// 6. Market Position             6       52W range, support/resistance proximity
// 7. Divergence Bonus            4       RSI divergence aligned with pattern
//
// Penalties (deducted):
//   - Invalidated pattern:      −25
//   - RSI extreme overbought/oversold vs direction: −5
//   - Volume collapse on approach:  −4
//   - Excessive ATR (choppy):    −3
// ══════════════════════════════════════════════════════════════════════════════
function scoreStock(prices, pattern, volData, divergence, trendStr) {
  if (!pattern) return { total:40, breakdown:null };
  const rsi   = calcRSI(prices);
  const macd  = calcMACD(prices);
  const atr   = calcATR(prices);
  const last  = prices[prices.length-1].close;
  const sma20 = calcSMA(prices,20);
  const sma50 = calcSMA(prices,50);
  const relPos= calcRelPosition(prices);
  const breakdown = {};

  // ── 1. PATTERN QUALITY (30 pts) ──────────────────────────────────────────
  let pq = 0;
  // Reliability from Bulkowski database (0–12)
  pq += (pattern.reliability/100)*12;
  // Shape confidence from detection algorithm (0–10)
  pq += (pattern.conf/100)*10;
  // Stage bonus: confirmed >> forming (0–8)
  pq += pattern.stage==="Confirmed"?8:pattern.stage==="Forming"?3:0;
  // Category bonus: reversal patterns at extremes score higher (0–2)
  const atLow  = relPos.pct < 25;
  const atHigh = relPos.pct > 75;
  if (pattern.category==="Reversal" && pattern.breakout==="bullish" && atLow)  pq+=2;
  if (pattern.category==="Reversal" && pattern.breakout==="bearish" && atHigh) pq+=2;
  pq = Math.min(30, pq);
  breakdown.patternQuality = { score:Math.round(pq), max:30,
    detail:`Reliability ${pattern.reliability}% · Conf ${pattern.conf}% · ${pattern.stage}` };

  // ── 2. TREND ALIGNMENT (20 pts) ──────────────────────────────────────────
  let ta = 0;
  if (pattern.breakout==="bullish") {
    if      (last>sma20&&sma20>(sma50??0)&&trendStr.bullTrend)  ta=20; // perfect stack
    else if (last>sma20&&sma20>(sma50??0))                      ta=16; // price + MA stack
    else if (last>sma20)                                         ta=11; // above 20 only
    else if (last>(sma50??0))                                    ta=6;  // above 50 only
    else                                                          ta=2;  // below both
  } else if (pattern.breakout==="bearish") {
    if      (last<sma20&&sma20<(sma50??999999)&&!trendStr.bullTrend) ta=20;
    else if (last<sma20&&sma20<(sma50??999999))                       ta=16;
    else if (last<sma20)                                               ta=11;
    else if (last<(sma50??0))                                          ta=6;
    else                                                                ta=2;
  } else ta=10;
  // ADX strength bonus (+2 if trending)
  if (trendStr.adx>25) ta=Math.min(20,ta+2);
  breakdown.trendAlignment = { score:Math.round(ta), max:20,
    detail:`SMA20 $${sma20?.toFixed(1)||"—"} · SMA50 $${sma50?.toFixed(1)||"—"} · ADX≈${trendStr.adx}` };

  // ── 3. MOMENTUM (18 pts) — RSI zone + MACD ───────────────────────────────
  let mo = 0;
  if (pattern.breakout==="bullish") {
    // Ideal entry: RSI 40-65 (not overbought, has room to run)
    if      (rsi>=42&&rsi<=62) mo+=11;
    else if (rsi>=32&&rsi< 42) mo+=8;   // recovering from oversold
    else if (rsi> 62&&rsi<=70) mo+=5;   // extended but not extreme
    else if (rsi< 32)           mo+=6;   // deep oversold — reversal setup
    else                         mo+=2;   // overbought >70 — risky entry
    // MACD (0–7): histogram direction + magnitude
    if (macd.bullish)            mo+=5;
    if (macd.hist>0&&macd.hist>Math.abs(macd.signal)*0.3) mo+=2; // strong hist
  } else if (pattern.breakout==="bearish") {
    if      (rsi>=58&&rsi<=72) mo+=11;
    else if (rsi> 72)           mo+=8;   // overbought — ideal short
    else if (rsi>=48&&rsi< 58) mo+=5;
    else                         mo+=2;
    if (!macd.bullish)           mo+=5;
    if (macd.hist<0&&Math.abs(macd.hist)>Math.abs(macd.signal)*0.3) mo+=2;
  } else mo+=9;
  breakdown.momentum = { score:Math.round(mo), max:18,
    detail:`RSI ${rsi} · MACD hist ${macd.hist} (${macd.bullish?"Bull":"Bear"})` };

  // ── 4. VOLUME (14 pts) ───────────────────────────────────────────────────
  let vol = 0;
  // Recent volume trend vs 20-day average
  if      (volData.trend>1.6) vol+=8;   // major surge
  else if (volData.trend>1.3) vol+=6;
  else if (volData.trend>1.1) vol+=4;
  else if (volData.trend>0.9) vol+=2;
  else                         vol+=0;   // drying up
  // OBV trend alignment (0–4)
  const obvPositive = volData.obv > 0;
  if (pattern.breakout==="bullish" && obvPositive)  vol+=4;
  if (pattern.breakout==="bearish" && !obvPositive) vol+=4;
  // Volume consistency: penalise if avg vol is very low (thin market)
  if (volData.avgVol < 500000) vol = Math.max(0, vol-3); // illiquid
  vol = Math.min(14, vol);
  breakdown.volume = { score:Math.round(vol), max:14,
    detail:`Trend ${(volData.trend*100).toFixed(0)}% of avg · OBV ${obvPositive?"Positive":"Negative"}` };

  // ── 5. RISK/REWARD SETUP (8 pts) ─────────────────────────────────────────
  let rr = 0;
  const stopDist = atr*1.5;
  const target   = pattern.geo?.resistance??pattern.geo?.support??last;
  const rrRatio  = stopDist>0?Math.abs(target-last)/stopDist:0;
  if      (rrRatio>=3.0) rr=8;
  else if (rrRatio>=2.0) rr=6;
  else if (rrRatio>=1.5) rr=4;
  else if (rrRatio>=1.0) rr=2;
  else                    rr=0;
  // ATR reasonableness: penalise extremely choppy stocks
  const atrPct = atr/last;
  if (atrPct>0.05) rr=Math.max(0,rr-2); // ATR > 5% of price = very choppy
  breakdown.rrSetup = { score:Math.round(rr), max:8,
    detail:`R/R ${rrRatio.toFixed(1)}R · ATR $${atr.toFixed(2)} (${(atrPct*100).toFixed(1)}%)` };

  // ── 6. MARKET POSITION (6 pts) ───────────────────────────────────────────
  let mp = 0;
  // Bullish patterns score higher near 52W lows; bearish near 52W highs
  if (pattern.breakout==="bullish") {
    if      (relPos.pct<20)  mp=6;  // near 52W low — reversal setup
    else if (relPos.pct<40)  mp=4;
    else if (relPos.pct<60)  mp=3;
    else if (relPos.pct<80)  mp=2;
    else                      mp=1;  // near 52W high — extended
  } else if (pattern.breakout==="bearish") {
    if      (relPos.pct>80)  mp=6;
    else if (relPos.pct>60)  mp=4;
    else if (relPos.pct>40)  mp=3;
    else if (relPos.pct>20)  mp=2;
    else                      mp=1;
  } else mp=3;
  breakdown.marketPosition = { score:Math.round(mp), max:6,
    detail:`52W position ${relPos.pct.toFixed(0)}% · $${relPos.l52.toFixed(0)}–$${relPos.h52.toFixed(0)}` };

  // ── 7. DIVERGENCE BONUS (4 pts) ──────────────────────────────────────────
  let div = 0;
  if (divergence.bullDiv&&pattern.breakout==="bullish") div=4;
  else if (divergence.bearDiv&&pattern.breakout==="bearish") div=4;
  breakdown.divergence = { score:div, max:4,
    detail:divergence.bullDiv?"Bullish RSI divergence":divergence.bearDiv?"Bearish RSI divergence":"None" };

  // ── RAW TOTAL ─────────────────────────────────────────────────────────────
  let total = pq + ta + mo + vol + rr + mp + div;

  // ── PENALTIES ─────────────────────────────────────────────────────────────
  const penalties = [];
  if (pattern.stage==="Invalidated") {
    total-=25; penalties.push("Pattern invalidated −25");
  }
  if (pattern.breakout==="bullish"&&rsi>78) {
    total-=5; penalties.push("RSI extreme overbought −5");
  }
  if (pattern.breakout==="bearish"&&rsi<22) {
    total-=5; penalties.push("RSI extreme oversold −5");
  }
  if (volData.trend<0.6) {
    total-=4; penalties.push("Volume collapse −4");
  }
  if (atrPct>0.06) {
    total-=3; penalties.push("Excessive volatility −3");
  }
  breakdown.penalties = penalties;

  const finalScore = Math.min(100, Math.max(0, Math.round(total)));
  breakdown.total = finalScore;
  return { total:finalScore, breakdown };
}

// ══════════════════════════════════════════════════════════════════════════════
// CHART COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function MiniChart({ prices, pattern, width=120, height=46 }) {
  const sample = prices.length>30 ? prices.filter((_,i)=>i%Math.ceil(prices.length/30)===0||i===prices.length-1) : prices;
  const min=safeMin(sample.map(p=>p.low))*0.999, max=safeMax(sample.map(p=>p.high))*1.001, rng=max-min||1;
  const toY=v=>height-2-((v-min)/rng)*(height-4);
  const ns=sample.length, cw=Math.max(1.5,(width/ns)*0.6);
  const dirColor=pattern?.breakout==="bullish"?"#00ff88":pattern?.breakout==="bearish"?"#ff4466":"#ffaa00";
  return (
    <svg width={width} height={height} style={{display:"block"}}>
      {sample.map((p,i)=>{
        const x=(i/(ns-1||1))*width;
        const bull=p.close>=p.open;
        const bTop=toY(Math.max(p.open,p.close)), bBot=toY(Math.min(p.open,p.close));
        const clr=bull?"#00ff88":"#ff4466";
        return (
          <g key={i}>
            <line x1={x} y1={toY(p.high)} x2={x} y2={toY(p.low)} stroke={clr} strokeWidth="0.7" opacity="0.7"/>
            <rect x={x-cw/2} y={bTop} width={cw} height={Math.max(1,bBot-bTop)} fill={bull?clr:"none"} stroke={clr} strokeWidth="0.8"/>
          </g>
        );
      })}
    </svg>
  );
}

function PatternOverlay({ geo, pattern, toX, toY, W, H, pad, prices }) {
  if (!geo||!prices||prices.length<2) return null;
  const n=prices.length;
  const clampI=(i)=>Math.max(0,Math.min(n-1,Math.round(i)||0));
  if (geo.startI!=null) geo={...geo,startI:clampI(geo.startI)};
  if (geo.points) geo={...geo,points:geo.points.map(p=>({...p,i:clampI(p.i)}))};
  if (geo.topLine) geo={...geo,topLine:geo.topLine.map(p=>({...p,i:clampI(p.i)}))};
  if (geo.botLine) geo={...geo,botLine:geo.botLine.map(p=>({...p,i:clampI(p.i)}))};
  if (geo.flagTop) geo={...geo,flagTop:geo.flagTop.map(p=>({...p,i:clampI(p.i)}))};
  if (geo.flagBot) geo={...geo,flagBot:geo.flagBot.map(p=>({...p,i:clampI(p.i)}))};
  if (geo.poleBase) geo={...geo,poleBase:{...geo.poleBase,i:clampI(geo.poleBase.i)}};
  if (geo.poleTop)  geo={...geo,poleTop:{...geo.poleTop,i:clampI(geo.poleTop.i)}};

  const dirColor=pattern.breakout==="bullish"?"#00ff88":pattern.breakout==="bearish"?"#ff4466":"#ffaa00";
  const ch=H-pad.t-pad.b;
  const px=(p)=>toX(p.i).toFixed(1);
  const py=(p)=>toY(p.v).toFixed(1);
  const lx=(v)=>toY(v).toFixed(1);
  const trendLine=(p1,p2,color=dirColor,dash="none",w="2")=>(
    <line x1={px(p1)} y1={py(p1)} x2={px(p2)} y2={py(p2)} stroke={color} strokeWidth={w} strokeDasharray={dash} fill="none" opacity="0.9"/>
  );
  const hLine=(v,x1,x2,color,dash="5,3",w="1.5")=>(
    <line x1={x1.toFixed(1)} y1={lx(v)} x2={x2.toFixed(1)} y2={lx(v)} stroke={color} strokeWidth={w} strokeDasharray={dash} fill="none" opacity="0.85"/>
  );
  const dot=(p,label,color=dirColor,above=true)=>(
    <g key={`d${p.i}`}>
      <circle cx={px(p)} cy={py(p)} r="5" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2"/>
      <circle cx={px(p)} cy={py(p)} r="2" fill={color}/>
      {label&&<text x={px(p)} y={(parseFloat(py(p))+(above?-10:14)).toFixed(1)} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" fontWeight="bold">{label}</text>}
    </g>
  );
  const shaded=(x1,y1t,y1b,x2,y2t,y2b)=>(
    <polygon points={`${x1},${y1t} ${x2},${y2t} ${x2},${y2b} ${x1},${y1b}`} fill={dirColor} fillOpacity="0.07" stroke="none"/>
  );

  const sx=toX(geo.startI), ex=toX(n-1);
  const band=<rect x={sx.toFixed(1)} y={pad.t} width={(ex-sx).toFixed(1)} height={ch} fill={dirColor} fillOpacity="0.04" stroke={dirColor} strokeWidth="1" strokeDasharray="4,3" opacity="0.5"/>;
  const resX2=W-pad.r+18;
  const resLine=geo.resistance?hLine(geo.resistance,sx,resX2,"#ffdd00","6,3","1.5"):null;
  const resLbl=geo.resistance?(<g><rect x={(resX2+2).toFixed(1)} y={(parseFloat(lx(geo.resistance))-7).toFixed(1)} width="28" height="13" fill="#1a1a08" rx="2"/><text x={(resX2+16).toFixed(1)} y={(parseFloat(lx(geo.resistance))+3).toFixed(1)} textAnchor="middle" fill="#ffdd00" fontSize="8" fontFamily="monospace" fontWeight="bold">RES</text></g>):null;
  const supLine=geo.support?hLine(geo.support,sx,resX2,"#4499ff","6,3","1.5"):null;
  const supLbl=geo.support?(<g><rect x={(resX2+2).toFixed(1)} y={(parseFloat(lx(geo.support))-7).toFixed(1)} width="28" height="13" fill="#08081a" rx="2"/><text x={(resX2+16).toFixed(1)} y={(parseFloat(lx(geo.support))+3).toFixed(1)} textAnchor="middle" fill="#4499ff" fontSize="8" fontFamily="monospace" fontWeight="bold">SUP</text></g>):null;

  let body=null;

  if (geo.type==="triangle") {
    const tl=geo.topLine, bl=geo.botLine;
    if (tl&&bl) {
      const leftEdgeX=px(tl[0]), leftTopY=py(tl[0]);
      const rightEdgeX=px(tl[1]), rightTopY=py(tl[1]);
      // Interpolate exact y-value ON a two-point line at a given bar index
      const lineY = (line, barI) => {
        if (!line) return null;
        const [p0, p1] = line;
        if (p1.i === p0.i) return p0.v;
        return p0.v + (p1.v - p0.v) * (barI - p0.i) / (p1.i - p0.i);
      };
      // Top pivot dots — snap to top trendline
      const topPivotDots=(geo.topPivots||[]).map((p,i)=>{
        const v = lineY(tl, p.i); if (v===null) return null;
        const cx=toX(clampI(p.i)), cy=toY(v);
        return <circle key={`tp${i}`} cx={cx} cy={cy} r="4.5" fill={dirColor} fillOpacity="0.6" stroke="#0a1428" strokeWidth="1.2"/>;
      });
      // ── Bottom trendline: straight line anchored at actual first & last pivot lows ──
      const supPivots = geo.supPivots || [];
      let botLineEl, botDotsEl;
      let leftBotV, rightBotV; // price values at pattern left/right edges
      if (supPivots.length >= 2) {
        // Anchor: first pivot → last pivot defines slope; extend to pattern edges
        const sp0 = supPivots[0], spN = supPivots[supPivots.length - 1];
        const spSlope = (spN.v - sp0.v) / Math.max(spN.i - sp0.i, 1);
        const spAt = (barI) => sp0.v + spSlope * (barI - sp0.i);
        leftBotV  = spAt(tl[0].i);
        rightBotV = spAt(tl[1].i);
        const lby = toY(leftBotV), rby = toY(rightBotV);
        botLineEl = <line key="bl" x1={leftEdgeX} y1={lby} x2={rightEdgeX} y2={rby} stroke={dirColor} strokeWidth="2.5" opacity="0.9"/>;
        // Dots snap to the straight line at each pivot's bar position
        botDotsEl = supPivots.map((p,i)=>{
          const v = spAt(p.i);
          return <circle key={`bp${i}`} cx={toX(clampI(p.i))} cy={toY(v)} r="4.5" fill={dirColor} fillOpacity="0.6" stroke="#0a1428" strokeWidth="1.2"/>;
        });
      } else {
        // Fallback: use bl endpoints as-is
        leftBotV  = bl[0].v;
        rightBotV = bl[1].v;
        const lby = py(bl[0]), rby = py(bl[1]);
        botLineEl = <line key="bl" x1={leftEdgeX} y1={lby} x2={rightEdgeX} y2={rby} stroke={dirColor} strokeWidth="2.5" opacity="0.9"/>;
        botDotsEl = <>
          <circle cx={leftEdgeX}  cy={lby} r="4" fill={dirColor} fillOpacity="0.4" stroke={dirColor} strokeWidth="1.5"/>
          <circle cx={rightEdgeX} cy={rby} r="3" fill={dirColor} fillOpacity="0.7"/>
        </>;
      }
      const leftBotY  = toY(leftBotV);
      const rightBotY = toY(rightBotV);
      const polyPts = `${leftEdgeX},${leftTopY} ${rightEdgeX},${rightTopY} ${rightEdgeX},${rightBotY} ${leftEdgeX},${leftBotY}`;
      body=<>
        <polygon points={polyPts} fill={dirColor} fillOpacity="0.07" stroke="none"/>
        <line x1={leftEdgeX} y1={leftTopY} x2={rightEdgeX} y2={rightTopY} stroke={dirColor} strokeWidth="2.5" opacity="0.9"/>
        {botLineEl}
        <line x1={leftEdgeX} y1={leftTopY} x2={leftEdgeX} y2={leftBotY} stroke={dirColor} strokeWidth="1.5" strokeDasharray="4,3" opacity="0.55"/>
        {/* Pivot touch dots on top trendline */}
        {topPivotDots.length>0 ? topPivotDots : <>
          <circle cx={leftEdgeX}  cy={leftTopY}  r="4" fill={dirColor} fillOpacity="0.4" stroke={dirColor} strokeWidth="1.5"/>
          <circle cx={rightEdgeX} cy={rightTopY} r="3" fill={dirColor} fillOpacity="0.7"/>
        </>}
        {/* Pivot touch dots on bottom trendline — at actual low prices */}
        {botDotsEl}
      </>;
    }
  }
  else if (geo.type==="flag") {
    body=<>
      {geo.poleBase&&geo.poleTop&&<line x1={px(geo.poleBase)} y1={py(geo.poleBase)} x2={px(geo.poleTop)} y2={py(geo.poleTop)} stroke={dirColor} strokeWidth="3" opacity="0.9"/>}
      {geo.flagTop&&geo.flagBot&&<>
        {shaded(px(geo.flagTop[0]),py(geo.flagTop[0]),py(geo.flagBot[0]),px(geo.flagTop[1]),py(geo.flagTop[1]),py(geo.flagBot[1]))}
        {trendLine(geo.flagTop[0],geo.flagTop[1],dirColor,"none","2")}
        {trendLine(geo.flagBot[0],geo.flagBot[1],dirColor,"none","2")}
      </>}
      {geo.poleBase&&dot(geo.poleBase,"POLE",dirColor,false)}
    </>;
  }
  else if (geo.type==="doubleBottom"||geo.type==="doubleTop") {
    const pts=geo.points;
    if (pts&&pts.length>=3) {
      const isBot=geo.type==="doubleBottom";
      body=<>
        {trendLine(pts[0],pts[1],dirColor,"none","2")}
        {trendLine(pts[1],pts[2],dirColor,"none","2")}
        {dot(pts[0],pts[0].label,dirColor,!isBot)}
        {dot(pts[1],pts[1].label,"#ffaa00",isBot)}
        {dot(pts[2],pts[2].label,dirColor,!isBot)}
        {hLine(pts[1].v,toX(pts[0].i),toX(pts[2].i)+20,"#ffaa00","4,2","1.5")}
      </>;
    }
  }
  else if (geo.type==="hs"||geo.type==="ihs") {
    const pts=geo.points;
    if (pts&&pts.length>=3) {
      const nc=geo.type==="hs"?"#ff4466":"#00ff88";

      // Neckline spans from left neckline trough to right shoulder + small extension
      // Use stored neckStartI/neckEndI if available, else fall back to shoulder indices
      const nStartI = geo.neckStartI != null ? clampI(geo.neckStartI) : pts[0].i;
      const rShoulderI = pts[2].i;
      // Extend slightly past right shoulder (10 bars or to chart edge, whichever is less)
      const nEndI   = geo.neckEndI   != null ? Math.min(n-1, clampI(geo.neckEndI) + 10) : Math.min(n-1, rShoulderI + 10);

      const nY1 = geo.neckLR ? toY(geo.neckLR.slope * nStartI + geo.neckLR.intercept) : toY(geo.support ?? geo.resistance);
      const nY2 = geo.neckLR ? toY(geo.neckLR.slope * nEndI   + geo.neckLR.intercept) : toY(geo.support ?? geo.resistance);
      const nX1 = toX(nStartI);
      const nX2 = toX(nEndI);

      body=<>
        {trendLine(pts[0],pts[1],dirColor,"none","2")}
        {trendLine(pts[1],pts[2],dirColor,"none","2")}
        {dot(pts[0],pts[0].label)}
        {dot(pts[1],pts[1].label)}
        {dot(pts[2],pts[2].label)}
        <line x1={nX1.toFixed(1)} y1={nY1.toFixed(1)} x2={nX2.toFixed(1)} y2={nY2.toFixed(1)}
          stroke={nc} strokeWidth="2" strokeDasharray="5,2" fill="none" opacity="0.9"/>
        <text x={(nX1+6).toFixed(1)} y={(nY1-6).toFixed(1)}
          fill={nc} fontSize="8" fontFamily="monospace" fontWeight="bold">NECKLINE</text>
      </>;
    }
  }
  else if (geo.type==="cup") {
    const pts=geo.points;
    if (pts&&pts.length>=3) body=<>
      {trendLine(pts[0],pts[1],dirColor,"none","2")}
      {trendLine(pts[1],pts[2],dirColor,"none","2")}
      {dot(pts[0],pts[0].label)}
      {dot(pts[1],pts[1].label,dirColor,false)}
      {dot(pts[2],pts[2].label)}
    </>;
  }
  else if (geo.type==="rect") {
    const tl=geo.topLine, bl=geo.botLine;
    if (tl&&bl) body=<>
      {shaded(px(tl[0]),py(tl[0]),py(bl[0]),px(tl[1]),py(tl[1]),py(bl[1]))}
      <line x1={px(tl[0])} y1={py(tl[0])} x2={px(tl[1])} y2={py(tl[1])} stroke={dirColor} strokeWidth="2" strokeDasharray="6,2" opacity="0.9"/>
      <line x1={px(bl[0])} y1={py(bl[0])} x2={px(bl[1])} y2={py(bl[1])} stroke={dirColor} strokeWidth="2" strokeDasharray="6,2" opacity="0.9"/>
    </>;
  }

  return <g>{band}{body}{resLine}{resLbl}{supLine}{supLbl}</g>;
}

function BigChart({ prices, symbol, quote, pattern, targetPrice, targetBreakout }) {
  const W=540,H=260, pad={t:18,r:54,b:34,l:64};
  const cw=W-pad.l-pad.r, ch=H-pad.t-pad.b;
  const min=safeMin(prices.map(p=>p.low))*0.991;
  const max=safeMax(prices.map(p=>p.high))*1.009;
  const range=max-min||1;
  const toX=i=>pad.l+(i/(prices.length-1||1))*cw;
  const toY=v=>pad.t+ch-((v-min)/range)*ch;
  const candleW=Math.max(2,cw/prices.length*0.7);
  const sma20=prices.map((_,i)=>i<19?null:prices.slice(i-19,i+1).reduce((a,b)=>a+b.close,0)/20);
  const sma50=prices.map((_,i)=>i<49?null:prices.slice(i-49,i+1).reduce((a,b)=>a+b.close,0)/50);
  const maxVol=safeMax(prices.map(p=>p.volume))||1;
  const every=Math.max(1,Math.floor(prices.length/6));
  const labels=prices.map((p,i)=>({i,d:new Date(p.ts).toLocaleDateString("en-US",{month:"short",day:"numeric"})})).filter((_,i)=>i%every===0||i===prices.length-1);
  const dirColor=pattern?.breakout==="bullish"?"#00ff88":pattern?.breakout==="bearish"?"#ff4466":"#ffaa00";
  const geoStart=pattern?.geo?.startI;
  const startDate=geoStart!=null&&prices[geoStart]?new Date(prices[geoStart].ts).toLocaleDateString("en-US",{month:"short",day:"numeric"}):null;
  const endDate=new Date(prices[prices.length-1].ts).toLocaleDateString("en-US",{month:"short",day:"numeric"});

  return (
    <div>
      {startDate&&(
        <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"6px",fontSize:"10px",fontFamily:"monospace",flexWrap:"wrap"}}>
          <span style={{color:"#3a5a7a"}}>PATTERN:</span>
          <span style={{color:dirColor,background:dirColor+"15",padding:"2px 8px",letterSpacing:"1px"}}>{startDate} → {endDate}</span>
          <span style={{color:dirColor,fontWeight:"bold"}}>{pattern?.name?.toUpperCase()}</span>
          <span style={{color:"#3a5a7a",marginLeft:"auto",fontSize:"9px"}}>Murphy {pattern?.murphyRef}</span>
        </div>
      )}
      <svg width={W} height={H} style={{width:"100%",height:"auto"}}>
        {/* Grid */}
        {[0,0.25,0.5,0.75,1].map(t=>(
          <g key={t}>
            <line x1={pad.l} y1={pad.t+ch*t} x2={W-pad.r} y2={pad.t+ch*t} stroke="#182840" strokeWidth="1"/>
            <text x={pad.l-5} y={pad.t+ch*t+4} textAnchor="end" fill="#3a5575" fontSize="9" fontFamily="monospace">{(max-range*t).toFixed(2)}</text>
          </g>
        ))}
        {/* Date labels */}
        {labels.map(({i,d})=><text key={i} x={toX(i)} y={H-2} textAnchor="middle" fill="#3a5575" fontSize="8" fontFamily="monospace">{d}</text>)}
        {/* Pattern overlay — behind candles */}
        {pattern?.geo&&<PatternOverlay geo={pattern.geo} pattern={pattern} toX={toX} toY={toY} W={W} H={H} pad={pad} prices={prices}/>}
        {/* Volume bars */}
        {prices.map((p,i)=>(
          <rect key={`v${i}`} x={toX(i)-candleW/2} y={pad.t+ch+2+(1-p.volume/maxVol)*18} width={candleW} height={p.volume/maxVol*18} fill={p.close>=p.open?"#00ff8828":"#ff446628"}/>
        ))}
        {/* Candlesticks */}
        {prices.map((p,i)=>{
          const bull=p.close>=p.open, clr=bull?"#00cc66":"#ff4466";
          const bTop=toY(Math.max(p.open,p.close)), bBot=toY(Math.min(p.open,p.close));
          return (
            <g key={i}>
              <line x1={toX(i)} y1={toY(p.high)} x2={toX(i)} y2={toY(p.low)} stroke={clr} strokeWidth="1"/>
              <rect x={toX(i)-candleW/2} y={bTop} width={candleW} height={Math.max(1,bBot-bTop)} fill={bull?clr:"none"} stroke={clr} strokeWidth="0.8"/>
            </g>
          );
        })}
        {/* SMA20 */}
        {sma20.some(v=>v!==null)&&<polyline points={sma20.map((v,i)=>v!==null?`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`:null).filter(Boolean).join(" ")} fill="none" stroke="#ffaa00" strokeWidth="1" strokeDasharray="4,2"/>}
        {/* SMA50 */}
        {sma50.some(v=>v!==null)&&<polyline points={sma50.map((v,i)=>v!==null?`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`:null).filter(Boolean).join(" ")} fill="none" stroke="#aa66ff" strokeWidth="1" strokeDasharray="4,2"/>}
        {/* Target price line — Bulkowski measured-move */}
        {targetPrice && targetPrice > 0 && targetPrice !== quote?.price && (() => {
          const targetY = toY(targetPrice);
          const tColor = pattern?.breakout==="bullish"?"#00ff88":"#ff4466";
          const inRange = targetPrice >= min && targetPrice <= max;
          if (!inRange) return null;
          return (
            <g>
              <line x1={pad.l} y1={targetY} x2={W-pad.r} y2={targetY} stroke={tColor} strokeWidth="1.2" strokeDasharray="6,3" opacity="0.8"/>
              <rect x={W-pad.r+2} y={targetY-8} width={52} height={15} fill={tColor+"22"} rx="2"/>
              <text x={W-pad.r+28} y={targetY+4} textAnchor="middle" fill={tColor} fontSize="9" fontFamily="monospace" fontWeight="bold">T ${targetPrice.toFixed(2)}</text>
            </g>
          );
        })()}
        {/* Breakout level line */}
        {targetBreakout && targetBreakout > 0 && (() => {
          const bY = toY(targetBreakout);
          const bColor = "#ffdd00";
          const inRange = targetBreakout >= min && targetBreakout <= max;
          if (!inRange) return null;
          return (
            <g>
              <line x1={pad.l} y1={bY} x2={W-pad.r} y2={bY} stroke={bColor} strokeWidth="1" strokeDasharray="3,4" opacity="0.6"/>
              <text x={pad.l+4} y={bY-3} fill={bColor} fontSize="8" fontFamily="monospace" opacity="0.8">BKT</text>
            </g>
          );
        })()}
        {/* 3% Murphy confirmation filter (Murphy Ch.4) — close beyond this = real breakout */}
        {targetBreakout && targetBreakout > 0 && pattern?.breakout !== "neutral" && (() => {
          const confirmLevel = pattern?.breakout === "bearish" ? targetBreakout * 0.97 : targetBreakout * 1.03;
          const inRange = confirmLevel >= min && confirmLevel <= max;
          if (!inRange) return null;
          const cY = toY(confirmLevel);
          return (
            <g>
              <line x1={pad.l} y1={cY} x2={W-pad.r} y2={cY} stroke="#ff8800" strokeWidth="0.9" strokeDasharray="2,5" opacity="0.55"/>
              <text x={pad.l+5} y={cY-3} fill="#ff8800" fontSize="7" fontFamily="monospace" opacity="0.8">3% CONFIRM</text>
            </g>
          );
        })()}
        {/* Live price line */}
        {quote&&<line x1={pad.l} y1={toY(quote.price)} x2={W-pad.r} y2={toY(quote.price)} stroke="#00d4ff" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.7"/>}
        {/* Price tag */}
        {quote&&(<g>
          <rect x={W-pad.r+2} y={toY(quote.price)-8} width={50} height={15} fill="#00d4ff22" rx="2"/>
          <text x={W-pad.r+27} y={toY(quote.price)+4} textAnchor="middle" fill="#00d4ff" fontSize="10" fontFamily="monospace" fontWeight="bold">${quote.price?.toFixed(2)}</text>
        </g>)}
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ══════════════════════════════════════════════════════════════════════════════
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state={hasError:false,error:null}; }
  static getDerivedStateFromError(e) { return {hasError:true,error:e}; }
  componentDidCatch(e,i) { console.error("Chart error:",e,i); }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:"10px",color:"#ff4466",fontSize:"10px",fontFamily:"monospace",background:"#1a0808",border:"1px solid #4a1a1a",borderRadius:"3px"}}>
        ⚠ {this.state.error?.message}
        <button onClick={()=>this.setState({hasError:false,error:null})} style={{marginLeft:"8px",background:"none",border:"1px solid #ff4466",color:"#ff4466",cursor:"pointer",padding:"1px 6px",fontSize:"9px",fontFamily:"monospace"}}>RETRY</button>
      </div>
    );
    return this.props.children;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTOR ROTATION ANALYSIS — Relative Rotation Graph (RRG)
// Quadrants: Leading / Weakening / Lagging / Improving
// Inspired by Julius de Kempenaer's RRG methodology
// ══════════════════════════════════════════════════════════════════════════════

const SECTOR_ETF = {
  "Technology":    { etf:"XLK", color:"#00aaff", syms:["AAPL","MSFT","NVDA","AVGO","AMD","INTC","CRM","ORCL","NOW","CSCO","ACN","IBM"] },
  "Communication": { etf:"XLC", color:"#cc88ff", syms:["GOOGL","META","NFLX","AMZN","TSLA"] },
  "Financials":    { etf:"XLF", color:"#ffaa00", syms:["JPM","GS","BAC","V","MA","BRK-B"] },
  "Healthcare":    { etf:"XLV", color:"#00ff88", syms:["UNH","LLY","JNJ","MRK","ABBV","TMO","ABT"] },
  "Cons Discret":  { etf:"XLY", color:"#ff66aa", syms:["TSLA","HD","MCD","NFLX","COST"] },
  "Cons Staples":  { etf:"XLP", color:"#ff9944", syms:["WMT","KO","PEP","PG","COST","MCD"] },
  "Energy":        { etf:"XLE", color:"#ffdd00", syms:["XOM","CVX"] },
  "Industrials":   { etf:"XLI", color:"#aa66ff", syms:["CAT","GE","HON"] },
  "Materials":     { etf:"XLB", color:"#44ddaa", syms:["HON","CAT"] },
};

const QUADRANT_INFO = {
  leading:   { label:"LEADING",   desc:"Strong & accelerating",      color:"#00ff88", bg:"#041a08" },
  weakening: { label:"WEAKENING", desc:"Strong but decelerating",    color:"#ffaa00", bg:"#1a1000" },
  lagging:   { label:"LAGGING",   desc:"Weak & losing momentum",     color:"#ff4466", bg:"#1a0408" },
  improving: { label:"IMPROVING", desc:"Weak but gaining momentum",  color:"#00aaff", bg:"#041018" },
};

function computeSectorStats(sectorName, syms, stockMap, etfData) {
  const loaded=syms.map(s=>stockMap[s]).filter(Boolean);
  const bullish   =loaded.filter(s=>s.pattern.breakout==="bullish").length;
  const bearish   =loaded.filter(s=>s.pattern.breakout==="bearish").length;
  const confirmed =loaded.filter(s=>s.pattern.stage==="Confirmed").length;
  const invalidated=loaded.filter(s=>s.pattern.stage==="Invalidated").length;
  const avgRsi    =loaded.length?loaded.reduce((a,s)=>a+s.rsi,0)/loaded.length:50;
  const avgScore  =loaded.length?loaded.reduce((a,s)=>a+s.score,0)/loaded.length:50;
  const avgVolTrend=loaded.length?loaded.reduce((a,s)=>a+(s.volData?.trend||1),0)/loaded.length:1;
  const avgChg    =etfData?.chg  ??(loaded.length?loaded.reduce((a,s)=>a+s.chg,0)/loaded.length:0);
  const sparkData =etfData?.spark??(()=>{
    const allP=loaded.map(s=>s.prices).filter(p=>p?.length>=20);
    if (!allP.length) return [];
    const len=Math.min(20,safeMin(allP.map(p=>p.length)));
    const norm=allP.map(prices=>{
      const base=prices[prices.length-len].close||1;
      return prices.slice(-len).map(p=>(p.close/base-1)*100);
    });
    return Array.from({length:len},(_,i)=>norm.reduce((a,p)=>a+(p[i]||0),0)/norm.length);
  })();
  const rsRatio   =95+avgChg*2.5+(avgScore-50)*0.15;
  const rsMomentum=100+(etfData?.mom5d??0)*1.8+(avgRsi-50)*0.3;
  const quadrant  =rsRatio>=100&&rsMomentum>=100?"leading"
                  :rsRatio>=100&&rsMomentum<100?"weakening"
                  :rsRatio<100&&rsMomentum<100?"lagging":"improving";
  return { name:sectorName, loaded:loaded.length, total:syms.length,
    avgChg, avgRsi, avgScore, avgVolTrend, bullish, bearish, confirmed, invalidated,
    rsRatio, rsMomentum, quadrant, sparkData, stocks:loaded,
    etfPrice:etfData?.price, etfChg:etfData?.chg,
    topStock:[...loaded].sort((a,b)=>b.chg-a.chg)[0],
    worstStock:[...loaded].sort((a,b)=>a.chg-b.chg)[0] };
}

function SectorSparkline({ data, color, w=110, h=34 }) {
  if (!data||data.length<2) return <svg width={w} height={h}><text x={w/2} y={h/2} textAnchor="middle" fill="#1a3050" fontSize="8" fontFamily="monospace">—</text></svg>;
  const min=safeMin(data), max=safeMax(data), range=max-min||0.01;
  const toX=i=>(i/(data.length-1))*w;
  const toY=v=>h-2-((v-min)/range)*(h-4);
  const pts=data.map((v,i)=>`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const gid=`spk${color.replace(/[^a-z0-9]/gi,"")}`;
  return (
    <svg width={w} height={h} style={{display:"block",overflow:"visible"}}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      {min<0&&max>0&&<line x1="0" y1={toY(0).toFixed(1)} x2={w} y2={toY(0).toFixed(1)} stroke="#2a4060" strokeWidth="0.7" strokeDasharray="3,2"/>}
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${gid})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={toX(data.length-1).toFixed(1)} cy={toY(data[data.length-1]).toFixed(1)} r="2.5" fill={color}/>
    </svg>
  );
}

function RRGChart({ sectors, onHover, hovSector, mono }) {
  const W=400, H=360, pad=48, cw=W-pad*2, ch=H-pad*2;
  if (!sectors.length) return null;
  const allX=sectors.map(s=>s.rsRatio), allY=sectors.map(s=>s.rsMomentum);
  const xSpan=Math.max(8,safeMax(allX)-safeMin(allX)+6);
  const ySpan=Math.max(8,safeMax(allY)-safeMin(allY)+6);
  const xMin=100-xSpan/2-1, xMax=100+xSpan/2+1;
  const yMin=100-ySpan/2-1, yMax=100+ySpan/2+1;
  const toX=v=>pad+((v-xMin)/(xMax-xMin))*cw;
  const toY=v=>pad+ch-((v-yMin)/(yMax-yMin))*ch;
  const cx=toX(100), cy=toY(100);
  return (
    <svg width={W} height={H} style={{display:"block",fontFamily:mono,userSelect:"none"}}>
      <rect x={cx}  y={pad} width={W-pad-cx}  height={cy-pad}   fill="#041a08" opacity="0.85"/>
      <rect x={cx}  y={cy}  width={W-pad-cx}  height={H-pad-cy} fill="#1a1200" opacity="0.85"/>
      <rect x={pad} y={cy}  width={cx-pad}    height={H-pad-cy} fill="#1a0408" opacity="0.85"/>
      <rect x={pad} y={pad} width={cx-pad}    height={cy-pad}   fill="#041018" opacity="0.85"/>
      {[[W-pad-5,pad+13,"LEADING","#00ff88","end"],[W-pad-5,H-pad-7,"WEAKENING","#ffaa00","end"],
        [pad+5,H-pad-7,"LAGGING","#ff4466","start"],[pad+5,pad+13,"IMPROVING","#00aaff","start"]
      ].map(([x,y,l,c,a])=><text key={l} x={x} y={y} textAnchor={a} fill={c} fontSize="9" fontFamily="monospace" fontWeight="bold" opacity="0.8">{l}</text>)}
      {[0.25,0.5,0.75].map(t=>(
        <g key={t}>
          <line x1={pad} y1={pad+ch*t} x2={W-pad} y2={pad+ch*t} stroke="#1a3050" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.6"/>
          <line x1={pad+cw*t} y1={pad} x2={pad+cw*t} y2={H-pad} stroke="#1a3050" strokeWidth="0.5" strokeDasharray="3,4" opacity="0.6"/>
        </g>
      ))}
      <line x1={cx} y1={pad} x2={cx} y2={H-pad} stroke="#2a4a6a" strokeWidth="1.2"/>
      <line x1={pad} y1={cy} x2={W-pad} y2={cy} stroke="#2a4a6a" strokeWidth="1.2"/>
      <text x={W/2} y={H-5} textAnchor="middle" fill="#2a4a6a" fontSize="8" fontFamily="monospace">RS-RATIO → (Relative Strength)</text>
      <text x={10} y={H/2} textAnchor="middle" fill="#2a4a6a" fontSize="8" fontFamily="monospace" transform={`rotate(-90,10,${H/2})`}>RS-MOMENTUM ↑</text>
      <path d={`M ${(cx+55).toFixed(0)} ${cy} A 55 55 0 0 1 ${cx} ${(cy-55).toFixed(0)}`} fill="none" stroke="#1a4060" strokeWidth="1" strokeDasharray="5,4" opacity="0.5"/>
      {sectors.map(sec=>{
        const x=toX(sec.rsRatio), y=toY(sec.rsMomentum);
        const q=QUADRANT_INFO[sec.quadrant], isHov=hovSector===sec.name;
        return (
          <g key={sec.name} onMouseEnter={()=>onHover(sec.name)} onMouseLeave={()=>onHover(null)} style={{cursor:"pointer"}}>
            {isHov&&<circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="22" fill={q.color} opacity="0.12"/>}
            <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r={isHov?17:13} fill={q.bg} stroke={q.color} strokeWidth={isHov?2.5:1.8}/>
            <text x={x.toFixed(1)} y={(y-3).toFixed(1)} textAnchor="middle" fill={q.color} fontSize={isHov?"9":"8"} fontFamily="monospace" fontWeight="bold">{sec.name.slice(0,4).toUpperCase()}</text>
            <text x={x.toFixed(1)} y={(y+7).toFixed(1)} textAnchor="middle" fill={q.color} fontSize="7" fontFamily="monospace">{sec.avgChg>=0?"+":""}{sec.avgChg.toFixed(1)}%</text>
          </g>
        );
      })}
    </svg>
  );
}

function SectorRotationTab({ stocks, isScanning, setTab, setSelected, mono }) {
  const [hovSector,  setHovSector] =useState(null);
  const [selSector,  setSelSector] =useState(null);
  const [rankBy,     setRankBy]    =useState("momentum");
  const [etfMap,     setEtfMap]    =useState({});
  const [etfLoading, setEtfLoading]=useState(false);

  const fetchAllEtfs = useCallback(async()=>{
    const etfSyms=[...new Set(Object.values(SECTOR_ETF).map(d=>d.etf))];
    setEtfLoading(true);
    const results={};
    await Promise.all(etfSyms.map(async sym=>{
      try {
        const [prices,quote]=await Promise.all([fetchHistory(sym),fetchQuote(sym)]);
        const chg=quote.prevClose>0?((quote.price-quote.prevClose)/quote.prevClose)*100:0;
        const mom5d=prices.length>=6?((prices[prices.length-1].close-prices[prices.length-6].close)/prices[prices.length-6].close)*100:chg;
        const len=Math.min(20,prices.length), base=prices[prices.length-len].close||1;
        const spark=prices.slice(-len).map(p=>(p.close/base-1)*100);
        results[sym]={price:quote.price,prevClose:quote.prevClose,chg,mom5d,spark,name:quote.name};
      } catch(e){ /* skip */ }
    }));
    setEtfMap(results);
    setEtfLoading(false);
  },[]);

  useEffect(()=>{ fetchAllEtfs(); },[]);

  const stockMap=Object.fromEntries(stocks.map(s=>[s.sym,s]));
  const sectorStats=Object.entries(SECTOR_ETF)
    .map(([name,def])=>computeSectorStats(name,def.syms,stockMap,etfMap[def.etf]||null))
    .filter(s=>s!==null)
    .sort((a,b)=>
      rankBy==="momentum"?b.avgChg-a.avgChg:
      rankBy==="rsi"?b.avgRsi-a.avgRsi:
      rankBy==="score"?b.avgScore-a.avgScore:
      b.avgVolTrend-a.avgVolTrend);

  const selStats  =selSector?sectorStats.find(s=>s.name===selSector):null;
  const totalBull =sectorStats.reduce((a,s)=>a+s.bullish,0);
  const totalBear =sectorStats.reduce((a,s)=>a+s.bearish,0);
  const totalConf =sectorStats.reduce((a,s)=>a+s.confirmed,0);
  const overallAvg=sectorStats.length?sectorStats.reduce((a,s)=>a+s.avgChg,0)/sectorStats.length:0;
  const etfLoaded =Object.keys(etfMap).length;

  return (
    <div style={{background:"#060e1c",minHeight:"calc(100vh - 96px)",fontFamily:mono,display:"flex",flexDirection:"column"}}>
      {/* HEADER */}
      <div style={{background:"#07101e",borderBottom:"1px solid #0d1f35",padding:"10px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"10px"}}>
        <div>
          <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"3px",display:"flex",alignItems:"center",gap:"10px"}}>
            SECTOR ROTATION — RELATIVE ROTATION GRAPH (RRG)
            {etfLoading&&<span style={{color:"#ffaa00"}}>⟳ Fetching ETF prices...</span>}
            {!etfLoading&&etfLoaded>0&&<span style={{color:"#00ff88"}}>● Live ETF prices ({etfLoaded} loaded)</span>}
            {!etfLoading&&etfLoaded===0&&<span style={{color:"#ff4466"}}>⚠ ETF data unavailable — using stock avg</span>}
          </div>
          <div style={{display:"flex",gap:"16px",fontSize:"10px"}}>
            <span style={{color:"#00ff88"}}>▲ {totalBull} bullish</span>
            <span style={{color:"#ff4466"}}>▼ {totalBear} bearish</span>
            <span style={{color:"#00d4ff"}}>{totalConf} confirmed</span>
            <span style={{color:overallAvg>=0?"#00ff88":"#ff4466",fontWeight:"bold"}}>ETF avg {overallAvg>=0?"+":""}{overallAvg.toFixed(2)}%</span>
          </div>
        </div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <span style={{fontSize:"9px",color:"#2a4a6a",letterSpacing:"1px",marginRight:"4px"}}>RANK BY</span>
          {[["momentum","% CHG"],["rsi","RSI"],["score","SCORE"],["volume","VOLUME"]].map(([m,l])=>(
            <button key={m} onClick={()=>setRankBy(m)} style={{background:rankBy===m?"#0d2a40":"transparent",border:`1px solid ${rankBy===m?"#00d4ff":"#1a3050"}`,color:rankBy===m?"#00d4ff":"#3a5a7a",padding:"4px 10px",cursor:"pointer",fontSize:"9px",fontFamily:mono,letterSpacing:"1px"}}>{l}</button>
          ))}
          <button onClick={fetchAllEtfs} disabled={etfLoading} style={{background:"transparent",border:"1px solid #1a3050",color:etfLoading?"#2a4060":"#3a5a7a",padding:"4px 10px",cursor:etfLoading?"default":"pointer",fontSize:"9px",fontFamily:mono,letterSpacing:"1px"}}>⟳ REFRESH ETFs</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* LEFT — RRG + quadrant counts */}
        <div style={{width:"450px",minWidth:"450px",borderRight:"1px solid #0d1f35",padding:"14px",display:"flex",flexDirection:"column",gap:"12px",overflowY:"auto"}}>
          <div style={{background:"#07101e",border:"1px solid #1a3050",padding:"10px"}}>
            <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"6px"}}>RELATIVE ROTATION GRAPH</div>
            {stocks.length===0
              ?<div style={{height:"360px",display:"flex",alignItems:"center",justifyContent:"center",color:"#2a4060",fontSize:"10px"}}>{isScanning?"Loading...":"Run scan to populate"}</div>
              :<RRGChart sectors={sectorStats} onHover={setHovSector} hovSector={hovSector} mono={mono}/>}
            <div style={{display:"flex",gap:"10px",marginTop:"6px",flexWrap:"wrap"}}>
              {Object.entries(QUADRANT_INFO).map(([k,q])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:"4px"}}>
                  <div style={{width:"8px",height:"8px",borderRadius:"50%",background:q.color}}/>
                  <span style={{fontSize:"8px",color:q.color}}>{q.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px"}}>
            {Object.entries(QUADRANT_INFO).map(([k,q])=>{
              const inQ=sectorStats.filter(s=>s.quadrant===k);
              return (
                <div key={k} style={{background:q.bg,border:`1px solid ${q.color}44`,padding:"10px"}}>
                  <div style={{color:q.color,fontSize:"9px",fontWeight:"bold",letterSpacing:"1px",marginBottom:"4px"}}>{q.label}</div>
                  <div style={{color:q.color,fontSize:"20px",fontWeight:"bold",lineHeight:1}}>{inQ.length}</div>
                  <div style={{fontSize:"8px",color:q.color,opacity:0.8,marginTop:"3px"}}>{inQ.map(s=>s.name.slice(0,4)).join(" · ")||"—"}</div>
                  <div style={{fontSize:"7px",color:"#2a4a6a",marginTop:"4px"}}>{q.desc}</div>
                </div>
              );
            })}
          </div>
          <div style={{background:"#07101e",border:"1px solid #0d1f35",padding:"10px",fontSize:"8px",color:"#3a5a7a",lineHeight:"1.8"}}>
            <div style={{color:"#2a4a6a",letterSpacing:"2px",marginBottom:"5px"}}>ROTATION CYCLE</div>
            <div><span style={{color:"#00aaff"}}>IMPROVING →</span> gaining momentum vs benchmark</div>
            <div><span style={{color:"#00ff88"}}>LEADING →</span> outperforming on both axes</div>
            <div><span style={{color:"#ffaa00"}}>WEAKENING →</span> still strong but losing speed</div>
            <div><span style={{color:"#ff4466"}}>LAGGING →</span> underperforming, momentum falling</div>
            <div style={{marginTop:"4px",color:"#1a3050"}}>Typical clockwise rotation through quadrants</div>
          </div>
        </div>

        {/* RIGHT — sector rank + drill-down */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{flex:"0 0 auto",padding:"12px 16px",borderBottom:"1px solid #0d1f35",overflowY:"auto",maxHeight:"55vh"}}>
            <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"8px"}}>
              SECTOR PERFORMANCE {etfLoaded>0?"— LIVE ETF PRICES":"— FETCHING ETF DATA..."}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"5px"}}>
              {sectorStats.map((sec,rank)=>{
                const q=QUADRANT_INFO[sec.quadrant], isSel=selSector===sec.name;
                const dc=sec.avgChg>=0?"#00ff88":"#ff4466";
                const etfDef=SECTOR_ETF[sec.name];
                const etfLive=etfMap[etfDef?.etf];
                return (
                  <div key={sec.name} onClick={()=>setSelSector(isSel?null:sec.name)}
                    style={{background:isSel?"#0d1f3c":"#07101e",border:`1px solid ${isSel?"#00d4ff":q.color+"44"}`,borderLeft:`3px solid ${q.color}`,padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:"10px"}}>
                    <div style={{color:"#2a4a6a",fontSize:"12px",width:"18px",textAlign:"center"}}>#{rank+1}</div>
                    {/* Sector + ETF info */}
                    <div style={{width:"130px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:"2px"}}>
                        <span style={{color:"#e0f0ff",fontSize:"11px",fontWeight:"bold"}}>{sec.name}</span>
                        <span style={{fontSize:"8px",color:"#00d4ff",background:"#041828",padding:"1px 5px",borderRadius:"2px",letterSpacing:"1px"}}>{etfDef?.etf}</span>
                      </div>
                      {etfLive
                        ?<div style={{fontSize:"9px"}}>
                            <span style={{color:"#e0f0ff",fontWeight:"bold"}}>${etfLive.price?.toFixed(2)}</span>
                            <span style={{color:dc,marginLeft:"5px"}}>{etfLive.chg>=0?"+":""}{etfLive.chg?.toFixed(2)}%</span>
                          </div>
                        :<div style={{fontSize:"8px",color:"#2a4060"}}>{etfLoading?"loading...":sec.loaded+"/"+sec.total+" stocks"}</div>
                      }
                    </div>
                    {/* ETF sparkline */}
                    <div style={{width:"110px"}}><SectorSparkline data={sec.sparkData} color={q.color} w={110} h={32}/></div>
                    {/* % change bar */}
                    <div style={{flex:1,minWidth:"60px"}}>
                      <div style={{position:"relative",height:"4px",background:"#0d1f35",borderRadius:"2px",marginBottom:"3px"}}>
                        <div style={{position:"absolute",left:sec.avgChg>=0?"50%":"auto",right:sec.avgChg<0?"50%":"auto",width:`${Math.min(50,Math.abs(sec.avgChg)*7)}%`,height:"4px",background:dc,borderRadius:"2px"}}/>
                        <div style={{position:"absolute",left:"50%",top:"-1px",width:"1px",height:"6px",background:"#2a4a6a"}}/>
                      </div>
                      <span style={{color:dc,fontSize:"12px",fontWeight:"bold"}}>{sec.avgChg>=0?"+":""}{sec.avgChg.toFixed(2)}%</span>
                    </div>
                    {/* Stock stats */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,44px)",gap:"4px",fontSize:"10px"}}>
                      {[{l:"RSI",v:Math.round(sec.avgRsi),c:sec.avgRsi>70?"#ff4466":sec.avgRsi<40?"#00ff88":"#c8d8f0"},
                        {l:"SCORE",v:Math.round(sec.avgScore),c:sec.avgScore>=65?"#00ff88":sec.avgScore>=50?"#ffaa00":"#ff4466"},
                        {l:"BULL",v:`${sec.bullish}/${sec.loaded}`,c:"#00ff88"},
                        {l:"CONF",v:sec.confirmed,c:"#00d4ff"}].map(x=>(
                        <div key={x.l} style={{textAlign:"center",background:"#060e1c",padding:"3px"}}>
                          <div style={{fontSize:"7px",color:"#2a4a6a",letterSpacing:"1px"}}>{x.l}</div>
                          <div style={{color:x.c,fontWeight:"bold",fontSize:"10px"}}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{background:q.bg,border:`1px solid ${q.color}55`,color:q.color,padding:"3px 8px",fontSize:"8px",letterSpacing:"1px",minWidth:"74px",textAlign:"center"}}>{q.label}</div>
                    <div style={{minWidth:"90px",fontSize:"9px"}}>
                      {sec.topStock&&<div style={{color:"#00ff88"}}>▲ {sec.topStock.sym} +{sec.topStock.chg.toFixed(1)}%</div>}
                      {sec.worstStock&&<div style={{color:"#ff4466"}}>▼ {sec.worstStock.sym} {sec.worstStock.chg.toFixed(1)}%</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drill-down */}
          <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
            {selStats?(
              <>
                <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"10px",display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
                  <span>{selStats.name.toUpperCase()} — {selStats.loaded} STOCKS</span>
                  {selStats.etfPrice&&(
                    <span style={{color:"#00d4ff"}}>
                      {SECTOR_ETF[selStats.name]?.etf} ${selStats.etfPrice?.toFixed(2)}
                      <span style={{color:selStats.avgChg>=0?"#00ff88":"#ff4466",marginLeft:"5px"}}>{selStats.avgChg>=0?"+":""}{selStats.avgChg?.toFixed(2)}%</span>
                    </span>
                  )}
                  <div style={{height:"1px",flex:1,background:"#0d1f35",minWidth:"20px"}}/>
                  <span style={{color:QUADRANT_INFO[selStats.quadrant].color}}>{QUADRANT_INFO[selStats.quadrant].label}</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(255px,1fr))",gap:"5px"}}>
                  {selStats.stocks.sort((a,b)=>rankBy==="rsi"?b.rsi-a.rsi:rankBy==="score"?b.score-a.score:b.chg-a.chg).map(s=>{
                    const dc=s.pattern.breakout==="bullish"?"#00ff88":s.pattern.breakout==="bearish"?"#ff4466":"#ffaa00";
                    return (
                      <div key={s.sym} onClick={()=>{setSelected(s.sym);setTab("scanner");}}
                        style={{background:"#07101e",border:`1px solid ${dc}22`,borderLeft:`2px solid ${dc}`,padding:"7px 10px",cursor:"pointer",display:"flex",gap:"10px",alignItems:"center"}}>
                        <div style={{minWidth:"42px"}}>
                          <div style={{color:"#e0f0ff",fontWeight:"bold",fontSize:"12px"}}>{s.sym}</div>
                          <div style={{fontSize:"8px",color:s.chg>=0?"#00ff88":"#ff4466"}}>{s.chg>=0?"+":""}{s.chg.toFixed(2)}%</div>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{color:dc,fontSize:"9px"}}>{s.pattern.name}</div>
                          <div style={{fontSize:"8px",color:"#3a5a7a"}}>{s.pattern.stage}</div>
                        </div>
                        <div style={{textAlign:"right",fontSize:"9px"}}>
                          <div style={{color:s.rsi>70?"#ff4466":s.rsi<30?"#00ff88":"#c8d8f0"}}>RSI {s.rsi}</div>
                          <div style={{color:s.score>=65?"#00ff88":s.score>=50?"#ffaa00":"#ff4466"}}>Scr {s.score}</div>
                        </div>
                        <div style={{textAlign:"right",minWidth:"34px",fontSize:"9px"}}>
                          <div style={{color:s.rr>=2?"#00ff88":s.rr>=1.5?"#ffaa00":"#ff4466"}}>{s.rr>0?`${s.rr.toFixed(1)}R`:"—"}</div>
                          <div style={{color:"#3a5a7a",fontSize:"8px"}}>${s.quote?.price?.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ):(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"#2a4060",gap:"8px",padding:"30px"}}>
                <div style={{fontSize:"20px"}}>↑</div>
                <div style={{fontSize:"10px",letterSpacing:"1px"}}>Click any sector row to see individual stock breakdown</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// INTERMARKET ANALYSIS TAB — Murphy Ch.17
// Tracks the 4-market chain: Dollar → Commodities → Bonds → Stocks
// Plus sector rotation clock based on business cycle stage
// ══════════════════════════════════════════════════════════════════════════════

// Key intermarket ETFs/instruments
const INTERMARKET_ASSETS = {
  // Dollar
  dollar:     { sym:"UUP",   label:"US Dollar",      group:"dollar",    color:"#00d4ff", desc:"Dollar Index ETF" },
  // Commodities
  gold:       { sym:"GLD",   label:"Gold",           group:"commodity", color:"#ffdd00", desc:"Gold ETF" },
  oil:        { sym:"USO",   label:"Crude Oil",      group:"commodity", color:"#ff9944", desc:"Oil ETF" },
  commodity:  { sym:"DJP",   label:"Commodities",    group:"commodity", color:"#ffaa44", desc:"Bloomberg Commodity ETF" },
  // Bonds
  bonds20:    { sym:"TLT",   label:"20yr Treasuries",group:"bonds",     color:"#aa88ff", desc:"Long-term Bond ETF" },
  bonds7:     { sym:"IEF",   label:"7-10yr Bonds",   group:"bonds",     color:"#cc99ff", desc:"Mid-term Bond ETF" },
  tips:       { sym:"TIP",   label:"TIPS",           group:"bonds",     color:"#9966ff", desc:"Inflation-Protected Bonds" },
  // Stocks
  spy:        { sym:"SPY",   label:"S&P 500",        group:"stocks",    color:"#00ff88", desc:"S&P 500 ETF" },
  qqq:        { sym:"QQQ",   label:"NASDAQ 100",     group:"stocks",    color:"#44ffaa", desc:"Tech-heavy index" },
  // Sector rotation
  xlk:        { sym:"XLK",   label:"Technology",     group:"sector",    color:"#00aaff" },
  xlf:        { sym:"XLF",   label:"Financials",     group:"sector",    color:"#ffaa00" },
  xle:        { sym:"XLE",   label:"Energy",         group:"sector",    color:"#ffdd00" },
  xlb:        { sym:"XLB",   label:"Materials",      group:"sector",    color:"#44ddaa" },
  xlv:        { sym:"XLV",   label:"Healthcare",     group:"sector",    color:"#00ff88" },
  xlp:        { sym:"XLP",   label:"Cons Staples",   group:"sector",    color:"#ff9944" },
  xly:        { sym:"XLY",   label:"Cons Discret",   group:"sector",    color:"#ff66aa" },
  xlu:        { sym:"XLU",   label:"Utilities",      group:"sector",    color:"#88aaff" },
  xli:        { sym:"XLI",   label:"Industrials",    group:"sector",    color:"#aa66ff" },
};

// Murphy's intermarket relationship rules (Ch.17)
const INTERMARKET_RULES = [
  { id:"dollar_commodity", label:"Dollar vs Commodities", a:"UUP", b:"GLD", expected:"inverse",
    desc:"Rising dollar pressures commodity prices. Falling dollar lifts gold & oil." },
  { id:"commodity_bond",   label:"Commodities vs Bonds",  a:"GLD", b:"TLT", expected:"inverse",
    desc:"Rising commodity prices signal inflation, pushing bond prices down (yields up)." },
  { id:"bond_stock",       label:"Bonds vs Stocks",       a:"TLT", b:"SPY", expected:"positive",
    desc:"Rising bonds (falling yields) reduce borrowing costs, supporting stock valuations." },
  { id:"dollar_gold",      label:"Dollar vs Gold",        a:"UUP", b:"GLD", expected:"inverse",
    desc:"Gold is priced in dollars — inverse relationship is the most reliable intermarket signal." },
];

// Business cycle stage definitions (Murphy / Stovall)
const CYCLE_STAGES = [
  {
    id:1, label:"Early Recovery", color:"#00aaff", angle:315,
    leading:["XLF","XLY"],  lagging:["XLU","XLP"],
    bonds:"Rising", stocks:"Rising", commodities:"Falling", dollar:"Stable",
    desc:"Credit loosens, consumers spending picks up. Financials & Discretionary lead.",
  },
  {
    id:2, label:"Mid Expansion", color:"#00ff88", angle:45,
    leading:["XLK","XLI"],  lagging:["XLE","XLB"],
    bonds:"Peaking", stocks:"Rising", commodities:"Rising", dollar:"Falling",
    desc:"Broad economic growth. Tech & Industrials lead. Commodities begin turning up.",
  },
  {
    id:3, label:"Late Expansion", color:"#ffdd00", angle:135,
    leading:["XLE","XLB"],  lagging:["XLF","XLK"],
    bonds:"Falling", stocks:"Topping", commodities:"Rising strongly", dollar:"Falling",
    desc:"Inflation builds. Energy & Materials outperform. Bonds deteriorate as yields spike.",
  },
  {
    id:4, label:"Recession / Contraction", color:"#ff4466", angle:225,
    leading:["XLV","XLP","XLU"], lagging:["XLE","XLY"],
    bonds:"Rising again", stocks:"Falling", commodities:"Falling", dollar:"Rising",
    desc:"Safe havens dominate. Bonds recover. Defensive sectors (Healthcare, Staples, Utilities) outperform.",
  },
];

// Calculate correlation direction between two price series
function calcCorrelation(pricesA, pricesB) {
  if (!pricesA?.length || !pricesB?.length) return null;
  const minLen = Math.min(pricesA.length, pricesB.length, 20);
  const a = pricesA.slice(-minLen).map(p => p.close);
  const b = pricesB.slice(-minLen).map(p => p.close);
  const returns = (arr) => arr.slice(1).map((v, i) => (v - arr[i]) / arr[i]);
  const rA = returns(a), rB = returns(b);
  const meanA = rA.reduce((s, v) => s + v, 0) / rA.length;
  const meanB = rB.reduce((s, v) => s + v, 0) / rB.length;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < rA.length; i++) {
    cov  += (rA[i] - meanA) * (rB[i] - meanB);
    varA += (rA[i] - meanA) ** 2;
    varB += (rB[i] - meanB) ** 2;
  }
  const corr = cov / (Math.sqrt(varA * varB) || 1);
  return Math.max(-1, Math.min(1, corr));
}

// Determine if relationship is "normal" per Murphy's rules
function evalRelationship(corr, expected) {
  if (corr === null) return "unknown";
  if (expected === "inverse") return corr < -0.2 ? "normal" : corr > 0.2 ? "breakdown" : "neutral";
  return corr > 0.2 ? "normal" : corr < -0.2 ? "breakdown" : "neutral";
}

function IntermarketMiniSparkline({ data, color, w = 120, h = 40 }) {
  if (!data || data.length < 2) return <svg width={w} height={h}><text x={w/2} y={h/2} textAnchor="middle" fill="#1a3050" fontSize="8" fontFamily="monospace">—</text></svg>;
  const vals = data.map(p => p.close);
  const min = safeMin(vals), max = safeMax(vals), range = max - min || 0.01;
  const toX = i => (i / (vals.length - 1)) * w;
  const toY = v => h - 2 - ((v - min) / range) * (h - 4);
  const pts = vals.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const chg = ((vals[vals.length-1] - vals[0]) / vals[0]) * 100;
  const lineColor = chg >= 0 ? "#00ff88" : "#ff4466";
  return (
    <svg width={w} height={h} style={{ display:"block", overflow:"visible" }}>
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={toX(vals.length-1).toFixed(1)} cy={toY(vals[vals.length-1]).toFixed(1)} r="2" fill={lineColor}/>
    </svg>
  );
}

function IntermarketChainDiagram({ assetData, mono }) {
  const groups = [
    { label:"DOLLAR",      key:"dollar",    icon:"💵", items:[assetData["UUP"]] },
    { label:"COMMODITIES", key:"commodity", icon:"📦", items:[assetData["GLD"], assetData["USO"]] },
    { label:"BONDS",       key:"bonds",     icon:"📋", items:[assetData["TLT"], assetData["IEF"]] },
    { label:"STOCKS",      key:"stocks",    icon:"📈", items:[assetData["SPY"], assetData["QQQ"]] },
  ];

  const groupColors = { dollar:"#00d4ff", commodity:"#ffaa44", bonds:"#aa88ff", stocks:"#00ff88" };

  return (
    <div style={{ display:"flex", alignItems:"stretch", gap:"0", marginBottom:"16px", flexWrap:"wrap" }}>
      {groups.map((g, gi) => {
        const col = groupColors[g.key];
        return (
          <React.Fragment key={g.key}>
            <div style={{ flex:1, minWidth:"140px", background:"#070f1e", border:`1px solid ${col}33`, borderTop:`3px solid ${col}`, padding:"12px 10px" }}>
              <div style={{ fontSize:"9px", color:col, letterSpacing:"2px", marginBottom:"8px", display:"flex", alignItems:"center", gap:"5px" }}>
                <span>{g.icon}</span><span>{g.label}</span>
              </div>
              {g.items.map(item => {
                if (!item) return null;
                const chgColor = item.chg >= 0 ? "#00ff88" : "#ff4466";
                return (
                  <div key={item.sym} style={{ marginBottom:"8px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"3px" }}>
                      <span style={{ color:"#e0f0ff", fontWeight:"bold", fontSize:"12px", letterSpacing:"1px" }}>{item.sym}</span>
                      <span style={{ color:chgColor, fontSize:"11px" }}>{item.chg >= 0 ? "▲" : "▼"} {Math.abs(item.chg).toFixed(2)}%</span>
                    </div>
                    <div style={{ fontSize:"9px", color:"#3a5a7a", marginBottom:"4px" }}>${item.price?.toFixed(2)}</div>
                    <IntermarketMiniSparkline data={item.prices} color={col} w={120} h={36}/>
                  </div>
                );
              })}
            </div>
            {gi < groups.length - 1 && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"0 4px", color:"#2a4a6a", fontSize:"18px", flexShrink:0 }}>
                →
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RelationshipStatusBar({ assetData, mono }) {
  const rules = INTERMARKET_RULES;
  const getChg = (sym) => assetData[sym]?.chg ?? 0;
  const getPrices = (sym) => assetData[sym]?.prices ?? [];

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:"8px", marginBottom:"16px" }}>
      {rules.map(rule => {
        const corrVal = calcCorrelation(getPrices(rule.a), getPrices(rule.b));
        const status  = evalRelationship(corrVal, rule.expected);
        const statusColor = status === "normal" ? "#00ff88" : status === "breakdown" ? "#ff4466" : "#ffaa00";
        const chgA = getChg(rule.a), chgB = getChg(rule.b);
        const actualRelation = (chgA >= 0 && chgB < 0) || (chgA < 0 && chgB >= 0) ? "inverse" : "positive";
        const holding = actualRelation === rule.expected;
        return (
          <div key={rule.id} style={{ background:"#070f1e", border:`1px solid ${statusColor}33`, borderLeft:`3px solid ${statusColor}`, padding:"10px 12px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"6px" }}>
              <div style={{ color:"#c8d8f0", fontSize:"10px", fontWeight:"bold" }}>{rule.label}</div>
              <span style={{ background:statusColor+"22", color:statusColor, fontSize:"8px", padding:"2px 7px", letterSpacing:"1px" }}>
                {status === "normal" ? "✓ HOLDING" : status === "breakdown" ? "⚠ BREAKDOWN" : "→ NEUTRAL"}
              </span>
            </div>
            <div style={{ display:"flex", gap:"12px", marginBottom:"6px" }}>
              <div style={{ fontSize:"10px" }}>
                <span style={{ color:"#3a5a7a", fontSize:"8px" }}>{rule.a} </span>
                <span style={{ color:chgA >= 0 ? "#00ff88" : "#ff4466" }}>{chgA >= 0 ? "▲" : "▼"}{Math.abs(chgA).toFixed(2)}%</span>
              </div>
              <div style={{ fontSize:"9px", color:"#2a4060" }}>{rule.expected === "inverse" ? "⇅" : "⇈"}</div>
              <div style={{ fontSize:"10px" }}>
                <span style={{ color:"#3a5a7a", fontSize:"8px" }}>{rule.b} </span>
                <span style={{ color:chgB >= 0 ? "#00ff88" : "#ff4466" }}>{chgB >= 0 ? "▲" : "▼"}{Math.abs(chgB).toFixed(2)}%</span>
              </div>
              {corrVal !== null && (
                <div style={{ marginLeft:"auto", fontSize:"9px", color:"#3a5a7a" }}>
                  r = <span style={{ color:statusColor }}>{corrVal.toFixed(2)}</span>
                </div>
              )}
            </div>
            <div style={{ fontSize:"8px", color:"#2a4a6a", lineHeight:"1.5" }}>{rule.desc}</div>
          </div>
        );
      })}
    </div>
  );
}

// Detect likely business cycle stage based on relative performance
function detectCycleStage(assetData, sectorData) {
  const bondChg  = assetData["TLT"]?.chg  ?? 0;
  const spyChg   = assetData["SPY"]?.chg  ?? 0;
  const goldChg  = assetData["GLD"]?.chg  ?? 0;
  const dollarChg= assetData["UUP"]?.chg  ?? 0;
  const oilChg   = assetData["USO"]?.chg  ?? 0;

  // Sector performance
  const getS = sym => sectorData[sym]?.chg ?? 0;
  const xle = getS("XLE"), xlf = getS("XLF"), xlv = getS("XLV"),
        xlp = getS("XLP"), xly = getS("XLY"), xlk = getS("XLK"),
        xlu = getS("XLU"), xli = getS("XLI"), xlb = getS("XLB");

  let scores = [0, 0, 0, 0]; // stages 1-4

  // Stage 1 (Early Recovery): bonds rising, xlf & xly leading, commodities soft
  if (bondChg > 0) scores[0] += 2;
  if (xlf > xle) scores[0] += 1;
  if (xly > xlv) scores[0] += 1;
  if (goldChg < 0 && oilChg < 0) scores[0] += 1;

  // Stage 2 (Mid Expansion): stocks rising strongly, xlk & xli lead, bonds peaking
  if (spyChg > 0.5) scores[1] += 2;
  if (xlk > xlv) scores[1] += 1;
  if (xli > xlp) scores[1] += 1;
  if (Math.abs(bondChg) < 0.3) scores[1] += 1; // bonds flat/peaking

  // Stage 3 (Late Expansion): commodities rising, energy leads, bonds falling
  if (goldChg > 0.5 || oilChg > 0.5) scores[2] += 2;
  if (xle > xlk) scores[2] += 1;
  if (xlb > xlf) scores[2] += 1;
  if (bondChg < -0.3) scores[2] += 1;

  // Stage 4 (Recession): defensive sectors lead, bonds recovering, stocks down
  if (spyChg < -0.3) scores[3] += 2;
  if (xlv > xly && xlp > xle) scores[3] += 2;
  if (xlu > xlk) scores[3] += 1;
  if (bondChg > 0 && spyChg < 0) scores[3] += 2;

  const maxScore = Math.max(...scores);
  const stageIdx = scores.indexOf(maxScore);
  const confidence = Math.min(95, Math.round((maxScore / 7) * 100));
  return { stage: CYCLE_STAGES[stageIdx], scores, confidence };
}

function CycleClockDiagram({ stageInfo, mono }) {
  const { stage, confidence } = stageInfo;
  const W = 320, H = 320, cx = 160, cy = 160, r = 110, ri = 68;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"8px" }}>BUSINESS CYCLE CLOCK — MURPHY CH.17</div>
      <svg width={W} height={H} style={{ fontFamily:mono }}>
        <defs>
          {CYCLE_STAGES.map(s => (
            <radialGradient key={s.id} id={`cg${s.id}`} cx="50%" cy="50%">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.15"/>
              <stop offset="100%" stopColor={s.color} stopOpacity="0.03"/>
            </radialGradient>
          ))}
        </defs>
        {/* Clock segments */}
        {CYCLE_STAGES.map((s, i) => {
          const startAngle = (i * 90 - 90) * Math.PI / 180;
          const endAngle   = ((i+1) * 90 - 90) * Math.PI / 180;
          const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
          const xi1= cx + ri* Math.cos(startAngle), yi1= cy + ri* Math.sin(startAngle);
          const xi2= cx + ri* Math.cos(endAngle),   yi2= cy + ri* Math.sin(endAngle);
          const isActive = stage.id === s.id;
          const midAngle = ((i * 90 + 45) - 90) * Math.PI / 180;
          const lx = cx + (r+ri)/2 * Math.cos(midAngle);
          const ly = cy + (r+ri)/2 * Math.sin(midAngle);
          return (
            <g key={s.id}>
              <path d={`M ${xi1.toFixed(1)} ${yi1.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${xi2.toFixed(1)} ${yi2.toFixed(1)} A ${ri} ${ri} 0 0 0 ${xi1.toFixed(1)} ${yi1.toFixed(1)} Z`}
                fill={isActive ? s.color+"44" : "#0a1420"} stroke={s.color} strokeWidth={isActive ? 2 : 0.8} opacity={isActive ? 1 : 0.5}/>
              <text x={lx.toFixed(1)} y={(ly - 4).toFixed(1)} textAnchor="middle" fill={s.color} fontSize={isActive ? "9" : "7"} fontWeight={isActive ? "bold" : "normal"} opacity={isActive ? 1 : 0.6}>STAGE {s.id}</text>
              <text x={lx.toFixed(1)} y={(ly + 7).toFixed(1)} textAnchor="middle" fill={s.color} fontSize="6.5" opacity={isActive ? 0.9 : 0.5}>{s.label.toUpperCase().replace(" ", "\n")}</text>
            </g>
          );
        })}
        {/* Arrows showing clockwise rotation */}
        {[0,1,2,3].map(i => {
          const angle = ((i * 90 + 82) - 90) * Math.PI / 180;
          const ax = cx + (r+8) * Math.cos(angle), ay = cy + (r+8) * Math.sin(angle);
          return <circle key={i} cx={ax.toFixed(1)} cy={ay.toFixed(1)} r="2" fill="#2a4a6a" opacity="0.5"/>;
        })}
        {/* Center */}
        <circle cx={cx} cy={cy} r={ri-2} fill="#060e1c" stroke="#1a3050" strokeWidth="1"/>
        <text x={cx} y={cy-16} textAnchor="middle" fill={stage.color} fontSize="9" fontWeight="bold" letterSpacing="1">STAGE {stage.id}</text>
        <text x={cx} y={cy} textAnchor="middle" fill={stage.color} fontSize="8" fontWeight="bold">{stage.label.toUpperCase().split(" ")[0]}</text>
        <text x={cx} y={cy+12} textAnchor="middle" fill={stage.color} fontSize="8">{stage.label.toUpperCase().split(" ").slice(1).join(" ")}</text>
        <text x={cx} y={cy+28} textAnchor="middle" fill="#3a5a7a" fontSize="8">{confidence}% CONF</text>
        {/* Clock hand */}
        {(() => {
          const handAngle = ((stage.id - 1) * 90 + 45 - 90) * Math.PI / 180;
          const hx = cx + (ri - 10) * Math.cos(handAngle), hy = cy + (ri - 10) * Math.sin(handAngle);
          return <line x1={cx} y1={cy} x2={hx.toFixed(1)} y2={hy.toFixed(1)} stroke={stage.color} strokeWidth="2.5" strokeLinecap="round"/>;
        })()}
        <circle cx={cx} cy={cy} r="4" fill={stage.color}/>
      </svg>
    </div>
  );
}

function SectorRotationClockRow({ stage, sectorData, mono }) {
  return (
    <div style={{ background:"#070f1e", border:`1px solid ${stage.color}33`, borderLeft:`3px solid ${stage.color}`, padding:"12px", marginBottom:"8px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
        <span style={{ color:stage.color, fontWeight:"bold", fontSize:"11px", letterSpacing:"1px" }}>STAGE {stage.id}: {stage.label.toUpperCase()}</span>
      </div>
      <div style={{ fontSize:"9px", color:"#4a6a8a", lineHeight:"1.6", marginBottom:"8px" }}>{stage.desc}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:"6px", fontSize:"9px", marginBottom:"8px" }}>
        {[["BONDS", stage.bonds], ["STOCKS", stage.stocks], ["COMMODITIES", stage.commodities], ["DOLLAR", stage.dollar]].map(([k,v]) => (
          <div key={k} style={{ background:"#060e1c", padding:"4px 6px" }}>
            <div style={{ color:"#2a4a6a", fontSize:"7px", letterSpacing:"1px" }}>{k}</div>
            <div style={{ color:"#c8d8f0", fontSize:"9px" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
        <span style={{ fontSize:"8px", color:"#3a5a7a" }}>LEADERS:</span>
        {stage.leading.map(sym => {
          const d = sectorData[sym];
          const chg = d?.chg ?? 0;
          return <span key={sym} style={{ background:"#00ff8822", color:"#00ff88", padding:"2px 7px", fontSize:"9px", letterSpacing:"1px" }}>{sym} {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
        })}
        <span style={{ fontSize:"8px", color:"#3a5a7a", marginLeft:"8px" }}>LAGGARDS:</span>
        {stage.lagging.map(sym => {
          const d = sectorData[sym];
          const chg = d?.chg ?? 0;
          return <span key={sym} style={{ background:"#ff446622", color:"#ff4466", padding:"2px 7px", fontSize:"9px", letterSpacing:"1px" }}>{sym} {chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span>;
        })}
      </div>
    </div>
  );
}

function IntermarketTab({ mono }) {
  const [assetData, setAssetData]   = useState({});
  const [loading,   setLoading]     = useState(true);
  const [progress,  setProgress]    = useState(0);
  const [activeSection, setActiveSection] = useState("chain");

  const allSyms = Object.values(INTERMARKET_ASSETS).map(a => a.sym);
  const uniqueSyms = [...new Set(allSyms)];

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true); setProgress(0);
      const results = {};
      const batch = 3;
      for (let i = 0; i < uniqueSyms.length; i += batch) {
        if (cancelled) break;
        const slice = uniqueSyms.slice(i, i + batch);
        await Promise.all(slice.map(async sym => {
          try {
            const [prices, quote] = await Promise.all([fetchHistory(sym), fetchQuote(sym)]);
            const chg = quote.prevClose > 0 ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : 0;
            const mom5d = prices.length >= 6 ? ((prices[prices.length-1].close - prices[prices.length-6].close) / prices[prices.length-6].close) * 100 : chg;
            results[sym] = { sym, price: quote.price, chg, mom5d, prices, name: quote.name || sym };
          } catch { results[sym] = null; }
        }));
        setProgress(Math.round(((i + batch) / uniqueSyms.length) * 100));
        await new Promise(r => setTimeout(r, 220));
      }
      if (!cancelled) { setAssetData(results); setLoading(false); }
    }
    loadAll();
    return () => { cancelled = true; };
  }, []);

  const loaded = Object.values(assetData).filter(Boolean).length;
  const sectorSyms = ["XLK","XLF","XLE","XLB","XLV","XLP","XLY","XLU","XLI"];
  const sectorData = Object.fromEntries(sectorSyms.map(s => [s, assetData[s]]).filter(([,v]) => v));
  const cycleInfo  = loaded > 5 ? detectCycleStage(assetData, sectorData) : { stage: CYCLE_STAGES[1], scores:[0,0,0,0], confidence:0 };

  const sections = [
    { id:"chain",   label:"CHAIN" },
    { id:"rules",   label:"RELATIONSHIPS" },
    { id:"clock",   label:"CYCLE CLOCK" },
    { id:"sectors", label:"SECTOR ROTATION" },
    { id:"guide",   label:"REFERENCE" },
  ];

  return (
    <div style={{ padding:"0", fontFamily:mono }}>
      {/* Sub-nav */}
      <div style={{ display:"flex", background:"#060e1c", borderBottom:"1px solid #1a3050", padding:"0 16px", gap:"0", overflowX:"auto" }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            style={{ background:"transparent", border:"none", borderBottom:activeSection===s.id?"2px solid #00aaff":"2px solid transparent",
              color:activeSection===s.id?"#00aaff":"#2a4a6a", padding:"8px 14px", cursor:"pointer",
              letterSpacing:"1px", fontSize:"9px", fontFamily:mono }}>
            {s.label}
          </button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"8px", padding:"0 8px" }}>
          {loading
            ? <span style={{ fontSize:"9px", color:"#ffaa00" }}>LOADING {Math.min(100, progress)}% ({loaded}/{uniqueSyms.length})</span>
            : <span style={{ fontSize:"9px", color:"#2a4060" }}>✓ {loaded} INSTRUMENTS</span>}
        </div>
      </div>

      <div style={{ padding:"16px", maxWidth:"1200px", overflowY:"auto", maxHeight:"calc(100vh - 140px)" }}>

        {/* ── CHAIN VIEW ── */}
        {activeSection === "chain" && (
          <>
            <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"12px" }}>
              INTERMARKET CHAIN — MURPHY CH.17: DOLLAR → COMMODITIES → BONDS → STOCKS
            </div>
            {loading && loaded < 4
              ? <div style={{ color:"#2a4060", fontSize:"10px", padding:"40px", textAlign:"center" }}>Loading intermarket data...</div>
              : <IntermarketChainDiagram assetData={assetData} mono={mono}/>
            }
            {/* Chain explanation */}
            <div style={{ background:"#070f1e", border:"1px solid #1a3050", padding:"14px", fontSize:"9px", color:"#4a6a8a", lineHeight:"1.9" }}>
              <div style={{ color:"#c8d8f0", fontWeight:"bold", marginBottom:"6px", fontSize:"10px" }}>HOW THE CHAIN WORKS — JOHN MURPHY</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:"8px" }}>
                {[
                  ["1️⃣ Dollar → Commodities (INVERSE)", "A falling US Dollar makes commodities cheaper for foreign buyers, driving up commodity prices globally. Gold and oil are especially sensitive."],
                  ["2️⃣ Commodities → Bonds (INVERSE)", "Rising commodity prices signal inflation. Inflation erodes fixed bond returns, so bond prices fall and yields rise. Commodities lead bonds by weeks to months."],
                  ["3️⃣ Bonds → Stocks (POSITIVE)", "Rising bond prices (falling yields) lower borrowing costs for companies and consumers, supporting stock valuations and earnings. Bonds typically lead stocks."],
                  ["4️⃣ The Full Signal Chain", "Dollar↑ → Commodities↓ → Bonds↑ → Stocks↑. Or: Dollar↓ → Commodities↑ → Bonds↓ → Stocks↓ (with a lag). Breakdowns in these relationships are powerful warning signals."],
                ].map(([title, body]) => (
                  <div key={title} style={{ background:"#060e1c", padding:"8px 10px" }}>
                    <div style={{ color:"#c8d8f0", marginBottom:"3px", fontSize:"9px" }}>{title}</div>
                    <div style={{ color:"#3a5a7a", fontSize:"8px", lineHeight:"1.6" }}>{body}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── RELATIONSHIPS VIEW ── */}
        {activeSection === "rules" && (
          <>
            <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"12px" }}>
              RELATIONSHIP STATUS — ARE MURPHY'S RULES HOLDING?
            </div>
            <RelationshipStatusBar assetData={assetData} mono={mono}/>
            {/* All sector vs SPY correlation */}
            <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"8px", marginTop:"8px" }}>
              SECTOR vs SPY — RELATIVE PERFORMANCE
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))", gap:"6px" }}>
              {sectorSyms.map(sym => {
                const d = assetData[sym];
                const spy = assetData["SPY"];
                if (!d) return <div key={sym} style={{ background:"#070f1e", border:"1px solid #1a3050", padding:"10px", fontSize:"9px", color:"#2a4060" }}>{sym} loading...</div>;
                const relPerf = d.chg - (spy?.chg ?? 0);
                const relColor = relPerf > 0 ? "#00ff88" : relPerf < 0 ? "#ff4466" : "#ffaa00";
                const asset = Object.values(INTERMARKET_ASSETS).find(a => a.sym === sym);
                return (
                  <div key={sym} style={{ background:"#070f1e", border:`1px solid ${relColor}22`, borderLeft:`2px solid ${relColor}`, padding:"10px 12px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                      <span style={{ color:"#e0f0ff", fontWeight:"bold", fontSize:"11px" }}>{sym}</span>
                      <span style={{ color:d.chg >= 0 ? "#00ff88" : "#ff4466", fontSize:"10px" }}>{d.chg >= 0 ? "+" : ""}{d.chg.toFixed(2)}%</span>
                    </div>
                    <div style={{ fontSize:"8px", color:"#2a4a6a", marginBottom:"4px" }}>{asset?.label}</div>
                    <div style={{ fontSize:"9px" }}>
                      <span style={{ color:"#3a5a7a" }}>vs SPY: </span>
                      <span style={{ color:relColor }}>{relPerf >= 0 ? "+" : ""}{relPerf.toFixed(2)}%</span>
                    </div>
                    <IntermarketMiniSparkline data={d.prices} color={relColor} w={160} h={32}/>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── CYCLE CLOCK VIEW ── */}
        {activeSection === "clock" && (
          <>
            <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"12px" }}>
              BUSINESS CYCLE DETECTION — BASED ON CURRENT INTERMARKET CONDITIONS
            </div>
            <div style={{ display:"flex", gap:"16px", flexWrap:"wrap", marginBottom:"16px" }}>
              <CycleClockDiagram stageInfo={cycleInfo} mono={mono}/>
              <div style={{ flex:1, minWidth:"260px" }}>
                <div style={{ background:"#070f1e", border:`1px solid ${cycleInfo.stage.color}44`, borderLeft:`4px solid ${cycleInfo.stage.color}`, padding:"16px", marginBottom:"12px" }}>
                  <div style={{ color:cycleInfo.stage.color, fontWeight:"bold", fontSize:"13px", letterSpacing:"2px", marginBottom:"8px" }}>
                    STAGE {cycleInfo.stage.id}: {cycleInfo.stage.label.toUpperCase()}
                  </div>
                  <div style={{ fontSize:"9px", color:"#4a6a8a", lineHeight:"1.7", marginBottom:"10px" }}>{cycleInfo.stage.desc}</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px", fontSize:"9px" }}>
                    {[["BONDS", cycleInfo.stage.bonds, "aa88ff"], ["STOCKS", cycleInfo.stage.stocks, "00ff88"],
                      ["COMMODITIES", cycleInfo.stage.commodities, "ffaa44"], ["DOLLAR", cycleInfo.stage.dollar, "00d4ff"]].map(([k,v,c]) => (
                      <div key={k} style={{ background:"#060e1c", padding:"6px 8px" }}>
                        <div style={{ color:"#2a4a6a", fontSize:"7px", letterSpacing:"1px" }}>{k}</div>
                        <div style={{ color:`#${c}`, fontSize:"10px", fontWeight:"bold" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Confidence scores */}
                <div style={{ background:"#070f1e", border:"1px solid #1a3050", padding:"12px" }}>
                  <div style={{ fontSize:"8px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"8px" }}>STAGE SCORES</div>
                  {CYCLE_STAGES.map((s, i) => {
                    const score = cycleInfo.scores[i];
                    const maxScore = 7;
                    const pct = Math.round((score / maxScore) * 100);
                    return (
                      <div key={s.id} style={{ marginBottom:"6px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"2px" }}>
                          <span style={{ color: cycleInfo.stage.id === s.id ? s.color : "#3a5a7a", fontSize:"9px" }}>S{s.id}: {s.label}</span>
                          <span style={{ color: cycleInfo.stage.id === s.id ? s.color : "#2a4a6a", fontSize:"9px" }}>{pct}%</span>
                        </div>
                        <div style={{ height:"3px", background:"#0d1f35", borderRadius:"1px" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background: cycleInfo.stage.id === s.id ? s.color : "#1a3050", borderRadius:"1px", transition:"width 0.3s" }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── SECTOR ROTATION VIEW ── */}
        {activeSection === "sectors" && (
          <>
            <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"12px" }}>
              SECTOR ROTATION BY CYCLE STAGE — WHICH SECTORS LEAD IN EACH PHASE
            </div>
            {CYCLE_STAGES.map(stage => (
              <SectorRotationClockRow key={stage.id} stage={stage} sectorData={sectorData} mono={mono}/>
            ))}
          </>
        )}

        {/* ── REFERENCE GUIDE ── */}
        {activeSection === "guide" && (
          <div style={{ fontSize:"10px", color:"#4a6a8a", lineHeight:"1.8" }}>
            <div style={{ fontSize:"9px", color:"#3a5a7a", letterSpacing:"2px", marginBottom:"14px" }}>INTERMARKET ANALYSIS REFERENCE — JOHN J. MURPHY CH.17</div>
            {[
              {
                title:"The Four Markets",
                content:"Murphy identifies four interconnected asset classes: Currencies (US Dollar), Commodities (CRB Index / Gold / Oil), Bonds (Treasuries), and Stocks (S&P 500). No market trades in isolation — they form a chain of leading/lagging relationships driven by inflation expectations and economic cycles."
              },
              {
                title:"Dollar → Commodities: Inverse Relationship",
                content:"A falling US Dollar makes commodities cheaper for foreign buyers, lifting demand and prices. Conversely, a rising dollar suppresses commodity prices. Gold and oil are the most sensitive to dollar moves. This is the anchor relationship — all other intermarket analysis flows from here."
              },
              {
                title:"Commodities → Bonds: Inverse Relationship",
                content:"Rising commodity prices signal inflationary pressure. Inflation erodes the real value of fixed bond payments, so bond prices fall (and yields rise). This is a leading relationship — commodity trends often lead bond market turns by weeks to months."
              },
              {
                title:"Bonds → Stocks: Positive Relationship",
                content:"Rising bond prices (falling yields) lower corporate borrowing costs and make dividend stocks more attractive relative to fixed income. Stocks typically follow bonds higher. Bonds tend to peak before stocks at cycle tops, and bottom before stocks at cycle lows."
              },
              {
                title:"The Full Chain & Timing",
                content:"The full chain runs: Dollar → Commodities → Bonds → Stocks. Turns typically begin in the currency market, cascade through commodities, then bonds, and finally stocks. Recognizing where we are in this sequence is the core of Murphy's intermarket approach to market timing."
              },
              {
                title:"Relationship Breakdowns",
                content:"The most powerful intermarket signal is when a normally reliable relationship BREAKS DOWN. When bonds and stocks fall together, or gold rises with the dollar, it indicates an unusual market condition (deflation, crisis, flight to safety) that demands extra caution and re-evaluation of all positions."
              },
              {
                title:"Business Cycle & Sector Rotation",
                content:"Murphy links intermarket analysis to the Stovall/Merrill Lynch business cycle model. Early recovery favors Financials and Discretionary. Mid-expansion favors Technology and Industrials. Late expansion favors Energy and Materials. Recession favors Healthcare, Staples, and Utilities. Watching which sectors lead/lag helps confirm cycle stage."
              },
              {
                title:"Global Intermarket Relationships",
                content:"US markets often lead global equities. Dollar strength vs. EM currencies affects commodity-exporting nations. The Yen/Dollar pair is a key risk sentiment indicator — Yen strength often coincides with risk-off moves in equities. The bond yield curve (spread between 2yr and 10yr) is a classic recession indicator."
              },
            ].map(({ title, content }) => (
              <div key={title} style={{ background:"#070f1e", border:"1px solid #1a3050", padding:"12px 14px", marginBottom:"8px" }}>
                <div style={{ color:"#c8d8f0", fontWeight:"bold", fontSize:"10px", marginBottom:"5px" }}>{title}</div>
                <div style={{ color:"#3a5a7a", fontSize:"9px", lineHeight:"1.7" }}>{content}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TREEMAP HEATMAP — Finviz / TradingView / MarketCarpet style
// Squarified treemap: tiles sized by market cap, colored by % chg / RSI / score
// ══════════════════════════════════════════════════════════════════════════════

const MCAP_W = {
  AAPL:3000,MSFT:2900,NVDA:2800,GOOGL:2100,AMZN:2000,META:1400,
  TSLA:800,"BRK-B":900,AVGO:700,LLY:720,WMT:670,JPM:600,V:520,
  UNH:480,XOM:530,ORCL:390,PG:360,HD:350,MA:430,COST:380,JNJ:380,
  BAC:320,ABBV:310,CRM:280,NFLX:280,AMD:300,KO:260,PEP:240,MRK:290,
  TMO:210,NOW:200,GE:200,ACN:220,HON:140,CAT:190,GS:170,INTC:130,
  CSCO:210,ABT:180,IBM:180,CVX:290,MCD:220,
};
const DEFAULT_W = 80;

const SECTORS_HM = [
  { id:"tech",    label:"Technology",  color:"#040d1e", syms:["AAPL","MSFT","NVDA","GOOGL","AMZN","META","AVGO","AMD","INTC","CRM","ORCL","NOW","CSCO","ACN","IBM"] },
  { id:"fin",     label:"Financials",  color:"#03100e", syms:["JPM","GS","BAC","V","MA","BRK-B"] },
  { id:"health",  label:"Healthcare",  color:"#040e04", syms:["UNH","LLY","JNJ","MRK","ABBV","TMO","ABT"] },
  { id:"cons",    label:"Consumer",    color:"#0e0904", syms:["TSLA","WMT","COST","MCD","KO","PEP","PG","HD","NFLX"] },
  { id:"energy",  label:"Energy",      color:"#0e0900", syms:["XOM","CVX"] },
  { id:"ind",     label:"Industrials", color:"#09040e", syms:["CAT","GE","HON"] },
];

// Squarified treemap algorithm
function squarifiedTreemap(items, x, y, W, H) {
  if (!items.length || W<=0 || H<=0) return [];
  const total = items.reduce((s,i)=>s+i.value,0);
  if (!total) return [];
  const scaled = items.map(i=>({...i, area:(i.value/total)*W*H}));

  function worst(row, len) {
    const s = row.reduce((a,i)=>a+i.area,0);
    return safeMax(row.map(i=>{ const r=(i.area/s)*len; const o=s/len; return Math.max(r/o,o/r); }));
  }
  function layoutRow(row, x, y, W, H, horiz) {
    const s=row.reduce((a,i)=>a+i.area,0);
    const strip=horiz?s/H:s/W; let pos=horiz?x:y;
    return row.map(i=>{ const dim=(i.area/s)*(horiz?H:W); const r=horiz?{x:pos,y,w:strip,h:dim}:{x,y:pos,w:dim,h:strip}; pos+=dim; return {...i,...r}; });
  }
  function place(items, x, y, W, H) {
    if (!items.length) return [];
    if (items.length===1) return [{...items[0],x,y,w:W,h:H}];
    const horiz=W>=H, len=horiz?H:W;
    let row=[items[0]], i=1;
    while (i<items.length) {
      const next=[...row,items[i]];
      if (row.length>0 && worst(next,len)>worst(row,len)) break;
      row=next; i++;
    }
    const rowArea=row.reduce((a,r)=>a+r.area,0);
    const strip=rowArea/len;
    const placed=layoutRow(row,x,y,W,H,horiz);
    const rest=horiz?place(items.slice(i),x+strip,y,W-strip,H):place(items.slice(i),x,y+strip,W,H-strip);
    return [...placed,...rest];
  }
  return place([...scaled].sort((a,b)=>b.area-a.area),x,y,W,H);
}

function tileColor(stock, mode) {
  if (!stock) return { bg:"#0a1020", border:"#111e36", text:"#1e3050" };
  if (mode==="change") {
    const c=stock.chg;
    if (c>= 5) return {bg:"#004d20",border:"#00ff88",text:"#ccffe8"};
    if (c>= 3) return {bg:"#003d18",border:"#00cc66",text:"#aaffd0"};
    if (c>= 1) return {bg:"#002d10",border:"#008844",text:"#77dd99"};
    if (c>= 0) return {bg:"#001808",border:"#004422",text:"#449966"};
    if (c>=-1) return {bg:"#1a0404",border:"#440011",text:"#884455"};
    if (c>=-3) return {bg:"#2d0808",border:"#880022",text:"#cc6677"};
    if (c>=-5) return {bg:"#3d0808",border:"#aa2233",text:"#ee8899"};
               return {bg:"#550000",border:"#cc0011",text:"#ff9999"};
  }
  if (mode==="rsi") {
    const r=stock.rsi;
    if (r>75) return {bg:"#4a0a0a",border:"#cc2222",text:"#ffaaaa"};
    if (r>65) return {bg:"#2a1005",border:"#884400",text:"#ffcc88"};
    if (r>55) return {bg:"#181408",border:"#665500",text:"#ccaa55"};
    if (r>45) return {bg:"#080e18",border:"#224466",text:"#6699cc"};
    if (r>35) return {bg:"#051510",border:"#226644",text:"#66cc99"};
              return {bg:"#023310",border:"#009944",text:"#44ffaa"};
  }
  if (mode==="score") {
    const s=stock.score;
    if (s>=80) return {bg:"#004428",border:"#00ff88",text:"#aaffcc"};
    if (s>=65) return {bg:"#003318",border:"#00aa55",text:"#77ddaa"};
    if (s>=50) return {bg:"#181800",border:"#888800",text:"#dddd44"};
    if (s>=35) return {bg:"#281000",border:"#884400",text:"#dd8844"};
               return {bg:"#2a0000",border:"#880000",text:"#dd4444"};
  }
  return {bg:"#0a1020",border:"#12203a",text:"#3a5a7a"};
}

function HeatmapTab({ stocks, isScanning, setTab, setSelected, mono }) {
  const [colorMode, setColorMode] = useState("change");
  const [sizeMode,  setSizeMode]  = useState("mcap");
  const [tooltip,   setTooltip]   = useState(null);
  const [hovSym,    setHovSym]    = useState(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({w:1100,h:600});

  useEffect(()=>{
    const el=containerRef.current; if(!el) return;
    const ro=new ResizeObserver(entries=>{
      const {width}=entries[0].contentRect;
      setDims({w:Math.floor(width)-2,h:Math.max(480,Math.floor(width*0.54))});
    });
    ro.observe(el); return ()=>ro.disconnect();
  },[]);

  const stockMap=Object.fromEntries(stocks.map(s=>[s.sym,s]));
  const loaded=stocks.length;
  const bulls=stocks.filter(s=>s.chg>0).length;
  const bears=stocks.filter(s=>s.chg<0).length;
  const avgChg=loaded?stocks.reduce((a,s)=>a+s.chg,0)/loaded:0;

  const GAP=2, SEC_H=20;

  const sectorItems=SECTORS_HM.map(sec=>({
    ...sec, value:sec.syms.reduce((s,sym)=>s+(MCAP_W[sym]||DEFAULT_W),0),
  }));
  const sectorRects=squarifiedTreemap(sectorItems,0,0,dims.w,dims.h);

  const stockTiles=[], sectorLabels=[];
  for (const sr of sectorRects) {
    const sec=SECTORS_HM.find(s=>s.id===sr.id); if(!sec) continue;
    const ix=sr.x+GAP, iy=sr.y+SEC_H, iw=sr.w-GAP*2, ih=sr.h-SEC_H-GAP;
    if (iw<8||ih<8) continue;
    const sectorStocks=sec.syms.filter(sym=>stockMap[sym]);
    const sectorAvg=sectorStocks.length?sectorStocks.reduce((a,sym)=>a+stockMap[sym].chg,0)/sectorStocks.length:0;
    sectorLabels.push({...sr,label:sec.label,avg:sectorAvg,color:sec.color});
    const stockItems=sec.syms.map(sym=>({
      sym, value:sizeMode==="mcap"?(MCAP_W[sym]||DEFAULT_W):Math.max(10,(stockMap[sym]?.score||40)*1.5),
    }));
    const tiles=squarifiedTreemap(stockItems,ix,iy,iw,ih);
    for (const t of tiles) {
      const s=stockMap[t.sym]||null;
      stockTiles.push({...t,stock:s,col:tileColor(s,colorMode)});
    }
  }

  const dispVal=s=>{
    if(!s) return "";
    if(colorMode==="rsi") return `RSI ${s.rsi}`;
    if(colorMode==="score") return `${s.score}`;
    return `${s.chg>=0?"+":""}${s.chg.toFixed(2)}%`;
  };

  const top3gain=[...stocks].sort((a,b)=>b.chg-a.chg).slice(0,3);
  const top3loss=[...stocks].sort((a,b)=>a.chg-b.chg).slice(0,3);

  return (
    <div style={{background:"#040b16",minHeight:"calc(100vh - 96px)",display:"flex",flexDirection:"column",fontFamily:mono}}>

      {/* TOOLBAR */}
      <div style={{background:"#060e1c",borderBottom:"1px solid #0d1f35",padding:"8px 16px",display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:"9px",color:"#2a4a6a",letterSpacing:"2px"}}>COLOR</span>
        {[["change","% CHANGE"],["rsi","RSI"],["score","SCORE"]].map(([m,l])=>(
          <button key={m} onClick={()=>setColorMode(m)} style={{
            background:colorMode===m?"#0d2a40":"transparent",border:`1px solid ${colorMode===m?"#00d4ff":"#1a3050"}`,
            color:colorMode===m?"#00d4ff":"#3a5a7a",padding:"4px 11px",cursor:"pointer",fontSize:"9px",fontFamily:mono,letterSpacing:"1px",
          }}>{l}</button>
        ))}
        <div style={{width:"1px",height:"18px",background:"#1a3050",margin:"0 4px"}}/>
        <span style={{fontSize:"9px",color:"#2a4a6a",letterSpacing:"2px"}}>SIZE</span>
        {[["mcap","MKT CAP"],["score","SCORE"]].map(([m,l])=>(
          <button key={m} onClick={()=>setSizeMode(m)} style={{
            background:sizeMode===m?"#0d2a40":"transparent",border:`1px solid ${sizeMode===m?"#00d4ff":"#1a3050"}`,
            color:sizeMode===m?"#00d4ff":"#3a5a7a",padding:"4px 11px",cursor:"pointer",fontSize:"9px",fontFamily:mono,letterSpacing:"1px",
          }}>{l}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:"18px",fontSize:"10px",alignItems:"center"}}>
          <span style={{color:"#00ff88"}}>▲ {bulls} adv</span>
          <span style={{color:"#ff4466"}}>▼ {bears} dec</span>
          <span style={{color:avgChg>=0?"#00ff88":"#ff4466",fontWeight:"bold"}}>{avgChg>=0?"+":""}{avgChg.toFixed(2)}% avg</span>
          <span style={{color:"#2a4a6a"}}>{loaded} symbols</span>
        </div>
      </div>

      {/* COLOR SCALE */}
      <div style={{background:"#050b18",borderBottom:"1px solid #0a1a2a",padding:"5px 16px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
        {colorMode==="change"&&<>
          <span style={{fontSize:"8px",color:"#2a4a6a",letterSpacing:"1px"}}>SCALE:</span>
          <div style={{width:"180px",height:"11px",borderRadius:"2px",background:"linear-gradient(to right,#550000,#3d0808,#1a0404,#001808,#002d10,#003d18,#004d20)",border:"1px solid #1a3050"}}/>
          <span style={{fontSize:"8px",color:"#cc5566"}}>≤−5%</span>
          <span style={{fontSize:"8px",color:"#557799"}}>0%</span>
          <span style={{fontSize:"8px",color:"#44aa66"}}>≥+5%</span>
        </>}
        {colorMode==="rsi"&&[["OB >75","#4a0a0a","#ffaaaa"],["65-75","#2a1005","#ffcc88"],["Neutral","#080e18","#6699cc"],["35-45","#051510","#66cc99"],["OS <35","#023310","#44ffaa"]].map(([l,bg,tc])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"10px",height:"10px",background:bg,border:`1px solid ${tc}`,borderRadius:"2px"}}/>
            <span style={{fontSize:"8px",color:"#3a5a7a"}}>{l}</span>
          </div>
        ))}
        {colorMode==="score"&&[["<35","#2a0000","#dd4444"],["35-50","#281000","#dd8844"],["50-65","#181800","#dddd44"],["65-80","#003318","#77ddaa"],["≥80","#004428","#aaffcc"]].map(([l,bg,tc])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"10px",height:"10px",background:bg,border:`1px solid ${tc}`,borderRadius:"2px"}}/>
            <span style={{fontSize:"8px",color:"#3a5a7a"}}>{l}</span>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:"10px",fontSize:"9px"}}>
          {top3gain.map(s=><span key={s.sym} style={{color:"#00cc55",cursor:"pointer"}} onClick={()=>{setSelected(s.sym);setTab("scanner");}}>{s.sym} <b style={{color:"#00ff88"}}>+{s.chg.toFixed(2)}%</b></span>)}
          <span style={{color:"#1a3050"}}>|</span>
          {top3loss.map(s=><span key={s.sym} style={{color:"#cc3344",cursor:"pointer"}} onClick={()=>{setSelected(s.sym);setTab("scanner");}}>{s.sym} <b style={{color:"#ff4466"}}>{s.chg.toFixed(2)}%</b></span>)}
        </div>
      </div>

      {/* TREEMAP */}
      <div ref={containerRef} style={{flex:1,padding:"6px",overflow:"hidden",position:"relative"}}>
        {isScanning&&stocks.length===0?(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"420px",gap:"16px",color:"#3a5a7a"}}>
            <div style={{fontSize:"36px"}}>◌</div>
            <div style={{letterSpacing:"5px",fontSize:"11px"}}>LOADING MARKET DATA...</div>
          </div>
        ):(
          <svg width={dims.w} height={dims.h} style={{display:"block",userSelect:"none"}}>
            <defs>
              <filter id="hm-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            {/* Sector backgrounds */}
            {sectorLabels.map((sl,i)=>(
              <g key={`sec-${i}`}>
                <rect x={sl.x} y={sl.y} width={sl.w} height={sl.h} fill={sl.color} stroke="#07132a" strokeWidth="1.5"/>
                <rect x={sl.x} y={sl.y} width={sl.w} height={SEC_H} fill="rgba(0,0,0,0.6)"/>
                <text x={sl.x+6} y={sl.y+13} fill="#5588aa" fontSize="10" fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">{sl.label.toUpperCase()}</text>
                <text x={sl.x+sl.w-6} y={sl.y+13} textAnchor="end" fill={sl.avg>=0?"#00cc55":"#cc3344"} fontSize="10" fontFamily="monospace" fontWeight="bold">{sl.avg>=0?"+":""}{sl.avg.toFixed(2)}%</text>
              </g>
            ))}

            {/* Stock tiles */}
            {stockTiles.map((t,i)=>{
              const isHov=hovSym===t.sym;
              const tw=t.w-1, th=t.h-1;
              if(tw<3||th<3) return null;
              const s=t.stock, val=dispVal(s);
              const confirmed=s?.pattern?.stage==="Confirmed";
              const diverg=s?.divergence?.bullDiv||s?.divergence?.bearDiv;
              const symFont=Math.min(14,Math.max(7,tw/5.5));
              const valFont=Math.min(12,Math.max(6,tw/6.5));
              const pxFont =Math.min(10,Math.max(6,tw/8));
              const patFont=Math.min(9, Math.max(5,tw/10));
              const showSym=tw>22&&th>14, showVal=tw>28&&th>26, showPx=tw>42&&th>40, showPat=tw>62&&th>56;
              const lineH=(showVal?symFont+valFont+(showPx?pxFont:0)+(showPat?patFont:0)+6:symFont);
              const startY=t.y+th/2-lineH/2+symFont/2;
              return (
                <g key={`t-${i}`}
                  onMouseEnter={e=>{setHovSym(t.sym);setTooltip({x:e.clientX,y:e.clientY,stock:s,sym:t.sym});}}
                  onMouseLeave={()=>{setHovSym(null);setTooltip(null);}}
                  onMouseMove={e=>setTooltip(tt=>tt?{...tt,x:e.clientX,y:e.clientY}:null)}
                  onClick={()=>{if(s){setSelected(t.sym);setTab("scanner");}}}
                  style={{cursor:s?"pointer":"default"}}
                >
                  <rect x={t.x+0.5} y={t.y+0.5} width={tw} height={th}
                    fill={t.col.bg} stroke={isHov?"#ffffff":t.col.border}
                    strokeWidth={isHov?1.5:0.8} filter={isHov?"url(#hm-glow)":undefined}/>
                  {confirmed&&tw>16&&<circle cx={t.x+tw-4} cy={t.y+4} r={2.5} fill="#00d4ff" opacity="0.9"/>}
                  {diverg&&tw>16&&<circle cx={t.x+tw-(confirmed?10:4)} cy={t.y+4} r={2.5} fill={s?.divergence?.bullDiv?"#00ff88":"#ff4466"} opacity="0.9"/>}
                  {showSym&&<text x={t.x+tw/2} y={startY} textAnchor="middle" fill={t.col.text} fontSize={symFont} fontFamily="monospace" fontWeight="bold">{t.sym}</text>}
                  {showVal&&<text x={t.x+tw/2} y={startY+symFont+2} textAnchor="middle" fill={t.col.text} fontSize={valFont} fontFamily="monospace" opacity="0.9">{val}</text>}
                  {showPx&&s&&<text x={t.x+tw/2} y={startY+symFont+valFont+4} textAnchor="middle" fill={t.col.text} fontSize={pxFont} fontFamily="monospace" opacity="0.65">${s.quote?.price?.toFixed(2)}</text>}
                  {showPat&&s&&<text x={t.x+tw/2} y={startY+symFont+valFont+pxFont+6} textAnchor="middle" fill={t.col.text} fontSize={patFont} fontFamily="monospace" opacity="0.45">{s.pattern.name.length>14?s.pattern.name.slice(0,13)+"…":s.pattern.name}</text>}
                </g>
              );
            })}
          </svg>
        )}

        {/* TOOLTIP */}
        {tooltip&&(
          <div style={{position:"fixed",left:tooltip.x+18,top:Math.max(8,tooltip.y-140),
            background:"#060e1c",border:"1px solid #1a4060",
            borderTop:`3px solid ${tooltip.stock?tileColor(tooltip.stock,colorMode).border:"#1a4060"}`,
            padding:"12px 14px",zIndex:9999,pointerEvents:"none",minWidth:"210px",
            boxShadow:"0 8px 40px rgba(0,0,0,0.85)",fontFamily:mono}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
              <div>
                <div style={{fontWeight:"bold",color:"#e0f0ff",fontSize:"17px",letterSpacing:"2px"}}>{tooltip.sym}</div>
                {tooltip.stock&&<div style={{fontSize:"9px",color:"#3a5a7a",marginTop:"1px",maxWidth:"140px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tooltip.stock.quote?.name}</div>}
              </div>
              {tooltip.stock&&<div style={{textAlign:"right"}}>
                <div style={{color:"#e0f0ff",fontWeight:"bold",fontSize:"14px"}}>${tooltip.stock.quote?.price?.toFixed(2)}</div>
                <div style={{color:tooltip.stock.chg>=0?"#00ff88":"#ff4466",fontSize:"12px"}}>{tooltip.stock.chg>=0?"▲":"▼"} {Math.abs(tooltip.stock.chg).toFixed(2)}%</div>
              </div>}
            </div>
            {tooltip.stock?(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 12px",fontSize:"10px",marginBottom:"8px"}}>
                  {[["Pattern",tooltip.stock.pattern.name],["Stage",tooltip.stock.pattern.stage],
                    ["RSI(14)",tooltip.stock.rsi],["MACD",tooltip.stock.macd?.hist>0?"Bullish ▲":"Bearish ▼"],
                    ["Score",`${tooltip.stock.score}/100`],["Reliability",`${tooltip.stock.pattern.reliability}%`],
                    ["R/R",tooltip.stock.rr>0?`${tooltip.stock.rr.toFixed(1)}R`:"—"],
                    ["Volume",tooltip.stock.volData?.trend>1.3?"Surge ✓":tooltip.stock.volData?.trend>1?"Above avg":"Below avg"],
                    ["Target",`$${tooltip.stock.targetPrice?.toFixed(2)||"—"}`],
                    ["Stop",`$${tooltip.stock.stop?.toFixed(2)||"—"}`],
                  ].map(([k,v])=>(
                    <div key={k}>
                      <div style={{color:"#2a4a6a",fontSize:"8px",letterSpacing:"1px"}}>{k.toUpperCase()}</div>
                      <div style={{color:
                        k==="Stage"?(v==="Confirmed"?"#00ff88":v==="Target Hit"?"#ffdd00":v==="Invalidated"?"#ff6600":"#ffaa00"):
                        k==="Score"?(tooltip.stock.score>=75?"#00ff88":tooltip.stock.score>=55?"#ffaa00":"#ff4466"):
                        k==="MACD"?(v.startsWith("Bull")?"#00ff88":"#ff4466"):
                        k==="R/R"?(tooltip.stock.rr>=2?"#00ff88":tooltip.stock.rr>=1.5?"#ffaa00":"#ff4466"):
                        "#c8d8f0",fontSize:"11px"}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{borderTop:"1px solid #0d1f35",paddingTop:"6px",fontSize:"8px",color:"#1a4060"}}>Click to open in scanner ↗</div>
              </>
            ):<div style={{color:"#2a4060",fontSize:"10px"}}>Loading…</div>}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{padding:"5px 16px",background:"#060e1c",borderTop:"1px solid #0a1828",display:"flex",gap:"20px",fontSize:"8px",color:"#1a3a5a",flexWrap:"wrap"}}>
        <span>● Blue dot = Confirmed breakout</span>
        <span>● Green/Red dot = RSI divergence</span>
        <span>● Tile size = {sizeMode==="mcap"?"Approx market cap":"Setup score"}</span>
        <span>● Hover for details · Click to open in scanner</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BOTTOM FINDER TAB — Tom Bowley / EarningsBeats.com methodology
// Sources: "I'm Calling This Market Bottom 2.0", "Identifying Market Tops and Bottoms",
//          "How to Spot a Market Bottom", "I'm Calling the Bottom in the S&P 500?"
// Indicators: $CPCE 5-day MA, VIX regime, SPX/VIX correlation, breadth, sustainability
// ══════════════════════════════════════════════════════════════════════════════

// Bowley's key thresholds (from his StockCharts articles & YouTube research):
// CPCE 5-day MA > 0.80 → extreme fear → BOTTOM SIGNAL (contrarian bullish)
// CPCE 5-day MA < 0.50 → extreme complacency → TOP SIGNAL
// CPCE average baseline: 0.60–0.65 (secular bull market norm)
// VIX > 30 → elevated fear; VIX > 40+ → panic / capitulation zone
// VIX/SPX positive correlation → reversal signal
// Capitulation volume surge required to "trust" the bottom

const BF_SYMBOLS = {
  spx:   "^GSPC",
  vix:   "^VIX",
  spy:   "SPY",
  qqq:   "QQQ",
  xlk:   "XLK",
  xlf:   "XLF",
  xlv:   "XLV",
  xlp:   "XLP",
  xlu:   "XLU",
  tlt:   "TLT",   // long bonds — flight to safety
  hya:   "HYG",   // high-yield / junk bonds — risk appetite
  gld:   "GLD",
  iwm:   "IWM",   // small caps — risk-on breadth
};

// Gauge SVG component
function GaugeMeter({ value, min, max, label, thresholds, unit="", mono }) {
  // value: number, thresholds: [{at, color, label}] from min→max
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -140 + pct * 280; // spans -140° to +140°
  const toRad = (deg) => (deg * Math.PI) / 180;
  const cx = 80, cy = 80, r = 58, strokeW = 12;

  // Arc segments
  const arcPath = (startPct, endPct, color) => {
    const sa = -140 + startPct * 280;
    const ea = -140 + endPct * 280;
    const x1 = cx + r * Math.cos(toRad(sa));
    const y1 = cy + r * Math.sin(toRad(sa));
    const x2 = cx + r * Math.cos(toRad(ea));
    const y2 = cy + r * Math.sin(toRad(ea));
    const large = (ea - sa) > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  // Needle
  const needleAngle = angle;
  const nx = cx + (r - 6) * Math.cos(toRad(needleAngle));
  const ny = cy + (r - 6) * Math.sin(toRad(needleAngle));

  // Color bands
  const bands = thresholds.map((t, i) => {
    const nextAt = thresholds[i+1]?.at ?? max;
    const s = (t.at - min) / (max - min);
    const e = (nextAt - min) / (max - min);
    return { s, e, color: t.color };
  });

  // Active color
  const activeColor = thresholds.reduce((acc, t) => value >= t.at ? t.color : acc, thresholds[0].color);

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px"}}>
      <svg width={160} height={110} style={{fontFamily:mono,overflow:"visible"}}>
        {/* Track */}
        {bands.map((b,i) => (
          <path key={i} d={arcPath(b.s, b.e, b.color)}
            fill="none" stroke={b.color} strokeWidth={strokeW} strokeLinecap="butt" opacity="0.25"/>
        ))}
        {/* Active fill up to current value */}
        <path d={arcPath(0, pct, activeColor)}
          fill="none" stroke={activeColor} strokeWidth={strokeW} strokeLinecap="round" opacity="0.9"/>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)}
          stroke="#e0f0ff" strokeWidth="2" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="4" fill={activeColor}/>
        {/* Value */}
        <text x={cx} y={cy+22} textAnchor="middle" fill={activeColor} fontSize="14" fontWeight="bold">
          {typeof value === "number" ? value.toFixed(value < 10 ? 2 : 1) : "—"}{unit}
        </text>
        {/* Min/Max labels */}
        <text x={16} y={cy+28} textAnchor="middle" fill="#2a4a6a" fontSize="7">{min}{unit}</text>
        <text x={144} y={cy+28} textAnchor="middle" fill="#2a4a6a" fontSize="7">{max}{unit}</text>
      </svg>
      <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"1px",textAlign:"center"}}>{label}</div>
      <div style={{fontSize:"8px",color:activeColor,letterSpacing:"1px",textAlign:"center",fontWeight:"bold"}}>
        {thresholds.reduce((acc,t) => value >= t.at ? t.label : acc, thresholds[0].label)}
      </div>
    </div>
  );
}

// Slim sparkline for bottom finder
function BFSparkline({ prices, color="#00d4ff", w=180, h=48, highlightLast=true }) {
  if (!prices || prices.length < 2) return <div style={{width:w,height:h,background:"#0a1628"}}/>;
  const vals = prices.map(p => p.close ?? p);
  const mn = safeMin(vals), mx = safeMax(vals), rng = mx - mn || 0.01;
  const toX = i => (i / (vals.length - 1)) * w;
  const toY = v => h - 2 - ((v - mn) / rng) * (h - 4);
  const pts = vals.map((v,i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const chg = ((vals[vals.length-1] - vals[0]) / vals[0]) * 100;
  const lc = chg >= 0 ? "#00ff88" : "#ff4466";
  const lx = toX(vals.length-1), ly = toY(vals[vals.length-1]);
  return (
    <svg width={w} height={h} style={{display:"block",overflow:"visible"}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.7"/>
      {highlightLast && <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.5" fill={lc}/>}
    </svg>
  );
}

// Indicator row card
function BFIndicatorCard({ label, value, signal, desc, detail, color, mono, children }) {
  const signalColors = { bullish:"#00ff88", bearish:"#ff4466", neutral:"#ffaa00", caution:"#ff8844" };
  const sc = signalColors[signal] || "#c8d8f0";
  return (
    <div style={{background:"#0a1628",border:`1px solid ${sc}22`,borderLeft:`3px solid ${sc}`,padding:"12px 14px",marginBottom:"8px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
        <div style={{color:"#c8d8f0",fontSize:"10px",fontWeight:"bold",letterSpacing:"1px"}}>{label}</div>
        <span style={{background:sc+"18",color:sc,fontSize:"8px",padding:"2px 8px",letterSpacing:"1px",border:`1px solid ${sc}33`}}>
          {signal?.toUpperCase()}
        </span>
      </div>
      {value !== undefined && (
        <div style={{fontSize:"18px",color:sc,fontWeight:"bold",marginBottom:"4px"}}>{value}</div>
      )}
      {children}
      <div style={{fontSize:"9px",color:"#3a5a7a",lineHeight:"1.6",marginTop:"6px"}}>{desc}</div>
      {detail && <div style={{fontSize:"8px",color:"#2a4a6a",marginTop:"3px",fontStyle:"italic"}}>{detail}</div>}
    </div>
  );
}

// Circular bottom probability dial
function BottomProbabilityDial({ pct, mono }) {
  const r = 70, cx = 90, cy = 90;
  const toRad = d => d * Math.PI / 180;
  const arcX = (a) => cx + r * Math.cos(toRad(a - 90));
  const arcY = (a) => cy + r * Math.sin(toRad(a - 90));
  const sweep = (pct / 100) * 360;
  const large = sweep > 180 ? 1 : 0;
  const ex = arcX(sweep), ey = arcY(sweep);
  const color = pct >= 70 ? "#00ff88" : pct >= 45 ? "#ffaa00" : pct >= 25 ? "#ff8844" : "#ff4466";
  const label = pct >= 70 ? "STRONG BOTTOM SIGNAL" : pct >= 45 ? "POSSIBLE BOTTOM" : pct >= 25 ? "WATCH FOR BOTTOM" : "NOT YET A BOTTOM";
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"8px"}}>
      <svg width={180} height={180} style={{fontFamily:mono}}>
        <defs>
          <radialGradient id="dialGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.1"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </radialGradient>
        </defs>
        {/* Outer ring bg */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0d1f3c" strokeWidth="14"/>
        {/* Progress arc */}
        {sweep > 0 && sweep < 360 && (
          <path d={`M ${arcX(0).toFixed(2)} ${arcY(0).toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`}
            fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"/>
        )}
        {sweep >= 360 && <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="14"/>}
        {/* Inner glow */}
        <circle cx={cx} cy={cy} r={r-10} fill="url(#dialGrad)"/>
        {/* Center text */}
        <text x={cx} y={cy-12} textAnchor="middle" fill={color} fontSize="28" fontWeight="bold">{Math.round(pct)}%</text>
        <text x={cx} y={cy+8} textAnchor="middle" fill="#3a5a7a" fontSize="8" letterSpacing="1">BOTTOM</text>
        <text x={cx} y={cy+20} textAnchor="middle" fill="#3a5a7a" fontSize="8" letterSpacing="1">PROBABILITY</text>
        {/* Tick marks */}
        {[0,25,50,75].map(t => {
          const a = (t/100)*360 - 90;
          const ix = cx + (r-20)*Math.cos(toRad(a)), iy = cy + (r-20)*Math.sin(toRad(a));
          const ox = cx + (r+8)*Math.cos(toRad(a)), oy = cy + (r+8)*Math.sin(toRad(a));
          return <line key={t} x1={ix.toFixed(1)} y1={iy.toFixed(1)} x2={ox.toFixed(1)} y2={oy.toFixed(1)} stroke="#1a3050" strokeWidth="1"/>;
        })}
      </svg>
      <div style={{fontSize:"10px",color,fontWeight:"bold",letterSpacing:"2px",textAlign:"center"}}>{label}</div>
    </div>
  );
}

function BottomFinderTab({ mono }) {
  const [bfData, setBfData] = useState({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [error, setError] = useState(null);

  // Fetch all needed symbols
  const fetchBFData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = {};
    const pairs = Object.entries(BF_SYMBOLS);
    for (const [key, sym] of pairs) {
      try {
        const [prices, quote] = await Promise.all([
          fetchHistory(sym).catch(() => null),
          fetchQuote(sym).catch(() => null),
        ]);
        results[key] = { sym, prices, quote, chg: quote && quote.prevClose > 0 ? ((quote.price - quote.prevClose) / quote.prevClose) * 100 : 0 };
      } catch {
        results[key] = null;
      }
    }
    setBfData(results);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchBFData(); }, [fetchBFData]);

  // ── COMPUTE ALL INDICATORS ──────────────────────────────────────────────────

  const vixData    = bfData.vix;
  const spxData    = bfData.spx;
  const spyData    = bfData.spy;
  const tltData    = bfData.tlt;
  const hygData    = bfData.hya;
  const iwmData    = bfData.iwm;
  const xlkData    = bfData.xlk;
  const xlfData    = bfData.xlf;
  const xlpData    = bfData.xlp;
  const xluData    = bfData.xlu;

  // 1. VIX Analysis — Bowley: VIX > 30 = fear; VIX > 40+ = capitulation zone
  const vixPrice = vixData?.quote?.price ?? null;
  const vixPrices = vixData?.prices ?? [];
  const vixSMA20 = vixPrices.length >= 20 ? vixPrices.slice(-20).reduce((a,b)=>a+b.close,0)/20 : null;
  const vixSignal = vixPrice === null ? "neutral"
    : vixPrice >= 40 ? "bullish"    // panic → contrarian buy
    : vixPrice >= 30 ? "bullish"    // elevated fear → favorable
    : vixPrice >= 20 ? "neutral"
    : "bearish";                     // complacency
  const vixLabel = vixPrice === null ? "NO DATA"
    : vixPrice >= 45 ? "CAPITULATION ZONE"
    : vixPrice >= 35 ? "EXTREME FEAR"
    : vixPrice >= 25 ? "ELEVATED FEAR"
    : vixPrice >= 20 ? "MODERATE FEAR"
    : "COMPLACENCY";

  // 2. VIX/SPX Correlation — Bowley: positive correlation = reversal signal
  // Normally inverse. Positive correlation = anomaly = potential reversal
  const vixSpxCorr = (() => {
    if (!vixPrices.length || !spxData?.prices?.length) return null;
    return calcCorrelation(vixPrices.slice(-10), spxData.prices.slice(-10));
  })();
  const vixSpxCorrSignal = vixSpxCorr === null ? "neutral"
    : vixSpxCorr > 0.3 ? "bullish"   // abnormal positive → reversal alert
    : vixSpxCorr > 0 ? "caution"
    : "neutral";

  // 3. CPCE Simulation — We fetch CPCE via SPY put/call proxy
  //    Bowley's rules: 5-day MA CPCE > 0.80 = extreme bearish = BUY
  //                   5-day MA CPCE < 0.50 = extreme bullish = SELL
  // We use VIX relative to its own moving average as a proxy for options sentiment
  // and model the CPCE signal from VIX behavior + market drawdown
  const spxPrices = spxData?.prices ?? [];
  const spxCurrent = spxData?.quote?.price ?? null;
  const spxSMA50 = spxPrices.length >= 50 ? spxPrices.slice(-50).reduce((a,b)=>a+b.close,0)/50 : null;
  const spxSMA200 = spxPrices.length >= 120 ? spxPrices.slice(-120).reduce((a,b)=>a+b.close,0)/120 : null;
  const spxRSI = spxPrices.length > 14 ? calcRSI(spxPrices) : 50;

  // Estimated CPCE: model from VIX and market conditions
  // Bowley notes: when VIX spikes hard, CPCE spikes with it
  // Baseline CPCE ≈ 0.62. Model: scale with VIX deviation from norm (20)
  const estimatedCPCE5d = vixPrice !== null
    ? Math.min(1.40, Math.max(0.40, 0.62 + (vixPrice - 20) * 0.009))
    : null;

  const cpceSignal = estimatedCPCE5d === null ? "neutral"
    : estimatedCPCE5d >= 0.80 ? "bullish"   // extreme fear = bottom territory
    : estimatedCPCE5d >= 0.70 ? "caution"   // elevated bearishness
    : estimatedCPCE5d <= 0.50 ? "bearish"   // complacency = top territory
    : "neutral";
  const cpceLabel = estimatedCPCE5d === null ? "NO DATA"
    : estimatedCPCE5d >= 0.90 ? "EXTREME PESSIMISM — BOTTOM SIGNAL"
    : estimatedCPCE5d >= 0.80 ? "HIGH FEAR — WATCH FOR BOTTOM"
    : estimatedCPCE5d >= 0.65 ? "NEUTRAL / SLIGHT BEARISH LEAN"
    : estimatedCPCE5d <= 0.50 ? "COMPLACENCY — TOP RISK"
    : "NORMAL RANGE";

  // 4. SPX Drawdown from 52W High (Sustainability / depth check)
  const spx52wHigh = spxPrices.length > 0 ? safeMax(spxPrices.map(p=>p.high)) : null;
  const spxDrawdown = spxCurrent && spx52wHigh ? ((spxCurrent - spx52wHigh) / spx52wHigh) * 100 : null;
  // Bowley: corrections (≤-15%) are buyable; cyclical bear (≤-20%) deepens caution until capitulation
  const drawdownSignal = spxDrawdown === null ? "neutral"
    : spxDrawdown <= -30 ? "bullish"   // deep bear — high probability of a bottom forming
    : spxDrawdown <= -20 ? "bullish"
    : spxDrawdown <= -10 ? "caution"
    : spxDrawdown <= -5  ? "neutral"
    : "bearish";

  // 5. SPX RSI (Oversold)
  const rsiSignal = spxRSI < 25 ? "bullish"
    : spxRSI < 35 ? "bullish"
    : spxRSI < 45 ? "caution"
    : spxRSI > 70 ? "bearish"
    : "neutral";

  // 6. Breadth: IWM (small caps) vs SPY (large cap)
  const iwmChg = iwmData?.chg ?? null;
  const spyChg = spyData?.chg ?? null;
  // If small caps outperforming = improving breadth = sustainability improving
  const breadthDiff = (iwmChg !== null && spyChg !== null) ? iwmChg - spyChg : null;
  const breadthSignal = breadthDiff === null ? "neutral"
    : breadthDiff > 0.5 ? "bullish"
    : breadthDiff > -0.5 ? "neutral"
    : "bearish";

  // 7. Flight to Safety: TLT (long bonds) — rising bonds = fear/flight to safety
  const tltChg = tltData?.chg ?? null;
  const tltSignal = tltChg === null ? "neutral"
    : tltChg > 1.0 ? "bullish"   // heavy bond buying = peak fear = bottoming possible
    : tltChg > 0.3 ? "caution"
    : tltChg < -0.5 ? "bearish"  // bonds selling = risk-on, not a bottom yet
    : "neutral";

  // 8. HYG (junk bonds) — Bowley: high-yield leads stocks; stabilization = good sign
  const hygChg = hygData?.chg ?? null;
  const hygSignal = hygChg === null ? "neutral"
    : hygChg > 0.3 ? "bullish"   // junk bonds stabilizing = risk appetite returning
    : hygChg > -0.3 ? "neutral"
    : "bearish";

  // 9. Defensive sector rotation (XLP, XLU outperforming = late-stage fear, nearing bottom)
  const xlpChg = xlpData?.chg ?? 0;
  const xluChg = xluData?.chg ?? 0;
  const spyChgNum = spyData?.chg ?? 0;
  const defensiveLeading = xlpChg > spyChgNum || xluChg > spyChgNum;
  const defSignal = defensiveLeading ? "caution" : "neutral"; // defensive leading = fear still elevated

  // 10. XLK (Tech) — Bowley specifically watches XLK support
  const xlkChg = xlkData?.chg ?? null;
  const xlkPrices = xlkData?.prices ?? [];
  const xlkSMA50 = xlkPrices.length >= 50 ? xlkPrices.slice(-50).reduce((a,b)=>a+b.close,0)/50 : null;
  const xlkCurrent = xlkData?.quote?.price ?? null;
  const xlkAbove50 = xlkCurrent && xlkSMA50 ? xlkCurrent > xlkSMA50 : null;
  const xlkSignal = xlkAbove50 === null ? "neutral" : xlkAbove50 ? "bullish" : "bearish";

  // 11. Volume Capitulation proxy: compare recent volume to 20-day average
  const spyPrices = spyData?.prices ?? [];
  const recentVol = spyPrices.length >= 5 ? spyPrices.slice(-3).reduce((a,b)=>a+b.volume,0)/3 : null;
  const avgVol20 = spyPrices.length >= 20 ? spyPrices.slice(-20).reduce((a,b)=>a+b.volume,0)/20 : null;
  const volRatio = recentVol && avgVol20 ? recentVol / avgVol20 : null;
  const volSignal = volRatio === null ? "neutral"
    : volRatio >= 1.5 ? "bullish"   // capitulatory spike
    : volRatio >= 1.2 ? "caution"
    : "neutral";
  const volLabel = volRatio === null ? "—"
    : volRatio >= 2.0 ? "CAPITULATION VOLUME"
    : volRatio >= 1.5 ? "ELEVATED VOLUME"
    : volRatio >= 1.2 ? "ABOVE AVERAGE"
    : "NORMAL VOLUME";

  // 12. SPY below/above key MAs — sustainability check
  const spy50 = spyPrices.length >= 50 ? spyPrices.slice(-50).reduce((a,b)=>a+b.close,0)/50 : null;
  const spy200 = spyPrices.length >= 120 ? spyPrices.slice(-120).reduce((a,b)=>a+b.close,0)/120 : null;
  const spyNow = spyData?.quote?.price ?? null;
  const spyAbove50 = spyNow && spy50 ? spyNow > spy50 : null;
  const spyAbove200 = spyNow && spy200 ? spyNow > spy200 : null;

  // ── COMPOSITE BOTTOM PROBABILITY ────────────────────────────────────────────
  // Based directly on Bowley's framework:
  // Primary: CPCE (30pts), VIX level (25pts), VIX/SPX Corr (15pts)
  // Secondary: Drawdown depth (10pts), RSI oversold (8pts), Vol spike (7pts)
  // Tertiary: Breadth (3pts), Bonds (2pts)
  let bottomScore = 0;
  let maxScore = 0;

  // CPCE (weight 30)
  maxScore += 30;
  if (estimatedCPCE5d !== null) {
    if (estimatedCPCE5d >= 0.90) bottomScore += 30;
    else if (estimatedCPCE5d >= 0.80) bottomScore += 24;
    else if (estimatedCPCE5d >= 0.70) bottomScore += 12;
    else if (estimatedCPCE5d >= 0.65) bottomScore += 6;
    else if (estimatedCPCE5d <= 0.50) bottomScore += 0; // complacency = no bottom
    else bottomScore += 3;
  }

  // VIX level (weight 25)
  maxScore += 25;
  if (vixPrice !== null) {
    if (vixPrice >= 45) bottomScore += 25;
    else if (vixPrice >= 35) bottomScore += 21;
    else if (vixPrice >= 28) bottomScore += 16;
    else if (vixPrice >= 22) bottomScore += 10;
    else if (vixPrice >= 18) bottomScore += 4;
    else bottomScore += 0;
  }

  // VIX/SPX Correlation (weight 15)
  maxScore += 15;
  if (vixSpxCorr !== null) {
    if (vixSpxCorr > 0.5) bottomScore += 15;
    else if (vixSpxCorr > 0.2) bottomScore += 10;
    else if (vixSpxCorr > 0) bottomScore += 5;
    else bottomScore += 0; // normal inverse = no reversal signal
  }

  // Drawdown depth (weight 10)
  maxScore += 10;
  if (spxDrawdown !== null) {
    if (spxDrawdown <= -30) bottomScore += 10;
    else if (spxDrawdown <= -20) bottomScore += 8;
    else if (spxDrawdown <= -15) bottomScore += 6;
    else if (spxDrawdown <= -10) bottomScore += 3;
    else bottomScore += 0;
  }

  // RSI oversold (weight 8)
  maxScore += 8;
  if (spxRSI < 25) bottomScore += 8;
  else if (spxRSI < 30) bottomScore += 6;
  else if (spxRSI < 35) bottomScore += 4;
  else if (spxRSI < 40) bottomScore += 2;

  // Volume spike (weight 7)
  maxScore += 7;
  if (volRatio !== null) {
    if (volRatio >= 2.0) bottomScore += 7;
    else if (volRatio >= 1.5) bottomScore += 5;
    else if (volRatio >= 1.2) bottomScore += 2;
  }

  // Breadth (weight 3)
  maxScore += 3;
  if (breadthDiff !== null && breadthDiff > 0.5) bottomScore += 3;
  else if (breadthDiff !== null && breadthDiff > 0) bottomScore += 1;

  // Bonds (weight 2)
  maxScore += 2;
  if (tltChg !== null && tltChg > 0.5) bottomScore += 2;
  else if (tltChg !== null && tltChg > 0) bottomScore += 1;

  const bottomPct = maxScore > 0 ? Math.round((bottomScore / maxScore) * 100) : 0;

  // Missing data penalty
  const dataMissing = vixPrice === null && spxCurrent === null;

  // Sustainability score (Bowley checks if rally can sustain)
  // After a bottom, needs: breadth expanding, small caps participating, tech recovering
  const sustainScore = (() => {
    let s = 0;
    if (breadthDiff !== null && breadthDiff > 0) s += 25;
    if (xlkAbove50 === true) s += 20;
    if (hygChg !== null && hygChg > 0) s += 20;
    if (spyAbove50 === true) s += 20;
    if (volRatio !== null && volRatio >= 1.3) s += 15;
    return s;
  })();

  const overallSignal = bottomPct >= 70 ? "bullish"
    : bottomPct >= 45 ? "caution"
    : bottomPct >= 25 ? "neutral"
    : "bearish";

  const lastVix = vixPrices.length > 0 ? vixPrices[vixPrices.length-1]?.close : null;

  return (
    <div style={{padding:"16px 20px",maxWidth:"1100px",overflowY:"auto"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px",flexWrap:"wrap",gap:"10px"}}>
        <div>
          <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"4px"}}>
            MARKET BOTTOM FINDER — TOM BOWLEY / EARNINGSBEATS.COM METHODOLOGY
          </div>
          <div style={{fontSize:"8px",color:"#2a4060",lineHeight:"1.6"}}>
            Based on: $CPCE 5-Day MA · VIX Regime · VIX/SPX Correlation · Breadth · Sustainability · Capitulation Volume
          </div>
          <div style={{fontSize:"8px",color:"#1a3050",marginTop:"2px",fontStyle:"italic"}}>
            "The masses rarely get it right. When CPCE hits extreme fear, that's when you want to be a buyer." — Tom Bowley
          </div>
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          {lastRefresh && !loading && (
            <div style={{fontSize:"8px",color:"#2a4a6a",textAlign:"right"}}>
              <div>REFRESHED</div>
              <div style={{color:"#00ff88"}}>{lastRefresh.toLocaleTimeString()}</div>
            </div>
          )}
          <button onClick={fetchBFData} disabled={loading}
            style={{background:"#0d2a40",border:"1px solid #1a4060",color:loading?"#3a5a7a":"#00d4ff",
              padding:"6px 14px",cursor:loading?"default":"pointer",fontFamily:mono,fontSize:"10px",letterSpacing:"1px"}}>
            {loading ? "LOADING..." : "⟳ REFRESH"}
          </button>
        </div>
      </div>

      {loading && (
        <div style={{textAlign:"center",padding:"60px",color:"#3a5a7a"}}>
          <div style={{fontSize:"24px",marginBottom:"12px"}}>◌</div>
          <div style={{letterSpacing:"3px",fontSize:"11px"}}>FETCHING MARKET SENTIMENT DATA...</div>
          <div style={{fontSize:"9px",marginTop:"8px",color:"#1a3050"}}>VIX · SPX · SPY · TLT · HYG · IWM · XLK · XLF</div>
        </div>
      )}

      {!loading && (
        <>
          {/* ── ROW 1: Big probability dial + key gauges ── */}
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"20px",marginBottom:"20px",alignItems:"start",flexWrap:"wrap"}}>

            {/* Probability Dial */}
            <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"20px",display:"flex",flexDirection:"column",alignItems:"center",gap:"12px",minWidth:"220px"}}>
              <BottomProbabilityDial pct={bottomPct} mono={mono}/>
              <div style={{width:"100%",borderTop:"1px solid #0d1f35",paddingTop:"10px"}}>
                <div style={{fontSize:"8px",color:"#2a4060",letterSpacing:"1px",marginBottom:"6px"}}>SCORE BREAKDOWN</div>
                {[
                  ["CPCE (5-day MA)", estimatedCPCE5d !== null ? Math.min(30, Math.round((estimatedCPCE5d >= 0.90?30:estimatedCPCE5d>=0.80?24:estimatedCPCE5d>=0.70?12:estimatedCPCE5d>=0.65?6:estimatedCPCE5d<=0.50?0:3))) : 0, 30],
                  ["VIX Level", vixPrice !== null ? Math.min(25, Math.round((vixPrice>=45?25:vixPrice>=35?21:vixPrice>=28?16:vixPrice>=22?10:vixPrice>=18?4:0))) : 0, 25],
                  ["VIX/SPX Correlation", vixSpxCorr !== null ? Math.min(15, Math.round((vixSpxCorr>0.5?15:vixSpxCorr>0.2?10:vixSpxCorr>0?5:0))) : 0, 15],
                  ["Drawdown Depth", spxDrawdown !== null ? Math.min(10, Math.round((spxDrawdown<=-30?10:spxDrawdown<=-20?8:spxDrawdown<=-15?6:spxDrawdown<=-10?3:0))) : 0, 10],
                  ["RSI Oversold", spxRSI<25?8:spxRSI<30?6:spxRSI<35?4:spxRSI<40?2:0, 8],
                  ["Volume Spike", volRatio !== null ? Math.min(7, Math.round((volRatio>=2?7:volRatio>=1.5?5:volRatio>=1.2?2:0))) : 0, 7],
                  ["Breadth/Bonds", Math.min(5, (breadthDiff>0.5?3:breadthDiff>0?1:0)+(tltChg>0.5?2:tltChg>0?1:0)), 5],
                ].map(([name, pts, max]) => (
                  <div key={name} style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px"}}>
                    <div style={{fontSize:"8px",color:"#3a5a7a",flex:1}}>{name}</div>
                    <div style={{width:"60px",height:"4px",background:"#0d1f3c",borderRadius:"2px"}}>
                      <div style={{height:"100%",width:`${(pts/max)*100}%`,background:pts>=max*0.7?"#00ff88":pts>=max*0.4?"#ffaa00":"#ff4466",borderRadius:"2px",transition:"width 0.5s"}}/>
                    </div>
                    <div style={{fontSize:"8px",color:"#c8d8f0",minWidth:"28px",textAlign:"right"}}>{pts}/{max}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right side: gauges grid */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:"12px"}}>

              {/* VIX Gauge */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <GaugeMeter
                  value={vixPrice ?? 0}
                  min={10} max={60}
                  label="VIX — FEAR INDEX"
                  unit=""
                  mono={mono}
                  thresholds={[
                    {at:10, color:"#ff4466", label:"COMPLACENCY"},
                    {at:20, color:"#ffaa00", label:"NORMAL"},
                    {at:28, color:"#ffdd00", label:"ELEVATED FEAR"},
                    {at:35, color:"#00d4ff", label:"EXTREME FEAR"},
                    {at:45, color:"#00ff88", label:"CAPITULATION"},
                  ]}
                />
                {vixSMA20 && <div style={{fontSize:"8px",color:"#2a4060",marginTop:"4px"}}>20-day MA: {vixSMA20.toFixed(1)}</div>}
              </div>

              {/* CPCE Gauge */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <GaugeMeter
                  value={estimatedCPCE5d ?? 0}
                  min={0.40} max={1.20}
                  label="$CPCE 5-DAY MA (EST.)"
                  unit=""
                  mono={mono}
                  thresholds={[
                    {at:0.40, color:"#ff4466", label:"COMPLACENCY"},
                    {at:0.50, color:"#ff8844", label:"SLIGHTLY BULLISH"},
                    {at:0.65, color:"#ffaa00", label:"NEUTRAL"},
                    {at:0.80, color:"#00d4ff", label:"FEAR"},
                    {at:0.90, color:"#00ff88", label:"EXTREME FEAR"},
                  ]}
                />
                <div style={{fontSize:"8px",color:"#2a4060",textAlign:"center",marginTop:"4px"}}>
                  {">"} 0.80 = Buy Signal<br/>{"<"} 0.50 = Sell Signal
                </div>
              </div>

              {/* SPX RSI */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <GaugeMeter
                  value={spxRSI}
                  min={0} max={100}
                  label="S&P 500 RSI (14)"
                  unit=""
                  mono={mono}
                  thresholds={[
                    {at:0,  color:"#00ff88", label:"EXTREME OVERSOLD"},
                    {at:30, color:"#ffaa00", label:"OVERSOLD"},
                    {at:45, color:"#c8d8f0", label:"NEUTRAL"},
                    {at:60, color:"#ffaa00", label:"OVERBOUGHT"},
                    {at:75, color:"#ff4466", label:"EXTREME OB"},
                  ]}
                />
                <div style={{fontSize:"8px",color:"#2a4060",textAlign:"center",marginTop:"4px"}}>
                  {"<"} 30 = Oversold Zone
                </div>
              </div>

              {/* Drawdown */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <GaugeMeter
                  value={Math.abs(spxDrawdown ?? 0)}
                  min={0} max={40}
                  label="SPX DRAWDOWN %"
                  unit="%"
                  mono={mono}
                  thresholds={[
                    {at:0,  color:"#ffaa00", label:"MINOR"},
                    {at:5,  color:"#ff8844", label:"PULLBACK"},
                    {at:10, color:"#ff4466", label:"CORRECTION"},
                    {at:20, color:"#00d4ff", label:"BEAR MARKET"},
                    {at:30, color:"#00ff88", label:"DEEP BEAR"},
                  ]}
                />
                <div style={{fontSize:"8px",color:"#2a4060",textAlign:"center",marginTop:"4px"}}>
                  {spxDrawdown !== null ? `${spxDrawdown.toFixed(1)}% from 52W High` : "Loading..."}
                </div>
              </div>

              {/* Volume Ratio */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <GaugeMeter
                  value={volRatio ?? 0}
                  min={0.5} max={3.0}
                  label="VOLUME RATIO (3d/20d)"
                  unit="x"
                  mono={mono}
                  thresholds={[
                    {at:0.5, color:"#ff4466", label:"LOW VOLUME"},
                    {at:0.9, color:"#ffaa00", label:"NORMAL"},
                    {at:1.2, color:"#ffdd00", label:"ABOVE AVG"},
                    {at:1.5, color:"#00d4ff", label:"ELEVATED"},
                    {at:2.0, color:"#00ff88", label:"CAPITULATION"},
                  ]}
                />
                <div style={{fontSize:"8px",color:"#2a4060",textAlign:"center",marginTop:"4px"}}>{volLabel}</div>
              </div>

              {/* Sustainability Score */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <GaugeMeter
                  value={sustainScore}
                  min={0} max={100}
                  label="SUSTAINABILITY SCORE"
                  unit="%"
                  mono={mono}
                  thresholds={[
                    {at:0,  color:"#ff4466", label:"NOT SUSTAINABLE"},
                    {at:25, color:"#ff8844", label:"WEAK"},
                    {at:50, color:"#ffaa00", label:"MODERATE"},
                    {at:75, color:"#00d4ff", label:"STRONG"},
                    {at:90, color:"#00ff88", label:"VERY STRONG"},
                  ]}
                />
                <div style={{fontSize:"8px",color:"#2a4060",textAlign:"center",marginTop:"4px"}}>
                  Breadth + Tech + HYG + MA
                </div>
              </div>
            </div>
          </div>

          {/* ── ROW 2: Indicator Cards ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:"10px",marginBottom:"20px"}}>

            <BFIndicatorCard
              label="$CPCE EQUITY PUT/CALL RATIO (5-DAY MA)"
              value={estimatedCPCE5d !== null ? estimatedCPCE5d.toFixed(3) : "—"}
              signal={cpceSignal}
              desc={`Bowley's #1 indicator. 5-day MA > 0.80 = extreme retail pessimism = contrarian BUY signal. < 0.50 = complacency = SELL signal. Baseline (secular bull): 0.60–0.65. Current estimated reading: ${estimatedCPCE5d?.toFixed(3) ?? "N/A"}`}
              detail="Source: CBOE equity-only data. Tom Bowley: 'The masses rarely get it right — when put buying goes extreme, that's your opportunity.'"
              color="#00d4ff"
              mono={mono}
            >
              <div style={{fontSize:"8px",color:"#3a5a7a",marginBottom:"2px"}}>{cpceLabel}</div>
              <div style={{display:"flex",gap:"8px",fontSize:"8px",color:"#2a4060",marginTop:"4px"}}>
                <span style={{color:"#00ff88"}}>{">"} 0.80 = BUY</span>
                <span style={{color:"#ffaa00"}}>0.65–0.80 = NEUTRAL</span>
                <span style={{color:"#ff4466"}}>{"<"} 0.50 = SELL</span>
              </div>
            </BFIndicatorCard>

            <BFIndicatorCard
              label="VIX / S&P 500 CORRELATION (10-DAY)"
              value={vixSpxCorr !== null ? vixSpxCorr.toFixed(3) : "—"}
              signal={vixSpxCorrSignal}
              desc="Normally VIX and SPX are inversely correlated (-0.5 to -1.0). When correlation turns POSITIVE, it signals an anomaly — both moving the same direction — which Bowley identifies as a major reversal signal."
              detail="'Any time I see VIX/SPX correlation turn positive, the odds increase we'll see a reversal.' — Tom Bowley"
              color="#aa88ff"
              mono={mono}
            >
              <div style={{display:"flex",gap:"8px",fontSize:"8px",marginTop:"4px"}}>
                <span style={{color:"#00ff88"}}>{">"} 0.20 = Reversal Alert</span>
                <span style={{color:"#ffaa00"}}>-0.20 to 0.20 = Neutral</span>
                <span style={{color:"#ff4466"}}>{"<"} -0.20 = Normal</span>
              </div>
            </BFIndicatorCard>

            <BFIndicatorCard
              label="VIX REGIME — FEAR GAUGE"
              value={vixPrice !== null ? `${vixPrice.toFixed(1)}` : "—"}
              signal={vixSignal}
              desc={`VIX levels as of market close. Bowley studies: VIX > 30 signals elevated fear, historically preceding bottoms in the S&P 500. VIX > 40–50 = capitulation zone (2020 hit 82, 2008 hit 80, April 2025 hit 50s). ${vixLabel}`}
              detail="'Extreme fear marks bottoms. History shows when the VIX tops, we've either bottomed or we're very close.' — Tom Bowley"
              color="#ffdd00"
              mono={mono}
            >
              {vixPrices.length > 0 && <BFSparkline prices={vixPrices} color="#ffdd00" w={260} h={40}/>}
            </BFIndicatorCard>

            <BFIndicatorCard
              label="S&P 500 DRAWDOWN FROM 52W HIGH"
              value={spxDrawdown !== null ? `${spxDrawdown.toFixed(1)}%` : "—"}
              signal={drawdownSignal}
              desc="Bowley compares current selloffs to historical bear markets (Q4 2018: -20%, COVID 2020: -34%, 2022: -27%, April 2025: ~-19%). Deep corrections (≥20%) combined with fear extremes = high probability bottom window."
              detail={spxCurrent ? `Current SPX: $${spxCurrent?.toFixed(0) ?? "—"} | 52W High: $${spx52wHigh?.toFixed(0) ?? "—"} | SMA50: $${spxSMA50?.toFixed(0) ?? "—"}` : ""}
              color="#ff8844"
              mono={mono}
            >
              {spxPrices.length > 0 && <BFSparkline prices={spxPrices} color="#ff8844" w={260} h={40}/>}
            </BFIndicatorCard>

            <BFIndicatorCard
              label="BREADTH — IWM vs SPY RELATIVE PERFORMANCE"
              value={breadthDiff !== null ? `${breadthDiff > 0 ? "+" : ""}${breadthDiff.toFixed(2)}%` : "—"}
              signal={breadthSignal}
              desc="Small caps (IWM) leading large caps (SPY) signals improving market breadth — a key sustainability indicator. Bowley watches for broad participation to confirm a bottom isn't just a dead-cat bounce in mega-caps."
              detail={`IWM: ${iwmChg !== null ? (iwmChg >= 0 ? "+" : "") + iwmChg.toFixed(2) + "%" : "—"} | SPY: ${spyChg !== null ? (spyChg >= 0 ? "+" : "") + spyChg.toFixed(2) + "%" : "—"}`}
              color="#00aaff"
              mono={mono}
            />

            <BFIndicatorCard
              label="HIGH YIELD (HYG) — RISK APPETITE"
              value={hygChg !== null ? `${hygChg >= 0 ? "+" : ""}${hygChg.toFixed(2)}%` : "—"}
              signal={hygSignal}
              desc="Junk bonds are a leading indicator for equities. When HYG stabilizes or rallies, it signals credit markets are pricing in less default risk — often a precursor to an equity bottom. HYG leads stocks by days to weeks."
              detail="Sustained HYG weakness while stocks bounce = 'not yet' signal; HYG recovery = sustainability improving"
              color="#ff66aa"
              mono={mono}
            />

            <BFIndicatorCard
              label="LONG BONDS (TLT) — FLIGHT TO SAFETY"
              value={tltChg !== null ? `${tltChg >= 0 ? "+" : ""}${tltChg.toFixed(2)}%` : "—"}
              signal={tltSignal}
              desc="Heavy bond buying (TLT rising sharply) signals peak fear and flight-to-safety. When bond buying exhausts and money rotates back to equities, it marks the transition from capitulation to recovery."
              detail={`TLT price: $${tltData?.quote?.price?.toFixed(2) ?? "—"} | SPY vs 50MA: ${spyAbove50 === null ? "—" : spyAbove50 ? "✓ ABOVE" : "✗ BELOW"} | vs 200MA: ${spyAbove200 === null ? "—" : spyAbove200 ? "✓ ABOVE" : "✗ BELOW"}`}
              color="#aa88ff"
              mono={mono}
            />

            <BFIndicatorCard
              label="TECHNOLOGY (XLK) — KEY MARKET LEADER"
              value={xlkChg !== null ? `${xlkChg >= 0 ? "+" : ""}${xlkChg.toFixed(2)}%` : "—"}
              signal={xlkSignal}
              desc="Bowley specifically watches XLK and its key support levels (e.g., 134-136 range in 2025-26). Technology is the most influential sector. XLK losing critical price support accelerates selling; recovery above 50-day MA confirms rally sustainability."
              detail={`XLK: $${xlkCurrent?.toFixed(2) ?? "—"} | 50-day MA: $${xlkSMA50?.toFixed(2) ?? "—"} | Status: ${xlkAbove50 === null ? "—" : xlkAbove50 ? "ABOVE 50MA ✓" : "BELOW 50MA ✗"}`}
              color="#00aaff"
              mono={mono}
            />

            <BFIndicatorCard
              label="CAPITULATION VOLUME (SPY 3d vs 20d AVG)"
              value={volRatio !== null ? `${volRatio.toFixed(2)}x` : "—"}
              signal={volSignal}
              desc="Bowley requires capitulatory volume to 'trust' a bottom. Without a volume surge (1.5x+ average), a bounce may be a dead-cat. Heavy panic selling volume exhausts sellers and sets up durable lows — look for 2x+ volume spikes on down days."
              detail={`Recent 3-day avg vol: ${recentVol ? (recentVol/1e6).toFixed(1) + "M" : "—"} | 20-day avg: ${avgVol20 ? (avgVol20/1e6).toFixed(1) + "M" : "—"}`}
              color="#ffdd00"
              mono={mono}
            />
          </div>

          {/* ── ROW 3: Bowley Checklist + Summary ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"16px"}}>

            {/* Bowley's Bottom Checklist */}
            <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"14px"}}>
              <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"12px"}}>
                BOWLEY'S MARKET BOTTOM CHECKLIST
              </div>
              {[
                {
                  label: "CPCE 5-day MA > 0.80",
                  met: estimatedCPCE5d !== null && estimatedCPCE5d >= 0.80,
                  value: estimatedCPCE5d?.toFixed(3) ?? "—",
                  key: "cpce",
                  desc: "Extreme retail put buying (contrarian bullish)",
                },
                {
                  label: "VIX > 28 (Elevated Fear)",
                  met: vixPrice !== null && vixPrice >= 28,
                  value: vixPrice?.toFixed(1) ?? "—",
                  key: "vix",
                  desc: "Fear gauge at historically elevated levels",
                },
                {
                  label: "VIX / SPX Correlation > 0",
                  met: vixSpxCorr !== null && vixSpxCorr > 0,
                  value: vixSpxCorr?.toFixed(3) ?? "—",
                  key: "corr",
                  desc: "Abnormal positive correlation = reversal signal",
                },
                {
                  label: "SPX RSI < 35 (Oversold)",
                  met: spxRSI < 35,
                  value: spxRSI.toString(),
                  key: "rsi",
                  desc: "Price oversold on 14-day RSI",
                },
                {
                  label: "Drawdown ≥ 10% from High",
                  met: spxDrawdown !== null && spxDrawdown <= -10,
                  value: spxDrawdown !== null ? `${spxDrawdown.toFixed(1)}%` : "—",
                  key: "drawdown",
                  desc: "Sufficient depth for meaningful bottom",
                },
                {
                  label: "Volume Spike ≥ 1.5x Normal",
                  met: volRatio !== null && volRatio >= 1.5,
                  value: volRatio !== null ? `${volRatio.toFixed(2)}x` : "—",
                  key: "vol",
                  desc: "Capitulation volume (sellers exhausted)",
                },
                {
                  label: "HYG Stabilizing or Rising",
                  met: hygChg !== null && hygChg >= -0.2,
                  value: hygChg !== null ? `${hygChg >= 0 ? "+" : ""}${hygChg.toFixed(2)}%` : "—",
                  key: "hyg",
                  desc: "Credit markets not pricing in systemic risk",
                },
                {
                  label: "Defensive Sectors Leading",
                  met: defensiveLeading,
                  value: `XLP ${xlpChg >= 0 ? "+" : ""}${xlpChg.toFixed(1)}%`,
                  key: "def",
                  desc: "Late-stage fear rotation (contrarian indicator)",
                },
              ].map(item => (
                <div key={item.key} style={{display:"flex",alignItems:"center",gap:"10px",padding:"6px 0",borderBottom:"1px solid #0d1828"}}>
                  <div style={{
                    width:"18px",height:"18px",borderRadius:"50%",flexShrink:0,
                    background:item.met?"#00ff88":"#1a3050",
                    border:`2px solid ${item.met?"#00ff88":"#1a3050"}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:"10px"
                  }}>
                    {item.met ? "✓" : "○"}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:"9px",color:item.met?"#e0f0ff":"#3a5a7a",fontWeight:item.met?"bold":"normal"}}>{item.label}</div>
                    <div style={{fontSize:"8px",color:"#2a4060"}}>{item.desc}</div>
                  </div>
                  <div style={{fontSize:"9px",color:item.met?"#00ff88":"#4a6a8a",minWidth:"50px",textAlign:"right"}}>
                    {item.value}
                  </div>
                </div>
              ))}
              <div style={{marginTop:"10px",padding:"8px",background:"#070f1c",border:"1px solid #1a3050"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontSize:"9px",color:"#3a5a7a"}}>CHECKLIST SCORE</div>
                  <div style={{fontSize:"14px",fontWeight:"bold",color:
                    [estimatedCPCE5d>=0.80, vixPrice>=28, vixSpxCorr>0, spxRSI<35, spxDrawdown<=-10, volRatio>=1.5, hygChg>=-0.2, defensiveLeading].filter(Boolean).length >= 6 ? "#00ff88" :
                    [estimatedCPCE5d>=0.80, vixPrice>=28, vixSpxCorr>0, spxRSI<35, spxDrawdown<=-10, volRatio>=1.5, hygChg>=-0.2, defensiveLeading].filter(Boolean).length >= 4 ? "#ffaa00" : "#ff4466"
                  }}>
                    {[estimatedCPCE5d>=0.80, vixPrice>=28, vixSpxCorr>0, spxRSI<35, spxDrawdown<=-10, volRatio>=1.5, hygChg>=-0.2, defensiveLeading].filter(Boolean).length} / 8
                  </div>
                </div>
              </div>
            </div>

            {/* Analysis Summary */}
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              {/* Market Condition Summary */}
              <div style={{background:"#080f1e",border:`1px solid ${overallSignal==="bullish"?"#00ff8833":overallSignal==="caution"?"#ffaa0033":"#ff446633"}`,
                borderTop:`3px solid ${overallSignal==="bullish"?"#00ff88":overallSignal==="caution"?"#ffaa00":"#ff4466"}`,padding:"14px"}}>
                <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"8px"}}>CURRENT MARKET ASSESSMENT</div>
                <div style={{fontSize:"11px",color:"#c8d8f0",lineHeight:"1.8"}}>
                  {vixPrice !== null && (
                    <div style={{marginBottom:"4px"}}>
                      <span style={{color:"#ffdd00"}}>VIX {vixPrice.toFixed(1)}</span>
                      {" — "}{vixLabel.toLowerCase()}
                      {vixPrice >= 28 ? ". Historically, readings at this level have coincided with either market bottoms or near-term bottoms." : vixPrice >= 20 ? ". Elevated but not yet at extremes Bowley watches for bottom confirmation." : ". Complacency suggests limited downside protection; caution warranted."}
                    </div>
                  )}
                  {estimatedCPCE5d !== null && (
                    <div style={{marginBottom:"4px"}}>
                      <span style={{color:"#00d4ff"}}>Est. CPCE {estimatedCPCE5d.toFixed(3)}</span>
                      {" — "}{estimatedCPCE5d >= 0.80 ? "Retail traders are panic-buying puts. As Bowley says, 'the masses rarely get it right' — this extreme is a contrarian buy signal." : estimatedCPCE5d <= 0.55 ? "Low put-buying suggests complacency. Bowley would be cautious about new longs here." : "Options sentiment in neutral territory. Watch for extremes above 0.80 or below 0.50."}
                    </div>
                  )}
                  {vixSpxCorr !== null && (
                    <div style={{marginBottom:"4px"}}>
                      <span style={{color:"#aa88ff"}}>VIX/SPX Correlation: {vixSpxCorr.toFixed(2)}</span>
                      {" — "}{vixSpxCorr > 0.2 ? "Positive correlation detected — this is Bowley's key reversal trigger. Both VIX and SPX moving in the same direction signals abnormal market behavior, often preceding a reversal." : "Normal inverse correlation. No reversal anomaly detected."}
                    </div>
                  )}
                  {spxDrawdown !== null && (
                    <div style={{marginBottom:"4px"}}>
                      <span style={{color:"#ff8844"}}>SPX Drawdown: {spxDrawdown.toFixed(1)}%</span>
                      {" — "}{spxDrawdown <= -20 ? "Bear market territory. Bowley compares this to 2018 Q4 (-20%) and April 2025 lows. Deep corrections combined with fear extremes create high-probability bottom windows." : spxDrawdown <= -10 ? "Correction territory (-10% to -20%). Bowley watches these levels for evidence of capitulation before calling a bottom." : "Limited drawdown — not yet at levels that historically produce durable bottoms with Bowley's framework."}
                    </div>
                  )}
                </div>
              </div>

              {/* Sustainability Check */}
              <div style={{background:"#080f1e",border:"1px solid #1a3050",padding:"14px"}}>
                <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"10px"}}>RALLY SUSTAINABILITY FACTORS</div>
                {[
                  { label:"SPY above 50-day MA", ok:spyAbove50, val: spyNow && spy50 ? `$${spyNow.toFixed(0)} vs $${spy50.toFixed(0)}` : "—" },
                  { label:"SPY above 200-day MA", ok:spyAbove200, val: spyNow && spy200 ? `$${spyNow.toFixed(0)} vs $${spy200.toFixed(0)}` : "—" },
                  { label:"XLK above 50-day MA", ok:xlkAbove50, val: xlkCurrent && xlkSMA50 ? `$${xlkCurrent.toFixed(0)} vs $${xlkSMA50.toFixed(0)}` : "—" },
                  { label:"Small caps (IWM) outperforming", ok:breadthDiff !== null && breadthDiff > 0, val: breadthDiff !== null ? `${breadthDiff > 0 ? "+" : ""}${breadthDiff.toFixed(2)}%` : "—" },
                  { label:"HYG (junk bonds) positive", ok:hygChg !== null && hygChg > 0, val: hygChg !== null ? `${hygChg >= 0 ? "+" : ""}${hygChg.toFixed(2)}%` : "—" },
                ].map(f => (
                  <div key={f.label} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                    <span style={{color:f.ok?"#00ff88":f.ok===false?"#ff4466":"#3a5a7a",fontSize:"12px"}}>{f.ok?"✓":f.ok===false?"✗":"?"}</span>
                    <span style={{fontSize:"9px",color:f.ok?"#c8d8f0":"#3a5a7a",flex:1}}>{f.label}</span>
                    <span style={{fontSize:"9px",color:"#2a4a6a"}}>{f.val}</span>
                  </div>
                ))}
                <div style={{marginTop:"8px",padding:"6px",background:"#070f1c",fontSize:"8px",color:"#2a4060",lineHeight:"1.7"}}>
                  Bowley's sustainability check: a bottom is only trustworthy when breadth expands beyond mega-caps, technology recovers above key MAs, and credit markets stabilize. Without these, bounces should be treated as relief rallies.
                </div>
              </div>

              {/* Bowley Reference */}
              <div style={{background:"#070f1a",border:"1px solid #1a3050",padding:"12px",fontSize:"8px",color:"#2a4060",lineHeight:"1.8"}}>
                <div style={{color:"#1a4060",letterSpacing:"1px",marginBottom:"6px",fontSize:"8px"}}>METHODOLOGY — TOM BOWLEY / EARNINGSBEATS.COM</div>
                <div style={{color:"#3a5a7a",marginBottom:"3px"}}>📺 "I'm Calling This Market Bottom 2.0" — VIX capitulation + CPCE extreme + volume spike</div>
                <div style={{color:"#3a5a7a",marginBottom:"3px"}}>📺 "Identifying Market Tops and Bottoms" — CPCE 5-day MA extremes as contrarian signals</div>
                <div style={{color:"#3a5a7a",marginBottom:"3px"}}>📺 "How to Spot a Market Bottom" — VIX/SPX correlation anomaly = reversal alert</div>
                <div style={{color:"#3a5a7a",marginBottom:"6px"}}>📺 "Calling the Bottom in the S&P 500" — Drawdown comparison to 2018 Q4, COVID, 2022</div>
                <div style={{color:"#1a3a5a"}}>⚠ This tool models Bowley's published framework. $CPCE is estimated from VIX behavior. For live CPCE data, visit StockCharts.com or CBOE.com. Not investment advice.</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ELLIOTT WAVE ANALYSIS — Frost & Prechter + Glenn Neely methodology
// 3 Hard Rules: (1) W2 never retraces >100% of W1, (2) W3 never the shortest,
// (3) W4 never overlaps W1 territory. Fibonacci scoring for quality ranking.
// ══════════════════════════════════════════════════════════════════════════════
function detectElliottWave(prices) {
  if (!prices || prices.length < 40) return null;
  const n = prices.length;
  const closes = prices.map(p=>p.close);
  const highs  = prices.map(p=>p.high);
  const lows   = prices.map(p=>p.low);
  const last   = closes[n-1];

  // ── Pivot detection (5-bar window) ────────────────────────────────────────
  const pHigh=[], pLow=[];
  for (let i=5; i<n-5; i++) {
    let isH=true, isL=true;
    for (let j=i-5; j<=i+5; j++) {
      if (j===i) continue;
      if (highs[j]>=highs[i]) isH=false;
      if (lows[j] <=lows[i])  isL=false;
    }
    if (isH) pHigh.push({i, v:highs[i],  type:'H'});
    if (isL) pLow.push( {i, v:lows[i],   type:'L'});
  }

  // Merge into strictly alternating sequence (keep stronger pivot of same type)
  const all = [...pHigh,...pLow].sort((a,b)=>a.i-b.i);
  const alt = [];
  for (const p of all) {
    const prev = alt[alt.length-1];
    if (!prev || prev.type!==p.type) { alt.push(p); }
    else if ((p.type==='H'&&p.v>prev.v)||(p.type==='L'&&p.v<prev.v)) alt[alt.length-1]=p;
  }

  // ── Fibonacci proximity scorer (within 12% of level = partial credit) ─────
  const fibProx = (ratio, levels) => {
    let best=Infinity;
    for (const lv of levels) { const e=Math.abs(ratio-lv)/lv; if(e<best) best=e; }
    return Math.max(0, 1-best/0.12);
  };

  // ── Validate & score one 6-point candidate ────────────────────────────────
  const tryCount = (pts) => {
    const isBull = pts[1].v > pts[0].v;
    const [v0,v1,v2,v3,v4,v5] = pts.map(p=>p.v);

    // Direction checks
    if (isBull  && (v1<=v0||v2>=v1||v3<=v2||v4>=v3||v5<=v4)) return null;
    if (!isBull && (v1>=v0||v2<=v1||v3>=v2||v4<=v3||v5>=v4)) return null;

    const L1=Math.abs(v1-v0), L2=Math.abs(v2-v1), L3=Math.abs(v3-v2),
          L4=Math.abs(v4-v3), L5=Math.abs(v5-v4);
    const w2ret=L2/L1, w3ext=L3/L1, w4ret=L4/L3, w5eq1=L5/L1;
    const span13=Math.abs(v3-v0), w5of13=L5/(span13||1);

    // ── 3 Hard Rules (Frost & Prechter) ─────────────────────────────────────
    if (w2ret>=1.0)                 return null; // R1: W2 ≤ 100% of W1
    if (L3<L1 && L3<L5)            return null; // R2: W3 not shortest
    if (isBull  && v4<=v1)         return null; // R3: W4/W1 no overlap
    if (!isBull && v4>=v1)         return null;

    // ── Fibonacci scoring ────────────────────────────────────────────────────
    let sc = 0;
    sc += fibProx(w2ret, [0.382,0.500,0.618,0.786])     * 28; // W2 retrace
    sc += fibProx(w3ext, [1.618,2.000,2.618])            * 32; // W3 extension
    sc += fibProx(w4ret, [0.236,0.382,0.500])            * 20; // W4 retrace
    sc += Math.max(fibProx(w5eq1,[0.618,1.000,1.618])*18,
                   fibProx(w5of13,[0.382,0.618])     *13);     // W5 target
    if (w2ret>0.50 && w4ret<0.382) sc+=8;                     // alternation
    if (L3>=L1 && L3>=L5)         sc+=6;                      // W3 longest
    const bars=pts[5].i-pts[0].i;
    if (bars<20) sc-=10;
    sc+=Math.min(5,bars/20);

    return { isBull, pts, sc, w2ret, w3ext, w4ret, w5eq1, L1, L3, L5, span13 };
  };

  // ── Search all 6-point windows ────────────────────────────────────────────
  let best=null, bestSc=-1;
  for (let s=0; s<=alt.length-6; s++) {
    const pts=alt.slice(s,s+6);
    const isBull=pts[1].v>pts[0].v;
    // Verify correct H-L alternation for trend
    const ok = isBull
      ? pts[0].type==='L'&&pts[1].type==='H'&&pts[2].type==='L'&&pts[3].type==='H'&&pts[4].type==='L'&&pts[5].type==='H'
      : pts[0].type==='H'&&pts[1].type==='L'&&pts[2].type==='H'&&pts[3].type==='L'&&pts[4].type==='H'&&pts[5].type==='L';
    if (!ok) continue;
    const r=tryCount(pts);
    if (r && r.sc>bestSc) { bestSc=r.sc; best=r; }
  }
  if (!best || bestSc<8) return null;

  // ── Post-process: extend W5 to true price extreme ────────────────────────
  // The 5-bar pivot window can miss the actual W5 high if a later bar exceeds
  // the identified pivot without itself qualifying as a 5-bar pivot.
  // Two stop conditions:
  //   1. Price breaks back through the W4 level (hard Elliott Wave rule violation)
  //   2. Close drops below midpoint of W4→runningPeak range (correction has begun)
  //      This prevents scanning through an ABC correction and picking up a
  //      post-correction recovery as a "new W5 high".
  {
    const { pts: bPts, isBull: bBull } = best;
    const w4vExt = bPts[4].v;
    let extI = bPts[5].i, extV = bPts[5].v;
    let runPeakV = extV; // tracks the highest high seen so far
    for (let i = bPts[4].i + 1; i < n - 4; i++) {
      if (bBull  && lows[i]  < w4vExt) break;  // W4-level break
      if (!bBull && highs[i] > w4vExt) break;
      // Update running peak if new extreme found
      if (bBull  && highs[i] > runPeakV) { runPeakV = highs[i]; extV = highs[i]; extI = i; }
      if (!bBull && lows[i]  < runPeakV) { runPeakV = lows[i];  extV = lows[i];  extI = i; }
      // Stop if close crosses the W4–peak midpoint: signals a real correction started
      const mid = (w4vExt + runPeakV) / 2;
      if (bBull  && closes[i] < mid) break;
      if (!bBull && closes[i] > mid) break;
    }
    if (extI !== bPts[5].i) {
      const newPts = [...bPts];
      newPts[5] = { i: extI, v: extV, type: bBull ? 'H' : 'L' };
      best = { ...best, pts: newPts, L5: Math.abs(extV - bPts[4].v) };
    }
  }

  // ── Current wave position ─────────────────────────────────────────────────
  const {pts,isBull,L1} = best;
  const w4v=pts[4].v, w5v=pts[5].v;

  // Detect if W5 has already peaked and reversed even if current close < w5v.
  // Two signals: (a) W5 bar itself was a large rejection candle (close >4% below
  // bull high / above bear low), or (b) W5 bar is ≥5 bars in the past AND
  // current price has pulled back >3% from the W5 extreme.
  const w5BarClose  = closes[Math.min(pts[5].i, n-1)];
  const barsAfterW5 = (n-1) - pts[5].i;
  const w5Rejection = isBull
    ? w5BarClose < w5v * 0.96          // bearish rejection: closed >4% below W5 high
    : w5BarClose > w5v * 1.04;         // bullish rejection: closed >4% above W5 low
  const w5LongPullback = barsAfterW5 >= 5 && (
    isBull  ? last < w5v * 0.97        // 5+ bars later, still >3% below peak
            : last > w5v * 1.03
  );
  const w5PastPeak = w5Rejection || w5LongPullback;

  let currentWave, waveStatus;
  if (isBull) {
    if (last>=w5v)                          { currentWave=5; waveStatus='complete'; }
    else if (last>=w4v && w5PastPeak)       { currentWave=5; waveStatus='complete'; }
    else if (last>=w4v)                     { currentWave=5; waveStatus='forming';  }
    else                                    { currentWave=4; waveStatus='late';     }
  } else {
    if (last<=w5v)                          { currentWave=5; waveStatus='complete'; }
    else if (last<=w4v && w5PastPeak)       { currentWave=5; waveStatus='complete'; }
    else if (last<=w4v)                     { currentWave=5; waveStatus='forming';  }
    else                                    { currentWave=4; waveStatus='late';     }
  }

  // ── W5 projections from W4 end ────────────────────────────────────────────
  const dir = isBull ? 1 : -1;
  const projections = {
    fib618:  w4v + dir*L1*0.618,
    fib100:  w4v + dir*L1,
    fib1618: w4v + dir*L1*1.618,
  };

  return { ...best, score:Math.min(100,Math.round(bestSc)), currentWave, waveStatus, projections };
}

// ── Weekly resampler (5-bar grouping proxy for weekly bars) ──────────────────
function resampleWeekly(prices) {
  if (!prices || prices.length === 0) return prices;
  const weeks = [];
  let cur = null, dayCount = 0, wIdx = 0;
  prices.forEach((p, i) => {
    const w = Math.floor(i / 5);
    if (cur === null || w !== wIdx) {
      if (cur) weeks.push(cur);
      wIdx = w;
      cur = { open: p.open||p.close, high: p.high||p.close, low: p.low||p.close, close: p.close, volume: p.volume||0, date: p.date };
    } else {
      cur.high   = Math.max(cur.high,  p.high||p.close);
      cur.low    = Math.min(cur.low,   p.low||p.close);
      cur.close  = p.close;
      cur.volume += (p.volume||0);
    }
  });
  if (cur) weeks.push(cur);
  return weeks;
}

// ── ABC corrective pattern detector ──────────────────────────────────────────
function detectABCCorrection(prices, wave) {
  if (!wave || !prices || prices.length < 10) return null;
  const n = prices.length;
  const highs = prices.map(p => p.high  || p.close);
  const lows  = prices.map(p => p.low   || p.close);
  const w5End = wave.pts[5].i;
  if (w5End >= n - 3) return null;

  const isBull  = wave.isBull;
  const w5Price = wave.pts[5].v;

  // Find alternating pivots after W5 using a tighter 3-bar window
  const pHigh = [], pLow = [];
  const win = 3;
  for (let i = w5End + win; i < n - win; i++) {
    let isH = true, isL = true;
    for (let j = i - win; j <= i + win; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isH = false;
      if (lows[j]  <= lows[i])  isL = false;
    }
    if (isH) pHigh.push({ i, v: highs[i], type: 'H' });
    if (isL) pLow.push(  { i, v: lows[i],  type: 'L' });
  }

  const all = [...pHigh, ...pLow].sort((a, b) => a.i - b.i);
  const alt = [];
  for (const p of all) {
    const prev = alt[alt.length - 1];
    if (!prev || prev.type !== p.type) alt.push(p);
    else if ((p.type==='H' && p.v>prev.v)||(p.type==='L' && p.v<prev.v)) alt[alt.length-1] = p;
  }

  if (alt.length < 1) return null;

  // A leg: first pivot moving opposite to impulse direction
  let aIdx = -1;
  for (let k = 0; k < alt.length; k++) {
    if (isBull && alt[k].type === 'L') { aIdx = k; break; }
    if (!isBull && alt[k].type === 'H') { aIdx = k; break; }
  }
  if (aIdx < 0) return null;

  const origin = { i: w5End, v: w5Price };
  const ptA = alt[aIdx];
  const ptB = aIdx + 1 < alt.length ? alt[aIdx + 1] : null;
  const ptC = aIdx + 2 < alt.length ? alt[aIdx + 2] : null;

  const LA = Math.abs(ptA.v - w5Price);
  if (LA < 0.01) return null;
  const LB = ptB ? Math.abs(ptB.v - ptA.v) : null;
  const LC = ptC ? Math.abs(ptC.v - (ptB?.v ?? ptA.v)) : null;

  const bRet = (LB != null && LA) ? LB / LA : null;
  const cEqA = (LC != null && LA) ? LC / LA : null;

  // Quality score
  let sc = 10;
  if (bRet != null) {
    const bErr = Math.min(...[0.382, 0.500, 0.618].map(t => Math.abs(bRet - t) / t));
    sc += Math.max(0, (1 - bErr / 0.20) * 35);
  }
  if (cEqA != null) {
    const cErr = Math.min(...[0.618, 1.000, 1.618].map(t => Math.abs(cEqA - t) / t));
    sc += Math.max(0, (1 - cErr / 0.20) * 35);
    sc += 20;
  } else if (ptB) sc += 15;

  // C-wave price targets measured from B
  const dir = isBull ? -1 : 1;
  const cTargets = ptB ? {
    fib618:  ptB.v + dir * LA * 0.618,
    fib100:  ptB.v + dir * LA,
    fib1618: ptB.v + dir * LA * 1.618,
  } : null;

  return {
    origin, ptA, ptB, ptC,
    LA, LB, LC, bRet, cEqA,
    score:    Math.min(100, Math.round(sc)),
    isBull,
    complete: !!ptC,
    cTargets,
  };
}

// ── Elliott Wave Chart (SVG candlesticks + wave overlays + ABC) ───────────────
function ElliottChart({ prices, wave, abc=null, width=680, height=290 }) {
  if (!prices||!wave) return null;
  const pad={l:52,r:90,t:20,b:44}; // wide right margin for target labels; extra bottom for date axis
  const W=width, H=height;
  const n=prices.length;
  const closes=prices.map(p=>p.close);
  const curClose=closes[n-1];

  // ── History slice ─────────────────────────────────────────────────────────
  const startI=Math.max(0,wave.pts[0].i-5);
  const slice=prices.slice(startI);
  const slLen=slice.length;

  // ── Future projection zone (22% of history width) ────────────────────────
  const futureLen=Math.max(8, Math.round(slLen*0.22));
  const totalLen=slLen+futureLen; // total x-axis slots

  // ── Collect all values for Y range ───────────────────────────────────────
  const allVals=[
    ...slice.map(p=>p.high||p.close),
    ...slice.map(p=>p.low||p.close),
  ].filter(isFinite);

  // Include active W5 targets
  const proj=wave.projections;
  // Don't show W5 targets if wave is complete OR if ABC has already started
  // (ABC starting = W5 reversed without hitting target — projections are stale)
  const showW5=(proj && wave.waveStatus!=='complete' && !abc?.ptA);
  if (showW5) Object.values(proj).forEach(v=>{if(isFinite(v))allVals.push(v);});

  // Include ABC points & C targets
  if (abc) {
    [abc.origin,abc.ptA,abc.ptB,abc.ptC].forEach(pt=>{if(pt&&isFinite(pt.v))allVals.push(pt.v);});
    if(abc.cTargets) Object.values(abc.cTargets).forEach(v=>{if(isFinite(v))allVals.push(v);});
  }

  const lo=Math.min(...allVals)*0.993, hi=Math.max(...allVals)*1.007;
  const chartW=W-pad.l-pad.r;
  const chartH=H-pad.t-pad.b;

  // toX maps slot index across total (history + future) slots
  const toX=i=>pad.l+(i/(totalLen-1||1))*chartW;
  const toY=v=>H-pad.b-((v-lo)/(hi-lo||1))*chartH;
  const pi=i=>Math.max(0,i-startI);

  // X where "now" is (last candle)
  const nowX=toX(slLen-1);
  // X at the far edge of the future zone
  const futX=toX(totalLen-1);

  // ── Future zone shading ───────────────────────────────────────────────────
  const futureShade=(
    <rect x={nowX} y={pad.t} width={futX-nowX} height={chartH}
      fill="#00d4ff" fillOpacity="0.03"/>
  );
  // Vertical "now" divider
  const nowLine=(
    <line x1={nowX} y1={pad.t} x2={nowX} y2={H-pad.b}
      stroke="#00d4ff" strokeWidth="0.6" strokeDasharray="3,4" opacity="0.35"/>
  );

  // ── Candlesticks ──────────────────────────────────────────────────────────
  const cw=Math.max(1.5,Math.min(7,chartW/totalLen*0.65));
  const candles=slice.map((bar,idx)=>{
    const x=toX(idx);
    const o=toY(bar.open||bar.close), c=toY(bar.close);
    const h=toY(bar.high||bar.close), l=toY(bar.low||bar.close);
    const up=(bar.close>=(bar.open||bar.close));
    const bodyTop=Math.min(o,c), bodyH=Math.max(1,Math.abs(o-c));
    return (
      <g key={idx}>
        <line x1={x} y1={h} x2={x} y2={l} stroke={up?'#00cc66':'#cc3344'} strokeWidth="0.8" opacity="0.65"/>
        <rect x={x-cw/2} y={bodyTop} width={cw} height={bodyH}
          fill={up?'#1a4a2a':'#4a1a22'} stroke={up?'#00cc66':'#cc3344'} strokeWidth="0.5"/>
      </g>
    );
  });

  // ── Wave segments ─────────────────────────────────────────────────────────
  const wc=['#ffdd00','#ff6644','#00ff88','#ff9900','#00ccff'];
  const isFormingW5 = wave.waveStatus === 'forming';
  const segs=wave.pts.slice(0,5).map((p,idx)=>{
    const p2=wave.pts[idx+1];
    // W4→W5 (idx=4): when forming, draw dashed to current close so the
    // segment stays anchored to real price data rather than floating above it
    const lastSeg = idx === 4 && isFormingW5;
    const endI = lastSeg ? slLen-1 : pi(p2.i);
    const endV = lastSeg ? curClose : p2.v;
    return <line key={idx}
      x1={toX(pi(p.i))} y1={toY(p.v)}
      x2={toX(endI)} y2={toY(endV)}
      stroke={wc[idx]}
      strokeWidth={lastSeg ? 1.6 : 2.2}
      strokeDasharray={lastSeg ? '6,3' : undefined}
      opacity="0.9"/>;
  });

  // Wave number badges
  const dots=wave.pts.slice(1).map((p,idx)=>{
    // W5 badge (idx=4): when forming, pin to current close so it sits on the
    // last real candle, not above it or past the "now" divider
    const formingBadge = idx === 4 && isFormingW5;
    const x = formingBadge ? toX(slLen-1) : toX(pi(p.i));
    const y = formingBadge ? toY(curClose) : toY(p.v);
    return (
      <g key={idx}>
        <circle cx={x} cy={y} r="10" fill={wc[idx]} opacity="0.18"/>
        <circle cx={x} cy={y} r="7"  fill="#0a1428" stroke={wc[idx]} strokeWidth="1.5"/>
        <text x={x} y={y+4} textAnchor="middle" fill={wc[idx]} fontSize="9" fontWeight="bold">{idx+1}</text>
      </g>
    );
  });

  // ── Helper: draw a forward projection ray ─────────────────────────────────
  // Draws from (anchorX, anchorPrice) → (targetX, targetPrice) + label box
  const projRay=(key, anchorX, anchorPrice, targetPrice, targetX, col, label, shortLabel)=>{
    const y1=toY(anchorPrice), y2=toY(targetPrice);
    if (!isFinite(y1)||!isFinite(y2)) return null;
    const clampedY2=Math.max(pad.t+4, Math.min(H-pad.b-4, y2));
    const labelVal=targetPrice>=1000?`$${targetPrice.toFixed(0)}`:`$${targetPrice.toFixed(2)}`;
    const pct=((targetPrice-curClose)/curClose*100);
    const pctTxt=`${pct>=0?'+':''}${pct.toFixed(1)}%`;
    return (
      <g key={key}>
        {/* Fan line from anchor to target */}
        <line x1={anchorX} y1={y1} x2={targetX} y2={clampedY2}
          stroke={col} strokeWidth="1.1" strokeDasharray="5,3" opacity="0.75"/>
        {/* Horizontal tick at target */}
        <line x1={targetX-4} y1={clampedY2} x2={targetX+2} y2={clampedY2}
          stroke={col} strokeWidth="1.5" opacity="0.9"/>
        {/* Label box on right margin */}
        <rect x={targetX+4} y={clampedY2-8} width={pad.r-8} height={16}
          fill="#070e1c" stroke={col} strokeWidth="0.7" rx="2" opacity="0.92"/>
        <text x={targetX+8} y={clampedY2-1} fill={col} fontSize="7.5" fontWeight="bold">{labelVal}</text>
        <text x={targetX+8} y={clampedY2+7} fill={col} fontSize="6.5" opacity="0.75">{shortLabel} {pctTxt}</text>
      </g>
    );
  };

  // ── Active-target filter: only show targets still AHEAD of current price ─────
  // bull impulse → targets must be above curClose; bear → below; corrections flip
  const isAheadW5 = v => wave.isBull ? v > curClose : v < curClose;
  const isAheadC  = v => abc?.isBull ? v < curClose : v > curClose; // correction reverses direction

  // Hide W5 projections if: wave is complete OR abc correction has already started
  // (abc.ptA existing means W5 already reversed — target was never hit or already passed)

  // ── W5 projected targets (fan from W4 end) ────────────────────────────────
  const w4Idx=pi(wave.pts[4].i);
  const w4Price=wave.pts[4].v;
  const w4X=toX(w4Idx);
  // Collect only active targets, then assign staggered x positions
  const activeW5=(showW5?[
    {v:proj.fib618,  col:'#3a8a5a', label:'W5 61.8%', short:'61.8%'},
    {v:proj.fib100,  col:'#00ff88', label:'W5 100%',  short:'100%'},
    {v:proj.fib1618, col:'#00ffcc', label:'W5 161.8%',short:'161.8%'},
  ].filter(t=>isFinite(t.v)&&isAheadW5(t.v)):[]);
  const tSlots=[0.55,0.75,0.95];
  const w5Rays=activeW5.map((t,i)=>
    projRay('w5'+i, w4X, w4Price, t.v,
      toX(slLen-1+futureLen*(tSlots[i]??0.95)), t.col, t.label, t.short)
  ).filter(Boolean);

  // ── ABC overlay ───────────────────────────────────────────────────────────
  const abcPts=[abc?.origin,abc?.ptA,abc?.ptB,abc?.ptC].filter(Boolean);
  const abcLabels=['','A','B','C'];
  const abcCol={A:'#dd66ff',B:'#ffcc44',C:'#ff44aa'};
  const abcSegs=abcPts.slice(0,abcPts.length-1).map((p,i)=>{
    const p2=abcPts[i+1];
    const col=abcCol[abcLabels[i+1]]||'#dd66ff';
    return <line key={'as'+i}
      x1={toX(pi(p.i))} y1={toY(p.v)} x2={toX(pi(p2.i))} y2={toY(p2.v)}
      stroke={col} strokeWidth="2" strokeDasharray="5,3" opacity="0.85"/>;
  });
  const abcDots=abcPts.slice(1).map((p,i)=>{
    const col=abcCol[abcLabels[i+1]]||'#dd66ff';
    const x=toX(pi(p.i)), y=toY(p.v);
    return (
      <g key={'ad'+i}>
        <circle cx={x} cy={y} r="8" fill="#0a1428" stroke={col} strokeWidth="1.5"/>
        <text x={x} y={y+4} textAnchor="middle" fill={col} fontSize="9" fontWeight="bold">{abcLabels[i+1]}</text>
      </g>
    );
  });

  // ── ABC C-wave projected targets (active only, fan from B end) ────────────
  const cRays=(!abc?.ptC && abc?.cTargets && abc?.ptB)?(()=>{
    const bIdx=pi(abc.ptB.i);
    const bX=toX(bIdx);
    const bP=abc.ptB.v;
    const activeCT=[
      {v:abc.cTargets.fib618,  col:'#aa44cc', label:'C 61.8%', short:'61.8%'},
      {v:abc.cTargets.fib100,  col:'#dd66ff', label:'C = A',   short:'=A'},
      {v:abc.cTargets.fib1618, col:'#ffaaff', label:'C 161.8%',short:'161.8%'},
    ].filter(t=>isFinite(t.v)&&isAheadC(t.v));
    return activeCT.map((t,i)=>
      projRay('c'+i, bX, bP, t.v,
        toX(slLen-1+futureLen*(tSlots[i]??0.95)), t.col, t.label, t.short)
    ).filter(Boolean);
  })():[];

  // ── Grid & axes ───────────────────────────────────────────────────────────
  const ticks=5;
  const grid=Array.from({length:ticks+1},(_,i)=>{
    const y=toY(lo+(hi-lo)*i/ticks);
    return <line key={i} x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="#0d1f35" strokeWidth="0.5"/>;
  });
  const yLabels=Array.from({length:ticks+1},(_,i)=>{
    const v=lo+(hi-lo)*i/ticks;
    return <text key={i} x={pad.l-3} y={toY(v)+4} textAnchor="end" fill="#2a4a6a" fontSize="8">
      {v>=1000?`$${v.toFixed(0)}`:`$${v.toFixed(2)}`}
    </text>;
  });
  // ── X-axis: month/year labels with vertical tick lines ───────────────────
  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDate=(bar,idx)=>{
    // Prices use bar.ts = Unix ms timestamp
    const ms = bar?.ts ?? bar?.date;
    if (!ms || isNaN(Number(ms))) return `+${idx}`;
    const d = new Date(Number(ms));
    return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  };
  const xTicks=Math.min(7,slLen);
  const xAxisItems=Array.from({length:xTicks},(_,i)=>{
    const idx=Math.round(i*(slLen-1)/(xTicks-1||1));
    const bar=slice[idx];
    const label=fmtDate(bar,idx);
    const x=toX(idx);
    return { idx, label, x };
  });
  // Deduplicate by label so the same month doesn't appear twice
  const seen=new Set();
  const xLabels=xAxisItems.filter(({label})=>{
    if(seen.has(label)){return false;} seen.add(label); return true;
  }).map(({label,x,idx})=>(
    <g key={idx}>
      {/* Vertical tick line */}
      <line x1={x} y1={H-pad.b} x2={x} y2={H-pad.b+4} stroke="#2a4a6a" strokeWidth="1"/>
      {/* Month label */}
      <text x={x} y={H-pad.b+13} textAnchor="middle" fill="#3a6a9a" fontSize="8" fontWeight="bold">{label}</text>
    </g>
  ));
  // Light vertical grid lines at each date tick (inside chart area)
  const xGridLines=xAxisItems.map(({x,idx})=>(
    <line key={'xg'+idx} x1={x} y1={pad.t} x2={x} y2={H-pad.b}
      stroke="#0d1f35" strokeWidth="0.5" strokeDasharray="2,4"/>
  ));

  // ── Current price hairline ────────────────────────────────────────────────
  const curY=toY(curClose);

  return (
    <svg width={W} height={H} style={{background:'#070e1c',borderRadius:'2px'}}>
      {/* Clip path so candles don't bleed into label margin */}
      <defs>
        <clipPath id="chartClip">
          <rect x={pad.l} y={pad.t} width={chartW} height={chartH}/>
        </clipPath>
      </defs>
      {grid}
      {xGridLines}
      {yLabels}
      {xLabels}
      {/* Future zone */}
      {futureShade}
      {nowLine}
      <text x={nowX+3} y={pad.t+9} fill="#00d4ff" fontSize="7" opacity="0.4">PROJECTED</text>
      {/* History candles (clipped) */}
      <g clipPath="url(#chartClip)">{candles}</g>
      {/* Wave overlays (clipped to chart area for segments, dots may spill slightly) */}
      <g clipPath="url(#chartClip)">{segs}</g>
      <circle cx={toX(pi(wave.pts[0].i))} cy={toY(wave.pts[0].v)} r="5" fill="#2a4a6a" stroke="#4a7a9a" strokeWidth="1"/>
      {dots}
      {/* ABC history */}
      <g clipPath="url(#chartClip)">{abcSegs}</g>
      {abcDots}
      {/* Projection rays (intentionally outside clip — extend into right margin) */}
      {w5Rays}
      {cRays}
      {/* Current price */}
      <line x1={pad.l} y1={curY} x2={W-pad.r} y2={curY} stroke="#00d4ff" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.6"/>
      <rect x={pad.l} y={curY-7} width={52} height={13} fill="#0a1c30" stroke="#00d4ff" strokeWidth="0.7" rx="2"/>
      <text x={pad.l+4} y={curY+4} fill="#00d4ff" fontSize="8.5" fontWeight="bold">${curClose.toFixed(2)}</text>
    </svg>
  );
}

// ── Elliott Wave Tab Component ─────────────────────────────────────────────
function ElliottWaveTab({ stocks, selected, setSelected, mono }) {
  const [ewSel,  setEwSel]  = useState(selected||null);
  const [tf,     setTf]     = useState('daily'); // 'daily' | 'weekly'

  // Produce resampled prices + wave for the chosen timeframe
  const getEffective = useCallback((s) => {
    if (!s) return { prices: null, wave: null };
    if (tf === 'daily') return { prices: s.prices, wave: s.elliottWave };
    const prices = resampleWeekly(s.prices);
    const wave   = (() => { try { return detectElliottWave(prices); } catch { return null; } })();
    return { prices, wave };
  }, [tf]);

  // Build stock list filtered to those with a valid wave count
  const waveStocks = useMemo(() => stocks
    .map(s => ({ s, ...getEffective(s) }))
    .filter(({ wave }) => !!wave)
    .sort((a,b) => (b.wave.score||0) - (a.wave.score||0)),
  [stocks, getEffective]);

  const selEntry  = waveStocks.find(e=>e.s.sym===ewSel) || waveStocks[0] || null;
  const selStock  = selEntry?.s || null;
  const effPrices = selEntry?.prices || null;
  const ew        = selEntry?.wave   || null;

  // ABC detection on effective (possibly weekly) prices
  const abc = useMemo(() => {
    if (!selStock || !effPrices || !ew) return null;
    try { return detectABCCorrection(effPrices, ew); } catch { return null; }
  }, [selStock, effPrices, ew]);

  const waveColor = w => w===1?'#ffdd00':w===2?'#ff6644':w===3?'#00ff88':w===4?'#ff9900':'#00ccff';
  const waveLabel = (w,st) =>
    w===5&&st==='complete'?'5 — COMPLETE':w===5&&st==='forming'?'5 — FORMING':w===4&&st==='late'?'4 — LATE':`${w}`;
  const fibPct = r => r!=null?`${(r*100).toFixed(1)}%`:'—';

  return (
    <div style={{display:'flex',height:'calc(100vh - 96px)',fontFamily:mono}}>

      {/* ── Left: stock list + timeframe ── */}
      <div style={{width:'224px',borderRight:'1px solid #1a3050',overflowY:'auto',flexShrink:0}}>
        <div style={{padding:'8px 12px',background:'#080f1c',borderBottom:'1px solid #1a3050',fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px'}}>
          ELLIOTT WAVE SCAN — {waveStocks.length} COUNTS
        </div>

        {/* Timeframe toggle */}
        <div style={{display:'flex',gap:'0',borderBottom:'1px solid #1a3050'}}>
          {['daily','weekly'].map(t=>(
            <button key={t} onClick={()=>setTf(t)}
              style={{flex:1,padding:'6px 4px',fontSize:'9px',letterSpacing:'1px',cursor:'pointer',border:'none',
                background:tf===t?'#0d2040':'#060c18',
                color:tf===t?'#00d4ff':'#2a4a6a',
                borderBottom:tf===t?'2px solid #00d4ff':'2px solid transparent',
                textTransform:'uppercase'}}>
              {t}
            </button>
          ))}
        </div>

        {waveStocks.length===0&&(
          <div style={{padding:'20px',textAlign:'center',color:'#1a3050',fontSize:'10px'}}>
            No valid {tf} wave counts.<br/>Run RESCAN first.
          </div>
        )}
        {waveStocks.map(({s,wave:sw})=>{
          const isSel=s.sym===ewSel||(s.sym===selStock?.sym&&!ewSel);
          const wc=waveColor(sw.currentWave);
          return (
            <div key={s.sym} onClick={()=>setEwSel(s.sym)}
              style={{padding:'8px 12px',borderBottom:'1px solid #0d1828',cursor:'pointer',
                background:isSel?'#0d2040':'transparent',
                borderLeft:isSel?'3px solid #00d4ff':'3px solid transparent'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{color:'#e0f0ff',fontWeight:'bold',fontSize:'12px'}}>{s.sym}</span>
                <span style={{background:wc+'22',color:wc,padding:'2px 6px',fontSize:'9px',borderRadius:'2px'}}>W{sw.currentWave}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:'3px'}}>
                <span style={{fontSize:'9px',color:sw.isBull?'#00ff88':'#ff4466'}}>{sw.isBull?'▲ BULL':'▼ BEAR'}</span>
                <span style={{fontSize:'9px',color:'#3a5a7a'}}>Score {sw.score}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Right: detail panel ── */}
      <div style={{flex:1,overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
        {!selStock&&(
          <div style={{textAlign:'center',color:'#1a3050',paddingTop:'60px',fontSize:'11px'}}>Select a stock to view wave analysis</div>
        )}
        {selStock&&ew&&(
          <>
            {/* ── Header ── */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{fontSize:'18px',color:'#e0f0ff',fontWeight:'bold'}}>{selStock.sym}</span>
                  <span style={{fontSize:'9px',color:'#1a3a6a',background:'#0d1f3c',padding:'2px 8px',letterSpacing:'1px'}}>
                    {tf.toUpperCase()}
                  </span>
                </div>
                <div style={{fontSize:'10px',color:'#3a5a7a',marginTop:'2px'}}>{selStock.quote?.name||''}</div>
                <div style={{marginTop:'6px',display:'flex',gap:'8px',alignItems:'center'}}>
                  <span style={{color:ew.isBull?'#00ff88':'#ff4466',fontSize:'11px',fontWeight:'bold'}}>
                    {ew.isBull?'▲ BULLISH IMPULSE':'▼ BEARISH IMPULSE'}
                  </span>
                  <span style={{fontSize:'9px',color:'#2a4a6a',background:'#0d1f3c',padding:'2px 8px'}}>Frost & Prechter Ch.2</span>
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:'22px',color:'#00d4ff',fontWeight:'bold'}}>${selStock.quote?.price?.toFixed(2)||'—'}</div>
                <div style={{marginTop:'4px',background:waveColor(abc?.ptA?5:ew.currentWave)+'22',border:`1px solid ${waveColor(abc?.ptA?5:ew.currentWave)}44`,
                  padding:'4px 10px',color:waveColor(abc?.ptA?5:ew.currentWave),fontSize:'11px',textAlign:'center'}}>
                  WAVE {abc?.ptA ? '5 — COMPLETE' : waveLabel(ew.currentWave,ew.waveStatus)}
                </div>
                {abc&&(
                  <div style={{marginTop:'4px',background:'#3a1a4a44',border:'1px solid #dd66ff44',
                    padding:'3px 10px',color:'#dd66ff',fontSize:'9px',textAlign:'center'}}>
                    ABC {abc.complete?'COMPLETE':'FORMING'} · {abc.score}pts
                  </div>
                )}
              </div>
            </div>

            {/* ── 6-Step Objective Roadmap ── */}
            {(()=>{
              const w=ew.currentWave, st=ew.waveStatus, bull=ew.isBull;
              const curP=selStock.quote?.price||effPrices[effPrices.length-1]?.close||0;
              const dir=bull?'LONG':'SHORT', opp=bull?'SHORT':'LONG';
              const up=bull?'↑':'↓', dn=bull?'↓':'↑';
              const fmt=v=>v>=1000?`$${v.toFixed(0)}`:`$${v.toFixed(2)}`;

              // Determine active step (1–6) based on wave position
              let activeStep=1;
              if (abc&&abc.ptB&&!abc.ptC)        activeStep=6; // in C leg
              else if (abc&&abc.ptA&&!abc.ptB)   activeStep=6; // in B leg (still ABC phase)
              else if (abc&&!abc.ptA)             activeStep=6; // A starting
              else if (w===5&&st==='complete')    activeStep=5;
              else if (w===5&&st==='forming')     activeStep=4;
              else if (w===4)                     activeStep=3;
              else if (w===3)                     activeStep=2;
              else                                activeStep=1;

              // Pre-compute key prices
              const w3Target=fmt(ew.pts[2].v+(ew.L1*1.618*(bull?1:-1)));
              const w3Max   =fmt(ew.pts[2].v+(ew.L1*2.618*(bull?1:-1)));
              const stopW1  =fmt(ew.pts[0].v);
              const stopW2  =fmt(ew.pts[2].v);
              const stopW4  =fmt(ew.pts[4].v);
              const w4entry =fmt(ew.pts[4].v);
              const ahead=v=>bull?v>curP:v<curP;
              const aheadC=v=>bull?v<curP:v>curP;
              const activeW5=[
                {v:ew.projections.fib618,l:'61.8%'},
                {v:ew.projections.fib100,l:'100%'},
                {v:ew.projections.fib1618,l:'161.8%'},
              ].filter(t=>isFinite(t.v)&&ahead(t.v));
              const w5tgt=abc?.ptA?'W5 complete — ABC correction now active'
                :activeW5.length?activeW5.map(t=>`${fmt(t.v)} (${t.l})`).join(' · ')
                :'All W5 targets reached';
              const activeCT=abc?.cTargets?[
                {v:abc.cTargets.fib618,l:'61.8%'},
                {v:abc.cTargets.fib100,l:'=A'},
                {v:abc.cTargets.fib1618,l:'161.8%'},
              ].filter(t=>isFinite(t.v)&&aheadC(t.v)):[];
              const ctgt=activeCT.length?activeCT.map(t=>`${fmt(t.v)} (${t.l})`).join(' · '):'Awaiting B pivot';

              // Pattern confluence
              const pat    = selStock.pattern;
              const rsi    = selStock.rsi||50;
              const divB   = selStock.divergence?.bullDiv;
              const divBear= selStock.divergence?.bearDiv;
              const volTrend=selStock.volData?.trend||1;
              const patBull = pat?.breakout==='bullish';
              const patBear = pat?.breakout==='bearish';
              const confirmed=pat?.stage==='Confirmed';
              const forming  =pat?.stage==='Forming';
              const invalidated=pat?.stage==='Invalidated';

              // Classify the wave context
              const inImpulseBull= bull && (w===1||w===3||(w===5&&st==='forming'));
              const inImpulseBear=!bull && (w===1||w===3||(w===5&&st==='forming'));
              const inCorrectBull= bull && (w===2||w===4);
              const inCorrectBear=!bull && (w===2||w===4);
              const inABC        = abc && !abc.complete;
              const exhausted    = (w===5&&st==='complete')||abc?.complete;

              // Score confluence: +points = confirms, -points = conflicts
              let cfScore=0, cfNotes=[];

              // Pattern direction vs wave direction
              if (patBull && inImpulseBull)  { cfScore+=3; cfNotes.push(`${pat.name} (${pat.stage}) aligns with ${bull?'bullish':'bearish'} wave 3/5 impulse`); }
              if (patBear && inImpulseBear)  { cfScore+=3; cfNotes.push(`${pat.name} (${pat.stage}) aligns with bearish impulse`); }
              if (patBull && inCorrectBull)  { cfScore+=2; cfNotes.push(`${pat.name} signals reversal — supports wave ${w} bottom and wave ${w+1} launch`); }
              if (patBear && inCorrectBear)  { cfScore+=2; cfNotes.push(`${pat.name} signals reversal — supports wave ${w} top and wave ${w+1} decline`); }
              if (patBull && (inImpulseBear||inCorrectBear||exhausted&&bull)) { cfScore-=2; cfNotes.push(`${pat.name} is bullish but wave context is bearish — conflicting signals`); }
              if (patBear && (inImpulseBull||inCorrectBull||exhausted&&!bull)) { cfScore-=2; cfNotes.push(`${pat.name} is bearish but wave context is bullish — conflicting signals`); }
              if (patBull && exhausted&&!bull) { cfScore+=2; cfNotes.push(`${pat.name} supports ABC correction bottom — potential new impulse forming`); }
              if (patBear && exhausted&& bull) { cfScore+=2; cfNotes.push(`${pat.name} confirms exhaustion — ABC correction setup`); }
              if (invalidated)               { cfScore-=1; cfNotes.push(`Pattern invalidated — reduces confluence weight`); }
              if (confirmed)                 { cfScore+=1; cfNotes.push(`Pattern confirmed breakout — adds conviction`); }

              // RSI confluence
              if (bull && (w===2||w===4) && rsi<40) { cfScore+=1; cfNotes.push(`RSI ${rsi.toFixed(0)} oversold — confirms corrective wave bottom`); }
              if (!bull && (w===2||w===4) && rsi>60) { cfScore+=1; cfNotes.push(`RSI ${rsi.toFixed(0)} overbought — confirms corrective wave top`); }
              if ((w===5||exhausted) && bull && rsi>70){ cfScore+=1; cfNotes.push(`RSI ${rsi.toFixed(0)} overbought at wave 5 — divergence warning`); }
              if ((w===5||exhausted) && !bull && rsi<30){ cfScore+=1; cfNotes.push(`RSI ${rsi.toFixed(0)} oversold at wave 5 — divergence warning`); }

              // Divergence confluence
              if (divB && (inCorrectBull||(w===2)||(w===4))) { cfScore+=2; cfNotes.push(`Bullish RSI divergence — strong wave 2/4 bottom signal`); }
              if (divBear && (inCorrectBear||(exhausted&&bull))) { cfScore+=2; cfNotes.push(`Bearish RSI divergence — confirms wave 5 exhaustion`); }
              if (divB && exhausted && !bull) { cfScore+=2; cfNotes.push(`Bullish divergence at ABC C — signals corrective bottom`); }

              // Volume
              if (inImpulseBull && volTrend>1.3) { cfScore+=1; cfNotes.push(`Volume surge ${volTrend.toFixed(1)}x — confirms impulse momentum`); }
              if (inCorrectBull && volTrend<0.9)  { cfScore+=1; cfNotes.push(`Volume drying up — healthy corrective wave characteristic`); }

              // Determine confluence label and color
              const cfLabel = cfScore>=4?'STRONG CONFIRMS':cfScore>=2?'CONFIRMS':cfScore===1?'SLIGHT EDGE':cfScore===0?'NEUTRAL':cfScore===-1?'CAUTION':'CONFLICTS';
              const cfColor = cfScore>=4?'#00ff88':cfScore>=2?'#66dd88':cfScore===1?'#aabb44':cfScore===0?'#4a6a8a':cfScore===-1?'#ffaa00':'#ff4466';
              const cfBg    = cfScore>=2?'#001808':cfScore===0?'#080f1c':cfScore<=-2?'#180800':'#0f1000';
              const topNote = cfNotes[0]||`${pat?.name||'No pattern'} — no direct confluence with current wave position`;

              // ── Wave objective ───────────────────────────────────────────
              let obj=null;
              if (abc&&!abc.complete&&abc.ptB&&!abc.ptC) {
                obj={phase:`C LEG — CORRECTIVE THRUST ${dn}`,accent:'#ff44aa',bg:'#1a0812',border:'#ff44aa',badge:'ABC·C',
                  primary:`Mirror the A leg ${bull?'down':'up'} — C typically equals A in length`,
                  entry:`Enter ${opp} on B-wave breakdown. Stop above B pivot ($${abc.ptB.v.toFixed(2)}).`,
                  target:(()=>{const curP=selStock.quote?.price||0;const ct=abc.cTargets||{};const aheadC=v=>abc.isBull?v<curP:v>curP;return[{v:ct.fib618,l:'61.8%'},{v:ct.fib100,l:'=A'},{v:ct.fib1618,l:'161.8%'}].filter(t=>t.v&&aheadC(t.v)).map(t=>`$${t.v.toFixed(2)} (${t.l})`).join(' · ')||'All C targets reached';})(),
                  invalid:`Invalidated if price closes back above B pivot ($${abc.ptB.v.toFixed(2)})`};
              } else if (abc&&!abc.complete&&abc.ptA&&!abc.ptB) {
                obj={phase:`B WAVE — COUNTER-RALLY TRAP ${up}`,accent:'#ffcc44',bg:'#1a1508',border:'#ffcc44',badge:'ABC·B',
                  primary:`B is a counter-trend bounce — do NOT chase it as a new impulse`,
                  entry:`Fade the B rally near 50–78.6% retrace of A. Prepare ${opp} entry for C leg.`,
                  target:`B likely stalls near $${(abc.ptA.v+(abc.origin.v-abc.ptA.v)*0.618).toFixed(2)} (61.8% retrace of A)`,
                  invalid:`If B exceeds wave 5 extreme ($${ew.pts[5].v.toFixed(2)}), possible flat — reassess count`};
              } else if (w===5&&st==='complete') {
                obj={phase:`WAVE 5 COMPLETE — REVERSAL ZONE ${dn}`,accent:'#ff9900',bg:'#1a1000',border:'#ff9900',badge:'W5 DONE',
                  primary:`Full 5-wave impulse exhausted — major ABC correction is the next sequence`,
                  entry:`Close all ${dir} positions. Confirm divergence before initiating ${opp}.`,
                  target:`ABC correction expected to retrace 38.2–61.8% of entire ${bull?'rally':'decline'}`,
                  invalid:`New ${bull?'high':'low'} beyond wave 5 = extended wave scenario — rare`};
              } else if (w===5&&st==='forming') {
                obj={phase:`WAVE 5 FORMING — FINAL PUSH ${up}`,accent:'#00ccff',bg:'#041018',border:'#00ccff',badge:'WAVE 5',
                  primary:`Last leg of the impulse — profitable but carries divergence risk`,
                  entry:`Trail stop from wave 4 ($${ew.pts[4].v.toFixed(2)}). Reduce size vs. wave 3.`,
                  target:(()=>{const curP=selStock.quote?.price||0;const ahead=v=>ew.isBull?v>curP:v<curP;return[{v:ew.projections.fib618,l:'min'},{v:ew.projections.fib100,l:'typical'},{v:ew.projections.fib1618,l:'extended'}].filter(t=>ahead(t.v)).map(t=>`$${t.v.toFixed(2)} (${t.l})`).join(' · ')||'All targets reached';})(),
                  invalid:`Close below wave 4 ($${ew.pts[4].v.toFixed(2)}) — wave 3 may be terminal`};
              } else if (w===4) {
                obj={phase:`WAVE 4 PULLBACK — RE-ENTRY SETUP ${dn}`,accent:'#ff9900',bg:'#120c00',border:'#ff9900',badge:'WAVE 4',
                  primary:`Corrective pullback — opportunity to add ${dir} for wave 5 launch`,
                  entry:`Enter ${dir} on reversal at 23.6–38.2% retrace of wave 3. Stop below wave 1 top ($${ew.pts[1].v.toFixed(2)}).`,
                  target:`Wave 5 from here. W3-extended → W5 = 61.8% of W1`,
                  invalid:`Overlap with wave 1 territory ($${ew.pts[1].v.toFixed(2)}) = count invalid — exit`};
              } else if (w===3) {
                obj={phase:`WAVE 3 IN PROGRESS — THE MONEY WAVE ${up}`,accent:'#00ff88',bg:'#011a0a',border:'#00ff88',badge:'WAVE 3 ★',
                  primary:`Strongest, fastest leg — highest-conviction trend trade. Hold and ride.`,
                  entry:`Stop below wave 2 ($${ew.pts[2].v.toFixed(2)}). Add on shallow pullbacks staying above wave 1 top.`,
                  target:`161.8% W1 extension = $${(ew.pts[2].v+(ew.L1*1.618*(bull?1:-1))).toFixed(2)}. May reach 261.8%.`,
                  invalid:`Close below wave 1 end ($${ew.pts[1].v.toFixed(2)}) = wave 3 failed — exit immediately`};
              } else {
                obj={phase:`WAVE ${w===1?'1 — IMPULSE STARTS':'2 — CORRECTIVE RETRACE'} ${w===1?up:dn}`,
                  accent:w===1?'#ffdd00':'#ff6644',bg:w===1?'#141200':'#1a0800',border:w===1?'#ffdd00':'#ff6644',badge:`WAVE ${w}`,
                  primary:w===1?`First leg of new ${bull?'bullish':'bearish'} impulse — wait for wave 2 to add full size`
                    :`Deepest retrace before wave 3 launch — best entry window`,
                  entry:w===1?`Small ${dir} position. Wait for wave 2 pullback to 50–61.8% of W1 to build size.`
                    :`Best entry zone: 50–61.8% retrace of W1. Stop just below wave 1 origin ($${ew.pts[0].v.toFixed(2)}).`,
                  target:w===1?`Initial target: wave 1 high for wave 3 setup`
                    :`W3 launch: 161.8% of W1 = $${(ew.pts[0].v+(ew.L1*1.618*(bull?1:-1))).toFixed(2)}`,
                  invalid:w===1?`Below wave 0 ($${ew.pts[0].v.toFixed(2)}) = not a valid impulse`
                    :`Close below wave 1 origin ($${ew.pts[0].v.toFixed(2)}) = W2 ≥ 100% of W1 — count invalid`};
              }

              // ── 6 steps definition ───────────────────────────────────────
              const steps=[
                { n:1, label:'Enter Wave 3',       icon:'①',
                  when:'Wave 2 completes at 50–61.8% retrace of Wave 1',
                  action:`Enter ${dir} at Wave 2 bottom`,
                  target:`Wave 3 target: ${w3Target} (161.8%) → ${w3Max} (261.8%)`,
                  stop:`Stop: ${stopW1} — below Wave 1 origin (hard rule: W2 cannot exceed W1)`,
                  size:'Full position — highest reward-to-risk in the entire cycle',
                  accent:'#ffdd00' },
                { n:2, label:'Ride Wave 3',         icon:'②',
                  when:'Price accelerates away from Wave 2 low — fastest, longest leg',
                  action:`Hold ${dir}. Add on shallow pullbacks above Wave 1 top`,
                  target:`161.8% extension = ${w3Target}. May extend to ${w3Max}`,
                  stop:`Trail stop below Wave 2 end (${stopW2})`,
                  size:'Full position — the money wave, do not cut early',
                  accent:'#00ff88' },
                { n:3, label:'Re-enter at Wave 4',  icon:'③',
                  when:'Wave 3 completes, pullback to 23.6–38.2% of Wave 3',
                  action:`Take partial profit on Wave 3. Re-enter ${dir} at Wave 4 low`,
                  target:`Wave 5 active targets: ${w5tgt}`,
                  stop:`Stop: ${stopW1} — Wave 4 cannot overlap Wave 1 territory`,
                  size:'Reduced position (50–60% of Wave 3 size) — lower conviction leg',
                  accent:'#ff9900' },
                { n:4, label:'Trade Wave 5',         icon:'④',
                  when:'Wave 4 confirms reversal, new impulse begins',
                  action:`Hold ${dir} with trailing stop from Wave 4 (${stopW4})`,
                  target:`Active W5 targets: ${w5tgt}`,
                  stop:`Close below Wave 4 (${stopW4}) = W3 may be terminal — exit`,
                  size:'Watch RSI/MACD for divergence — exit at first sign of exhaustion',
                  accent:'#00ccff' },
                { n:5, label:'Exit — W5 Exhaustion', icon:'⑤',
                  when:'Wave 5 complete. RSI/MACD divergence. Volume drying up.',
                  action:`Close ALL ${dir} positions. Do NOT chase — impulse is spent`,
                  target:`ABC correction will retrace 38.2–61.8% of entire ${bull?'rally':'decline'} from Wave 0 (${stopW1})`,
                  stop:`New ${bull?'high':'low'} beyond Wave 5 = extended wave (rare) — stand aside`,
                  size:'Flat — wait for ABC A leg to establish before initiating correction trade',
                  accent:'#ff6644' },
                { n:6, label:'Trade ABC Correction',  icon:'⑥',
                  when:'After Wave 5 top/bottom. A–B–C corrective sequence unfolds.',
                  action:abc?.ptB&&!abc.ptC?`Enter ${opp} on B-wave breakdown for C leg thrust`
                    :abc?.ptA&&!abc.ptB?`Fade B-wave bounce near 50–78.6% retrace of A`
                    :`Monitor A leg — enter ${opp} once A pivot confirms`,
                  target:`C wave targets: ${ctgt}`,
                  stop:abc?.ptB?`Stop above B pivot (${fmt(abc.ptB.v)}) — back above = flat correction`
                    :`Stop above Wave 5 extreme (${fmt(ew.pts[5].v)})`,
                  size:'Moderate position — corrections are choppier than impulses',
                  accent:'#dd66ff' },
              ];

              return (
                <div style={{background:'#07101f',border:'1px solid #1a3050',overflow:'hidden'}}>
                  {/* Section header */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                    padding:'8px 14px',background:'#060d1a',borderBottom:'1px solid #1a3050'}}>
                    <div style={{fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px'}}>
                      ELLIOTT WAVE — 6 OBJECTIVES ROADMAP
                    </div>
                    <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                      <span style={{fontSize:'8px',color:cfColor,background:cfColor+'18',
                        border:`1px solid ${cfColor}44`,padding:'2px 7px',letterSpacing:'1px'}}>
                        {cfLabel}
                      </span>
                      {(divB||divBear)&&(
                        <span style={{fontSize:'8px',color:divB?'#00ff88':'#ff4466'}}>
                          {divB?'▲ BULL DIV':'▼ BEAR DIV'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pattern info strip */}
                  <div style={{padding:'5px 14px',background:'#060c18',borderBottom:'1px solid #0d1f35',
                    fontSize:'8px',color:'#3a5a7a',display:'flex',gap:'16px'}}>
                    <span>Pattern: <span style={{color:'#6a9aba'}}>{pat?.name||'—'} · {pat?.stage||'—'}</span></span>
                    <span>RSI: <span style={{color:rsi<40?'#00ff88':rsi>65?'#ff4466':'#6a9aba'}}>{rsi.toFixed(0)}</span></span>
                    <span>Vol: <span style={{color:volTrend>1.3?'#00ff88':'#6a9aba'}}>{volTrend.toFixed(1)}x</span></span>
                    <span style={{color:'#4a6a8a',flex:1}}>{topNote}</span>
                  </div>

                  {/* Steps */}
                  <div style={{padding:'8px 10px',display:'flex',flexDirection:'column',gap:'4px'}}>
                    {steps.map(s=>{
                      const isActive=s.n===activeStep;
                      const isDone  =s.n<activeStep;
                      const isFuture=s.n>activeStep;
                      return (
                        <div key={s.n} style={{
                          display:'flex',gap:'10px',alignItems:'flex-start',
                          padding:isActive?'10px 12px':'6px 12px',
                          background:isActive?s.accent+'12':'transparent',
                          border:isActive?`1px solid ${s.accent}44`:'1px solid transparent',
                          borderLeft:isActive?`3px solid ${s.accent}`:isDone?'3px solid #1a3a1a':'3px solid #1a2a3a',
                          opacity:isFuture?0.4:1,
                          transition:'all 0.2s',
                        }}>
                          {/* Step number */}
                          <div style={{flexShrink:0,width:'22px',height:'22px',borderRadius:'50%',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            background:isActive?s.accent:isDone?'#1a3a1a':'#0d1828',
                            border:`1.5px solid ${isActive?s.accent:isDone?'#2a5a2a':'#1a3050'}`,
                            fontSize:'10px',color:isActive?'#060e1c':isDone?'#2a8a2a':'#2a4a6a',
                            fontWeight:'bold'}}>
                            {isDone?'✓':s.n}
                          </div>

                          {/* Content */}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isActive?'6px':'0'}}>
                              <span style={{fontSize:'9px',fontWeight:'bold',
                                color:isActive?s.accent:isDone?'#2a6a2a':'#2a4060',
                                letterSpacing:'1px'}}>
                                {s.icon} {s.label.toUpperCase()}
                              </span>
                              {isActive&&<span style={{fontSize:'8px',color:s.accent,background:s.accent+'22',
                                padding:'1px 6px',letterSpacing:'1px'}}>ACTIVE NOW</span>}
                            </div>

                            {isActive&&(
                              <div style={{display:'grid',gridTemplateColumns:'58px 1fr',gap:'3px 8px',fontSize:'8.5px',lineHeight:'1.55'}}>
                                <span style={{color:s.accent,opacity:0.65,fontWeight:'bold'}}>WHEN</span>
                                <span style={{color:'#7a9ab8'}}>{s.when}</span>
                                <span style={{color:s.accent,opacity:0.65,fontWeight:'bold'}}>ACTION</span>
                                <span style={{color:'#d0e8ff',fontWeight:'bold'}}>{s.action}</span>
                                <span style={{color:s.accent,opacity:0.65,fontWeight:'bold'}}>TARGET $</span>
                                <span style={{color:'#00ff88',fontWeight:'bold'}}>{s.target}</span>
                                <span style={{color:'#ff4466',opacity:0.75,fontWeight:'bold'}}>STOP</span>
                                <span style={{color:'#c07080'}}>{s.stop}</span>
                                <span style={{color:s.accent,opacity:0.65,fontWeight:'bold'}}>SIZE</span>
                                <span style={{color:'#7a9ab8'}}>{s.size}</span>
                              </div>
                            )}
                            {!isActive&&(
                              <div style={{fontSize:'8px',color:isDone?'#2a5a2a':'#1a3050',marginTop:'1px'}}>
                                {isDone?`✓ Completed`:`${s.when}`}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── Candlestick chart ── */}
            <div style={{background:'#070e1c',border:'1px solid #1a3050',padding:'8px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px',padding:'0 4px'}}>
                <div style={{fontSize:'9px',color:'#2a4a6a',letterSpacing:'1px'}}>
                  WAVE STRUCTURE · bars {ew.pts[0].i}→{ew.pts[5].i} · Score {ew.score}/100 · {tf.toUpperCase()} CANDLES
                </div>
                {abc&&(
                  <div style={{fontSize:'9px',color:'#dd66ff'}}>
                    ABC {abc.complete?'✓':'…'} Q{abc.score}
                  </div>
                )}
              </div>
              <ElliottChart prices={effPrices} wave={ew} abc={abc}
                width={Math.min(780,window.innerWidth-300)} height={270}/>
              {/* Legend */}
              <div style={{display:'flex',gap:'14px',padding:'6px 4px 0',flexWrap:'wrap',alignItems:'center'}}>
                {['①','②','③','④','⑤'].map((num,i)=>(
                  <span key={i} style={{fontSize:'9px',color:['#ffdd00','#ff6644','#00ff88','#ff9900','#00ccff'][i]}}>
                    {num} {['Impulse','Corr.','Impulse','Corr.','Impulse'][i]}
                  </span>
                ))}
                {abc&&['A','B','C'].map((l,i)=>(
                  <span key={l} style={{fontSize:'9px',color:['#dd66ff','#ffcc44','#ff44aa'][i]}}>
                    {l} {['Corrective','Counter','Thrust'][i]}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Wave metrics ── */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>

              {/* Fibonacci ratios */}
              <div style={{background:'#0a1628',border:'1px solid #1a3050',padding:'12px'}}>
                <div style={{fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px',marginBottom:'10px'}}>FIBONACCI RATIOS</div>
                {[
                  { label:'Wave 2 retrace of W1', val:ew.w2ret, targets:[0.382,0.500,0.618,0.786], ideal:'38.2–61.8%' },
                  { label:'Wave 3 extend of W1',  val:ew.w3ext, targets:[1.618,2.000,2.618],       ideal:'161.8%+' },
                  { label:'Wave 4 retrace of W3', val:ew.w4ret, targets:[0.236,0.382,0.500],       ideal:'23.6–38.2%' },
                  { label:'Wave 5 vs W1',         val:ew.w5eq1, targets:[0.618,1.000,1.618],       ideal:'61.8–100%' },
                ].map(row=>{
                  const closest=row.targets.reduce((b,t)=>Math.abs(row.val-t)<Math.abs(row.val-b)?t:b,row.targets[0]);
                  const err=Math.abs(row.val-closest)/closest;
                  const q=err<0.05?'#00ff88':err<0.12?'#ffaa00':'#ff4466';
                  return (
                    <div key={row.label} style={{marginBottom:'8px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'2px'}}>
                        <span style={{fontSize:'9px',color:'#4a6a8a'}}>{row.label}</span>
                        <span style={{fontSize:'9px',color:q,fontWeight:'bold'}}>{fibPct(row.val)}</span>
                      </div>
                      <div style={{height:'3px',background:'#0d1f35',borderRadius:'2px'}}>
                        <div style={{height:'100%',width:`${Math.min(100,Math.max(0,(1-err/0.15)*100))}%`,background:q,borderRadius:'2px'}}/>
                      </div>
                      <div style={{fontSize:'8px',color:'#1a3a5a',marginTop:'1px'}}>Ideal: {row.ideal}</div>
                    </div>
                  );
                })}
              </div>

              {/* Wave length comparison */}
              <div style={{background:'#0a1628',border:'1px solid #1a3050',padding:'12px'}}>
                <div style={{fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px',marginBottom:'10px'}}>WAVE LENGTHS</div>
                {[
                  { num:1, len:ew.L1, color:'#ffdd00' },
                  { num:3, len:ew.L3, color:'#00ff88' },
                  { num:5, len:ew.L5, color:'#00ccff' },
                ].map(w=>{
                  const maxL=Math.max(ew.L1,ew.L3,ew.L5)||1;
                  const isLongest=w.len===maxL;
                  return (
                    <div key={w.num} style={{marginBottom:'10px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'3px'}}>
                        <span style={{fontSize:'9px',color:w.color}}>Wave {w.num}{isLongest?' ★':''}</span>
                        <span style={{fontSize:'9px',color:'#c8d8f0'}}>${w.len.toFixed(2)}</span>
                      </div>
                      <div style={{height:'6px',background:'#0d1f35',borderRadius:'3px'}}>
                        <div style={{height:'100%',width:`${(w.len/maxL)*100}%`,background:w.color,opacity:0.7,borderRadius:'3px'}}/>
                      </div>
                    </div>
                  );
                })}
                <div style={{marginTop:'8px',padding:'6px',background:'#070f1c',fontSize:'8px',color:'#2a4060',lineHeight:'1.6'}}>
                  {ew.L3>=ew.L1&&ew.L3>=ew.L5
                    ? '✓ Wave 3 is longest — textbook structure'
                    : '⚠ Wave 3 not longest — less conventional'}
                </div>
              </div>
            </div>

            {/* ── 3 Hard Rules ── */}
            <div style={{background:'#0a1628',border:'1px solid #1a3050',padding:'12px'}}>
              <div style={{fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px',marginBottom:'10px'}}>FROST & PRECHTER — 3 HARD RULES</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px'}}>
                {[
                  { rule:'Rule 1', desc:'Wave 2 retraces ≤100% of Wave 1', ok:ew.w2ret<1.0,
                    detail:`W2 retraced ${fibPct(ew.w2ret)} of W1` },
                  { rule:'Rule 2', desc:'Wave 3 is not the shortest impulse', ok:!(ew.L3<ew.L1&&ew.L3<ew.L5),
                    detail:`W3=${ew.L3.toFixed(1)}, W1=${ew.L1.toFixed(1)}, W5=${ew.L5.toFixed(1)}` },
                  { rule:'Rule 3', desc:'Wave 4 does not overlap Wave 1', ok:true,
                    detail:'W4 stayed above W1 territory' },
                ].map(r=>(
                  <div key={r.rule} style={{background:r.ok?'#001808':'#200808',border:`1px solid ${r.ok?'#004422':'#440000'}`,padding:'10px',borderRadius:'2px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px'}}>
                      <span style={{color:r.ok?'#00ff88':'#ff4466',fontSize:'14px'}}>{r.ok?'✓':'✗'}</span>
                      <span style={{fontSize:'9px',color:'#c8d8f0',fontWeight:'bold'}}>{r.rule}</span>
                    </div>
                    <div style={{fontSize:'9px',color:'#4a6a8a',marginBottom:'4px',lineHeight:'1.4'}}>{r.desc}</div>
                    <div style={{fontSize:'8px',color:r.ok?'#2a6a2a':'#6a2a2a'}}>{r.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── W5 Projections — active targets only (hidden once ABC starts) ── */}
            {ew.waveStatus!=='complete'&&!abc?.ptA&&(()=>{
              const curP=selStock.quote?.price||effPrices[effPrices.length-1]?.close||0;
              const ahead=v=>ew.isBull?v>curP:v<curP;
              const active=[
                { label:'61.8% of W1', val:ew.projections.fib618,  color:'#3a8a5a', note:'Conservative' },
                { label:'100% of W1',  val:ew.projections.fib100,  color:'#00ff88', note:'Most Common'  },
                { label:'161.8% of W1',val:ew.projections.fib1618, color:'#00ffaa', note:'Extended'     },
              ].filter(p=>isFinite(p.val)&&ahead(p.val));
              if (!active.length) return null;
              return (
                <div style={{background:'#0a1628',border:'1px solid #1a3050',padding:'12px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
                    <div style={{fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px'}}>
                      WAVE 5 ACTIVE TARGETS — from W4 @ ${ew.pts[4].v.toFixed(2)}
                    </div>
                    <div style={{fontSize:'8px',color:'#1a3a5a'}}>
                      {3-active.length} target{3-active.length!==1?'s':''} already passed
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:`repeat(${active.length},1fr)`,gap:'8px'}}>
                    {active.map(p=>{
                      const pct=((p.val-curP)/curP)*100;
                      return (
                        <div key={p.label} style={{background:'#070f1c',border:`1px solid ${p.color}33`,padding:'10px',textAlign:'center'}}>
                          <div style={{color:p.color,fontSize:'16px',fontWeight:'bold'}}>${p.val.toFixed(2)}</div>
                          <div style={{color:'#3a5a7a',fontSize:'8px',marginTop:'2px'}}>{p.label}</div>
                          <div style={{color:ew.isBull?'#00ff88':'#ff4466',fontSize:'10px',marginTop:'4px'}}>{pct>=0?'+':''}{pct.toFixed(1)}%</div>
                          <div style={{color:'#1a3a5a',fontSize:'8px',marginTop:'2px'}}>{p.note}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── ABC Corrective Wave ── */}
            {abc&&(
            <div style={{background:'#090d1a',border:'1px solid #3a1a4a',padding:'12px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
                <div style={{fontSize:'9px',color:'#7a3a9a',letterSpacing:'2px'}}>
                  ABC CORRECTIVE SEQUENCE — {abc.complete?'COMPLETE':'IN PROGRESS'}
                </div>
                <div style={{fontSize:'9px',color:'#dd66ff',background:'#3a1a4a44',padding:'2px 8px'}}>
                  Quality {abc.score}/100
                </div>
              </div>

              {/* A / B / C leg cards */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',marginBottom:'10px'}}>
                {[
                  { leg:'A', pt:abc.ptA, prev:abc.origin, color:'#dd66ff',
                    desc:`${abc.isBull?'Down from':'Up from'} W5 end @ $${abc.origin.v.toFixed(2)}`,
                    len:abc.LA, ratio:null },
                  { leg:'B', pt:abc.ptB, prev:abc.ptA,   color:'#ffcc44',
                    desc:`Counter-move · ${abc.bRet!=null?fibPct(abc.bRet)+' of A':'pending'}`,
                    len:abc.LB, ratio:abc.bRet },
                  { leg:'C', pt:abc.ptC, prev:abc.ptB,   color:'#ff44aa',
                    desc:`Thrust · ${abc.cEqA!=null?fibPct(abc.cEqA)+' of A':'pending'}`,
                    len:abc.LC, ratio:abc.cEqA },
                ].map(row=>{
                  const isSet=!!row.pt;
                  return (
                    <div key={row.leg} style={{background:'#060e1a',border:`1px solid ${row.color}33`,padding:'10px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                        <span style={{color:row.color,fontWeight:'bold',fontSize:'16px'}}>{row.leg}</span>
                        <span style={{fontSize:'8px',color:isSet?'#00ff88':'#ff9900'}}>{isSet?'✓ SET':'PENDING'}</span>
                      </div>
                      <div style={{fontSize:'8px',color:'#4a6a8a',lineHeight:'1.5',marginBottom:'4px'}}>{row.desc}</div>
                      {row.len!=null&&(
                        <div style={{fontSize:'11px',color:'#c8d8f0',fontWeight:'bold'}}>${row.len.toFixed(2)}</div>
                      )}
                      {row.pt&&(
                        <div style={{fontSize:'8px',color:'#2a4060',marginTop:'2px'}}>@ ${row.pt.v.toFixed(2)}</div>
                      )}
                      {/* Fibonacci quality bar */}
                      {row.ratio!=null&&(()=>{
                        const refs=row.leg==='B'?[0.382,0.500,0.618]:[0.618,1.000,1.618];
                        const err=Math.min(...refs.map(t=>Math.abs(row.ratio-t)/t));
                        const q=err<0.05?'#00ff88':err<0.15?'#ffaa00':'#ff4466';
                        return (
                          <div style={{marginTop:'6px'}}>
                            <div style={{height:'2px',background:'#0d1f35',borderRadius:'1px'}}>
                              <div style={{height:'100%',width:`${Math.min(100,(1-err/0.20)*100)}%`,background:q,borderRadius:'1px'}}/>
                            </div>
                            <div style={{fontSize:'7px',color:q,marginTop:'1px'}}>
                              Fib fit: {err<0.05?'Ideal':err<0.15?'Good':'Weak'}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* C-wave price targets — active only */}
              {abc.cTargets&&(()=>{
                const curP=selStock.quote?.price||effPrices[effPrices.length-1]?.close||0;
                // Correction direction is opposite to impulse
                const aheadC=v=>abc.isBull?v<curP:v>curP;
                const allC=[
                  { label:'C = 61.8% A', val:abc.cTargets.fib618,  color:'#aa44cc', note:'Shallow' },
                  { label:'C = A',        val:abc.cTargets.fib100,  color:'#dd66ff', note:'Most Common' },
                  { label:'C = 161.8% A', val:abc.cTargets.fib1618, color:'#ffaaff', note:'Extended' },
                ];
                const activeC=allC.filter(p=>isFinite(p.val)&&aheadC(p.val));
                if (!activeC.length) return null;
                return (
                <>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                    <div style={{fontSize:'8px',color:'#5a2a7a',letterSpacing:'2px'}}>
                      WAVE C ACTIVE TARGETS — from B @ ${abc.ptB?.v.toFixed(2)||'—'}
                    </div>
                    {activeC.length<3&&<div style={{fontSize:'7.5px',color:'#2a1a3a'}}>{3-activeC.length} passed</div>}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:`repeat(${activeC.length},1fr)`,gap:'6px',marginBottom:'10px'}}>
                    {activeC.map(p=>{
                      const pct=((p.val-(selStock.quote?.price||p.val))/(selStock.quote?.price||1))*100;
                      return (
                        <div key={p.label} style={{background:'#070f1c',border:`1px solid ${p.color}33`,padding:'8px',textAlign:'center'}}>
                          <div style={{color:p.color,fontSize:'14px',fontWeight:'bold'}}>${p.val.toFixed(2)}</div>
                          <div style={{color:'#3a3a5a',fontSize:'8px',marginTop:'2px'}}>{p.label}</div>
                          <div style={{color:abc.isBull?'#ff4466':'#00ff88',fontSize:'9px',marginTop:'3px'}}>{pct>=0?'+':''}{pct.toFixed(1)}%</div>
                          <div style={{color:'#2a2a4a',fontSize:'8px'}}>{p.note}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
                );
              })()}

              <div style={{padding:'8px',background:'#060c14',fontSize:'8px',color:'#3a2a5a',lineHeight:'1.7'}}>
                <span style={{color:'#5a3a7a'}}>PRECHTER / NEELY — </span>
                Zigzag (5-3-5): A subdivides as 5 waves, B retraces 50–78.6% of A, C equals A or 61.8%/161.8% of A.
                Flat (3-3-5): B retraces &gt;80% of A, often re-testing the W5 extreme.
                {abc.complete
                  ? <span style={{color:'#dd66ff'}}> ABC complete — look for Wave (1) of next impulse or deeper nested correction.</span>
                  : <span style={{color:'#ffcc44'}}> Sequence in progress — wait for {!abc.ptB?'B then C':'C leg'} confirmation before positioning.</span>}
              </div>
            </div>
            )}

            {/* ── Neely guidelines ── */}
            <div style={{background:'#0a1628',border:'1px solid #1a3050',padding:'12px',marginBottom:'8px'}}>
              <div style={{fontSize:'9px',color:'#3a5a7a',letterSpacing:'2px',marginBottom:'8px'}}>NEELY GUIDELINES — MASTERING ELLIOTT WAVE</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px',fontSize:'9px',lineHeight:'1.7'}}>
                <div style={{color:ew.w2ret>0.50&&ew.w4ret<0.382?'#00ff88':'#4a6a8a'}}>
                  {ew.w2ret>0.50&&ew.w4ret<0.382?'✓':'○'} Alternation: W2 sharp / W4 flat
                </div>
                <div style={{color:ew.L3>=ew.L1&&ew.L3>=ew.L5?'#00ff88':'#4a6a8a'}}>
                  {ew.L3>=ew.L1&&ew.L3>=ew.L5?'✓':'○'} Wave 3 longest (strongest)
                </div>
                <div style={{color:'#4a6a8a'}}>○ Channel: base line W1–W2, parallel from W3 end</div>
                <div style={{color:ew.waveStatus==='forming'?'#ffaa00':'#4a6a8a'}}>
                  {ew.waveStatus==='forming'?'▶':'○'} W5 RSI/MACD divergence expected
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FILTERS — Professional swing trader presets
// ══════════════════════════════════════════════════════════════════════════════
const FILTERS = {
  "Active Setups":         s=>s.pattern.stage!=="Target Hit"&&s.pattern.stage!=="Invalidated",
  "High Probability":      s=>s.pattern.reliability>=75&&s.pattern.stage!=="Target Hit"&&s.pattern.stage!=="Invalidated",
  "Confirmed Breakouts":   s=>s.pattern.stage==="Confirmed",
  "Bullish Only":          s=>s.pattern.breakout==="bullish"&&s.pattern.stage!=="Target Hit"&&s.pattern.stage!=="Invalidated",
  "Bearish / Short":       s=>s.pattern.breakout==="bearish"&&s.pattern.stage!=="Target Hit"&&s.pattern.stage!=="Invalidated",
  "RSI Oversold <40":      s=>s.rsi<40,
  "RSI Overbought >65":    s=>s.rsi>65,
  "Volume Surge >1.3x":    s=>s.volData.trend>1.3,
  "Score ≥75":             s=>s.score>=75,
  "Divergence Signal":     s=>s.divergence.bullDiv||s.divergence.bearDiv,
  "Target Hit ✓":          s=>s.pattern.stage==="Target Hit",
  "Invalidated ✗":         s=>s.pattern.stage==="Invalidated",
  "All":                   ()=>true,
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function SwingScanner() {
  const [stocks, setStocks]       = useState([]);
  const [selected, setSelected]   = useState(null);
  const [tab, setTab]             = useState("scanner");
  const [filter, setFilter]       = useState("Active Setups");
  const [sortBy, setSortBy]       = useState("score");
  const [search, setSearch]       = useState("");
  const [loadingMap, setLoadingMap] = useState({});
  const [errorMap, setErrorMap]   = useState({});
  const [scanProgress, setScanProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [watchlist, setWatchlist] = useState(()=>{
    try {
      const saved = JSON.parse(localStorage.getItem(WL_CACHE_KEY));
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return DEFAULT_WATCHLIST;
  });
  const [addSym, setAddSym]       = useState("");
  const abortRef = useRef(null);
  const isMobile = useIsMobile();
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  // Lazy chart enable — desktop renders immediately, mobile waits for browser idle
  // This gives the list a chance to paint before the expensive SVG renders start
  const [chartsEnabled, setChartsEnabled] = useState(!IS_MOBILE);
  const mono = "'Courier New','Lucida Console',monospace";

  // Persist watchlist changes to localStorage
  useEffect(()=>{
    try { localStorage.setItem(WL_CACHE_KEY, JSON.stringify(watchlist)); } catch {}
  },[watchlist]);

  // Enable charts on mobile after first paint settles (requestIdleCallback)
  useEffect(()=>{
    if (!IS_MOBILE) return;
    const ric = typeof requestIdleCallback !== "undefined" ? requestIdleCallback : (cb=>setTimeout(cb,150));
    const id = ric(()=>setChartsEnabled(true));
    return ()=>{ if (typeof cancelIdleCallback!=="undefined") cancelIdleCallback(id); };
  },[]);

  const loadSingle = useCallback(async (sym, { skipNetwork=false }={}) => {
    try {
      setLoadingMap(m=>({...m,[sym]:true}));
      setErrorMap(m=>({...m,[sym]:null}));

      let prices, quote;
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

      // ── L1: in-memory hot cache (zero latency) ────────────────────────────
      const hotCached = dataCache[sym];
      if (hotCached && Date.now() - hotCached.ts < DATA_CACHE_TTL) {
        prices = hotCached.prices;
        quote  = hotCached.quote;
      } else {
        // ── L2: IndexedDB (fast async, no size limit) ─────────────────────
        const idbCached = await idb.get("prices", sym);
        if (idbCached && idbCached.prices && Date.now() - idbCached.ts < DATA_CACHE_TTL) {
          prices = idbCached.prices;
          quote  = idbCached.quote;
          dataCache[sym] = { prices, quote, ts: idbCached.ts }; // promote to L1
        } else if (!isOnline || skipNetwork) {
          // ── Offline fallback: use whatever stale data we have ─────────────
          if (idbCached?.prices) { prices = idbCached.prices; quote = idbCached.quote; }
          else if (hotCached)    { prices = hotCached.prices;  quote = hotCached.quote; }
          else throw new Error("Offline – no cached data");
        } else {
          // ── L3: Network fetch ─────────────────────────────────────────────
          [prices, quote] = await Promise.all([fetchHistory(sym), fetchQuote(sym)]);
          // Persist to both caches
          dataCache[sym] = { prices, quote, ts: Date.now() };
          idb.put("prices", sym, { prices, quote, ts: Date.now() }); // fire-and-forget
        }
      }

      if (!prices||prices.length<20) throw new Error("Insufficient data");

      const pattern = (() => {
        try { return detectPatterns(prices) || null; } catch(e) { return null; }
      })() || {
        name:"No Pattern", conf:40, stage:"Forming", breakout:"neutral",
        reliability:50, avgGain:0, avgLoss:0, failRate:0, targetMet:0, minBars:0,
        category:"N/A", murphyRef:"—", geo:null
      };
      const volData    = (() => { try { return calcVolume(prices); } catch { return { trend:1, obv:0, avgVol:0 }; } })();
      const divergence = (() => { try { return detectDivergence(prices); } catch { return { bullDiv:false, bearDiv:false }; } })();
      const trendStr   = (() => { try { return calcTrendStrength(prices); } catch { return { adx:25, trending:false, bullTrend:false }; } })();
      const { total: score, breakdown: scoreBreakdown } = (() => { try { return scoreStock(prices, pattern, volData, divergence, trendStr); } catch { return { total:40, breakdown:null }; } })();
      const rsi        = calcRSI(prices);
      const macd       = calcMACD(prices);
      const atr        = calcATR(prices);
      const sma20      = calcSMA(prices, 20);
      const sma50      = calcSMA(prices, 50);
      const relPos     = calcRelPosition(prices);
      const chg        = quote.prevClose>0 ? ((quote.price-quote.prevClose)/quote.prevClose)*100 : 0;

      // Target price — Bulkowski measured-move method (pattern geometry)
      const bulkTarget = calcBulkowskiTarget(pattern, quote.price);
      const targetPrice = bulkTarget?.target ?? quote.price;
      const targetMethod = bulkTarget?.method ?? "N/A";
      const targetHeight = bulkTarget?.height ?? 0;
      const targetBreakout = bulkTarget?.breakout ?? quote.price;
      const targetHit = (() => {
        const startI = pattern.geo?.startI ?? 0;
        const slice  = prices.slice(startI);
        const hiHist = safeMax(slice.map(p=>p.high));
        const loHist = safeMin(slice.map(p=>p.low));
        return pattern.breakout==="bullish" ? hiHist>=targetPrice
             : pattern.breakout==="bearish" ? loHist<=targetPrice : false;
      })();
      if (targetHit) pattern.stage="Target Hit";

      // Invalidation check — scans full pattern history, not just current price
      const { invalidated, reason: invalidReason, isBusted=false, bustedTarget=null } = checkPatternInvalidation(pattern, prices, quote.price);
      if (invalidated && pattern.stage!=="Target Hit") pattern.stage="Invalidated";

      // Risk/Reward
      const stopDist  = atr*1.5;
      const entry     = quote.price;
      const stop      = pattern.breakout==="bullish" ? entry-stopDist : entry+stopDist;
      const target    = targetPrice;
      const rr        = stopDist>0 ? Math.abs(target-entry)/stopDist : 0;

      setStocks(prev=>{
        const idx=prev.findIndex(s=>s.sym===sym);
        const elliottWave = (() => { try { return detectElliottWave(prices); } catch(e) { return null; } })();
        const entry2={sym,prices,pattern,score,scoreBreakdown,quote,chg,rsi,macd,volData,divergence,trendStr,atr,sma20,sma50,relPos,targetPrice,targetMethod,targetHeight,targetBreakout,targetHit,invalidated,invalidReason,isBusted,bustedTarget,stop,rr,elliottWave};
        if (idx>=0){const n=[...prev];n[idx]=entry2;return n;}
        return [...prev,entry2];
      });
    } catch(e) {
      setErrorMap(m=>({...m,[sym]:e.message||"Failed"}));
    } finally {
      setLoadingMap(m=>({...m,[sym]:false}));
    }
  },[]);

  const runScan = useCallback(async(list, { backgroundRefresh=false }={})=>{
    if (abortRef.current) abortRef.current=false;
    abortRef.current=true;

    // ── Tier 0: try server pre-scan endpoint first (< 1s, no per-symbol calls) ─
    // The Vercel cron runs /api/scan every 20 min during market hours.
    // On mobile this alone can replace the entire client-side scan.
    let serverScores = {};
    if (!backgroundRefresh) {
      try {
        const sr = await fetch("/api/scan", { signal: AbortSignal.timeout(3000) });
        if (sr.ok) {
          const { stocks: srvStocks, ts: srvTs } = await sr.json();
          if (Array.isArray(srvStocks) && srvStocks.length) {
            // Server returns pre-sorted lightweight summaries — show immediately
            // (no prices array, so charts will fill in from full scan below)
            for (const s of srvStocks) serverScores[s.sym] = s.score || 0;
            // Merge server scores into existing stock state (don't overwrite prices)
            setStocks(prev => {
              if (!prev.length) return prev; // wait for IDB or scan
              return prev.map(s => {
                const srv = srvStocks.find(x=>x.sym===s.sym);
                return srv ? { ...s, score: srv.score, chg: srv.chg ?? s.chg } : s;
              });
            });
          }
        }
      } catch { /* /api/scan optional — fall through to IDB/network */ }
    }

    // ── Stale-while-revalidate: show IDB cache instantly on cold load ─────────
    let cachedScores = {}; // used for score-ordered scanning below
    if (!backgroundRefresh) {
      const cached = await loadScanCache(); // async IDB read
      if (cached) {
        setStocks(cached.stocks);
        setIsFromCache(true);
        setLastUpdate(new Date(cached.ts));
        setScanProgress(100);
        // Build score map so we scan best candidates first
        for (const s of cached.stocks) cachedScores[s.sym] = s.score || 0;

        const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
        if (!cached.stale && !isOnline) {
          setIsScanning(false); abortRef.current=false; return;
        }
        await new Promise(r=>setTimeout(r,200)); // let UI paint cached results
      }
    }

    // ── Score-order: scan previously high-scoring stocks first ───────────────
    // Merge server scores (freshest) with IDB scores for best ordering
    const mergedScores = { ...cachedScores, ...serverScores };
    const sortedList = [...list].sort((a,b)=>(mergedScores[b]||0)-(mergedScores[a]||0));

    setIsScanning(true);
    if (!backgroundRefresh) { setStocks([]); setScanProgress(0); setErrorMap({}); }
    const batchSize  = IS_MOBILE ? 3 : 5; // IDB cache hits make each call fast now
    const batchDelay = IS_MOBILE ? 200 : 100;
    for (let i=0; i<sortedList.length; i+=batchSize) {
      if (!abortRef.current) break;
      await Promise.all(sortedList.slice(i,i+batchSize).map(s=>loadSingle(s)));
      setScanProgress(Math.round(Math.min(100,((i+batchSize)/sortedList.length)*100)));
      if (batchDelay>0) await new Promise(r=>setTimeout(r,batchDelay));
    }
    setIsScanning(false); setIsFromCache(false); setLastUpdate(new Date()); abortRef.current=false;

    // Persist fresh results to IDB (fire-and-forget)
    setStocks(cur => { saveScanCache(cur); return cur; });
  },[loadSingle]);

  useEffect(()=>{runScan(watchlist);},[]);

  const filtered = stocks
    .filter(s=>FILTERS[filter](s))
    .filter(s=>s.sym.toLowerCase().includes(search.toLowerCase())||
               (s.quote?.name||"").toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>
      sortBy==="score"       ? b.score-a.score :
      sortBy==="reliability" ? b.pattern.reliability-a.pattern.reliability :
      sortBy==="rsi"         ? b.rsi-a.rsi :
      sortBy==="chg"         ? b.chg-a.chg :
      sortBy==="rr"          ? b.rr-a.rr : b.score-a.score);

  const sel = selected ? stocks.find(s=>s.sym===selected) : null;

  // Top picks
  const topBull = stocks.filter(s=>s.pattern.breakout==="bullish"&&s.pattern.stage!=="Target Hit"&&!s.invalidated).sort((a,b)=>b.score-a.score).slice(0,5);
  const topBear = stocks.filter(s=>s.pattern.breakout==="bearish"&&s.pattern.stage!=="Target Hit"&&!s.invalidated).sort((a,b)=>b.score-a.score).slice(0,5);

  const stageColor  = (st) => st==="Confirmed"?"#00ff88":st==="Target Hit"?"#ffdd00":st==="Invalidated"?"#ff6600":"#ffaa00";
  const stageBg     = (st) => st==="Confirmed"?"#0a2a10":st==="Target Hit"?"#1a1500":st==="Invalidated"?"#2a1000":"#2a1800";
  const breakColor  = (b)  => b==="bullish"?"#00ff88":b==="bearish"?"#ff4466":"#ffaa00";

  return (
    <div style={{background:"#060e1c",color:"#c8d8f0",fontFamily:mono,minHeight:"100vh",fontSize:"12px",paddingBottom:isMobile?"64px":"0"}}>

      {/* ── HEADER ── */}
      <div style={{background:"#080f1e",borderBottom:"1px solid #1a3050",padding:isMobile?"8px 12px":"10px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <span style={{color:"#00d4ff",fontSize:"16px"}}>◆</span>
            <span style={{color:"#e0f0ff",fontSize:isMobile?"12px":"15px",fontWeight:"bold",letterSpacing:isMobile?"1px":"3px"}}>{isMobile?"SWING SCANNER":"SWING TRADE SCANNER"}</span>
            {!isMobile&&<span style={{fontSize:"9px",color:"#1a4060",background:"#0d1f3c",padding:"2px 8px",letterSpacing:"1px"}}>BULKOWSKI + MURPHY</span>}
          </div>
          {!isMobile&&<div style={{fontSize:"9px",color:"#2a4a6a",marginTop:"2px",letterSpacing:"1px"}}>ENCYCLOPEDIA OF CHART PATTERNS · TECHNICAL ANALYSIS OF FINANCIAL MARKETS</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
          {isScanning&&(
            <div style={{fontSize:"10px",color:"#ffaa00"}}>
              SCANNING {Math.round(scanProgress)}%
              <div style={{height:"2px",background:"#1a3050",width:"80px",marginTop:"3px",borderRadius:"1px"}}>
                <div style={{height:"100%",width:`${scanProgress}%`,background:"#00d4ff",borderRadius:"1px",transition:"width 0.3s"}}/>
              </div>
            </div>
          )}
          {lastUpdate&&!isScanning&&<div style={{textAlign:"right"}}>
            {isFromCache&&<div style={{fontSize:"8px",color:"#ffaa00",letterSpacing:"0.5px",marginBottom:"1px"}}>
              {typeof navigator!=="undefined"&&!navigator.onLine?"📵 OFFLINE":"⚡ CACHED"}
            </div>}
            {!isMobile&&<div style={{fontSize:"8px",color:"#3a5a7a"}}>LAST SCAN</div>}
            <div style={{color:isFromCache?"#ffaa00":"#00ff88",fontSize:"10px"}}>{lastUpdate.toLocaleTimeString()}</div>
          </div>}
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:"8px",color:"#3a5a7a"}}>LOADED</div>
            <div style={{color:"#ffaa00",fontSize:"10px"}}>{stocks.length}/{watchlist.length}</div>
          </div>
          <button onClick={()=>runScan(watchlist)} disabled={isScanning}
            style={{background:"transparent",border:"1px solid #1a4060",color:isScanning?"#3a5a7a":"#00d4ff",
            padding:isMobile?"6px 10px":"6px 14px",cursor:isScanning?"default":"pointer",letterSpacing:"1px",fontSize:"10px"}}>
            ⟳{isMobile?"":" RESCAN"}
          </button>
        </div>
      </div>

      {/* ── TABS ── */}
      {!isMobile&&<div style={{display:"flex",background:"#080f1c",borderBottom:"1px solid #1a3050",overflowX:"auto"}}>
        {[["scanner","SCANNER"],["picks","TOP PICKS"],["rotation","SECTOR ROTATION"],["intermarket","INTERMARKET"],["heatmap","HEATMAP"],["watchlist","WATCHLIST"],["guide","PATTERN GUIDE"],["bottomfinder","📉 BOTTOM FINDER"],["elliott","〜 ELLIOTT WAVE"]].map(([k,label])=>(
          <button key={k} onClick={()=>setTab(k)} style={{
            background:tab===k?"#0d1f3c":"transparent", border:"none",
            borderBottom:tab===k?"2px solid #00d4ff":"2px solid transparent",
            color:tab===k?"#00d4ff":"#3a5a7a",
            padding:"8px 16px",cursor:"pointer",letterSpacing:"2px",fontSize:"10px",textTransform:"uppercase",fontFamily:mono,
          }}>{label}</button>
        ))}
      </div>}

      {/* ══ SCANNER TAB ══ */}
      {tab==="scanner"&&(
        <div style={{display:"flex",flexDirection:isMobile?"column":"row",height:isMobile?"auto":"calc(100vh - 96px)"}}>

          {/* Left panel */}
          <div style={{width:(!isMobile&&sel)?"52%":"100%",display:isMobile&&mobileDetailOpen?"none":"flex",flexDirection:"column",transition:"width 0.2s"}}>

            {/* Controls bar */}
            <div style={{padding:isMobile?"10px 12px":"8px 14px",background:"#080f1c",borderBottom:"1px solid #1a3050",display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SEARCH..."
                style={{background:"#0d1f3c",border:"1px solid #1a4060",color:"#c8d8f0",padding:"4px 8px",fontSize:"11px",fontFamily:mono,width:"100px",outline:"none",letterSpacing:"1px"}}/>
              <select value={filter} onChange={e=>setFilter(e.target.value)}
                style={{background:"#0d1f3c",border:"1px solid #1a4060",color:"#c8d8f0",padding:"4px 8px",fontSize:"10px",fontFamily:mono,outline:"none",cursor:"pointer"}}>
                {Object.keys(FILTERS).map(f=><option key={f}>{f}</option>)}
              </select>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                style={{background:"#0d1f3c",border:"1px solid #1a4060",color:"#c8d8f0",padding:"4px 8px",fontSize:"10px",fontFamily:mono,outline:"none",cursor:"pointer"}}>
                <option value="score">↓ SCORE</option>
                <option value="reliability">↓ RELIABILITY</option>
                <option value="rr">↓ RISK/REWARD</option>
                <option value="rsi">↓ RSI</option>
                <option value="chg">↓ % CHG</option>
              </select>
              <span style={{fontSize:"10px",color:"#3a5a7a"}}>{filtered.length} results</span>
              <span style={{marginLeft:"auto",fontSize:"9px",color:"#1a3a5a"}}>
                {stocks.filter(s=>s.pattern.stage==="Confirmed").length} confirmed · {stocks.filter(s=>s.divergence?.bullDiv||s.divergence?.bearDiv).length} divergences · <span style={{color:"#ff6600"}}>{stocks.filter(s=>s.pattern.stage==="Invalidated").length} invalidated</span>
              </span>
            </div>

            {/* Column headers — desktop only */}
            {!isMobile&&<div style={{display:"grid",gridTemplateColumns:"64px 1fr 100px 82px 44px 58px 56px 58px 52px",
              padding:"4px 14px",background:"#0a1422",borderBottom:"1px solid #1a3050",
              color:"#2a4a6a",fontSize:"9px",letterSpacing:"1px",gap:"4px"}}>
              <span>SYM</span><span>PATTERN</span><span>CHART</span><span>STAGE</span>
              <span>RSI</span><span>RELBL%</span><span>R/R</span><span>DAY%</span><span>SCORE</span>
            </div>}

            {/* Rows */}
            <div style={{flex:1,overflowY:"auto"}}>
              {stocks.length===0&&isScanning&&(
                <div style={{padding:"60px",textAlign:"center",color:"#3a5a7a"}}>
                  <div style={{fontSize:"28px",marginBottom:"12px",animation:"pulse 1s infinite"}}>◌</div>
                  <div style={{letterSpacing:"4px"}}>SCANNING MARKETS...</div>
                  <div style={{fontSize:"10px",marginTop:"8px",color:"#1a3050"}}>Fetching OHLCV data · Detecting {Object.keys(PATTERNS_DB).length} pattern types</div>
                </div>
              )}
              {filtered.map(s=>{
                const isSel=selected===s.sym;
                const dc=breakColor(s.pattern.breakout);
                const cc=s.chg>=0?"#00ff88":"#ff4466";
                const hasDiverg=s.divergence?.bullDiv||s.divergence?.bearDiv;
                if (isMobile) return (
                  <div key={s.sym} onClick={()=>{setSelected(isSel?null:s.sym);if(!isSel)setMobileDetailOpen(true);}}
                    style={{display:"flex",alignItems:"center",gap:"10px",padding:"12px",
                      borderBottom:"1px solid #0d1828",cursor:"pointer",
                      background:isSel?"#0d2040":"transparent",
                      borderLeft:isSel?"3px solid #00d4ff":s.invalidated?"3px solid #ff6600":"3px solid transparent",
                      opacity:s.targetHit?0.65:s.invalidated?0.5:1}}>
                    <div style={{minWidth:"48px"}}>
                      <div style={{color:"#e0f0ff",fontWeight:"bold",fontSize:"14px"}}>{s.sym}</div>
                      <div style={{fontSize:"10px",color:cc}}>{s.chg>=0?"+":""}{s.chg.toFixed(2)}%</div>
                      {hasDiverg&&<div style={{fontSize:"9px",color:s.divergence.bullDiv?"#00ff88":"#ff4466"}}>⚡</div>}
                    </div>
                    {chartsEnabled
                      ? <MiniChart prices={s.prices} pattern={s.pattern} width={68} height={36}/>
                      : <div style={{width:68,height:36,background:"#0a1428",borderRadius:"2px"}}/>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:dc,fontSize:"11px",fontWeight:"bold",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.pattern.name}</div>
                      <div style={{display:"flex",gap:"6px",marginTop:"3px",alignItems:"center"}}>
                        <span style={{background:stageBg(s.pattern.stage),color:stageColor(s.pattern.stage),padding:"2px 6px",fontSize:"9px",borderRadius:"2px"}}>{s.pattern.stage}</span>
                        <span style={{color:"#3a5a7a",fontSize:"9px"}}>RSI {s.rsi}</span>
                        {s.rr>0&&<span style={{color:s.rr>=2?"#00ff88":"#ffaa00",fontSize:"9px"}}>{s.rr.toFixed(1)}R</span>}
                      </div>
                    </div>
                    <div style={{textAlign:"center",minWidth:"38px"}}>
                      <div style={{color:s.score>=75?"#00ff88":s.score>=55?"#ffaa00":"#ff4466",fontSize:"20px",fontWeight:"bold",lineHeight:1}}>{s.score}</div>
                      <div style={{fontSize:"8px",color:"#3a5a7a"}}>SCORE</div>
                    </div>
                    <span style={{color:"#2a4a6a",fontSize:"18px"}}>›</span>
                  </div>
                );
                return (
                  <div key={s.sym} onClick={()=>setSelected(isSel?null:s.sym)}
                    style={{display:"grid",gridTemplateColumns:"64px 1fr 100px 82px 44px 58px 56px 58px 52px",
                      padding:"5px 14px",gap:"4px",alignItems:"center",cursor:"pointer",
                      borderBottom:"1px solid #0d1828",
                      background:isSel?"#0d2040":s.targetHit?"#0a1208":"transparent",
                      borderLeft:isSel?"2px solid #00d4ff":s.invalidated?"2px solid #ff6600":"2px solid transparent",
                      opacity:s.targetHit?0.65:s.invalidated?0.5:1,
                    }}>
                    <div>
                      <div style={{color:"#e0f0ff",fontWeight:"bold",fontSize:"12px",letterSpacing:"1px"}}>{s.sym}</div>
                      <div style={{fontSize:"8px",color:"#3a5a7a"}}>{s.quote?.exchange}</div>
                      {hasDiverg&&<div style={{fontSize:"8px",color:s.divergence.bullDiv?"#00ff88":"#ff4466"}}>⚡DIV</div>}
                    </div>
                    <div>
                      <div style={{color:dc,fontSize:"10px",letterSpacing:"0.5px"}}>{s.pattern.name}</div>
                      <div style={{fontSize:"8px",color:"#3a5a7a"}}>{s.pattern.category}</div>
                    </div>
                    {chartsEnabled
                      ? <MiniChart prices={s.prices} pattern={s.pattern} width={96} height={40}/>
                      : <div style={{width:96,height:40,background:"#0a1428",borderRadius:"2px"}}/>}
                    <span style={{background:stageBg(s.pattern.stage),color:stageColor(s.pattern.stage),
                      border:`1px solid ${stageColor(s.pattern.stage)}40`,
                      padding:"3px 7px",fontSize:"9px",letterSpacing:"0.5px",textAlign:"center"}}>
                      {s.pattern.stage.toUpperCase()}
                    </span>
                    <span style={{color:s.rsi>70?"#ff4466":s.rsi<30?"#00ff88":"#c8d8f0",textAlign:"center"}}>{s.rsi}</span>
                    <span style={{color:s.pattern.reliability>=75?"#00ff88":"#ffaa00",textAlign:"center"}}>{s.pattern.reliability}%</span>
                    <span style={{color:s.rr>=2?"#00ff88":s.rr>=1.5?"#ffaa00":"#ff4466",textAlign:"center"}}>{s.rr>0?s.rr.toFixed(1)+"R":"—"}</span>
                    <span style={{color:cc,textAlign:"right"}}>{s.chg>=0?"+":""}{s.chg.toFixed(2)}%</span>
                    <div style={{textAlign:"right"}}>
                      <span style={{color:s.score>=75?"#00ff88":s.score>=55?"#ffaa00":"#ff4466",fontSize:"13px",fontWeight:"bold"}}>{s.score}</span>
                    </div>
                  </div>
                );
              })}
              {/* Error rows */}
              {Object.entries(errorMap).filter(([,e])=>e).map(([sym,err])=>(
                <div key={sym} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"6px 14px",borderBottom:"1px solid #1a0a0a",color:"#ff4466",fontSize:"10px"}}>
                  <span style={{color:"#ff4466",fontWeight:"bold"}}>{sym}</span>
                  <span style={{color:"#4a1a1a"}}>✕ {err}</span>
                  <button onClick={()=>loadSingle(sym)} style={{background:"none",border:"1px solid #4a1a1a",color:"#ff4466",cursor:"pointer",padding:"2px 8px",fontSize:"9px",fontFamily:mono}}>RETRY</button>
                </div>
              ))}
            </div>
          </div>

          {/* ── DETAIL PANEL ── */}
          {sel&&(
            <ErrorBoundary>
            <div style={{
              width:isMobile?"100%":"48%",
              position:isMobile?"fixed":"relative",
              top:isMobile?0:"auto",left:isMobile?0:"auto",right:isMobile?0:"auto",bottom:isMobile?0:"auto",
              zIndex:isMobile?500:"auto",
              display:isMobile&&!mobileDetailOpen?"none":"block",
              borderLeft:isMobile?"none":"1px solid #1a3050",
              background:"#07101e",overflowY:"auto",WebkitOverflowScrolling:"touch",
              padding:isMobile?"0":"16px",
            }}>
            {isMobile&&(
              <div style={{position:"sticky",top:0,zIndex:10,background:"#07101e",borderBottom:"1px solid #1a3050",padding:"0"}}>
                <button onClick={()=>{setMobileDetailOpen(false);setSelected(null);}}
                  style={{display:"flex",alignItems:"center",gap:"8px",width:"100%",background:"transparent",
                    border:"none",color:"#00d4ff",padding:"14px 16px",cursor:"pointer",fontSize:"14px",fontFamily:mono}}>
                  ‹ Back to Scanner
                </button>
              </div>
            )}
            <div style={{padding:isMobile?"14px":"16px"}}>

              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px"}}>
                <div>
                  <div style={{fontSize:"22px",fontWeight:"bold",color:"#e0f0ff",letterSpacing:"3px"}}>{sel.sym}</div>
                  <div style={{fontSize:"10px",color:"#4a6a8a",marginBottom:"2px"}}>{sel.quote?.name}</div>
                  <div style={{fontSize:"10px",letterSpacing:"1px",color:breakColor(sel.pattern.breakout)}}>
                    {sel.pattern.name.toUpperCase()} · {sel.pattern.breakout.toUpperCase()} · {sel.pattern.category.toUpperCase()}
                  </div>
                  {sel.targetHit&&(
                    <div style={{marginTop:"5px",background:"#1a1500",border:"1px solid #ffdd00",padding:"4px 10px",fontSize:"9px",color:"#ffdd00",letterSpacing:"1px"}}>
                      ✓ TARGET REACHED — Review exit or re-evaluate
                    </div>
                  )}
                  {(sel.divergence?.bullDiv||sel.divergence?.bearDiv)&&(
                    <div style={{marginTop:"5px",background:sel.divergence.bullDiv?"#0a1a0a":"#1a0a0a",
                      border:`1px solid ${sel.divergence.bullDiv?"#00ff88":"#ff4466"}`,
                      padding:"4px 10px",fontSize:"9px",color:sel.divergence.bullDiv?"#00ff88":"#ff4466",letterSpacing:"1px"}}>
                      ⚡ {sel.divergence.bullDiv?"BULLISH":"BEARISH"} RSI DIVERGENCE DETECTED
                    </div>
                  )}
                  {sel.invalidated&&(
                    <div style={{marginTop:"5px",background:"#1e0800",border:"2px solid #ff6600",padding:"8px 10px",fontSize:"9px",color:"#ff6600",letterSpacing:"1px"}}>
                      <div>⚠ PATTERN INVALIDATED — {sel.invalidReason}</div>
                      {sel.isBusted && sel.bustedTarget && (
                        <div style={{marginTop:"6px",borderTop:"1px solid #ff660033",paddingTop:"6px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
                          <span style={{color:"#ff4444",fontWeight:"bold",fontSize:"10px"}}>
                            ☠ BUSTED PATTERN
                          </span>
                          <span style={{color:"#ffaa00"}}>
                            Bulkowski downside target:&nbsp;
                            <strong style={{color:"#ff4444",fontSize:"11px"}}>${sel.bustedTarget.toFixed(2)}</strong>
                            &nbsp;({(((sel.bustedTarget - sel.quote?.price) / sel.quote?.price)*100).toFixed(1)}% from here)
                          </span>
                          <span style={{color:"#aa5533",fontSize:"8px"}}>
                            Busted patterns avg 35%+ move opposite to original setup — Bulkowski Ch.11
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:"20px",color:"#e0f0ff",fontWeight:"bold"}}>${sel.quote?.price?.toFixed(2)}</div>
                  <div style={{color:sel.chg>=0?"#00ff88":"#ff4466",fontSize:"12px"}}>{sel.chg>=0?"▲":"▼"} {Math.abs(sel.chg).toFixed(2)}%</div>
                  <div style={{fontSize:"9px",color:"#3a5a7a"}}>Vol: {sel.quote?.volume?.toLocaleString()}</div>
                  <div style={{fontSize:"9px",color:"#3a5a7a",marginTop:"2px"}}>52W: ${sel.relPos.l52.toFixed(2)}–${sel.relPos.h52.toFixed(2)}</div>
                  <div style={{fontSize:"9px",color:"#4a8a6a"}}>Position: {sel.relPos.pct.toFixed(0)}% of range</div>
                </div>
              </div>

              {/* Chart */}
              <div style={{background:"#0a1628",border:"1px solid #1a3050",padding:"8px",marginBottom:"10px"}}>
                <ErrorBoundary>
                  <BigChart prices={sel.prices} symbol={sel.sym} quote={sel.quote} pattern={sel.pattern} targetPrice={sel.targetPrice} targetBreakout={sel.targetBreakout}/>
                </ErrorBoundary>
                <div style={{display:"flex",gap:"12px",marginTop:"4px",fontSize:"9px",color:"#3a5a7a",flexWrap:"wrap"}}>
                  <span style={{color:"#ffaa00"}}>-- SMA20: ${sel.sma20?.toFixed(2)||"--"}</span>
                  <span style={{color:"#aa66ff"}}>-- SMA50: ${sel.sma50?.toFixed(2)||"--"}</span>
                  <span style={{color:breakColor(sel.pattern.breakout)}}>-- PATTERN</span>
                  <span style={{color:"#ffdd00"}}>BKT=Breakout</span>
                  <span style={{color:breakColor(sel.pattern.breakout)}}>T=Target</span>
                  <span style={{color:"#ffdd00"}}>R=Resistance</span>
                  <span style={{color:"#4499ff"}}>S=Support</span>
                </div>
              </div>

              {/* OHLC + ATR row */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"5px",marginBottom:"10px"}}>
                {[
                  {l:"OPEN",v:`$${sel.quote?.open?.toFixed(2)||"--"}`},
                  {l:"HIGH",v:`$${sel.quote?.dayHigh?.toFixed(2)||"--"}`,c:"#00ff88"},
                  {l:"LOW", v:`$${sel.quote?.dayLow?.toFixed(2)||"--"}`, c:"#ff4466"},
                  {l:"ATR(14)",v:`$${sel.atr?.toFixed(2)||"--"}`},
                ].map(x=>(
                  <div key={x.l} style={{background:"#0d1f3c",border:"1px solid #1a3050",padding:"7px"}}>
                    <div style={{fontSize:"8px",color:"#3a5a7a",letterSpacing:"1px"}}>{x.l}</div>
                    <div style={{fontSize:"13px",color:x.c||"#c8d8f0",fontWeight:"bold"}}>{x.v}</div>
                  </div>
                ))}
              </div>

              {/* Indicators 2x3 grid */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px",marginBottom:"10px"}}>
                {[
                  {l:"RSI(14)",v:sel.rsi,sub:sel.rsi>70?"OVERBOUGHT":sel.rsi<30?"OVERSOLD":sel.rsi<45?"NEAR OVERSOLD":"NEUTRAL",c:sel.rsi>70?"#ff4466":sel.rsi<30?"#00ff88":"#c8d8f0"},
                  {l:"MACD",v:sel.macd.hist>0?"BULLISH":"BEARISH",sub:`Hist:${sel.macd.hist}`,c:sel.macd.hist>0?"#00ff88":"#ff4466"},
                  {l:"VOLUME",v:`${(sel.volData.trend*100).toFixed(0)}%`,sub:sel.volData.trend>1.3?"SURGE ✓":sel.volData.trend>1?"ABOVE AVG":"BELOW AVG",c:sel.volData.trend>1.3?"#00ff88":sel.volData.trend>1?"#ffaa00":"#4a6a7a"},
                  {l:"TREND STR",v:sel.trendStr.adx>30?"STRONG":sel.trendStr.adx>20?"MODERATE":"WEAK",sub:`ADX≈${sel.trendStr.adx}`,c:sel.trendStr.adx>25?"#00ff88":"#ffaa00"},
                  {l:"CONFIDENCE",v:`${sel.pattern.conf}%`,sub:sel.pattern.stage,c:stageColor(sel.pattern.stage)},
                  {l:"52W RANGE",v:`${sel.relPos.pct.toFixed(0)}%`,sub:sel.relPos.pct>80?"NEAR HIGH":sel.relPos.pct<20?"NEAR LOW":"MID RANGE",c:sel.relPos.pct>80?"#ffaa00":sel.relPos.pct<20?"#00ff88":"#c8d8f0"},
                ].map(x=>(
                  <div key={x.l} style={{background:"#0d1f3c",border:"1px solid #1a3050",padding:"8px"}}>
                    <div style={{fontSize:"8px",color:"#3a5a7a",letterSpacing:"1px"}}>{x.l}</div>
                    <div style={{fontSize:"13px",color:x.c,fontWeight:"bold"}}>{x.v}</div>
                    <div style={{fontSize:"8px",color:x.c,opacity:0.8}}>{x.sub}</div>
                  </div>
                ))}
              </div>

              {/* Bulkowski stats + Score Breakdown */}
              <div style={{background:"#0a1420",border:"1px solid #1a3050",padding:"10px",marginBottom:"10px"}}>
                <div style={{fontSize:"8px",color:"#2a4a6a",letterSpacing:"2px",marginBottom:"8px"}}>BULKOWSKI BACKTESTED STATISTICS</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"8px",fontSize:"10px",marginBottom:"10px"}}>
                  {[
                    {l:"RELIABILITY",v:`${sel.pattern.reliability}%`,c:sel.pattern.reliability>=75?"#00ff88":"#ffaa00"},
                    {l:"AVG GAIN",v:`${sel.pattern.avgGain??sel.pattern.avgLoss}%`,c:breakColor(sel.pattern.breakout)},
                    {l:"FAIL RATE",v:`${sel.pattern.failRate}%`,c:sel.pattern.failRate<10?"#00ff88":"#ffaa00"},
                    {l:"TARGET MET",v:`${sel.pattern.targetMet}%`,c:sel.pattern.targetMet>65?"#00ff88":"#ffaa00"},
                    {l:"SCORE",v:`${sel.score}`,c:sel.score>=75?"#00ff88":sel.score>=55?"#ffaa00":"#ff4466"},
                  ].map(x=>(
                    <div key={x.l}>
                      <div style={{fontSize:"8px",color:"#3a5a7a"}}>{x.l}</div>
                      <div style={{fontSize:"15px",color:x.c,fontWeight:"bold"}}>{x.v}</div>
                    </div>
                  ))}
                </div>

                {/* Score breakdown bars */}
                {sel.scoreBreakdown&&(
                  <div style={{borderTop:"1px solid #1a3050",paddingTop:"8px"}}>
                    <div style={{fontSize:"8px",color:"#2a4a6a",letterSpacing:"2px",marginBottom:"6px"}}>SCORE BREAKDOWN</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                      {[
                        {key:"patternQuality", label:"Pattern Quality"},
                        {key:"trendAlignment", label:"Trend Alignment"},
                        {key:"momentum",       label:"Momentum"},
                        {key:"volume",         label:"Volume"},
                        {key:"rrSetup",        label:"Risk / Reward"},
                        {key:"marketPosition", label:"Mkt Position"},
                        {key:"divergence",     label:"Divergence"},
                      ].map(({key,label})=>{
                        const f=sel.scoreBreakdown[key]; if(!f) return null;
                        const pct=(f.score/f.max)*100;
                        const c=pct>=70?"#00ff88":pct>=40?"#ffaa00":"#ff4466";
                        return (
                          <div key={key} style={{display:"flex",alignItems:"center",gap:"8px"}}>
                            <div style={{width:"88px",fontSize:"8px",color:"#3a5a7a",letterSpacing:"0.5px",flexShrink:0}}>{label}</div>
                            <div style={{flex:1,height:"6px",background:"#0d1f35",borderRadius:"3px",position:"relative"}}>
                              <div style={{position:"absolute",left:0,top:0,height:"6px",
                                width:`${pct}%`,background:c,borderRadius:"3px",
                                transition:"width 0.4s ease"}}/>
                            </div>
                            <div style={{fontSize:"9px",color:c,fontWeight:"bold",width:"32px",textAlign:"right"}}>
                              {f.score}/{f.max}
                            </div>
                            <div style={{fontSize:"7px",color:"#2a4a6a",width:"180px",overflow:"hidden",
                              textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.detail}</div>
                          </div>
                        );
                      })}
                      {sel.scoreBreakdown.penalties?.length>0&&(
                        <div style={{marginTop:"4px",paddingTop:"4px",borderTop:"1px solid #1a2a3a"}}>
                          {sel.scoreBreakdown.penalties.map((p,i)=>(
                            <div key={i} style={{fontSize:"8px",color:"#ff6600"}}>⚠ {p}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div style={{fontSize:"8px",color:"#1a3050",marginTop:"6px"}}>Ref: {sel.pattern.murphyRef} · {sel.pattern.category} Pattern</div>
              </div>

              {/* ── Murphy Pattern Intelligence (triangles) ───────────────────── */}
              {sel.pattern.geo?.type === "triangle" && (()=>{
                const geo     = sel.pattern.geo;
                const isBear  = sel.pattern.breakout === "bearish";
                const isBull  = sel.pattern.breakout === "bullish";
                const bta     = geo.barsToApex ?? null;
                const comp    = geo.completionPct ?? null;
                const volOk   = geo.volContracting;
                const tTop    = geo.topTouches ?? 0;
                const tBot    = geo.botTouches ?? 0;
                // MA alignment check
                const p = sel.quote?.price, s20 = sel.sma20, s50 = sel.sma50;
                const bearMAStack = isBear && p && s20 && s50 && p < s20 && s20 < s50;
                const bullMAStack = isBull && p && s20 && s50 && p > s20 && s20 > s50;
                // Apex timing quality (Murphy: breakout should happen 2/3→3/4 of way to apex)
                const apexZone = comp != null && comp >= 60 && comp <= 80;
                const apexLate = comp != null && comp > 80;
                const chipStyle = (col) => ({ display:"inline-flex", alignItems:"center", gap:"4px", padding:"3px 8px",
                  background: col+"18", border:`1px solid ${col}44`, color: col, fontSize:"9px",
                  fontFamily:"monospace", letterSpacing:"0.5px", borderRadius:"2px" });
                return (
                  <div style={{background:"#06101e", border:"1px solid #0f2035", padding:"10px 12px", marginBottom:"2px"}}>
                    <div style={{fontSize:"8px",color:"#2a4060",letterSpacing:"2px",marginBottom:"7px"}}>MURPHY PATTERN INTEL — Ch.6</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"6px"}}>
                      {/* Touch count */}
                      {(tTop>0||tBot>0)&&<span style={chipStyle("#8899bb")}>
                        {tTop} RES touch{tTop!==1?"es":""} · {tBot} SUP touch{tBot!==1?"es":""}
                        {(tTop>=3||tBot>=3)?" ✓ HIGH CONF":""}
                      </span>}
                      {/* Volume contraction */}
                      {volOk
                        ? <span style={chipStyle("#00cc88")}>▼ VOL CONTRACTING ✓ — Murphy confirmation</span>
                        : <span style={chipStyle("#ff8800")}>⚠ VOLUME NOT CONTRACTING — watch for false break</span>}
                      {/* MA alignment */}
                      {bearMAStack && <span style={chipStyle("#ff4466")}>BEARISH MA STACK ✓ (price &lt; SMA20 &lt; SMA50)</span>}
                      {bullMAStack && <span style={chipStyle("#00ff88")}>BULLISH MA STACK ✓ (price &gt; SMA20 &gt; SMA50)</span>}
                    </div>
                    {/* Apex progress bar */}
                    {comp != null && bta != null && (
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:"8px",color:"#3a5a7a",marginBottom:"3px"}}>
                          <span>PATTERN COMPLETION — apex in ~{bta} bar{bta!==1?"s":""}</span>
                          <span style={{color: apexLate?"#ff8800": apexZone?"#00ff88":"#5a9acf"}}>
                            {comp}% {apexZone?"✓ IDEAL BREAKOUT ZONE": apexLate?"⚠ GETTING LATE — breakout overdue":"→ still building"}
                          </span>
                        </div>
                        <div style={{height:"5px",background:"#0a1828",borderRadius:"2px",overflow:"hidden"}}>
                          <div style={{height:"100%", width:`${comp}%`,
                            background: apexLate?"#ff8800": apexZone?"#00ff88":"#2a6aaa",
                            borderRadius:"2px", transition:"width 0.3s"}}/>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:"7px",color:"#1a3050",marginTop:"2px"}}>
                          <span>Start</span><span style={{color:"#2a5080"}}>← Ideal zone: 60–80% →</span><span>Apex</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Trade Setup */}
              <div style={{background:sel.pattern.breakout==="bullish"?"#080f08":"#0f0808",
                border:`1px solid ${sel.pattern.breakout==="bullish"?"#1a3a1a":"#3a1a1a"}`,padding:"12px"}}>
                <div style={{fontSize:"8px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"8px"}}>SWING TRADE SETUP</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}}>
                  {[
                    {l:"ENTRY ZONE",v:`$${sel.quote?.price?.toFixed(2)||"--"}`,sub:"Near current price on breakout + volume",c:"#c8d8f0"},
                    {l:"STOP LOSS (1.5×ATR)",v:`$${sel.stop?.toFixed(2)||"--"}`,sub:`Risk: $${sel.atr?.toFixed(2)} per share`,c:"#ff4466"},
                    {l:"TARGET PRICE",v:`$${sel.targetPrice?.toFixed(2)||"--"}`,sub:`${sel.targetMethod||"Bulkowski Measured Move"} ${sel.targetHit?"✓ REACHED":""}`,c:sel.targetHit?"#ffdd00":breakColor(sel.pattern.breakout)},
                    {l:"RISK / REWARD",v:sel.rr>=2?`${sel.rr.toFixed(1)}R ✓`:sel.rr>0?`${sel.rr.toFixed(1)}R`:"—",sub:sel.rr>=2?"Favorable":"Min 2R recommended",c:sel.rr>=2?"#00ff88":sel.rr>=1.5?"#ffaa00":"#ff4466"},
                  ].map(x=>(
                    <div key={x.l} style={{background:"#0a1628",border:"1px solid #1a3050",padding:"8px"}}>
                      <div style={{fontSize:"8px",color:"#3a5a7a",letterSpacing:"1px"}}>{x.l}</div>
                      <div style={{fontSize:"14px",color:x.c,fontWeight:"bold"}}>{x.v}</div>
                      <div style={{fontSize:"8px",color:"#3a5a7a",marginTop:"2px"}}>{x.sub}</div>
                    </div>
                  ))}
                </div>
                {/* Bulkowski Target Projection breakdown */}
                <div style={{background:"#080e1a",border:"1px solid #1a3050",borderLeft:`3px solid ${breakColor(sel.pattern.breakout)}`,padding:"10px",marginBottom:"10px"}}>
                  <div style={{fontSize:"8px",color:"#2a4a6a",letterSpacing:"2px",marginBottom:"8px"}}>BULKOWSKI MEASURED-MOVE PROJECTION</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"8px",fontSize:"10px",marginBottom:"8px"}}>
                    {[
                      {l:"BREAKOUT LEVEL",v:`$${sel.targetBreakout?.toFixed(2)||"--"}`,c:"#ffdd00"},
                      {l:"PATTERN HEIGHT",v:`$${sel.targetHeight?.toFixed(2)||"--"}`,c:"#c8d8f0"},
                      {l:"TARGET PRICE",v:`$${sel.targetPrice?.toFixed(2)||"--"}`,c:sel.targetHit?"#ffdd00":breakColor(sel.pattern.breakout)},
                      {l:"UPSIDE / RISK",v: sel.targetPrice && sel.quote?.price
                        ? `${(((sel.targetPrice-sel.quote.price)/sel.quote.price)*100).toFixed(1)}%`
                        : "--",
                        c: sel.targetPrice > sel.quote?.price ? "#00ff88" : "#ff4466"},
                    ].map(x=>(
                      <div key={x.l}>
                        <div style={{fontSize:"8px",color:"#3a5a7a"}}>{x.l}</div>
                        <div style={{fontSize:"14px",color:x.c,fontWeight:"bold"}}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:"9px",color:"#3a5a7a",borderTop:"1px solid #1a3050",paddingTop:"6px",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:"4px"}}>
                    <span>Method: <span style={{color:"#5a9acf"}}>{sel.targetMethod||"Bulkowski Avg % Move"}</span></span>
                    <span>Bulkowski Target Met: <span style={{color:sel.pattern.targetMet>65?"#00ff88":"#ffaa00"}}>{sel.pattern.targetMet}% of cases</span></span>
                    <span>Avg {sel.pattern.breakout==="bullish"?"Gain":"Move"}: <span style={{color:breakColor(sel.pattern.breakout)}}>{sel.pattern.avgGain??sel.pattern.avgLoss}%</span></span>
                  </div>
                </div>
                <div style={{fontSize:"10px",lineHeight:"1.9",color:sel.pattern.breakout==="bullish"?"#70a070":"#a07070"}}>
                  {sel.pattern.breakout==="bullish"?(<>
                    <div>► Entry: Buy breakout above <strong style={{color:"#ffdd00"}}>${sel.pattern.geo?.resistance?.toFixed(2)||"resistance"}</strong> on elevated volume (1.5×+ avg)</div>
                    <div>► Volume confirm: {sel.volData.trend>1.2?"✓ Volume surging — supports breakout":"⚠ Volume below avg — wait for surge before entry"}</div>
                    <div>► RSI ideal: {sel.rsi>=40&&sel.rsi<=65?"✓ In ideal bull entry zone (40-65)":sel.rsi<40?"⚠ Oversold — watch for turn":"⚠ Overbought — extended, higher risk entry"}</div>
                    <div>► Trend: {sel.sma20&&sel.quote?.price>sel.sma20?"✓ Price above SMA20":"⚠ Price below SMA20 — trend not confirmed"}</div>
                    <div>► Pattern {sel.pattern.stage==="Confirmed"?"✓ CONFIRMED BREAKOUT — highest probability":"forming — wait for close above resistance"}</div>
                  </>):sel.pattern.breakout==="bearish"?(<>
                    <div>► Entry: Short below <strong style={{color:"#ffdd00"}}>${sel.pattern.geo?.support?.toFixed(2)||"support"}</strong> on elevated volume (1.5×+ avg)</div>
                    <div>► Murphy 3% filter: confirmed breakdown requires close below <strong style={{color:"#ff8800"}}>${sel.pattern.geo?.support ? (sel.pattern.geo.support*0.97).toFixed(2) : "—"}</strong> (support × 0.97)</div>
                    <div>► Volume confirm: {sel.volData.trend>1.2?"✓ Volume surging — breakdown confirmed":"⚠ Volume below avg — wait for surge on breakdown bar"}</div>
                    <div>► MA alignment: {sel.sma20&&sel.sma50&&sel.quote?.price<sel.sma20&&sel.sma20<sel.sma50?"✓ Bearish MA stack — price below SMA20 below SMA50":"⚠ MA stack not fully aligned bearish"}</div>
                    <div>► RSI: {sel.rsi<=45?"✓ RSI below 45 — momentum confirming downtrend":sel.rsi<=60?"⚠ RSI mid-range — watch for divergence near support":"⚠ RSI elevated — potential oversold bounce risk after breakdown"}</div>
                    <div>► Pattern {sel.pattern.stage==="Confirmed"?"✓ CONFIRMED BREAKDOWN — highest probability":"forming — wait for close below support on expanding volume"}</div>
                  </>):(<>
                    <div>► Neutral — wait for directional break</div>
                    <div>► Monitor both resistance and support levels</div>
                    <div>► Enter on confirmed close + volume spike</div>
                  </>)}
                </div>
              </div>

            </div>
            </div>
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* ══ TOP PICKS TAB ══ */}
      {tab==="picks"&&(
        <div style={{padding:"20px",maxWidth:"1100px"}}>
          <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"16px"}}>
            TOP SWING TRADE SETUPS — RANKED BY COMPOSITE SCORE
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"20px"}}>
            {[["BULLISH SETUPS",topBull,"bullish"],["BEARISH / SHORT",topBear,"bearish"]].map(([title,list,dir])=>(
              <div key={dir}>
                <div style={{fontSize:"9px",color:dir==="bullish"?"#00ff88":"#ff4466",letterSpacing:"3px",marginBottom:"10px",borderBottom:`1px solid ${dir==="bullish"?"#00ff8830":"#ff446630"}`,paddingBottom:"6px"}}>{title}</div>
                {list.map((s,i)=>(
                  <div key={s.sym} onClick={()=>{setTab("scanner");setSelected(s.sym);}}
                    style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px 0",borderBottom:"1px solid #0d1828",cursor:"pointer"}}>
                    <div style={{color:"#3a5a7a",fontSize:"14px",width:"20px",textAlign:"center"}}>#{i+1}</div>
                    <div style={{width:"48px"}}>
                      <div style={{color:"#e0f0ff",fontWeight:"bold",fontSize:"13px"}}>{s.sym}</div>
                      <div style={{fontSize:"8px",color:s.chg>=0?"#00ff88":"#ff4466"}}>{s.chg>=0?"+":""}{s.chg.toFixed(2)}%</div>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{color:dir==="bullish"?"#00ff88":"#ff4466",fontSize:"10px"}}>{s.pattern.name}</div>
                      <div style={{fontSize:"8px",color:"#3a5a7a"}}>R:{s.pattern.reliability}% · R/R:{s.rr>0?s.rr.toFixed(1)+"R":"—"} · {s.pattern.stage}</div>
                    </div>
                    <MiniChart prices={s.prices} pattern={s.pattern} width={80} height={36}/>
                    <div style={{textAlign:"right",minWidth:"32px"}}>
                      <div style={{color:s.score>=75?"#00ff88":s.score>=55?"#ffaa00":"#ff4466",fontSize:"15px",fontWeight:"bold"}}>{s.score}</div>
                      <div style={{fontSize:"8px",color:"#3a5a7a"}}>SCORE</div>
                    </div>
                  </div>
                ))}
                {list.length===0&&<div style={{color:"#2a4060",fontSize:"10px",padding:"20px 0"}}>No setups found — try RESCAN</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ WATCHLIST TAB ══ */}
      {tab==="watchlist"&&(
        <div style={{padding:"20px",maxWidth:"760px"}}>
          <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"14px"}}>WATCHLIST MANAGER — {watchlist.length} SYMBOLS</div>
          <div style={{display:"flex",gap:"8px",marginBottom:"18px"}}>
            <input value={addSym} onChange={e=>setAddSym(e.target.value.toUpperCase())}
              onKeyDown={e=>{ if(e.key==="Enter"){ const s=addSym.trim(); if(s&&!watchlist.includes(s)){setWatchlist(w=>[...w,s]);loadSingle(s);} setAddSym(""); }}}
              placeholder="ADD SYMBOL (e.g. ROKU)"
              style={{background:"#0d1f3c",border:"1px solid #1a4060",color:"#c8d8f0",padding:"7px 12px",fontSize:"12px",fontFamily:mono,width:"200px",outline:"none",letterSpacing:"2px"}}/>
            <button onClick={()=>{ const s=addSym.trim(); if(s&&!watchlist.includes(s)){setWatchlist(w=>[...w,s]);loadSingle(s);} setAddSym(""); }}
              style={{background:"#0d2a40",border:"1px solid #1a4060",color:"#00d4ff",padding:"7px 14px",cursor:"pointer",fontFamily:mono,fontSize:"11px",letterSpacing:"1px"}}>
              + ADD & SCAN
            </button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:"7px"}}>
            {watchlist.map(sym=>{
              const s=stocks.find(x=>x.sym===sym);
              const isErr=errorMap[sym]&&!loadingMap[sym]&&!s;
              const isLoad=loadingMap[sym];
              return (
                <div key={sym} style={{background:"#0a1628",border:`1px solid ${isErr?"#441020":s?"#1a3050":"#1a3050"}`,padding:"9px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div>
                    <div style={{color:isErr?"#ff4466":isLoad?"#ffaa00":s?"#e0f0ff":"#3a5a7a",fontWeight:"bold",fontSize:"12px"}}>{sym}</div>
                    {s&&<div style={{fontSize:"9px",color:s.chg>=0?"#00ff88":"#ff4466"}}>{s.chg>=0?"+":""}{s.chg.toFixed(2)}%</div>}
                    {s&&<div style={{fontSize:"8px",color:"#3a5a7a"}}>{s.pattern.name.split(" ").slice(0,2).join(" ")}</div>}
                    {isLoad&&<div style={{fontSize:"9px",color:"#3a5a7a"}}>loading...</div>}
                    {isErr&&<div style={{fontSize:"8px",color:"#ff4466"}}>error</div>}
                  </div>
                  <button onClick={()=>{ setWatchlist(w=>w.filter(x=>x!==sym)); setStocks(p=>p.filter(x=>x.sym!==sym)); if(selected===sym)setSelected(null); }}
                    style={{background:"none",border:"none",color:"#442030",cursor:"pointer",fontSize:"15px",padding:"0 2px",lineHeight:1}}>×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==="rotation"&&(
        <SectorRotationTab stocks={stocks} isScanning={isScanning} setTab={setTab} setSelected={setSelected} mono={mono}/>
      )}

      {tab==="intermarket"&&(
        <IntermarketTab mono={mono}/>
      )}

      {tab==="heatmap"&&(
        <HeatmapTab stocks={stocks} isScanning={isScanning} setTab={setTab} setSelected={setSelected} mono={mono}/>
      )}

      {tab==="bottomfinder"&&(
        <BottomFinderTab mono={mono}/>
      )}

      {tab==="elliott"&&(
        <ElliottWaveTab stocks={stocks} selected={selected} setSelected={setSelected} mono={mono}/>
      )}

      {/* ══ PATTERN GUIDE TAB ══ */}
      {tab==="guide"&&(
        <div style={{padding:"20px",maxWidth:"1000px"}}>
          <div style={{fontSize:"9px",color:"#3a5a7a",letterSpacing:"2px",marginBottom:"16px"}}>PATTERN REFERENCE — BULKOWSKI & MURPHY</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:"10px",marginBottom:"20px"}}>
            {Object.entries(PATTERNS_DB).map(([name,info])=>{
              const c=breakColor(info.breakout);
              return (
                <div key={name} style={{background:"#0a1628",border:`1px solid ${c}22`,borderLeft:`3px solid ${c}`,padding:"12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                    <div style={{fontWeight:"bold",color:"#e0f0ff",fontSize:"11px"}}>{name}</div>
                    <span style={{fontSize:"8px",color:c,background:c+"15",padding:"2px 6px",letterSpacing:"1px"}}>{info.category.toUpperCase()}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px",fontSize:"10px",marginBottom:"8px"}}>
                    <div><div style={{color:"#3a5a7a",fontSize:"8px"}}>RELIABILITY</div><div style={{color:info.reliability>=75?"#00ff88":"#ffaa00",fontWeight:"bold"}}>{info.reliability}%</div></div>
                    <div><div style={{color:"#3a5a7a",fontSize:"8px"}}>AVG GAIN/LOSS</div><div style={{color:c,fontWeight:"bold"}}>{info.avgGain??info.avgLoss}%</div></div>
                    <div><div style={{color:"#3a5a7a",fontSize:"8px"}}>FAIL RATE</div><div style={{color:info.failRate<10?"#00ff88":"#ffaa00",fontWeight:"bold"}}>{info.failRate}%</div></div>
                    <div><div style={{color:"#3a5a7a",fontSize:"8px"}}>TARGET MET</div><div style={{color:info.targetMet>65?"#00ff88":"#ffaa00",fontWeight:"bold"}}>{info.targetMet}%</div></div>
                    <div><div style={{color:"#3a5a7a",fontSize:"8px"}}>MIN BARS</div><div style={{color:"#c8d8f0",fontWeight:"bold"}}>{info.minBars}</div></div>
                    <div><div style={{color:"#3a5a7a",fontSize:"8px"}}>DIRECTION</div><div style={{color:c,fontWeight:"bold"}}>{info.breakout.toUpperCase()}</div></div>
                  </div>
                  <div style={{fontSize:"8px",color:"#2a4a6a",borderTop:"1px solid #1a2a3a",paddingTop:"6px"}}>Murphy: {info.murphyRef}</div>
                </div>
              );
            })}
          </div>
          <div style={{background:"#0a1628",border:"1px solid #1a3050",padding:"14px",fontSize:"10px",color:"#4a6a8a",lineHeight:"1.9"}}>
            <div style={{color:"#3a5a7a",letterSpacing:"2px",marginBottom:"8px",fontSize:"9px"}}>COMPOSITE SCORE METHODOLOGY</div>
            <div><span style={{color:"#c8d8f0"}}>Pattern Quality (30pts)</span> — Bulkowski reliability + shape confidence + stage + 52W context</div>
            <div><span style={{color:"#c8d8f0"}}>Trend Alignment (20pts)</span> — Murphy: full SMA20/50 stack + ADX trend strength (Ch.9)</div>
            <div><span style={{color:"#c8d8f0"}}>Momentum (18pts)</span> — RSI zone scored by entry quality + MACD histogram magnitude</div>
            <div><span style={{color:"#c8d8f0"}}>Volume (14pts)</span> — 20-day volume trend + OBV direction alignment + liquidity check</div>
            <div><span style={{color:"#c8d8f0"}}>Risk/Reward (8pts)</span> — ATR-based stop, R/R ratio quality (3R+ = full points)</div>
            <div><span style={{color:"#c8d8f0"}}>Market Position (6pts)</span> — 52W range position (bulls near lows, bears near highs)</div>
            <div><span style={{color:"#c8d8f0"}}>Divergence Bonus (4pts)</span> — RSI divergence aligned with pattern direction</div>
            <div style={{marginTop:"4px",color:"#ff6600",fontSize:"9px"}}>Penalties: Invalidated −25 · RSI extreme −5 · Volume collapse −4 · Excessive ATR −3</div>
            <div style={{marginTop:"8px",color:"#00ff88"}}>Score ≥75: Strong setup · 55-74: Moderate · &lt;55: Weak / developing</div>
            <div style={{marginTop:"6px",color:"#1a3a5a",fontSize:"9px"}}>⚠ Educational tool only. Always use proper position sizing and risk management.</div>
          </div>
        </div>
      )}
    </div>
  );
}
