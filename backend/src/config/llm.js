import { env } from './env.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// LLM Factory — provider-agnostic chat model initialisation
//
// The LLM_PROVIDER environment variable controls which LangChain chat model
// is instantiated. This isolates all LLM-specific imports and configuration
// into one module. Adding a new provider requires only:
//   1. Installing the relevant @langchain/* package.
//   2. Adding a case to the factory switch below.
//   3. Setting LLM_PROVIDER and LLM_API_KEY in .env.
//
// Supported providers:
//   openai     → @langchain/openai   (ChatOpenAI)
//   anthropic  → @langchain/anthropic (ChatAnthropic)
//   google     → @langchain/google-genai (ChatGoogleGenerativeAI)
//   groq       → @langchain/groq     (ChatGroq)
// ---------------------------------------------------------------------------

let _llm = null;
let _mockLlm = null;

/**
 * Sets a mock LLM instance for testing.
 *
 * @param {any} mock - The mock LLM instance to use
 */
export function setMockLLM(mock) {
  _mockLlm = mock;
}

/**
 * Lazily creates and returns a configured LangChain chat model instance.
 * The same instance is reused across all agents (models are stateless).
 *
 * @returns {Promise<import('@langchain/core/language_models/chat_models').BaseChatModel>}
 * @throws {Error} If LLM_PROVIDER is not set or not supported.
 */
export async function getLLM() {
  if (_mockLlm) return _mockLlm;
  if (_llm) return _llm;

  const provider = (env.LLM_PROVIDER || '').toLowerCase().trim();
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;

  if (!provider) {
    throw new Error(
      'LLM_PROVIDER is not set. Please configure it in your .env file.\n' +
        'Supported values: openai | anthropic | google | groq',
    );
  }

  if (!apiKey) {
    throw new Error('LLM_API_KEY is not set. Please configure it in your .env file.');
  }

  logger.info('Initialising LLM', { provider, model: model || '(default)' });

  switch (provider) {
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      _llm = new ChatOpenAI({
        apiKey,
        model: model || 'gpt-4o',
        temperature: 0.2,
      });
      break;
    }

    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      _llm = new ChatAnthropic({
        apiKey,
        model: model || 'claude-3-5-sonnet-20241022',
        temperature: 0.2,
        maxTokens: 8192,
      });
      break;
    }

    case 'google': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      _llm = new ChatGoogleGenerativeAI({
        apiKey,
        model: model || 'gemini-1.5-pro',
        temperature: 0.2,
      });
      break;
    }

    case 'groq': {
      const { ChatGroq } = await import('@langchain/groq');
      _llm = new ChatGroq({
        apiKey,
        model: model || 'llama-3.3-70b-versatile',
        temperature: 0.2,
      });
      break;
    }

    default:
      throw new Error(
        `Unsupported LLM_PROVIDER: "${env.LLM_PROVIDER}". ` +
          'Supported values: openai | anthropic | google | groq',
      );
  }

  logger.info('LLM initialised successfully', { provider });
  return _llm;
}

/**
 * Resets the cached LLM instance.
 * Useful for testing or runtime provider switching.
 */
export function resetLLM() {
  _llm = null;
}
