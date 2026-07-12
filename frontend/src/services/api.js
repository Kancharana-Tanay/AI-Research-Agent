import axios from 'axios';

// ---------------------------------------------------------------------------
// Backend API Client Service
//
// Wraps all HTTP requests to our Node.js Express server.
// Configured to communicate with http://localhost:5000/api.
// ---------------------------------------------------------------------------

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 15000,
});

/**
 * Submits a new company research request to the background pipeline.
 *
 * @param {string} company - Name of the company, e.g. "Apple" or "Tesla"
 * @returns {Promise<object>} The spawned task response object (202 Accepted status)
 */
export async function spawnResearchTask(company) {
  const response = await api.post('/research', { company });
  return response.data;
}

/**
 * Checks the status and retrieves the payload of an active or completed task.
 *
 * @param {string} id - The MongoDB Task ID
 * @returns {Promise<object>} The task document details
 */
export async function fetchResearchTask(id) {
  const response = await api.get(`/research/${id}`);
  return response.data;
}

/**
 * Lists all historical research tasks spawned on the server.
 *
 * @returns {Promise<object>} List of lightweight task projection summaries
 */
export async function listResearchTasks() {
  const response = await api.get('/research');
  return response.data;
}
