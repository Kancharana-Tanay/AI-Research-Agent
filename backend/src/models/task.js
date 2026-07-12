import mongoose from 'mongoose';

// ---------------------------------------------------------------------------
// Research Task Schema
//
// Represents a single investment research execution task.
// Features:
//   - Stores input company name and output ticker.
//   - Tracks execution status (pending -> processing -> completed/failed).
//   - Retains the full, cleaned multi-agent output payloads.
//   - Saves execution error messages for easy diagnostics.
//   - Automatic indexing for faster search and history lookup.
// ---------------------------------------------------------------------------

const taskSchema = new mongoose.Schema(
  {
    company: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    ticker: {
      type: String,
      index: true,
      uppercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    research: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    analysis: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    report: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    recommendation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // Auto-manages createdAt and updatedAt
  }
);

// Optimize query for listing task history
taskSchema.index({ createdAt: -1 });

const Task = mongoose.model('Task', taskSchema);

export default Task;
