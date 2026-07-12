import { StateGraph, END } from '@langchain/langgraph';
import { InvestmentResearchStateAnnotation } from './state.js';
import { researchAgent } from '../agents/researchAgent.js';
import { analysisAgent } from '../agents/analysisAgent.js';
import { reportAgent } from '../agents/reportAgent.js';
import { recommendationAgent } from '../agents/recommendationAgent.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Research loop configuration
//
// The Research Agent is allowed to loop up to MAX_RESEARCH_ITERATIONS times
// before the pipeline forces it to proceed with whatever evidence it has.
// This prevents infinite loops if the LLM keeps requesting more data.
// ---------------------------------------------------------------------------
const MAX_RESEARCH_ITERATIONS = 4;

// ---------------------------------------------------------------------------
// Routing function for the Research Agent loop
//
// After each Research Agent invocation, LangGraph calls this function to
// decide the next node. The Research Agent sets `research.isComplete` to
// signal readiness; we also enforce the hard iteration cap.
// ---------------------------------------------------------------------------

/**
 * Decides whether to continue researching or advance to Analysis.
 *
 * @param {import('./state.js').InvestmentResearchState} state
 * @returns {"research" | "analysis"}
 */
function routeAfterResearch(state) {
  const { researchIterations, research } = state;

  const iterationCap = researchIterations >= MAX_RESEARCH_ITERATIONS;
  const researchComplete = research?.isComplete === true;

  if (researchComplete || iterationCap) {
    if (iterationCap && !researchComplete) {
      logger.warn(
        'Research Agent hit max iterations without declaring completeness — proceeding anyway',
        { iterations: researchIterations, company: state.company },
      );
    }
    return 'analysisAgent';
  }

  return 'researchAgent';
}

// ---------------------------------------------------------------------------
// Graph construction
//
// The pipeline is linear with one conditional loop at the research stage:
//
//   research ──(not complete)──► research (loop)
//             ──(complete)──────► analysis ──► report ──► recommendation ──► END
// ---------------------------------------------------------------------------

/**
 * Builds and compiles the LangGraph StateGraph.
 *
 * This is called once at application startup. The compiled graph is an
 * immutable runnable that can be invoked concurrently for different requests.
 *
 * @returns {import('@langchain/langgraph').CompiledGraph}
 */
export function buildWorkflow() {
  // NOTE: LangGraph prohibits node names that match state channel keys.
  // Node names use the 'Agent' suffix (e.g., 'researchAgent') while the
  // corresponding state fields remain unprefixed (e.g., state.research).
  const graph = new StateGraph(InvestmentResearchStateAnnotation)
    // ── Node definitions ──────────────────────────────────────────────────
    .addNode('researchAgent', researchAgent)
    .addNode('analysisAgent', analysisAgent)
    .addNode('reportAgent', reportAgent)
    .addNode('recommendationAgent', recommendationAgent)

    // ── Entry point ───────────────────────────────────────────────────────
    .addEdge('__start__', 'researchAgent')

    // ── Conditional loop: research may repeat until evidence is sufficient ─
    .addConditionalEdges('researchAgent', routeAfterResearch, {
      researchAgent: 'researchAgent',
      analysisAgent: 'analysisAgent',
    })

    // ── Linear progression once research is complete ──────────────────────
    .addEdge('analysisAgent', 'reportAgent')
    .addEdge('reportAgent', 'recommendationAgent')
    .addEdge('recommendationAgent', END);

  const compiled = graph.compile();

  logger.info('LangGraph workflow compiled successfully', {
    nodes: ['researchAgent', 'analysisAgent', 'reportAgent', 'recommendationAgent'],
    maxResearchIterations: MAX_RESEARCH_ITERATIONS,
  });

  return compiled;
}
