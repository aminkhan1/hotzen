/**
 * 🌐 Universal Agent Core Hub - Benchmark V1 Contracts & Schemas
 * Phase 6 Implementation: Frozen Benchmark Specification & Data Models
 */

'use strict';

const BENCHMARK_MODES = Object.freeze({
  RAW_STRONG: 'RAW_STRONG',
  CORE_FIXED_STRONG: 'CORE_FIXED_STRONG',
  CORE_ADAPTIVE: 'CORE_ADAPTIVE'
});

const BENCHMARK_VERDICTS = Object.freeze({
  BENEFIT_OBSERVED: 'BENEFIT_OBSERVED',
  NO_MEASURABLE_BENEFIT: 'NO_MEASURABLE_BENEFIT',
  REGRESSION_OBSERVED: 'REGRESSION_OBSERVED',
  INCONCLUSIVE: 'INCONCLUSIVE'
});

const TASK_CATEGORIES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  AMBIGUOUS: 'AMBIGUOUS',
  RECOVERY: 'RECOVERY'
});

const PROVIDER_EXECUTION_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  TIMEOUT: 'TIMEOUT',
  FAILURE: 'FAILURE'
});

const ARTIFACT_COLLECTION_STATUS = Object.freeze({
  EXTRACTED: 'EXTRACTED',
  FOUND_ON_DISK: 'FOUND_ON_DISK',
  NO_CODE_FOUND: 'NO_CODE_FOUND',
  SYNTAX_INVALID: 'SYNTAX_INVALID'
});

const VERIFICATION_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  SKIPPED: 'SKIPPED'
});

const RUBRIC_CATEGORIES = Object.freeze({
  FUNCTIONAL_CORRECTNESS: 'functionalCorrectness',      // 30 pts
  REQUIREMENT_UNDERSTANDING: 'requirementUnderstanding',// 20 pts
  ARCHITECTURE_DISCIPLINE: 'architectureDiscipline',    // 15 pts
  EDGE_CASES: 'edgeCases',                              // 15 pts
  SECURITY_SAFETY: 'securitySafety',                    // 10 pts
  REGRESSION_SAFETY: 'regressionSafety'                 // 10 pts
});

const RUBRIC_WEIGHTS = Object.freeze({
  [RUBRIC_CATEGORIES.FUNCTIONAL_CORRECTNESS]: 30,
  [RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING]: 20,
  [RUBRIC_CATEGORIES.ARCHITECTURE_DISCIPLINE]: 15,
  [RUBRIC_CATEGORIES.EDGE_CASES]: 15,
  [RUBRIC_CATEGORIES.SECURITY_SAFETY]: 10,
  [RUBRIC_CATEGORIES.REGRESSION_SAFETY]: 10
});

const MAX_RUBRIC_SCORE = 100;

/**
 * Validates a BenchmarkTask definition.
 * @param {object} task
 * @returns {{ valid: boolean, error?: string }}
 */
function validateBenchmarkTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return { valid: false, error: 'BenchmarkTask must be a non-null object' };
  }

  if (typeof task.id !== 'string' || !task.id.trim()) {
    return { valid: false, error: 'BenchmarkTask.id must be a non-empty string' };
  }

  if (!Object.values(TASK_CATEGORIES).includes(task.category)) {
    return { valid: false, error: `Invalid task category '${task.category}'. Expected one of: ${Object.values(TASK_CATEGORIES).join(', ')}` };
  }

  if (typeof task.userPrompt !== 'string' || !task.userPrompt.trim()) {
    return { valid: false, error: 'BenchmarkTask.userPrompt must be a non-empty string' };
  }

  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    return { valid: false, error: 'BenchmarkTask.acceptanceCriteria must be a non-empty array' };
  }

  if (!task.hiddenRubric || typeof task.hiddenRubric !== 'object') {
    return { valid: false, error: 'BenchmarkTask.hiddenRubric must be an object' };
  }

  for (const [cat, maxWeight] of Object.entries(RUBRIC_WEIGHTS)) {
    if (typeof task.hiddenRubric[cat] !== 'object' || task.hiddenRubric[cat] === null) {
      return { valid: false, error: `hiddenRubric must define category '${cat}'` };
    }
    if (task.hiddenRubric[cat].maxPoints !== maxWeight) {
      return { valid: false, error: `Category '${cat}' maxPoints must be ${maxWeight}, got: ${task.hiddenRubric[cat].maxPoints}` };
    }
  }

  return { valid: true };
}

/**
 * Validates a RunTelemetry record.
 * Unknown fields MUST be null, not omitted or fabricated.
 * @param {object} telemetry
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRunTelemetry(telemetry) {
  if (!telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) {
    return { valid: false, error: 'RunTelemetry must be a non-null object' };
  }

  const requiredFields = [
    'provider',
    'mode',
    'taskId',
    'exactUserPrompt',
    'promptWordCount',
    'modelPerAgent',
    'wallClockExecutionTimeMs',
    'modelCallCount',
    'retries',
    'humanInterventionCount',
    'testsPassed',
    'testsTotal',
    'finalQualityScore',
    'fatalFailure'
  ];

  for (const field of requiredFields) {
    if (telemetry[field] === undefined) {
      return { valid: false, error: `RunTelemetry missing required field: '${field}'` };
    }
  }

  if (!Object.values(BENCHMARK_MODES).includes(telemetry.mode)) {
    return { valid: false, error: `Invalid benchmark mode '${telemetry.mode}'` };
  }

  if (typeof telemetry.finalQualityScore !== 'number' || telemetry.finalQualityScore < 0 || telemetry.finalQualityScore > 100) {
    return { valid: false, error: `finalQualityScore must be a number between 0 and 100, got: ${telemetry.finalQualityScore}` };
  }

  if (typeof telemetry.fatalFailure !== 'boolean') {
    return { valid: false, error: 'fatalFailure must be a boolean' };
  }

  // Nullable telemetry fields must be either number/string/object or strictly null
  const nullableKeys = [
    'reasoningEffort',
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'partialTokens',
    'telemetryComplete',
    'telemetryStatus',
    'contextBytes',
    'providerReportedCost',
    'firstPassSuccess',
    'recoveryUsage',
    'executionValid',
    'providerExecutionStatus',
    'artifactCollectionStatus',
    'verificationStatus',
    'diagnosticScore',
    'toolCallCount'
  ];

  for (const key of nullableKeys) {
    if (telemetry[key] !== null && telemetry[key] !== undefined) {
      if (typeof telemetry[key] !== 'number' && typeof telemetry[key] !== 'string' && typeof telemetry[key] !== 'boolean') {
        return { valid: false, error: `Field '${key}' must be null or primitive, got: ${typeof telemetry[key]}` };
      }
    }
  }

  return { valid: true };
}

module.exports = {
  BENCHMARK_MODES,
  BENCHMARK_VERDICTS,
  TASK_CATEGORIES,
  PROVIDER_EXECUTION_STATUS,
  ARTIFACT_COLLECTION_STATUS,
  VERIFICATION_STATUS,
  RUBRIC_CATEGORIES,
  RUBRIC_WEIGHTS,
  MAX_RUBRIC_SCORE,
  validateBenchmarkTask,
  validateRunTelemetry
};
