/**
 * 🌐 Universal Agent Core Hub - Shared Artifact Delivery Envelope
 * Phase 1 Implementation: Symmetric Delivery Contract Across Modes A, B, and C
 *
 * Invariants:
 * 1. Symmetric Delivery: All modes (RAW_STRONG, CORE_FIXED_STRONG, CORE_ADAPTIVE)
 *    explicitly target index.js in the isolated sandbox.
 * 2. Prompt Preservation: The frozen functional prompt (task.userPrompt) is preserved
 *    intact and unmodified without altering requirements or hidden rubrics.
 * 3. Zero Governance Leakage: Mode A (RAW_STRONG) contains ZERO Core governance tokens
 *    ([CORE GOVERNANCE PROTOCOL ACTIVE], Role directives, Critic instructions, etc.).
 * 4. Deterministic Framing: Core modes (B and C) encapsulate the prompt within the
 *    governed execution role while retaining the exact same delivery requirement.
 */

'use strict';

const { BENCHMARK_MODES } = require('./contracts');

const DEFAULT_TARGET_FILE = 'index.js';

const DELIVERY_INSTRUCTION_PREFIX = 'Delivery Requirement:';

/**
 * Known Core governance tokens that must NEVER appear in RAW_STRONG prompts.
 */
const CORE_GOVERNANCE_MARKERS = Object.freeze([
  '[CORE GOVERNANCE PROTOCOL ACTIVE]',
  'Role:',
  'CoreBrain',
  'ModelAllocator',
  'Senior Critic Gate',
  'KISS Principle',
  'Clean Architecture & Boundary Isolation',
  'Minimum Viable Team',
  'Rubric',
  'HiddenRubric'
]);

/**
 * Builds the symmetric delivery instruction for writing the target artifact file.
 *
 * @param {string} [targetFile=DEFAULT_TARGET_FILE]
 * @returns {string}
 */
function buildDeliveryInstruction(targetFile = DEFAULT_TARGET_FILE) {
  return `${DELIVERY_INSTRUCTION_PREFIX} Write the complete implementation directly to ${targetFile} in the current working directory.`;
}

/**
 * Checks whether a given prompt string contains any Core governance tokens.
 *
 * @param {string} promptText
 * @returns {boolean}
 */
function hasCoreGovernance(promptText) {
  if (!promptText || typeof promptText !== 'string') return false;
  return CORE_GOVERNANCE_MARKERS.some(marker => promptText.includes(marker));
}

/**
 * Formats a benchmark task into a symmetric prompt envelope for execution.
 *
 * @param {object|string} task BenchmarkTask or user prompt string
 * @param {string} mode BenchmarkMode ('RAW_STRONG' | 'CORE_FIXED_STRONG' | 'CORE_ADAPTIVE')
 * @param {object} [options]
 * @param {string} [options.targetFile='index.js'] Target output file name
 * @param {string} [options.role='Coder'] Role name for Core modes
 * @returns {{
 *   mode: string,
 *   targetFile: string,
 *   prompt: string,
 *   functionalPrompt: string,
 *   hasGovernance: boolean
 * }}
 */
function formatDeliveryPrompt(task, mode, options = {}) {
  const validModes = Object.values(BENCHMARK_MODES);
  if (!mode || !validModes.includes(mode)) {
    throw new Error(`Invalid benchmark mode '${mode}'. Expected one of: ${validModes.join(', ')}`);
  }

  let userPrompt = '';
  let taskTitle = '';

  if (typeof task === 'string') {
    userPrompt = task.trim();
    taskTitle = 'Implementation Task';
  } else if (task && typeof task === 'object') {
    if (typeof task.userPrompt !== 'string') {
      throw new Error('Task object must provide a valid string userPrompt');
    }
    userPrompt = task.userPrompt.trim();
    taskTitle = task.title || task.id || 'Implementation Task';
  } else {
    throw new Error('Task must be a BenchmarkTask object or a non-empty string prompt');
  }

  if (!userPrompt) {
    throw new Error('User prompt cannot be empty');
  }

  const targetFile = options.targetFile || DEFAULT_TARGET_FILE;
  const deliveryInstruction = buildDeliveryInstruction(targetFile);

  let formattedPrompt = '';
  let hasGovernance = false;

  if (mode === BENCHMARK_MODES.RAW_STRONG) {
    // Mode A: Raw Direct Strong Provider
    // Appends the symmetric delivery instruction to userPrompt with ZERO Core governance.
    formattedPrompt = `${userPrompt}\n\n${deliveryInstruction}`;
    hasGovernance = false;
  } else {
    // Modes B & C: Core Governed Workflow (Fixed Strong or Adaptive)
    // Encapsulates task inside governed role execution envelope with the exact same delivery instruction.
    const role = options.role || 'Coder';
    formattedPrompt = `[CORE GOVERNANCE PROTOCOL ACTIVE]\nRole: ${role}\nTask: ${taskTitle}\nSpecification:\n${userPrompt}\n\n${deliveryInstruction}`;
    hasGovernance = true;
  }

  return Object.freeze({
    mode,
    targetFile,
    prompt: formattedPrompt,
    functionalPrompt: userPrompt,
    hasGovernance
  });
}

/**
 * Extracts the functional prompt and target file from an enveloped prompt.
 *
 * @param {string} envelopedPrompt
 * @returns {{ functionalPrompt: string, targetFile: string, hasGovernance: boolean }}
 */
function parseDeliveryEnvelope(envelopedPrompt) {
  if (!envelopedPrompt || typeof envelopedPrompt !== 'string') {
    throw new Error('envelopedPrompt must be a non-empty string');
  }

  const hasGovernance = hasCoreGovernance(envelopedPrompt);
  let targetFile = DEFAULT_TARGET_FILE;

  const targetMatch = envelopedPrompt.match(/directly to ([a-zA-Z0-9._-]+) in the current working directory/);
  if (targetMatch) {
    targetFile = targetMatch[1];
  }

  let functionalPrompt = envelopedPrompt;

  if (hasGovernance) {
    const specMatch = envelopedPrompt.match(/Specification:\n([\s\S]*?)\n\nDelivery Requirement:/);
    if (specMatch) {
      functionalPrompt = specMatch[1].trim();
    }
  } else {
    const rawMatch = envelopedPrompt.match(/([\s\S]*?)\n\nDelivery Requirement:/);
    if (rawMatch) {
      functionalPrompt = rawMatch[1].trim();
    }
  }

  return Object.freeze({
    functionalPrompt,
    targetFile,
    hasGovernance
  });
}

module.exports = {
  DEFAULT_TARGET_FILE,
  DELIVERY_INSTRUCTION_PREFIX,
  CORE_GOVERNANCE_MARKERS,
  buildDeliveryInstruction,
  hasCoreGovernance,
  formatDeliveryPrompt,
  parseDeliveryEnvelope
};
