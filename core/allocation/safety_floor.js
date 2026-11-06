/**
 * 🌐 Universal Agent Core Hub - Deterministic Safety Floor & Reconciliation Layer
 * Phase 5.4 Implementation: Minimum guaranteed safety floor against silent model downgrades.
 *
 * Architecture:
 * Planner Structured Metadata
 *          ↓
 * Deterministic Safety Floor
 *          │
 *          ├───────────────┐
 *          ↓               │
 * LocalBrain Prediction    │
 *          ↓               │
 *       Reconcile ←────────┘
 *          ↓
 * Final Requirements
 *
 * Invariant:
 * LocalBrain must NEVER be able to downgrade below risk/capability/reasoning requirements
 * that can already be established deterministically from trusted structured Planner metadata.
 */

'use strict';

const { validatePlanRequirementsResult } = require('./contracts');
const {
  deterministicFallbackBrain,
  resolveEffectiveRisk
} = require('./deterministic_fallback_brain');

const CAPABILITY_RANK = Object.freeze({
  lightweight: 1,
  balanced: 2,
  strong: 3
});

const REASONING_RANK = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3
});

const RISK_RANK = Object.freeze({
  low: 1,
  medium: 2,
  high: 3
});

/**
 * Computes the deterministic safety floor for a given plan input.
 * Does NOT perform free-form NLP over plan text; uses only structured Planner metadata.
 *
 * @param {object} input
 * @param {DeterministicFallbackBrain} [fallbackBrain]
 * @returns {object} PlanRequirementsResult representing the minimum safety floor
 */
function computeSafetyFloor(input, fallbackBrain = deterministicFallbackBrain) {
  return fallbackBrain.analyzePlanSync(input);
}

/**
 * Reconciles raw LocalBrain predictions with the deterministic safety floor.
 *
 * Decision Rules:
 * 1. If LocalBrain requirement is below floor in capability, reasoning, or risk:
 *    RAISE that field to the safety floor.
 * 2. If LocalBrain requirement is equal to or above floor:
 *    KEEP LocalBrain's value (upgrade allowed).
 * 3. Preserve raw Brain predictions in `rawPrediction` for separate observability
 *    (Raw Brain Accuracy vs Final System Safety).
 *
 * @param {object} rawResult - Validated raw result from LocalBrain (or fallback)
 * @param {object} input - Original plan input containing structured metadata
 * @param {object} [options]
 * @param {DeterministicFallbackBrain} [options.fallbackBrain]
 * @returns {object} PlanRequirementsResult with safe, reconciled requirements
 */
function reconcileWithSafetyFloor(rawResult, input, options = {}) {
  const fallbackBrain = options.fallbackBrain || deterministicFallbackBrain;
  const floorResult = computeSafetyFloor(input, fallbackBrain);

  // If rawResult is already a deterministic fallback, attach metadata and return
  if (!rawResult || rawResult.source === 'deterministic_fallback') {
    const safeFallback = rawResult || floorResult;
    return {
      ...safeFallback,
      rawPrediction: null,
      safetyFloor: {
        effectiveRisk: resolveEffectiveRiskFromInput(input),
        requirements: floorResult.requirements
      },
      reconciled: false
    };
  }

  const rawReqs = (rawResult.requirements && typeof rawResult.requirements === 'object')
    ? rawResult.requirements
    : {};

  const floorReqs = floorResult.requirements || {};
  const reconciledRequirements = {};
  let anyFieldRaised = false;

  const roles = Array.from(new Set([...Object.keys(floorReqs), ...Object.keys(rawReqs)]));

  for (const role of roles) {
    const rawRoleReq = rawReqs[role];
    const floorRoleReq = floorReqs[role] || {
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: 'Conservative safety floor fallback'
    };

    if (!rawRoleReq) {
      // If Brain completely omitted a role, adopt floor requirement
      reconciledRequirements[role] = { ...floorRoleReq };
      anyFieldRaised = true;
      continue;
    }

    // Compare capability
    const rawCapRank = CAPABILITY_RANK[rawRoleReq.capability] || 1;
    const floorCapRank = CAPABILITY_RANK[floorRoleReq.capability] || 1;
    const finalCapability = (rawCapRank >= floorCapRank)
      ? rawRoleReq.capability
      : floorRoleReq.capability;

    // Compare reasoning
    const rawRsnRank = REASONING_RANK[rawRoleReq.reasoning] !== undefined
      ? REASONING_RANK[rawRoleReq.reasoning]
      : 0;
    const floorRsnRank = REASONING_RANK[floorRoleReq.reasoning] !== undefined
      ? REASONING_RANK[floorRoleReq.reasoning]
      : 0;
    const finalReasoning = (rawRsnRank >= floorRsnRank)
      ? rawRoleReq.reasoning
      : floorRoleReq.reasoning;

    // Compare risk
    const rawRiskRank = RISK_RANK[rawRoleReq.risk] || 1;
    const floorRiskRank = RISK_RANK[floorRoleReq.risk] || 1;
    const finalRisk = (rawRiskRank >= floorRiskRank)
      ? rawRoleReq.risk
      : floorRoleReq.risk;

    const wasRaised = (
      rawCapRank < floorCapRank ||
      rawRsnRank < floorRsnRank ||
      rawRiskRank < floorRiskRank
    );

    if (wasRaised) {
      anyFieldRaised = true;
    }

    let rationale = rawRoleReq.rationale;
    if (wasRaised) {
      const origSummary = `${rawRoleReq.capability}/${rawRoleReq.reasoning}/${rawRoleReq.risk}`;
      const floorSummary = `${floorRoleReq.capability}/${floorRoleReq.reasoning}/${floorRoleReq.risk}`;
      rationale = `Reconciled: raised to deterministic safety floor (${floorSummary}) - was (${origSummary})`;
    }

    reconciledRequirements[role] = {
      capability: finalCapability,
      reasoning: finalReasoning,
      risk: finalRisk,
      confidence: rawRoleReq.confidence !== undefined ? rawRoleReq.confidence : null,
      rationale
    };
  }

  const effectiveFloorRisk = resolveEffectiveRiskFromInput(input);

  const finalResult = {
    taskId: rawResult.taskId || floorResult.taskId,
    source: rawResult.source, // 'local_brain'
    confidence: rawResult.confidence !== undefined ? rawResult.confidence : 0.85,
    requirements: reconciledRequirements,
    durationMs: rawResult.durationMs,
    // Separately observable fields for benchmarking and auditing
    rawPrediction: { ...rawReqs },
    safetyFloor: {
      effectiveRisk: effectiveFloorRisk,
      requirements: floorResult.requirements
    },
    reconciled: anyFieldRaised
  };

  const validation = validatePlanRequirementsResult(finalResult);
  if (!validation.valid) {
    throw new Error(`Reconciliation produced invalid PlanRequirementsResult: ${validation.error}`);
  }

  return finalResult;
}

/**
 * Helper to compute effective risk from raw input object.
 * @param {object} input
 * @returns {'low'|'medium'|'high'}
 */
function resolveEffectiveRiskFromInput(input) {
  const safeInput = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const meta = (safeInput.planMetadata && typeof safeInput.planMetadata === 'object' && !Array.isArray(safeInput.planMetadata))
    ? safeInput.planMetadata
    : {};

  const rawChangeType = meta.changeType !== undefined ? meta.changeType : safeInput.changeType;
  let changeType = null;
  if (typeof rawChangeType === 'number' && rawChangeType >= 1 && rawChangeType <= 5) {
    changeType = rawChangeType;
  }

  const rawTier = meta.riskTier !== undefined ? meta.riskTier : safeInput.riskTier;
  let riskTier = null;
  if (typeof rawTier === 'string') {
    const s = rawTier.toLowerCase().trim();
    if (s === 'low' || s === 'medium' || s === 'high') {
      riskTier = s;
    }
  }

  const flags = {
    securitySensitive: meta.securitySensitive !== undefined ? meta.securitySensitive : safeInput.securitySensitive,
    isSecuritySensitive: meta.isSecuritySensitive !== undefined ? meta.isSecuritySensitive : safeInput.isSecuritySensitive,
    affectsCriticalPath: meta.affectsCriticalPath !== undefined ? meta.affectsCriticalPath : safeInput.affectsCriticalPath,
    affectedLayers: Array.isArray(meta.affectedLayers) ? meta.affectedLayers : (Array.isArray(safeInput.affectedLayers) ? safeInput.affectedLayers : null)
  };

  return resolveEffectiveRisk(changeType, riskTier, flags);
}

module.exports = {
  CAPABILITY_RANK,
  REASONING_RANK,
  RISK_RANK,
  computeSafetyFloor,
  reconcileWithSafetyFloor,
  resolveEffectiveRiskFromInput
};
