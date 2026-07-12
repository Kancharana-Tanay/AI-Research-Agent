import { fmpGet } from '../services/fmpClient.js';
import { ExternalServiceError } from '../utils/errors.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Ticker Resolver
//
// Resolves a company name (e.g., "Apple", "Tesla") to its stock ticker symbol
// (e.g., "AAPL", "TSLA") using FMP's company search endpoint.
//
// FMP endpoint: GET /v3/search?query={name}&limit=5&exchange=NASDAQ,NYSE
//
// Design notes:
//   - The LLM receives the raw company name from the user and passes it here.
//   - We score results by name similarity and return the best match.
//   - If the input looks like a ticker already (all caps, ≤5 chars), we
//     skip the search and validate the ticker directly against FMP.
//   - This is kept as a utility (not a LangChain Tool) because it runs
//     unconditionally at the start of the Research Agent — it's not something
//     the LLM decides to call.
// ---------------------------------------------------------------------------

const TICKER_REGEX = /^[A-Z]{1,5}$/;

/**
 * Resolves a company name or ticker to a validated ticker symbol.
 *
 * @param {string} companyNameOrTicker - User-provided company name or ticker
 * @returns {Promise<{ ticker: string, name: string, exchange: string }>}
 * @throws {ExternalServiceError} if no match can be found
 */
export async function resolveTicker(companyNameOrTicker) {
  const input = companyNameOrTicker.trim();

  logger.info('[TickerResolver] Resolving ticker', { input });

  // If it looks like a ticker already, validate it directly
  if (TICKER_REGEX.test(input)) {
    return validateKnownTicker(input);
  }

  // Otherwise, search by company name
  return searchByName(input);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validates a known ticker symbol by fetching its profile.
 */
async function validateKnownTicker(ticker) {
  const results = await fmpGet('/stable/profile', {
    symbol: ticker.toUpperCase(),
  });

  if (!Array.isArray(results) || results.length === 0) {
    throw new ExternalServiceError(
      `Could not validate ticker "${ticker}". It may be delisted or invalid.`,
      { ticker },
    );
  }

  const match = results[0];

  logger.info('[TickerResolver] Ticker validated', {
    input: ticker,
    resolved: match.symbol,
    name: match.companyName,
  });

  return {
    ticker: match.symbol.toUpperCase(),
    name: match.companyName ?? ticker,
    exchange: match.exchangeShortName ?? match.exchange ?? null,
  };
}

/**
 * Searches for a company by name and returns the best match.
 */
async function searchByName(companyName) {
  const results = await fmpGet('/stable/search-name', {
    query: companyName,
  });

  if (!Array.isArray(results) || results.length === 0) {
    throw new ExternalServiceError(
      `No ticker found for company name "${companyName}". Try using the ticker symbol directly.`,
      { companyName },
    );
  }

  // Prefer results where the name closely matches AND it's on a US exchange
  const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'NYSE MKT']);

  const ranked = results
    .filter((r) => r.symbol && r.name)
    .sort((a, b) => {
      const aNameScore = nameSimilarity(companyName, a.name);
      const bNameScore = nameSimilarity(companyName, b.name);

      // Bonus for primary US exchanges — ensures AAPL wins over AAPL.DE
      const aExchangeBonus = US_EXCHANGES.has((a.exchangeShortName || a.exchange || '').toUpperCase()) ? 1.0 : 0;
      const bExchangeBonus = US_EXCHANGES.has((b.exchangeShortName || b.exchange || '').toUpperCase()) ? 1.0 : 0;

      return (bNameScore + bExchangeBonus) - (aNameScore + aExchangeBonus);
    });

  if (ranked.length === 0) {
    throw new ExternalServiceError(
      `No valid ticker found for "${companyName}".`,
      { companyName, rawResults: results },
    );
  }

  const best = ranked[0];

  logger.info('[TickerResolver] Resolved by name search', {
    input: companyName,
    ticker: best.symbol,
    name: best.name,
    exchange: best.exchange,
  });

  return {
    ticker: best.symbol.toUpperCase(),
    name: best.name,
    exchange: best.exchange ?? null,
  };
}

/**
 * Computes a simple overlap score between two strings (case-insensitive).
 * Used to rank search results by how closely the company name matches.
 */
function nameSimilarity(query, candidate) {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (c === q) return 1;
  if (c.startsWith(q) || q.startsWith(c)) return 0.9;
  if (c.includes(q) || q.includes(c)) return 0.7;
  // Count matching words
  const qWords = new Set(q.split(/\s+/));
  const cWords = c.split(/\s+/);
  const overlap = cWords.filter((w) => qWords.has(w)).length;
  return overlap / Math.max(qWords.size, cWords.length);
}
