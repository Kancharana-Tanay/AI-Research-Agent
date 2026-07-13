import { z } from 'zod';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getLLM } from '../config/llm.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Report Agent
//
// Responsibilities:
//   - Synthesizes state.research and state.analysis.
//   - Compiles a publication-quality investment research report.
//   - Produces clean structured JSON text fields.
//   - Generates a full Markdown document and a beautifully styled,
//     responsive inline HTML document for the front-end display.
// ---------------------------------------------------------------------------

// Zod schema to enforce structured outputs from LLM
const reportSchema = z.object({
  executiveSummary: z.string().describe('Concise summary of the investment research and final conclusions'),
  companyOverview: z.string().describe('Comprehensive business overview, business model, and operational footprint'),
  financialAnalysis: z.string().describe('Detailed analytical review of financials, including margins, scores, ratios, and estimates'),
  technicalAnalysis: z.string().describe('Technical overview compiling trend, RSI conditions, SMA position, and momentum outlook'),
  newsSummary: z.string().describe('Overview of the media narrative, events, and sentiment indicators'),
  growthDrivers: z.string().describe('Analytical summary of core growth catalysts'),
  risks: z.string().describe('Analytical summary of operational, strategic, or macro risks'),
  investmentThesis: z.string().describe('Clear qualitative investment case/thesis'),
  markdownReport: z.string().describe('Full publication-ready document in beautiful GitHub Markdown'),
  htmlReport: z.string().describe('Full publication-ready HTML document styled with clean inline CSS (dark/glassmorphism theme, card layouts)')
});

/**
 * Report Agent node for the LangGraph workflow.
 *
 * @param {import('../graph/state.js').InvestmentResearchState} state
 * @returns {Promise<Partial<import('../graph/state.js').InvestmentResearchState>>}
 */
export async function reportAgent(state) {
  logger.info('[ReportAgent] Node invoked', { company: state.company, ticker: state.ticker });

  const research = state.research;
  const analysis = state.analysis;

  if (!research || !analysis) {
    logger.warn('[ReportAgent] Missing research or analysis data — returning fallback report');
    return {
      report: {
        executiveSummary: 'Missing research or analysis data to generate report.',
        companyOverview: 'No data.',
        financialAnalysis: 'No data.',
        technicalAnalysis: 'No data.',
        newsSummary: 'No data.',
        growthDrivers: 'No data.',
        risks: 'No data.',
        investmentThesis: 'No data.',
        markdownReport: '# Missing Data\nReport could not be generated.',
        htmlReport: '<h1>Missing Data</h1><p>Report could not be generated.</p>'
      }
    };
  }

  // 1. Initialize LLM and bind structured output schema
  const llm = await getLLM();
  const structuredLlm = llm.withStructuredOutput(reportSchema, { method: 'jsonMode' });

  const systemMessage = new SystemMessage(
    'You are a senior equity research editor. Your job is to draft a comprehensive, publication-ready ' +
    'equity research report by combining the raw research dossier and structural analyst evaluations. ' +
    'Draft individual section texts, a formatted GitHub Markdown document, and a beautifully designed HTML report ' +
    'styled with professional modern CSS. The HTML layout should feel extremely premium, incorporating sleek typography, ' +
    'vibrant color highlights, clean margins, and clear cards for structural information (like SWOT elements).'
  );

  const humanContent = `
Company: ${research.profile.name || state.company}
Ticker: ${research.profile.ticker || state.ticker}
Exchange: ${research.profile.exchange}

--- Dossier & Analysis Inputs ---
Research Dossier: ${JSON.stringify(research, null, 2)}
Analyst SWOT & Ratings Analysis: ${JSON.stringify(analysis, null, 2)}

Draft the complete investment research report.
`;

  const humanMessage = new HumanMessage(humanContent);

  try {
    const report = await structuredLlm.invoke([systemMessage, humanMessage]);
    logger.info('[ReportAgent] Report compiled successfully', {
      ticker: research.profile.ticker,
      markdownLength: report.markdownReport?.length,
      htmlLength: report.htmlReport?.length
    });

    return { report };
  } catch (error) {
    logger.error('[ReportAgent] LLM invocation failed', { error: error.message });
    // Safe fallback to prevent pipeline crashes
    return {
      report: {
        executiveSummary: 'Fallback report summary due to model invocation crash.',
        companyOverview: 'Fallback company details.',
        financialAnalysis: 'Fallback financial analysis.',
        technicalAnalysis: 'Fallback technical overview.',
        newsSummary: 'Fallback news summary.',
        growthDrivers: 'Fallback growth drivers.',
        risks: 'Fallback risks.',
        investmentThesis: 'Fallback thesis.',
        markdownReport: `# Fallback Report\nModel invocation exception occurred.`,
        htmlReport: `<h1>Fallback Report</h1><p>Model invocation exception occurred.</p>`
      }
    };
  }
}
