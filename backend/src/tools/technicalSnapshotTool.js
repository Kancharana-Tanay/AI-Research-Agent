import { fmpGet } from '../services/fmpClient.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Technical Snapshot Tool
//
// Fetches RSI, SMA50, SMA200, and ADX for a given ticker from FMP's
// technical indicator endpoints. Each indicator is a separate FMP call, so
// we fan out in parallel using Promise.allSettled for resilience — a single
// indicator failure will not abort the others.
//
// FMP endpoint pattern:
//   GET /v3/technical_indicator/{period_type}/{symbol}?type={indicator}&period={n}
//
// We use daily candles (1day) with the following periods:
//   RSI   → period 14  (industry standard)
//   SMA50 → period 50
//   SMA200→ period 200
//   ADX   → period 14
//
// Output shape (normalised):
// {
//   rsi:    number | null    (0 – 100; >70 overbought, <30 oversold)
//   sma50:  number | null    (50-day simple moving average)
//   sma200: number | null    (200-day simple moving average)
//   adx:    number | null    (>25 = trending, <20 = ranging)
//   asOf:   string | null    (ISO 8601 date of the most recent data point)
//   priceVsSma50:  "above" | "below" | null
//   priceVsSma200: "above" | "below" | null
//   trend:  "uptrend" | "downtrend" | "sideways" | "insufficient_data"
// }
//
// The computed fields (priceVsSma50, priceVsSma200, trend) are derived here
// so agents receive ready-to-reason data, not raw numbers.
// ---------------------------------------------------------------------------

/**
 * Fetches and normalises technical indicators for a given ticker.
 *
 * @param {string} ticker - Stock ticker symbol, e.g. "AAPL"
 * @returns {Promise<object>} Normalised technical snapshot
 */
export async function technicalSnapshotTool(ticker) {
  const symbol = ticker.toUpperCase();
  logger.info('[TechnicalSnapshotTool] Fetching indicators', { ticker: symbol });

  // Fan out all four indicator requests in parallel.
  // Promise.allSettled ensures one failure doesn't block the others.
  const [rsiResult, sma50Result, sma200Result, adxResult] = await Promise.allSettled([
    fetchIndicator(symbol, 'rsi', 14),
    fetchIndicator(symbol, 'sma', 50),
    fetchIndicator(symbol, 'sma', 200),
    fetchIndicator(symbol, 'adx', 14),
  ]);

  const rsi = extractLatestValue(rsiResult, 'rsi');
  const sma50 = extractLatestValue(sma50Result, 'sma');
  const sma200 = extractLatestValue(sma200Result, 'sma');
  const adx = extractLatestValue(adxResult, 'adx');

  // Use the price from the RSI response (it includes OHLCV data)
  const price = extractLatestValue(rsiResult, 'close');

  // Derive position vs moving averages
  const priceVsSma50 = price !== null && sma50 !== null
    ? (price > sma50 ? 'above' : 'below')
    : null;

  const priceVsSma200 = price !== null && sma200 !== null
    ? (price > sma200 ? 'above' : 'below')
    : null;

  // Extract the date of the most recent data point
  const asOf = extractLatestDate(rsiResult);

  const snapshot = {
    rsi,
    sma50,
    sma200,
    adx,
    currentPrice: price,
    asOf,
    priceVsSma50,
    priceVsSma200,
    trend: deriveTrend({ rsi, sma50, sma200, adx, price }),
  };

  // Log any indicator failures as warnings (not errors — we proceed with partial data)
  logFailures({ rsiResult, sma50Result, sma200Result, adxResult }, symbol);

  logger.info('[TechnicalSnapshotTool] Snapshot ready', {
    ticker: symbol,
    rsi,
    sma50: sma50 ? sma50.toFixed(2) : null,
    sma200: sma200 ? sma200.toFixed(2) : null,
    adx,
    trend: snapshot.trend,
  });

  return snapshot;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Fetches a single technical indicator from FMP.
 * Returns the raw array response.
 */
async function fetchIndicator(symbol, type, period) {
  // FMP stable technical indicator endpoint
  return fmpGet(`/stable/technical-indicators/${type}`, {
    symbol,
    periodLength: period,
    timeframe: '1day',
  });
}

/**
 * Extracts the most recent value of a given field from a settled promise result.
 * Returns null if the promise rejected or the data is missing.
 */
function extractLatestValue(settledResult, field) {
  if (settledResult.status !== 'fulfilled') return null;
  const data = settledResult.value;
  if (!Array.isArray(data) || data.length === 0) return null;
  const value = data[0][field];
  return typeof value === 'number' ? value : null;
}

/**
 * Extracts the date of the most recent data point.
 */
function extractLatestDate(settledResult) {
  if (settledResult.status !== 'fulfilled') return null;
  const data = settledResult.value;
  if (!Array.isArray(data) || data.length === 0) return null;
  const raw = data[0]?.date;
  if (!raw) return null;
  try {
    return new Date(raw).toISOString();
  } catch {
    return raw;
  }
}

/**
 * Derives a human-readable trend description from the indicator values.
 *
 * Rules:
 *   uptrend   = price > SMA50 AND price > SMA200 AND (ADX > 25 OR RSI > 50)
 *   downtrend = price < SMA50 AND price < SMA200 AND (ADX > 25 OR RSI < 50)
 *   sideways  = ADX < 20 regardless of MAs
 *   default   = "insufficient_data"
 */
function deriveTrend({ rsi, sma50, sma200, adx, price }) {
  if (price === null || sma50 === null || sma200 === null) {
    return 'insufficient_data';
  }

  if (adx !== null && adx < 20) return 'sideways';

  const aboveBoth = price > sma50 && price > sma200;
  const belowBoth = price < sma50 && price < sma200;

  if (aboveBoth && (adx === null || adx > 25 || (rsi !== null && rsi > 50))) {
    return 'uptrend';
  }

  if (belowBoth && (adx === null || adx > 25 || (rsi !== null && rsi < 50))) {
    return 'downtrend';
  }

  return 'sideways';
}

/**
 * Logs indicator fetch failures as warnings.
 */
function logFailures(results, symbol) {
  const labelMap = {
    rsiResult: 'RSI',
    sma50Result: 'SMA50',
    sma200Result: 'SMA200',
    adxResult: 'ADX',
  };

  for (const [key, result] of Object.entries(results)) {
    if (result.status === 'rejected') {
      logger.warn('[TechnicalSnapshotTool] Indicator fetch failed', {
        ticker: symbol,
        indicator: labelMap[key],
        error: result.reason?.message ?? String(result.reason),
      });
    }
  }
}
