import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getLLM } from '../config/llm.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Analysis Agent
//
// Responsibilities:
//   - Consumes the clean, merged Research JSON from state.research.
//   - Analyzes financial health, news sentiment, and technical indicators.
//   - Determines competitive SWOT factors (strengths, weaknesses, risks, catalysts).
//   - Computes a weighted, logic-based investment attractiveness score (0-100).
//   - Communication is strictly JSON-structured using Zod.
// ---------------------------------------------------------------------------

// Zod schema to enforce structured outputs from LLM
const analysisSchema = z.object({
  financialHealth: z.object({
    revenueGrowthScore: z.number().min(0).max(10).describe('Score for revenue growth consistency and strength (0-10)'),
    marginStabilityScore: z.number().min(0).max(10).describe('Score for net/operating margin stability and strength (0-10)'),
    debtLeverageScore: z.number().min(0).max(10).describe('Score for debt levels, coverage ratios, and leverage safety (0-10)'),
    cashFlowStrengthScore: z.number().min(0).max(10).describe('Score for free cash flow generation and growth (0-10)'),
    financialHealthSummary: z.string().describe('Concise description of the company\'s financial health')
  }),
  newsSentiment: z.object({
    sentimentSummary: z.string().describe('Overview of recent news narrative and news flow'),
    sentimentScore: z.number().min(-1).max(1).describe('Composite sentiment index from -1 (extremely negative) to 1 (extremely positive)'),
    positivePercentage: z.number().min(0).max(100).describe('Percentage of news articles classified as positive'),
    neutralPercentage: z.number().min(0).max(100).describe('Percentage of news articles classified as neutral'),
    negativePercentage: z.number().min(0).max(100).describe('Percentage of news articles classified as negative')
  }),
  technicalOutlook: z.object({
    trendDirection: z.enum(['uptrend', 'downtrend', 'sideways', 'insufficient_data']).describe('Current primary trend direction'),
    rsiCondition: z.enum(['overbought', 'oversold', 'neutral', 'insufficient_data']).describe('RSI condition based on value (e.g. >70 overbought, <30 oversold, else neutral)'),
    smaCrossoverStatus: z.string().describe('Status of price vs SMA50 and SMA200 (e.g. "price above both SMAs", etc.)'),
    technicalOutlookSummary: z.string().describe('Concise technical analysis summary')
  }),
  strengths: z.array(z.string()).describe('Top 3-5 core competitive advantages, moat factors, or strengths'),
  weaknesses: z.array(z.string()).describe('Top 3-5 key operational, financial, or strategic weaknesses'),
  risks: z.array(z.string()).describe('Top 3-5 macro, regulatory, supply chain, or competitor risk factors'),
  growthDrivers: z.array(z.string()).describe('Top 3-5 near-term and long-term catalysts or upside growth drivers'),
  investmentScore: z.number().min(0).max(100).describe('Overall composite score (0-100) representing long-term investment attractiveness')
});

/**
 * Analysis Agent node for the LangGraph workflow.
 *
 * @param {import('../graph/state.js').InvestmentResearchState} state
 * @returns {Promise<Partial<import('../graph/state.js').InvestmentResearchState>>}
 */
export async function analysisAgent(state) {
  logger.info('[AnalysisAgent] Node invoked', { company: state.company, ticker: state.ticker });

  const research = state.research;

  if (!research || !research.profile) {
    logger.warn('[AnalysisAgent] Invoked without valid research data — returning fallback empty analysis');
    return {
      analysis: {
        financialHealth: {
          revenueGrowthScore: 0,
          marginStabilityScore: 0,
          debtLeverageScore: 0,
          cashFlowStrengthScore: 0,
          financialHealthSummary: 'No research data was available to perform analysis.'
        },
        newsSentiment: {
          sentimentSummary: 'No news available.',
          sentimentScore: 0,
          positivePercentage: 0,
          neutralPercentage: 100,
          negativePercentage: 0
        },
        technicalOutlook: {
          trendDirection: 'insufficient_data',
          rsiCondition: 'insufficient_data',
          smaCrossoverStatus: 'insufficient_data',
          technicalOutlookSummary: 'No technical data available.'
        },
        strengths: [],
        weaknesses: [],
        risks: [],
        growthDrivers: [],
        investmentScore: 0
      }
    };
  }

  // 1. Initialize LLM and bind structured output schema
  const llm = await getLLM();
  const structuredLlm = llm.withStructuredOutput(analysisSchema);

  const systemMessage = new SystemMessage(
    'You are a senior equity research analyst. Your task is to perform a comprehensive financial, technical, ' +
    'and sentiment analysis of the provided research dossier on a company. ' +
    'Provide structured data including sub-scores (0-10), sentiment breakdown, technical condition, SWOT elements, ' +
    'and a composite investment score (0-100) that balances fundamentals (50%), sentiment (25%), technicals (15%), and SWOT (10%).'
  );

  const humanContent = `
Company Name: ${research.profile.name || state.company}
Ticker: ${research.profile.ticker || state.ticker}
Exchange: ${research.profile.exchange}
Market Capitalization: $${research.profile.marketCap ? (research.profile.marketCap / 1e9).toFixed(2) + 'B' : 'N/A'}
Sector: ${research.profile.sector}
Industry: ${research.profile.industry}

--- Research Dossier ---
Financial Metrics Summary: ${JSON.stringify(research.financialMetrics || {}, null, 2)}
Technical Indicators: ${JSON.stringify(research.technicalIndicators || {}, null, 2)}
News Articles: ${JSON.stringify(research.news || [], null, 2)}
Additional Gathered Evidence (Statements, Multiples, Estimates): ${JSON.stringify(research.additionalEvidence || [], null, 2)}
Research Summary: ${research.researchSummary}

Generate the full structured investment analysis.
`;

  const humanMessage = new HumanMessage(humanContent);

  try {
    const analysis = await structuredLlm.invoke([systemMessage, humanMessage]);
    logger.info('[AnalysisAgent] Analysis completed successfully', {
      ticker: research.profile.ticker,
      score: analysis.investmentScore,
      trend: analysis.technicalOutlook.trendDirection
    });

    return { analysis };
  } catch (error) {
    logger.error('[AnalysisAgent] LLM invocation failed', { error: error.message });
    // Safe fallback to prevent pipeline crashes
    return {
      analysis: {
        financialHealth: {
          revenueGrowthScore: 5,
          marginStabilityScore: 5,
          debtLeverageScore: 5,
          cashFlowStrengthScore: 5,
          financialHealthSummary: 'Fallback health evaluation due to model invocation crash.'
        },
        newsSentiment: {
          sentimentSummary: 'Fallback neutral sentiment.',
          sentimentScore: 0,
          positivePercentage: 0,
          neutralPercentage: 100,
          negativePercentage: 0
        },
        technicalOutlook: {
          trendDirection: 'insufficient_data',
          rsiCondition: 'insufficient_data',
          smaCrossoverStatus: 'insufficient_data',
          technicalOutlookSummary: 'Fallback technical overview.'
        },
        strengths: ['Long-term industry footprint'],
        weaknesses: ['Model parsing fallback constraints'],
        risks: ['Unexpected pipeline exceptions'],
        growthDrivers: ['Technological adaptations'],
        investmentScore: 50
      }
    };
  }
}
