/**
 * 🌐 Universal Agent Core Hub - Benchmark V1 Harness Engine
 * Phase 6 Implementation: Multi-Mode Benchmark Execution & Comparative Analysis
 */

'use strict';

const {
  BENCHMARK_MODES,
  BENCHMARK_VERDICTS,
  validateRunTelemetry
} = require('./contracts');
const { BenchmarkSandbox } = require('./sandbox');
const { RubricEvaluator } = require('./rubric_evaluator');

const STRONG_MODEL_MAP = Object.freeze({
  claude_code: 'sonnet',
  codex: 'gpt-6-astra'
});

class BenchmarkHarness {
  /**
   * @param {object} [options]
   * @param {string} [options.provider='claude_code'] Active provider
   * @param {string} [options.sandboxRoot] Root directory for sandboxes
   * @param {object} [options.adapter] Provider adapter instance override
   */
  constructor(options = {}) {
    this.provider = options.provider || 'claude_code';
    this.sandboxRoot = options.sandboxRoot;
    this.adapter = options.adapter || null;
  }

  /**
   * Resolves the trusted strong model identifier for the provider.
   *
   * @param {string} [provider]
   * @returns {string}
   */
  getStrongModel(provider = this.provider) {
    const model = STRONG_MODEL_MAP[provider];
    if (!model) {
      throw new Error(`No strong model mapped for provider: '${provider}'`);
    }
    return model;
  }

  /**
   * Checks whether the provider currently has a resolved, trusted strong model.
   * @param {string} [provider]
   * @returns {boolean}
   */
  hasResolvedStrongModel(provider = this.provider) {
    return Boolean(STRONG_MODEL_MAP[provider]);
  }

  /**
   * Builds an empty, strictly typed telemetry record conforming to schema.
   * Unknown metrics are strictly initialized to null (no fabrication).
   *
   * @param {object} task BenchmarkTask
   * @param {string} mode BenchmarkMode
   * @param {object} [overrides]
   * @returns {object} Validated RunTelemetry
   */
  createTelemetryRecord(task, mode, overrides = {}) {
    const words = task.userPrompt.trim().split(/\s+/).length;

    const base = {
      provider: this.provider,
      mode,
      taskId: task.id,
      exactUserPrompt: task.userPrompt,
      promptWordCount: words,
      modelPerAgent: {},
      reasoningEffort: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      partialTokens: null,
      telemetryComplete: null,
      telemetryStatus: null,
      contextBytes: null,
      providerReportedCost: null,
      wallClockExecutionTimeMs: 0,
      modelCallCount: 0,
      toolCallCount: null,
      retries: 0,
      firstPassSuccess: null,
      recoveryUsage: null,
      humanInterventionCount: 0,
      testsPassed: 0,
      testsTotal: 0,
      finalQualityScore: 0,
      fatalFailure: false,
      rubricBreakdown: {},
      rawProviderTelemetry: null,
      executionValid: null,
      providerExecutionStatus: null,
      artifactCollectionStatus: null,
      verificationStatus: null,
      diagnosticScore: null,
      ...overrides
    };

    const validation = validateRunTelemetry(base);
    if (!validation.valid) {
      throw new Error(`Telemetry record failed schema validation: ${validation.error}`);
    }

    return base;
  }

  /**
   * Compares execution results across Modes A, B, and C for a benchmark task.
   * Evaluates the 5 Core Value Gate criteria.
   *
   * @param {object} params
   * @param {object} params.task BenchmarkTask
   * @param {object} params.resultA RunTelemetry for RAW_STRONG
   * @param {object} params.resultB RunTelemetry for CORE_FIXED_STRONG
   * @param {object} params.resultC RunTelemetry for CORE_ADAPTIVE
   * @returns {object} ComparisonReport
   */
  generateComparisonReport({ task, resultA, resultB, resultC }) {
    if (!resultA || !resultB || !resultC) {
      throw new Error('generateComparisonReport requires results for all three modes: A, B, and C');
    }

    // Dimension 1: Value of Core Itself (A vs B)
    const qualityDeltaCore = resultB.finalQualityScore - resultA.finalQualityScore;
    const coreFatalPrevented = resultA.fatalFailure && !resultB.fatalFailure;
    const coreRecoveryBenefit = (resultB.recoveryUsage === true && resultB.finalQualityScore > resultA.finalQualityScore);

    // Dimension 2: Value of Adaptive Model Routing (B vs C)
    const qualityDeltaAdaptive = resultC.finalQualityScore - resultB.finalQualityScore;
    const hasCompleteTokensB = (typeof resultB.totalTokens === 'number') && resultB.telemetryComplete !== false;
    const hasCompleteTokensC = (typeof resultC.totalTokens === 'number') && resultC.telemetryComplete !== false;
    const tokenSavingsPercent = (hasCompleteTokensB && hasCompleteTokensC && resultB.totalTokens > 0)
      ? Math.round(((resultB.totalTokens - resultC.totalTokens) / resultB.totalTokens) * 100)
      : null;
    const latencySavingsPercent = (resultB.wallClockExecutionTimeMs > 0 && resultC.wallClockExecutionTimeMs > 0)
      ? Math.round(((resultB.wallClockExecutionTimeMs - resultC.wallClockExecutionTimeMs) / resultB.wallClockExecutionTimeMs) * 100)
      : null;

    // Safety Floor Check for High Risk tasks
    const isHighRisk = task.category === 'HIGH';
    let safetyFloorPreserved = null;
    if (isHighRisk) {
      // In high-risk tasks, Mode C must NOT downgrade capability tier below strong
      if (this.hasResolvedStrongModel(this.provider)) {
        const strongModel = this.getStrongModel(this.provider);
        const cModels = Object.values(resultC.modelPerAgent || {});
        safetyFloorPreserved = cModels.every(m => m === strongModel);
      } else {
        // Cannot assert against unresolved strong model for uncalibrated provider
        safetyFloorPreserved = null;
      }
    }

    // Core Value Gate Decision Rules
    const benefits = [];
    const concerns = [];

    // Rule 1: Core quality improvement or preservation without regressions
    if (qualityDeltaCore > 5 || coreFatalPrevented) {
      benefits.push('Core workflow improved outcome quality and/or prevented fatal failure');
    } else if (qualityDeltaCore < -5) {
      concerns.push('Core workflow degraded quality compared to raw model');
    }

    // Rule 2: Recovery benefit
    if (coreRecoveryBenefit) {
      benefits.push('Core recovery state machine detected and resolved implementation defects');
    }

    // Rule 3: Adaptive token/latency efficiency
    if (tokenSavingsPercent !== null && tokenSavingsPercent > 10 && qualityDeltaAdaptive >= -5) {
      benefits.push(`Adaptive routing reduced token consumption by ${tokenSavingsPercent}% without significant quality degradation`);
    } else if (tokenSavingsPercent !== null && tokenSavingsPercent <= 0) {
      concerns.push('Adaptive routing did not reduce token usage');
    }

    // Rule 4: Quality regression in Adaptive
    if (qualityDeltaAdaptive < -10) {
      concerns.push(`Adaptive routing caused significant quality loss (${qualityDeltaAdaptive} pts)`);
    }

    // Rule 5: Safety floor in high risk
    if (isHighRisk && safetyFloorPreserved === false) {
      concerns.push('Safety floor violated: High-risk task suffered unsafe model downgrade in adaptive mode');
    }

    // Rule 6: Execution validity check
    if (resultA.executionValid === false || resultB.executionValid === false || resultC.executionValid === false) {
      concerns.push('One or more benchmark runs suffered execution failure or timeout');
    }

    // Determine final verdict using calibrated pilot-scale terminology
    let verdict = BENCHMARK_VERDICTS.NO_MEASURABLE_BENEFIT;

    const hasSignificantRegression = (
      qualityDeltaCore < -5 ||
      qualityDeltaAdaptive < -10 ||
      (isHighRisk && safetyFloorPreserved === false) ||
      (resultB.fatalFailure && !resultA.fatalFailure) ||
      (resultC.fatalFailure && !resultB.fatalFailure)
    );

    if (hasSignificantRegression) {
      verdict = BENCHMARK_VERDICTS.REGRESSION_OBSERVED;
    } else if (benefits.length > 0 && concerns.length === 0) {
      verdict = BENCHMARK_VERDICTS.BENEFIT_OBSERVED;
    } else if (benefits.length > 0 && concerns.length > 0) {
      verdict = BENCHMARK_VERDICTS.INCONCLUSIVE;
    } else {
      verdict = BENCHMARK_VERDICTS.NO_MEASURABLE_BENEFIT;
    }

    return Object.freeze({
      taskId: task.id,
      taskCategory: task.category,
      provider: this.provider,
      modes: {
        A_RAW_STRONG: resultA,
        B_CORE_FIXED_STRONG: resultB,
        C_CORE_ADAPTIVE: resultC
      },
      metrics: {
        qualityScores: {
          A: resultA.finalQualityScore,
          B: resultB.finalQualityScore,
          C: resultC.finalQualityScore
        },
        qualityDeltaCore_B_vs_A: qualityDeltaCore,
        qualityDeltaAdaptive_C_vs_B: qualityDeltaAdaptive,
        tokenSavingsPercent_C_vs_B: tokenSavingsPercent,
        latencySavingsPercent_C_vs_B: latencySavingsPercent,
        coreFatalPrevented,
        coreRecoveryBenefit,
        safetyFloorPreserved
      },
      evaluations: {
        coreImprovesQuality: qualityDeltaCore >= 0,
        coreRecoversDefects: coreRecoveryBenefit,
        adaptiveImprovesEfficiency: tokenSavingsPercent !== null ? tokenSavingsPercent > 0 : null,
        safetyFloorEffective: safetyFloorPreserved
      },
      verdict,
      summary: {
        benefits,
        concerns
      }
    });
  }
}

module.exports = {
  BenchmarkHarness,
  STRONG_MODEL_MAP
};
