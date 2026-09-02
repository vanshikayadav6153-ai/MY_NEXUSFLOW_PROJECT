import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '../config/index.js';

export const AI_MODEL = process.env.NEXUSFLOW_AI_MODEL || 'claude-sonnet-5';

let _client = null;
let _clientKey = null;

export function isAiEnabled() {
  return Boolean(getAnthropicKey());
}

export function getClient() {
  const key = getAnthropicKey();
  if (!key) return null;
  if (!_client || _clientKey !== key) {
    _client = new Anthropic({ apiKey: key });
    _clientKey = key;
  }
  return _client;
}
