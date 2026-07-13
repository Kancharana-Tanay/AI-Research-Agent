import { tavily } from '@tavily/core';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Company News Tool  (Tavily-powered)
//
// Replaces FMP news endpoints with real-time Tavily web search.
// Tavily searches the live web and returns relevant articles about the
// company — far more timely and accurate than FMP's article feed.
//
// Output shape (array of normalised news items):
// [
//   {
//     headline:      string
//     source:        string        (domain extracted from URL)
//     url:           string
//     publishedAt:   string | null (ISO 8601, if Tavily provides it)
//     summary:       string | null (Tavily snippet)
//     sentiment:     string | null ("Positive" | "Negative" | "Neutral")
//     ticker:        string
//   }
// ]
//
// Design notes:
//   - Sentiment is inferred via lightweight keyword scoring on title+content.
//     The Analysis Agent performs the real sentiment analysis downstream.
//   - We deduplicate by URL before returning.
//   - Articles without a title are discarded.
//   - Falls back to [] gracefully if TAVILY_API_KEY is missing or Tavily
//     is unavailable, so the pipeline is never blocked.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 5;           // Keep low — Tavily content is dense (~1k chars/article)
const CONTENT_TRUNCATE_CHARS = 400; // Max chars per article summary sent to LLM

/**
 * Fetches and normalises recent news for a given company via Tavily search.
 *
 * @param {string} ticker        - Stock ticker symbol, e.g. "AAPL"
 * @param {number} [limit=5]     - Maximum number of articles to return
 * @param {string} [companyName] - Human-readable company name for better queries
 * @returns {Promise<Array<object>>} Array of normalised news items
 */
export async function companyNewsTool(ticker, limit = DEFAULT_LIMIT, companyName = null) {
  logger.info('[CompanyNewsTool] Fetching news via Tavily', { ticker, limit });

  if (!env.TAVILY_API_KEY) {
    logger.warn('[CompanyNewsTool] TAVILY_API_KEY is not set — skipping news fetch');
    return [];
  }

  try {
    const client = tavily({ apiKey: env.TAVILY_API_KEY });

    // Build a focused query using both the name and ticker for specificity
    const nameHint = companyName ? `${companyName} (${ticker})` : ticker;
    const query = `${nameHint} stock news latest 2025`;

    const response = await client.search(query, {
      searchDepth: 'basic',
      topic: 'news',
      maxResults: Math.min(limit, 5), // Hard cap at 5 to control token cost
      includeAnswer: false,
    });

    const results = response.results ?? [];

    // Normalise, filter, and deduplicate
    const seen = new Set();
    const articles = [];

    for (const item of results) {
      if (!item.title) continue;

      const url = item.url ?? '';
      if (url && seen.has(url)) continue;
      if (url) seen.add(url);

      // Truncate content — Tavily returns full scraped article text which
      // can be 1k–3k chars. We only need the leading excerpt for sentiment
      // inference and LLM context; the rest is noise that burns tokens.
      const truncatedContent = item.content
        ? item.content.slice(0, CONTENT_TRUNCATE_CHARS).trimEnd() + (item.content.length > CONTENT_TRUNCATE_CHARS ? '…' : '')
        : null;

      articles.push({
        headline: item.title,
        source: extractDomain(url),
        url,
        publishedAt: item.published_date ? new Date(item.published_date).toISOString() : null,
        summary: truncatedContent,
        sentiment: inferSentiment(item.title, truncatedContent),
        ticker: ticker.toUpperCase(),
      });
    }

    logger.info('[CompanyNewsTool] News fetched via Tavily', {
      ticker,
      total: results.length,
      afterDedup: articles.length,
    });

    return articles;

  } catch (error) {
    logger.warn('[CompanyNewsTool] Tavily search failed — returning empty news array', {
      ticker,
      error: error.message,
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the bare domain name from a URL for use as the article source.
 * e.g. "https://www.reuters.com/article/..." → "reuters.com"
 */
function extractDomain(url) {
  if (!url) return 'Unknown';
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown';
  }
}

/**
 * Lightweight keyword-based sentiment inference from title + content.
 * This is intentionally simple — the Analysis Agent does the real NLP.
 *
 * @returns {"Positive"|"Negative"|"Neutral"|null}
 */
function inferSentiment(title = '', content = '') {
  const text = `${title} ${content}`.toLowerCase();

  const positiveWords = [
    'surge', 'soar', 'rally', 'gain', 'jump', 'rise', 'beat', 'exceed',
    'record', 'profit', 'growth', 'bullish', 'upgrade', 'outperform',
    'strong', 'positive', 'milestone', 'breakthrough', 'innovation',
  ];
  const negativeWords = [
    'fall', 'drop', 'plunge', 'tumble', 'decline', 'loss', 'miss', 'below',
    'cut', 'layoff', 'lawsuit', 'recall', 'investigation', 'bearish',
    'downgrade', 'underperform', 'weak', 'warning', 'risk', 'crash', 'concern',
  ];

  const posScore = positiveWords.filter((w) => text.includes(w)).length;
  const negScore = negativeWords.filter((w) => text.includes(w)).length;

  if (posScore === 0 && negScore === 0) return 'Neutral';
  if (posScore > negScore) return 'Positive';
  if (negScore > posScore) return 'Negative';
  return 'Neutral';
}
