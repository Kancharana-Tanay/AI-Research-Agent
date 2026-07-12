import Task from '../models/task.js';
import { getGraph } from '../graph/index.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Task Controller
//
// Handles HTTP request processing for the investment research pipeline:
//   1. createTask: Spawns research task asynchronously (as background job).
//   2. getTask: Fetches task details/status by its ID.
//   3. listTasks: Retrieves lightweight history list of tasks.
// ---------------------------------------------------------------------------

// Cache TTL: Deduplicate identical company runs completed within the last 12 hours
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Creates a new research task or returns a recently completed matching task.
 */
export async function createTask(req, res) {
  const { company } = req.body;

  if (!company || typeof company !== 'string' || !company.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Company name is required and must be a valid string.',
    });
  }

  const normalizedCompany = company.trim();
  logger.info('[TaskController] Received research request', { company: normalizedCompany });

  try {
    // Deduplication check: check if task for the same company was completed recently
    const recentTask = await Task.findOne({
      company: { $regex: new RegExp(`^${escapeRegExp(normalizedCompany)}$`, 'i') },
      status: 'completed',
      updatedAt: { $gte: new Date(Date.now() - CACHE_TTL_MS) }
    });

    if (recentTask) {
      logger.info('[TaskController] Cache hit: Returning recently completed research task', {
        company: normalizedCompany,
        taskId: recentTask._id
      });
      return res.status(200).json({
        success: true,
        message: 'Recent research data found (Cache Hit).',
        data: recentTask
      });
    }

    // Create a new task record in pending state
    const task = new Task({
      company: normalizedCompany,
      status: 'pending',
    });

    await task.save();
    logger.info('[TaskController] Task record created', { taskId: task._id });

    // Respond immediately with 202 Accepted and the Task ID.
    // The client will use this ID to poll status while research runs in the background.
    res.status(202).json({
      success: true,
      message: 'Research task spawned successfully.',
      data: {
        id: task._id,
        status: task.status,
        company: task.company,
        createdAt: task.createdAt
      }
    });

    // Execute the StateGraph workflow asynchronously in the background.
    // This detaches execution from the HTTP thread, avoiding request timeouts.
    executeResearchTaskInBackground(task._id);

  } catch (error) {
    logger.error('[TaskController] Failed to create research task', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error while creating task.',
      error: error.message
    });
  }
}

/**
 * Retrieves a single task status and payload by ID.
 */
export async function getTask(req, res) {
  const { id } = req.params;

  try {
    const task = await Task.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: `Task with ID "${id}" not found.`
      });
    }

    return res.status(200).json({
      success: true,
      data: task
    });
  } catch (error) {
    logger.error('[TaskController] Error fetching task', { id, error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching task status.',
      error: error.message
    });
  }
}

/**
 * Lists all historical research runs with lightweight projections to save bandwidth.
 */
export async function listTasks(req, res) {
  try {
    const tasks = await Task.find({}, {
      _id: 1,
      company: 1,
      ticker: 1,
      status: 1,
      createdAt: 1,
      'recommendation.decision': 1,
      'recommendation.confidenceScore': 1
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: tasks
    });
  } catch (error) {
    logger.error('[TaskController] Error listing tasks', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error while listing tasks.',
      error: error.message
    });
  }
}

// ---------------------------------------------------------------------------
// Private Helpers
// ---------------------------------------------------------------------------

/**
 * Triggers the compiled StateGraph and updates the task status in MongoDB.
 */
async function executeResearchTaskInBackground(taskId) {
  logger.info('[TaskController] Starting background task execution', { taskId });

  try {
    // 1. Transition status to processing
    const task = await Task.findByIdAndUpdate(
      taskId,
      { status: 'processing' },
      { new: true }
    );

    if (!task) {
      logger.error('[TaskController] Background task record missing during transition', { taskId });
      return;
    }

    // 2. Fetch the compiled graph singleton and execute it
    const graph = getGraph();
    const result = await graph.invoke({
      company: task.company,
      researchIterations: 0,
      errors: []
    });

    // 3. Update the task with the completed outputs
    await Task.findByIdAndUpdate(taskId, {
      status: 'completed',
      ticker: result.ticker || null,
      research: result.research || null,
      analysis: result.analysis || null,
      report: result.report || null,
      recommendation: result.recommendation || null,
      // Record any warning/minor errors collected during execution
      error: result.errors?.length > 0 ? JSON.stringify(result.errors) : null
    });

    logger.info('[TaskController] Background task execution completed', {
      taskId,
      ticker: result.ticker,
      decision: result.recommendation?.decision
    });

  } catch (error) {
    logger.error('[TaskController] Background task execution failed', { taskId, error: error.message });

    // Transition status to failed and store the error message
    await Task.findByIdAndUpdate(taskId, {
      status: 'failed',
      error: error.message
    });
  }
}

/**
 * Escapes special regex characters in a query string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
