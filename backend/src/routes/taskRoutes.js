import express from 'express';
import { createTask, getTask, listTasks } from '../controllers/taskController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ---------------------------------------------------------------------------
// Research Task Routes
//
// Mount path: /api/research
// Routes:
//   - POST /          : Spawn a new research run (or return cached completed run)
//   - GET /:id        : Fetch task execution details/status
//   - GET /          : Fetch lightweight history list of tasks
// ---------------------------------------------------------------------------

const router = express.Router();

router.post('/', asyncHandler(createTask));
router.get('/:id', asyncHandler(getTask));
router.get('/', asyncHandler(listTasks));

export default router;
