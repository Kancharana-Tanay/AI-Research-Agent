import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getLLM } from '../config/llm.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Recommendation Agent
//
// Responsibilities:
//   - Consumes state.analysis and state.report.
//   - Formulates a final investment directive: "BUY" | "HOLD" | "PASS".
//   - Sets a qualitative confidence score (0.0 to 1.0) and recommended horizon.
//   - Drafts a concise, structured markdown thesis justification.
//   - Enforces structured JSON output via Zod.
// ---------------------------------------------------------------------------

// Zod schema to enforce structured outputs from LLM
const recommendationSchema = z.object({
  decision: z.enum(['BUY', 'HOLD', 'PASS']).describe('Final investment recommendation action'),
  confidenceScore: z.number().min(0.0).max(1.0).describe('Confidence level in the decision (0.0 – 1.0)'),
  investmentHorizon: z.string().describe('Recommended holding period, e.g., "12-18 months", "long-term", etc.'),
  reasoning: z.string().describe('Concise, high-impact bulleted reasoning justifying the action based on the report inputs')
});

/**
 * Recommendation Agent node for the LangGraph workflow.
 *
 * @param {import('../graph/state.js').InvestmentResearchState} state
 * @returns {Promise<Partial<import('../graph/state.js').InvestmentResearchState>>}
 */
export async function recommendationAgent(state) {
  logger.info('[RecommendationAgent] Node invoked', { company: state.company, ticker: state.ticker });

  const analysis = state.analysis;
  const report = state.report;

  if (!analysis || !report) {
    logger.warn('[RecommendationAgent] Missing analysis or report data — returning fallback PASS recommendation');
    return {
      recommendation: {
        decision: 'PASS',
        confidenceScore: 0.0,
        investmentHorizon: 'N/A',
        reasoning: 'Missing analytical dossier inputs to formulate recommendation.'
      }
    };
  }

  // 1. Initialize LLM and bind structured output schema
  const llm = await getLLM();
  const structuredLlm = llm.withStructuredOutput(recommendationSchema, { method: 'jsonMode' });

  const systemMessage = new SystemMessage(
    'You are a senior investment committee director. Your job is to review the compiled equity research report ' +
    'and structural analyst ratings, and make a final investment decision. ' +
    'Your directive must be one of BUY, HOLD, or PASS. ' +
    'Provide a confidence score (0.0 – 1.0), recommended investment horizon (holding period), ' +
    'and a high-impact reasoning summary explaining the direct thesis for your recommendation.'
  );

  const humanContent = `
Company: ${state.company} (${state.ticker})
Dossier Report Summary: ${report.executiveSummary}
Investment Rationale (Thesis): ${report.investmentThesis}
Analyst Score: ${analysis.investmentScore}/100
SWOT Strengths: ${JSON.stringify(analysis.strengths, null, 2)}
SWOT Weaknesses: ${JSON.stringify(analysis.weaknesses, null, 2)}
SWOT Risks: ${JSON.stringify(analysis.risks, null, 2)}

Provide the final structured investment committee recommendation.
`;

  const humanMessage = new HumanMessage(humanContent);

  try {
    const recommendation = await structuredLlm.invoke([systemMessage, humanMessage]);
    logger.info('[RecommendationAgent] Final recommendation generated successfully', {
      ticker: state.ticker,
      decision: recommendation.decision,
      confidence: recommendation.confidenceScore
    });

    return { recommendation };
  } catch (error) {
    logger.error('[RecommendationAgent] LLM invocation failed', { error: error.message });
    // Safe fallback to prevent pipeline crashes
    return {
      recommendation: {
        decision: 'HOLD',
        confidenceScore: 0.5,
        investmentHorizon: '12 months',
        reasoning: 'Fallback recommendation due to model invocation exception.'
      }
    };
  }
}
