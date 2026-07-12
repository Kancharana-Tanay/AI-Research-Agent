import { fmpGet } from '../services/fmpClient.js';
import logger from '../utils/logger.js';
// ---------------------------------------------------------------------------
// Research MCP Tool (Wrapper)
//
// Purpose:
//   Acts as a single gateway for fetching advanced financial resources.
//   Instead of exposing 10 different FMP endpoints to the LLM, the LLM calls
//   this ONE tool and specifies the category of data it needs (e.g., "Balance Sheet").
//
// Under the hood, this tool decides:
//   1. How to map that request to the correct FMP REST endpoint.
//   2. How to parse and normalize the response.
//   3. How to package it with consistent source metadata.
//
// Supported Categories:
//   - "Income Statement"
//   - "Balance Sheet"
//   - "Cash Flow"
//   - "Financial Ratios"
//   - "Key Metrics"
//   - "Historical Prices"
//   - "Analyst Estimates"
//   - "Earnings Transcripts"
//   - "SEC Filings"
// ---------------------------------------------------------------------------

/**
 * Executes a query to retrieve advanced financial data based on a category.
 *
 * @param {object} args
 * @param {string} args.ticker - Stock ticker symbol, e.g. "AAPL"
 * @param {string} args.category - One of the supported categories
 * @param {string} args.reason - Why the LLM needs this information (for metadata)
 * @returns {Promise<object>} The retrieved evidence packaged with metadata
 */
export async function researchMcpTool({ ticker, category, reason }) {
  const symbol = ticker.toUpperCase();
  logger.info('[ResearchMcpTool] Invoked', { symbol, category, reason });

  let data = null;
  let source = category;
  let confidence = 0.95; // Default high confidence for official FMP data sources

  try {
    switch (category) {
      case 'Income Statement':
        data = await fmpGet(`/stable/income-statement/${symbol}`, { limit: 4 });
        data = (data || []).map(item => ({
          calendarYear: item.calendarYear,
          period: item.period,
          revenue: item.revenue,
          netIncome: item.netIncome,
          operatingIncome: item.operatingIncome,
          eps: item.eps,
          ebitda: item.ebitda
        }));
        break;

      case 'Balance Sheet':
        data = await fmpGet(`/stable/balance-sheet-statement/${symbol}`, { limit: 4 });
        data = (data || []).map(item => ({
          calendarYear: item.calendarYear,
          period: item.period,
          totalAssets: item.totalAssets,
          totalLiabilities: item.totalLiabilities,
          totalStockholdersEquity: item.totalStockholdersEquity,
          netDebt: item.netDebt,
          cashAndCashEquivalents: item.cashAndCashEquivalents
        }));
        break;

      case 'Cash Flow':
        data = await fmpGet(`/stable/cash-flow-statement/${symbol}`, { limit: 4 });
        data = (data || []).map(item => ({
          calendarYear: item.calendarYear,
          period: item.period,
          netCashProvidedByOperatingActivities: item.netCashProvidedByOperatingActivities,
          capitalExpenditure: item.capitalExpenditure,
          freeCashFlow: item.freeCashFlow
        }));
        break;

      case 'Financial Ratios':
        data = await fmpGet(`/stable/ratios/${symbol}`, { limit: 4 });
        data = (data || []).map(item => ({
          calendarYear: item.calendarYear,
          period: item.period,
          currentRatio: item.currentRatio,
          quickRatio: item.quickRatio,
          debtEquityRatio: item.debtEquityRatio,
          returnOnAssets: item.returnOnAssets,
          returnOnEquity: item.returnOnEquity,
          peRatio: item.priceEarningsRatio,
          priceToSalesRatio: item.priceToSalesRatio
        }));
        break;

      case 'Key Metrics':
        data = await fmpGet(`/stable/key-metrics/${symbol}`, { limit: 4 });
        data = (data || []).map(item => ({
          calendarYear: item.calendarYear,
          period: item.period,
          revenuePerShare: item.revenuePerShare,
          netIncomePerShare: item.netIncomePerShare,
          bookValuePerShare: item.bookValuePerShare,
          debtToAssets: item.debtToAssets,
          peRatio: item.peRatio,
          pbRatio: item.pbRatio,
          evToSales: item.evToSales
        }));
        break;

      case 'Historical Prices':
        // Get last 30 daily price bars to assess recent trend/volatility
        const historical = await fmpGet(`/stable/historical-price-full/${symbol}`, { timeseries: 30 });
        data = (historical?.historical || []).map(item => ({
          date: item.date,
          close: item.close,
          volume: item.volume,
          changePercent: item.changePercent
        }));
        break;

      case 'Analyst Estimates':
        data = await fmpGet(`/stable/analyst-estimates/${symbol}`, { limit: 4 });
        data = (data || []).map(item => ({
          date: item.date,
          estimatedRevenueAvg: item.estimatedRevenueAvg,
          estimatedNetIncomeAvg: item.estimatedNetIncomeAvg,
          estimatedEpsAvg: item.estimatedEpsAvg
        }));
        break;

      case 'Earnings Transcripts':
        // Retrieve transcripts index for recent quarters
        data = await fmpGet(`/stable/earning_call_transcript/${symbol}`, { limit: 2 });
        data = (data || []).map(item => ({
          quarter: item.quarter,
          year: item.year,
          date: item.date,
          // Truncate raw content if it exists to stay within state limits
          contentSummary: item.content ? item.content.slice(0, 1500) + '...' : null
        }));
        break;

      case 'SEC Filings':
        data = await fmpGet(`/stable/sec_filings/${symbol}`, { limit: 5 });
        data = (data || []).map(item => ({
          fillingDate: item.fillingDate,
          acceptedDate: item.acceptedDate,
          type: item.type,
          link: item.finalLink
        }));
        break;

      default:
        throw new Error(`Unsupported research category: "${category}"`);
    }

    logger.info('[ResearchMcpTool] Successfully retrieved data', {
      symbol,
      category,
      records: Array.isArray(data) ? data.length : 1
    });

  } catch (error) {
    logger.error('[ResearchMcpTool] Error retrieving data', {
      symbol,
      category,
      error: error.message
    });
    // Fallback to empty structure to prevent workflow crash, record details in metadata
    data = [];
    confidence = 0.0;
  }

  // Packaged standard structure
  return {
    source,
    reason,
    confidence,
    data,
    timestamp: new Date().toISOString()
  };
}
