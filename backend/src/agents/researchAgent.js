import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getLLM } from '../config/llm.js';
import {
  resolveTicker,
  companyProfileTool,
  companyNewsTool,
  technicalSnapshotTool,
  researchMcpTool,
  dataCleaningTool
} from '../tools/index.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Research Agent
//
// Responsibilities:
//   1. Resolve raw company name to stock ticker symbol (if not already done).
//   2. On iteration 0: Fetch profile, news, and technicals in parallel.
//   3. Ask the LLM: "Is this enough evidence to perform a complete analysis?"
//   4. If YES:
//        - Run Data Cleaning Tool to merge, deduplicate, and normalize.
//        - Set isComplete = true, store LLM summary, and proceed.
//   5. If NO (and iteration cap not hit):
//        - Call Research MCP Tool for the requested category.
//        - Append to additionalEvidence, set isComplete = false, and loop.
// ---------------------------------------------------------------------------

// Zod schema to enforce structured outputs from LLM without free-form text.
const evaluationSchema = z.object({
  isComplete: z.boolean().describe(
    'Set to true if we have gathered all necessary information to perform a high-quality investment analysis. ' +
    'Set to false if critical financial metrics (e.g. debt, income, cash flow, multiples) are still missing and required.'
  ),
  missingInformation: z.object({
    category: z.enum([
      'Income Statement',
      'Balance Sheet',
      'Cash Flow',
      'Financial Ratios',
      'Key Metrics',
      'Historical Prices',
      'Analyst Estimates',
      'Earnings Transcripts',
      'SEC Filings'
    ]).nullable().describe(
      'The category of additional data we need to fetch next. Must be null if isComplete is true.'
    ),
    reason: z.string().describe(
      'Explanation of why this category is needed to evaluate the company, or why research is complete.'
    )
  }),
  summary: z.string().describe(
    'A comprehensive, plain-text summary of all research findings gathered so far (key metrics, technical trend, sentiment). ' +
    'This serves as the researchSummary for the downstream agents.'
  )
});

/**
 * Research Agent node for the LangGraph workflow.
 *
 * @param {import('../graph/state.js').InvestmentResearchState} state
 * @returns {Promise<Partial<import('../graph/state.js').InvestmentResearchState>>}
 */
export async function researchAgent(state) {
  const currentIteration = state.researchIterations || 0;
  logger.info('[ResearchAgent] Node invoked', {
    company: state.company,
    ticker: state.ticker,
    iteration: currentIteration,
  });

  const updates = {};

  // 1. Resolve ticker if not already done
  let ticker = state.ticker;
  let resolvedInfo = null;
  if (!ticker) {
    logger.info('[ResearchAgent] Resolving ticker for company', { company: state.company });
    resolvedInfo = await resolveTicker(state.company);
    ticker = resolvedInfo.ticker;
    updates.ticker = ticker;
  }

  // 2. Fetch primary datasets in parallel on first iteration
  let research = state.research ? { ...state.research } : {
    profile: null,
    financialMetrics: null,
    technicalIndicators: null,
    news: [],
    additionalEvidence: [],
    researchSummary: null,
    isComplete: false
  };

  if (currentIteration === 0) {
    logger.info('[ResearchAgent] Fetching primary datasets in parallel', { ticker });
    const [profileResult, newsResult, technicalResult] = await Promise.allSettled([
      companyProfileTool(ticker),
      companyNewsTool(ticker, 5, resolvedInfo?.name ?? state.company),
      technicalSnapshotTool(ticker)
    ]);

    research.profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
    research.news = newsResult.status === 'fulfilled' ? newsResult.value : [];
    research.technicalIndicators = technicalResult.status === 'fulfilled' ? technicalResult.value : null;

    // Log failures as warnings, but proceed with whatever we successfully retrieved
    if (profileResult.status === 'rejected') {
      logger.warn('[ResearchAgent] Profile fetch failed', { ticker, error: profileResult.reason.message });
    }
    if (newsResult.status === 'rejected') {
      logger.warn('[ResearchAgent] News fetch failed', { ticker, error: newsResult.reason.message });
    }
    if (technicalResult.status === 'rejected') {
      logger.warn('[ResearchAgent] Technical snapshot fetch failed', { ticker, error: technicalResult.reason.message });
    }
  }

  // 3. Consult LLM on data sufficiency and summary
  logger.info('[ResearchAgent] Evaluating evidence sufficiency via LLM', { ticker });
  const llm = await getLLM();
  const structuredLlm = llm.withStructuredOutput(evaluationSchema);

  const systemMessage = new SystemMessage(
    'You are a senior investment research coordinator. Your job is to analyze the gathered research on a company ' +
    'and decide if it is sufficient to write a comprehensive investment analysis. ' +
    'We always fetch Profile, News, and Technical Indicators in iteration 0. ' +
    'If we do not have basic statements (Income Statement, Balance Sheet, Cash Flow) or Ratios, we usually need ' +
    'to request them one by one to form a complete thesis. ' +
    'If you choose to fetch more data, set isComplete to false and specify the next FMP category to retrieve. ' +
    'If you have sufficient data or reached a logical conclusion, set isComplete to true and summarize the findings.'
  );

  const humanContent = `
Company: ${state.company} (${ticker})
Iteration: ${currentIteration}

--- Collected Evidence ---
Profile: ${JSON.stringify(research.profile, null, 2)}
Technical Indicators: ${JSON.stringify(research.technicalIndicators, null, 2)}
News (Top 3): ${JSON.stringify(research.news.slice(0, 3), null, 2)}
Previously Collected Evidence (MCP): ${JSON.stringify(research.additionalEvidence, null, 2)}

Provide your evaluation and a clear summary of findings.
`;

  const humanMessage = new HumanMessage(humanContent);

  let evaluation;
  try {
    evaluation = await structuredLlm.invoke([systemMessage, humanMessage]);
    logger.info('[ResearchAgent] LLM sufficiency evaluation result', {
      isComplete: evaluation.isComplete,
      nextCategory: evaluation.missingInformation?.category,
      reason: evaluation.missingInformation?.reason
    });
  } catch (error) {
    logger.error('[ResearchAgent] LLM structured output invocation failed', { error: error.message });
    // Fallback: force complete to prevent infinite crash loops
    evaluation = {
      isComplete: true,
      missingInformation: { category: null, reason: 'LLM invocation failure fallback' },
      summary: 'Fallback summary due to LLM invocation failure.'
    };
  }

  // 4. Handle sufficiency decision
  // We cap iterations at 3 (meaning 4 total passes: 0, 1, 2, 3) to prevent runaway budgets.
  const hitIterationCap = currentIteration >= 3;

  if (evaluation.isComplete || hitIterationCap) {
    if (hitIterationCap && !evaluation.isComplete) {
      logger.warn('[ResearchAgent] Iteration limit reached — forcing research completion', { ticker });
    }

    // Pipeline final sanitization and cleaning
    logger.info('[ResearchAgent] Finalizing research phase and running Data Cleaning Tool', { ticker });
    const cleanedResearch = dataCleaningTool({
      profile: research.profile || { ticker, name: resolvedInfo?.name ?? ticker },
      technicalIndicators: research.technicalIndicators,
      news: research.news,
      additionalEvidence: research.additionalEvidence
    });

    cleanedResearch.isComplete = true;
    cleanedResearch.researchSummary = evaluation.summary;

    updates.research = cleanedResearch;
    // We increment iteration by 1 so total iteration count reflects final pass
    updates.researchIterations = 1;
  } else {
    // LLM requested more data
    const category = evaluation.missingInformation.category;
    const reason = evaluation.missingInformation.reason;

    if (category) {
      logger.info('[ResearchAgent] Fetching additional evidence via MCP Wrapper', { ticker, category });
      const newEvidence = await researchMcpTool({
        ticker,
        category,
        reason
      });

      research.additionalEvidence.push(newEvidence);
    }

    research.isComplete = false;
    updates.research = research;
    updates.researchIterations = 1; // langgraph will add this to the total via reducer
  }

  return updates;
}
