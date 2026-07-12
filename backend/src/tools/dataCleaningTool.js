import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Data Cleaning Tool
//
// Responsibilities:
//   - Clean and normalize all retrieved data before generating final Research JSON.
//   - Merge primary datasets (profile, news, technicalIndicators).
//   - Normalize dates to standard ISO strings.
//   - Normalize currency and numeric values (remove raw formatting symbols, cast to Number).
//   - Remove duplicated news articles.
//   - Strip out null, undefined, or empty values recursively.
//   - Validate required fields (ensures profile and basic fields exist).
//   - Strip internal tracking metadata to save LLM tokens.
//
// Outputs a standardized Research JSON structure:
//   { profile, financialMetrics, technicalIndicators, news, additionalEvidence, researchSummary }
// ---------------------------------------------------------------------------

/**
 * Clean, merge, and normalize all collected research inputs.
 *
 * @param {object} input
 * @param {object} input.profile - Company profile from Profile Tool
 * @param {object} input.technicalIndicators - Technical indicator metrics
 * @param {Array} input.news - Raw or parsed news list
 * @param {Array} input.additionalEvidence - Evidence dynamically collected via MCP tool
 * @returns {object} Standardized, sanitized Research JSON
 */
export function dataCleaningTool({ profile, technicalIndicators, news = [], additionalEvidence = [] }) {
  logger.info('[DataCleaningTool] Starting data sanitization & normalization');

  // 1. Validate required fields
  if (!profile || !profile.ticker) {
    throw new Error('Data Cleaning failed: Company profile with a valid ticker is required.');
  }

  // 2. Clean Company Profile
  const cleanProfile = cleanObject({
    name: profile.name,
    ticker: profile.ticker.toUpperCase(),
    sector: profile.sector,
    industry: profile.industry,
    ceo: profile.ceo,
    description: profile.description,
    exchange: profile.exchange,
    marketCap: normalizeNumeric(profile.marketCap),
    employees: normalizeNumeric(profile.employees),
    website: profile.website,
    country: profile.country,
    currency: profile.currency || 'USD',
    price: normalizeNumeric(profile.price),
    beta: normalizeNumeric(profile.beta),
    ipoDate: normalizeDate(profile.ipoDate)
  });

  // 3. Clean Technical Indicators
  const cleanTechnicals = cleanObject({
    rsi: normalizeNumeric(technicalIndicators?.rsi),
    sma50: normalizeNumeric(technicalIndicators?.sma50),
    sma200: normalizeNumeric(technicalIndicators?.sma200),
    adx: normalizeNumeric(technicalIndicators?.adx),
    currentPrice: normalizeNumeric(technicalIndicators?.currentPrice),
    asOf: normalizeDate(technicalIndicators?.asOf),
    priceVsSma50: technicalIndicators?.priceVsSma50 || null,
    priceVsSma200: technicalIndicators?.priceVsSma200 || null,
    trend: technicalIndicators?.trend || 'insufficient_data'
  });

  // 4. Deduplicate and clean News
  const seenUrls = new Set();
  const cleanNews = (news || [])
    .filter(article => article && article.headline)
    .map(article => ({
      headline: article.headline.trim(),
      source: article.source ? article.source.trim() : 'Unknown',
      url: article.url ? article.url.trim() : null,
      publishedAt: normalizeDate(article.publishedAt),
      summary: article.summary ? article.summary.trim() : null,
      sentiment: article.sentiment || null
    }))
    .filter(article => {
      if (!article.url) return true;
      if (seenUrls.has(article.url)) return false;
      seenUrls.add(article.url);
      return true;
    });

  // 5. Clean Additional Evidence (MCP Outputs)
  const cleanEvidence = (additionalEvidence || []).map(evidence => {
    return cleanObject({
      source: evidence.source,
      reason: evidence.reason,
      confidence: normalizeNumeric(evidence.confidence) ?? 1.0,
      data: Array.isArray(evidence.data)
        ? evidence.data.map(item => cleanObject(item))
        : typeof evidence.data === 'object'
          ? cleanObject(evidence.data)
          : evidence.data
    });
  });

  // 6. Extract financial metrics from additional evidence if present
  const financialMetrics = extractFinancialMetrics(cleanEvidence);

  const cleanResearchJson = {
    profile: cleanProfile,
    financialMetrics,
    technicalIndicators: cleanTechnicals,
    news: cleanNews.slice(0, 15), // Cap news to top 15 items to save prompt context
    additionalEvidence: cleanEvidence,
    researchSummary: null // Set by the Research Agent LLM summary step
  };

  logger.info('[DataCleaningTool] Data sanitization complete', {
    ticker: cleanProfile.ticker,
    newsArticles: cleanResearchJson.news.length,
    evidenceItems: cleanResearchJson.additionalEvidence.length
  });

  return cleanResearchJson;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes numeric inputs to clean float/integer numbers.
 */
function normalizeNumeric(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

/**
 * Normalizes dates to a standard YYYY-MM-DD or ISO string.
 */
function normalizeDate(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    // For date-only formats, keep YYYY-MM-DD. For times, keep full ISO.
    if (String(val).includes('T') || String(val).includes(':')) {
      return d.toISOString();
    }
    return d.toISOString().split('T')[0];
  } catch {
    return val;
  }
}

/**
 * Recursively removes keys with null, undefined, or empty values from an object/array.
 */
function cleanObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => cleanObject(item)).filter(item => item !== null && item !== undefined);
  } else if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const [key, val] of Object.entries(obj)) {
      const cleaned = cleanObject(val);
      if (cleaned !== null && cleaned !== undefined && cleaned !== '') {
        newObj[key] = cleaned;
      }
    }
    return Object.keys(newObj).length > 0 ? newObj : null;
  }
  return obj;
}

/**
 * Helper to consolidate parsed financial metrics if the LLM fetched them.
 */
function extractFinancialMetrics(evidence) {
  const metrics = {};

  const income = evidence.find(e => e.source === 'Income Statement')?.data;
  const balance = evidence.find(e => e.source === 'Balance Sheet')?.data;
  const cashFlow = evidence.find(e => e.source === 'Cash Flow')?.data;
  const ratios = evidence.find(e => e.source === 'Financial Ratios')?.data;

  // Use the most recent year's data point for core metrics
  if (Array.isArray(income) && income[0]) {
    metrics.revenue = income[0].revenue;
    metrics.netIncome = income[0].netIncome;
    metrics.eps = income[0].eps;
  }

  if (Array.isArray(balance) && balance[0]) {
    metrics.totalAssets = balance[0].totalAssets;
    metrics.totalLiabilities = balance[0].totalLiabilities;
    metrics.netDebt = balance[0].netDebt;
    metrics.equity = balance[0].totalStockholdersEquity;
  }

  if (Array.isArray(cashFlow) && cashFlow[0]) {
    metrics.freeCashFlow = cashFlow[0].freeCashFlow;
  }

  if (Array.isArray(ratios) && ratios[0]) {
    metrics.peRatio = ratios[0].peRatio;
    metrics.debtEquityRatio = ratios[0].debtEquityRatio;
    metrics.returnOnEquity = ratios[0].returnOnEquity;
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
}
