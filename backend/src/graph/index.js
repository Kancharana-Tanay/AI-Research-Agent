import { buildWorkflow } from './workflow.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Compiled Graph Singleton
//
// The graph is compiled once at module load time. This is intentional:
//   - Graph compilation validates the node/edge topology upfront.
//   - The compiled graph is stateless and thread-safe; multiple concurrent
//     requests can each invoke `graph.invoke(...)` independently.
//   - Compiling per-request would add unnecessary latency.
// ---------------------------------------------------------------------------

let _graph = null;

/**
 * Returns the singleton compiled LangGraph workflow.
 * Lazily initialised on first call.
 *
 * @returns {import('@langchain/langgraph').CompiledGraph}
 */
export function getGraph() {
  if (!_graph) {
    logger.info('Initialising LangGraph workflow singleton');
    _graph = buildWorkflow();
  }
  return _graph;
}
