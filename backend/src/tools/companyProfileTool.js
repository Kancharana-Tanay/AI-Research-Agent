import { fmpGet } from '../services/fmpClient.js';
import { ExternalServiceError } from '../utils/errors.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Company Profile Tool
//
// Fetches fundamental company information from FMP's /profile endpoint.
//
// FMP endpoint: GET /v3/profile/{symbol}
// Returns: array with one profile object
//
// Output shape (normalised):
// {
//   ticker:       string
//   name:         string
//   sector:       string
//   industry:     string
//   ceo:          string
//   description:  string
//   exchange:     string
//   marketCap:    number    (in USD)
//   employees:    number | null
//   website:      string
//   country:      string
//   currency:     string
//   price:        number | null   (current stock price)
//   beta:         number | null
//   ipoDate:      string | null
// }
//
// Responsibility boundary:
//   This tool ONLY retrieves and normalises data.
//   It does NOT update state — the Research Agent is responsible for that.
// ---------------------------------------------------------------------------

/**
 * Fetches and normalises the company profile for a given ticker.
 *
 * @param {string} ticker - Stock ticker symbol, e.g. "AAPL"
 * @returns {Promise<object>} Normalised company profile
 * @throws {ExternalServiceError} If FMP returns no data for the ticker
 */
export async function companyProfileTool(ticker) {
  logger.info('[CompanyProfileTool] Fetching profile', { ticker });

  const raw = await fmpGet('/stable/profile', { symbol: ticker.toUpperCase() });

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ExternalServiceError(
      `No company profile found for ticker "${ticker}". Verify the ticker symbol.`,
      { ticker },
    );
  }

  const p = raw[0];

  const profile = {
    ticker: p.symbol ?? ticker.toUpperCase(),
    name: p.companyName ?? null,
    sector: p.sector ?? null,
    industry: p.industry ?? null,
    ceo: p.ceo ?? null,
    description: p.description ?? null,
    exchange: p.exchangeShortName ?? p.exchange ?? null,
    marketCap: typeof p.marketCap === 'number' ? p.marketCap : (typeof p.mktCap === 'number' ? p.mktCap : null),
    employees: typeof p.fullTimeEmployees === 'number'
      ? p.fullTimeEmployees
      : (p.fullTimeEmployees ? parseInt(p.fullTimeEmployees, 10) || null : null),
    website: p.website ?? null,
    country: p.country ?? null,
    currency: p.currency ?? 'USD',
    price: typeof p.price === 'number' ? p.price : null,
    beta: typeof p.beta === 'number' ? p.beta : null,
    ipoDate: p.ipoDate ?? null,
  };

  logger.info('[CompanyProfileTool] Profile retrieved', {
    ticker: profile.ticker,
    name: profile.name,
    sector: profile.sector,
    marketCap: profile.marketCap,
  });

  return profile;
}
