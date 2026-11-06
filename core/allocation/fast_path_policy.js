/**
 * 🌐 Universal Agent Core Hub - Deterministic Fast Path Routing Policy
 * Phase 5.9 Implementation: TASK-5.9.3 (Policy Boundary Separation)
 *
 * Responsibilities:
 * - Pure routing policy over pre-computed MetadataLifecycleResult.
 * - Does NOT normalize, parse, or re-validate raw plan metadata.
 * - Evaluates Fast Path A (Low-Risk Scope), Fast Path B (High-Risk Ceiling),
 *   and Middle Path (Reconciliation Needed).
 *
 * Invariants:
 * - Zero NLP, zero regex, zero lexical keyword scanning.
 * - Positive low-risk evidence strictly required for Fast Path A.
 * - not-A does NOT imply B (Middle path preserved).
 * - SafetyFloor supremacy is preserved.
 */

'use strict';

const { STANDARD_LAYERS } = require('./plan_metadata');

/**
 * Fast-path routing evaluation result.
 * @typedef {Object} FastPathDecision
 * @property {'fast_path_a' | 'fast_path_b' | null} path - Resolved fast path or null for middle path.
 * @property {boolean} eligible - True if fast path A or B was positively matched.
 * @property {{ confidenceTier: 'high', confidenceReason: string } | null} evidenceState - Contract-compliant EvidenceState.
 * @property {string} reason - Structured reason code.
 * @property {object} lifecycle - Full pre-computed MetadataLifecycleResult.
 */

/**
 * Evaluates deterministic Fast Path routing policy over an ALREADY COMPUTED MetadataLifecycleResult.
 * Operates purely on structured lifecycle properties; zero NLP, zero lexical inspection.
 *
 * Boundary Invariant:
 * This function MUST NOT receive or re-normalize raw plan objects. It strictly consumes
 * the immutable MetadataLifecycleResult produced by plan_metadata.js.
 *
 * Rules:
 * 1. Fast Path A (Low-Risk Scope): Activates ONLY when lifecycle.sufficientForFastPath === true.
 * 2. Fast Path B (High-Risk Ceiling): Activates when metadata is present and explicit high-risk
 *    indicators are present:
 *    - riskTier === 'high'
 *    - changeType >= 4
 *    - securitySensitive === true
 *    - affectsCriticalPath === true
 *    - layers.hasCritical === true (touches domain, data, authentication, financial, core)
 * 3. Middle Path (Reconciliation Needed): Returns path = null when neither A nor B is matched.
 *    (e.g., standard layers like application/infrastructure, ambiguous changeType: 2/3 with non-high risk,
 *    incomplete or unknown metadata without high-risk flags).
 *
 * @param {object} lifecycle Pre-computed MetadataLifecycleResult from validatePlanMetadataLifecycle()
 * @returns {FastPathDecision} Immutable decision record
 */
function evaluateFastPath(lifecycle) {
  if (!lifecycle || typeof lifecycle !== 'object' || typeof lifecycle.stageReached !== 'string') {
    throw new TypeError(
      'evaluateFastPath requires a pre-computed MetadataLifecycleResult from plan_metadata.js (received raw or invalid input)'
    );
  }

  // 1. Fast Path A: Positive, verified structural low-risk scope
  // Strictly requires complete structural sufficiency from Stage 5 of the metadata lifecycle.
  if (lifecycle.sufficientForFastPath === true) {
    return Object.freeze({
      path: 'fast_path_a',
      eligible: true,
      evidenceState: Object.freeze({
        confidenceTier: 'high',
        confidenceReason: 'fast_path_verified_scope'
      }),
      reason: 'fast_path_verified_scope',
      lifecycle
    });
  }

  // 2. Fast Path B: Explicit high-risk ceiling
  // Triggers immediate escalation when authoritative high-risk structural evidence is present.
  const hasExplicitHighRisk = Boolean(
    lifecycle.present && (
      lifecycle.layers.hasCritical === true ||
      lifecycle.data.securitySensitive === true ||
      lifecycle.data.affectsCriticalPath === true ||
      lifecycle.data.riskTier === 'high' ||
      (lifecycle.data.changeType !== null && lifecycle.data.changeType >= 4)
    )
  );

  if (hasExplicitHighRisk) {
    let triggerReason = 'fast_path_high_risk_ceiling';
    if (lifecycle.layers.hasCritical) {
      triggerReason = 'critical_layer_enforced';
    } else if (lifecycle.data.securitySensitive) {
      triggerReason = 'security_sensitive_flag_enforced';
    } else if (lifecycle.data.affectsCriticalPath) {
      triggerReason = 'affects_critical_path_enforced';
    } else if (lifecycle.data.riskTier === 'high') {
      triggerReason = 'high_risk_tier_enforced';
    } else if (lifecycle.data.changeType >= 4) {
      triggerReason = 'major_change_type_enforced';
    }

    return Object.freeze({
      path: 'fast_path_b',
      eligible: true,
      evidenceState: Object.freeze({
        confidenceTier: 'high',
        confidenceReason: 'fast_path_high_risk_ceiling'
      }),
      reason: triggerReason,
      lifecycle
    });
  }

  // 3. Middle Path: Neither Fast Path A nor Fast Path B
  // Represents standard feature logic, ambiguous scope, incomplete/missing metadata,
  // or non-critical standard layers (application, infrastructure) that require reconciliation.
  let middleReason = 'standard_scope_requires_reconciliation';
  if (!lifecycle.present) {
    middleReason = 'missing_metadata_requires_reconciliation';
  } else if (!lifecycle.structurallyValid) {
    middleReason = 'malformed_metadata_requires_reconciliation';
  } else if (!lifecycle.internallyConsistent) {
    middleReason = 'inconsistent_metadata_requires_reconciliation';
  } else if (lifecycle.layers.isEmpty) {
    middleReason = 'empty_layers_requires_reconciliation';
  } else if (lifecycle.layers.hasUnknown) {
    middleReason = 'unknown_layer_requires_reconciliation';
  } else if (lifecycle.layers.canonicalLayers.some(l => STANDARD_LAYERS.has(l))) {
    middleReason = 'standard_layer_requires_reconciliation';
  }

  return Object.freeze({
    path: null,
    eligible: false,
    evidenceState: null,
    reason: middleReason,
    lifecycle
  });
}

module.exports = {
  evaluateFastPath
};
