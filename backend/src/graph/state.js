import { Annotation } from '@langchain/langgraph';

// ---------------------------------------------------------------------------
// InvestmentResearchState
//
// This is the SINGLE source of truth that flows through every node in the
// LangGraph workflow. Each agent receives the full state and returns only
// the slice it is responsible for updating.
//
// Design principles:
//   - Agents NEVER communicate via free-form text.
//   - All inter-agent communication happens through this structured JSON.
//   - Reducers are used for array fields (errors) so multiple agents can
//     append without overwriting each other.
//   - Object fields use a "last-write-wins" default reducer so each agent
//     can safely overwrite its own slice.
// ---------------------------------------------------------------------------

/**
 * Reducer for arrays: appends new items instead of replacing the array.
 * Used for the `errors` field so any agent can record errors non-destructively.
 */
function appendReducer(existing = [], incoming = []) {
  return [...existing, ...incoming];
}

/**
 * Reducer for the researchIterations counter: increments each loop pass.
 */
function incrementReducer(existing = 0, incoming = 0) {
  return existing + incoming;
}

export const InvestmentResearchStateAnnotation = Annotation.Root({
  // ── Input ────────────────────────────────────────────────────────────────

  /**
   * The raw company name provided by the user (e.g., "Apple").
   */
  company: Annotation({ reducer: (_, b) => b }),

  /**
   * Resolved stock ticker symbol (e.g., "AAPL").
   * Populated by the Research Agent after ticker resolution.
   */
  ticker: Annotation({ reducer: (_, b) => b }),

  // ── Research Agent output ─────────────────────────────────────────────

  /**
   * Structured research data produced by the Research Agent.
   *
   * Shape:
   * {
   *   profile:              object   // Company profile from FMP
   *   financialMetrics:     object   // Key financial figures
   *   technicalIndicators:  object   // RSI, SMA50, SMA200, ADX
   *   news:                 array    // Deduplicated recent news items
   *   additionalEvidence:   array    // Dynamically gathered via MCP tool
   *                                  // Each item: { source, reason, confidence, data }
   *   researchSummary:      string   // LLM-generated plain-text summary of
   *                                  // the collected evidence
   * }
   */
  research: Annotation({ reducer: (_, b) => b }),

  /**
   * Tracks how many times the Research Agent has looped (max iterations guard).
   * Uses increment reducer so each loop pass adds 1.
   */
  researchIterations: Annotation({ reducer: incrementReducer }),

  // ── Analysis Agent output ─────────────────────────────────────────────

  /**
   * Structured analysis produced by the Analysis Agent.
   *
   * Shape:
   * {
   *   financialHealth:   object  // Revenue, margins, debt, cash flow scores
   *   newsSentiment:     object  // Positive / neutral / negative breakdown
   *   technicalOutlook:  object  // Trend direction, momentum assessment
   *   strengths:         array   // Key competitive advantages
   *   weaknesses:        array   // Internal weaknesses
   *   risks:             array   // External and internal risk factors
   *   growthDrivers:     array   // Catalysts for upside
   *   investmentScore:   number  // 0-100 composite score
   * }
   */
  analysis: Annotation({ reducer: (_, b) => b }),

  // ── Report Agent output ───────────────────────────────────────────────

  /**
   * Investment report produced by the Report Agent.
   *
   * Shape:
   * {
   *   executiveSummary:   string
   *   companyOverview:    string
   *   financialAnalysis:  string
   *   technicalAnalysis:  string
   *   newsSummary:        string
   *   growthDrivers:      string
   *   risks:              string
   *   investmentThesis:   string
   *   markdownReport:     string  // Full report in Markdown
   *   htmlReport:         string  // Full report rendered as HTML
   * }
   */
  report: Annotation({ reducer: (_, b) => b }),

  // ── Recommendation Agent output ───────────────────────────────────────

  /**
   * Final investment recommendation produced by the Recommendation Agent.
   *
   * Shape:
   * {
   *   decision:           "BUY" | "HOLD" | "PASS"
   *   confidenceScore:    number   // 0.0 – 1.0
   *   investmentHorizon:  string   // e.g., "6-12 months"
   *   reasoning:          string   // Concise justification for the decision
   * }
   */
  recommendation: Annotation({ reducer: (_, b) => b }),

  // ── Pipeline metadata ─────────────────────────────────────────────────

  /**
   * Non-destructive error log. Any agent can push errors without aborting
   * the entire pipeline. Inspected by the controller after graph completion.
   *
   * Each entry shape:
   * {
   *   agent:    string   // Which agent recorded this error
   *   message:  string   // Human-readable description
   *   details:  any      // Optional raw error or context
   * }
   */
  errors: Annotation({ reducer: appendReducer, default: () => [] }),
});

/**
 * Convenience type alias — use this in agent node function signatures.
 *
 * @typedef {import('@langchain/langgraph').StateType<typeof InvestmentResearchStateAnnotation>} InvestmentResearchState
 */
