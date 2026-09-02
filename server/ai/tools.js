import { listAiTools, intentForAiTool } from '../actions/registry.js';

export function buildTools() {
  return listAiTools();
}

export { intentForAiTool };
