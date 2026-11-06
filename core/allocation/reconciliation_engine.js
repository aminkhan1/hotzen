/**
 * 🌐 Universal Agent Core Hub - Deterministic Reconciliation Engine
 * Phase 5.9 Implementation: TASK-5.9.4 (Role Policy & Deterministic Reconciliation)
 *
 * Responsibilities:
 * - Monotonically reconciles candidate requirements against deterministic policy evidence and SafetyFloor.
 * - Enforces the invariant: Reconciliation may PRESERVE or ESCALATE, but NEVER DOWNGRADE.
 * - Reuses existing ranking definitions (CAPABILITY_RANK, REASONING_RANK, RISK_RANK) from safety_floor.js.
 * - Preserves SafetyFloor as the authoritative final lower bound.
 * - Produces contract-compliant PlanRequirementsResult with EvidenceState and DecisionTrace.
 *
 * Invariants:
 * - Zero NLP, zero lexical regex/keyword scanning.
 * - No model or provider selection (ModelAllocator remains sole authority).
 * - SafetyFloor cannot be bypassed.
 * - Unknown or incomplete metadata never accidentally becomes cheap.
 */

'use strict';

const {
  validateAgentRequirement,
  validatePlanRequirementsResult,
  validateEvidenceState,
  validateDecisionTrace
} = require('./contracts');

const {
  CAPABILITY_RANK,
  REASONING_RANK,
  RISK_RANK,
  reconcileWithSafetyFloor
} = require('./safety_floor');

const {
  deriveRoleRequirements
} = require('./role_policy');

/**
 * Monotonically escalates two individual AgentRequirement records.
 * Chooses the higher rank for capability, reasoning, and risk.
 * Never downgrades below either requirement.
 *
 * @param {object} reqA - Base or policy requirement
 * @param {object} reqB - Candidate requirement
 */
function escalateRequirement(reqA, reqB) {
  if (!reqA && !reqB) {
    throw new TypeError('escalateRequirement requires at least one valid requirement object');
  }
  if (!reqA) {
    const valB = validateAgentRequirement(reqB);
    if (!valB.valid) throw new Error(`Invalid requirement: ${valB.error}`);
    return { ...reqB };
  }
  if (!reqB) {
    const valA = validateAgentRequirement(reqA);
    if (!valA.valid) throw new Error(`Invalid requirement: ${valA.error}`);
    return { ...reqA };
  }

  const valA = validateAgentRequirement(reqA);
  if (!valA.valid) {
    throw new Error(`Invalid requirement A: ${valA.error}`);
  }
  const valB = validateAgentRequirement(reqB);
  if (!valB.valid) {
    throw new Error(`Invalid requirement B: ${valB.error}`);
  }

  const capA = CAPABILITY_RANK[reqA.capability] || 1;
  const capB = CAPABILITY_RANK[reqB.capability] || 1;
  const finalCap = capB >= capA ? reqB.capability : reqA.capability;

  const rsnA = REASONING_RANK[reqA.reasoning] !== undefined ? REASONING_RANK[reqA.reasoning] : 0;
  const rsnB = REASONING_RANK[reqB.reasoning] !== undefined ? REASONING_RANK[reqB.reasoning] : 0;
  const finalRsn = rsnB >= rsnA ? reqB.reasoning : reqA.reasoning;

  const riskA = RISK_RANK[reqA.risk] || 1;
  const riskB = RISK_RANK[reqB.risk] || 1;
  const finalRisk = riskB >= riskA ? reqB.risk : reqA.risk;

  const wasEscalated = (capB > capA || rsnB > rsnA || riskB > riskA);

  let rationale = reqB.rationale || reqA.rationale || 'Preserved requirement';
  if (wasEscalated) {
    const baseSummary = `${reqA.capability}/${reqA.reasoning}/${reqA.risk}`;
    const candSummary = `${reqB.capability}/${reqB.reasoning}/${reqB.risk}`;
    rationale = `Monotonic escalation: raised to (${candSummary}) from base (${baseSummary})`;
  }

  return {
    capability: finalCap,
    reasoning: finalRsn,
    risk: finalRisk,
    confidence: null,
    rationale
  };
}

/**
 * Monotonically reconciles two sets of role requirements (e.g. policy vs candidate).
 *
 * @param {Object.<string, object>} baseReqs - Policy-derived role requirements
 * @param {Object.<string, object>} candidateReqs - External or proposed role requirements
 * @returns {Object.<string, object>} Reconciled role requirements map
 */
function monotonicallyReconcileRequirements(baseReqs = {}, candidateReqs = {}) {
  const roles = Array.from(new Set([
    ...Object.keys(baseReqs || {}),
    ...Object.keys(candidateReqs || {})
  ]));

  const reconciled = {};
  for (const role of roles) {
    const b = baseReqs ? baseReqs[role] : null;
    const c = candidateReqs ? candidateReqs[role] : null;
    const merged = escalateRequirement(b, c);

    const validation = validateAgentRequirement(merged);
    if (!validation.valid) {
      throw new Error(`Monotonic reconciliation produced invalid requirement for '${role}': ${validation.error}`);
    }

    reconciled[role] = Object.freeze(merged);
  }

  return Object.freeze(reconciled);
}

/**
 * Reconciles deterministic fast-path policy and candidate requirements against SafetyFloor.
 *
 * Pipeline:
 * FastPathDecision
 *       ↓
 * Role Policy Requirements (fast_path_a, fast_path_b, or middle-path baseline)
 *       ↓
 * Monotonic Reconciliation (with optional options.candidateRequirements)
 *       ↓
 * SafetyFloor (authoritative lower bound via reconcileWithSafetyFloor)
 *       ↓
 * Final PlanRequirementsResult (immutable, with EvidenceState & DecisionTrace)
 *
 * @param {object} fastPathDecision - Decision from evaluateFastPath()
 * @param {object} rawPlanInput - Raw plan object
 * @param {object} [options]
 * @param {Object.<string, object>} [options.candidateRequirements] - Optional candidate requirements to merge
 * @param {object} [options.rolePolicy] - Optional custom role policy
 * @param {DeterministicFallbackBrain} [options.fallbackBrain] - Optional fallback brain instance
 * @returns {object} Immutable PlanRequirementsResult
 */
function reconcileDeterministicPlan(fastPathDecision, rawPlanInput, options = {}) {
  if (!fastPathDecision || typeof fastPathDecision !== 'object' || typeof fastPathDecision.eligible !== 'boolean') {
    throw new TypeError('reconcileDeterministicPlan requires a valid FastPathDecision object');
  }

  // 1. Derive role requirements from fast path decision
  const policyReqs = deriveRoleRequirements(fastPathDecision, rawPlanInput, options);

  // 2. Monotonically reconcile with optional candidate requirements
  let candidateReqs = policyReqs;
  let wasCandidateEscalated = false;
  if (options.candidateRequirements && typeof options.candidateRequirements === 'object') {
    candidateReqs = monotonicallyReconcileRequirements(policyReqs, options.candidateRequirements);
    wasCandidateEscalated = Object.keys(options.candidateRequirements).some(role => {
      const rawCand = options.candidateRequirements[role];
      const merged = candidateReqs[role];
      if (!rawCand || !merged) return false;
      return (
        (CAPABILITY_RANK[merged.capability] || 1) !== (CAPABILITY_RANK[rawCand.capability] || 1) ||
        (REASONING_RANK[merged.reasoning] || 0) !== (REASONING_RANK[rawCand.reasoning] || 0) ||
        (RISK_RANK[merged.risk] || 1) !== (RISK_RANK[rawCand.risk] || 1)
      );
    });
  }

  // 3. Prepare candidate result for SafetyFloor
  const taskId = (rawPlanInput && typeof rawPlanInput.taskId === 'string' && rawPlanInput.taskId.trim())
    ? rawPlanInput.taskId.trim()
    : 'task-deterministic';

  const candidateResult = {
    taskId,
    source: 'hybrid_core_brain',
    confidence: null,
    requirements: { ...candidateReqs }
  };

  // Ensure plan input carries assignedRoles so SafetyFloor evaluates all active candidate roles
  const safePlanInput = (rawPlanInput && typeof rawPlanInput === 'object') ? rawPlanInput : {};
  const enrichedPlanInput = {
    ...safePlanInput,
    assignedRoles: Object.keys(candidateReqs)
  };

  // 4. Apply authoritative SafetyFloor lower bound
  const safetyFloorResult = reconcileWithSafetyFloor(candidateResult, enrichedPlanInput, options);

  // 5. Determine contract-compliant EvidenceState
  let evidenceState = null;
  if (fastPathDecision.evidenceState) {
    evidenceState = Object.freeze({
      confidenceTier: fastPathDecision.evidenceState.confidenceTier,
      confidenceReason: fastPathDecision.evidenceState.confidenceReason
    });
  } else {
    // Middle path: determine structured evidence state
    const lifecycle = fastPathDecision.lifecycle;
    if (!lifecycle || !lifecycle.present) {
      evidenceState = Object.freeze({
        confidenceTier: 'low',
        confidenceReason: 'deterministic_fallback_no_metadata'
      });
    } else if (!lifecycle.structurallyValid || !lifecycle.internallyConsistent) {
      evidenceState = Object.freeze({
        confidenceTier: 'low',
        confidenceReason: 'conflicting_evidence_conservative_fallback'
      });
    } else {
      evidenceState = Object.freeze({
        confidenceTier: 'medium',
        confidenceReason: 'incomplete_metadata_escalation'
      });
    }
  }

  const evidenceValidation = validateEvidenceState(evidenceState);
  if (!evidenceValidation.valid) {
    throw new Error(`Generated invalid EvidenceState: ${evidenceValidation.error}`);
  }

  // 6. Determine contract-compliant DecisionTrace
  let decisionPath = 'deterministic_fallback';
  if (fastPathDecision.path === 'fast_path_a') {
    decisionPath = 'fast_path_a';
  } else if (fastPathDecision.path === 'fast_path_b') {
    decisionPath = 'fast_path_b';
  } else if (safetyFloorResult.reconciled || wasCandidateEscalated) {
    decisionPath = 'reconciled';
  }

  const decisionTrace = Object.freeze({
    path: decisionPath,
    metadataValidity: Object.freeze({
      stageReached: (fastPathDecision.lifecycle && fastPathDecision.lifecycle.stageReached) || 'none',
      sufficientForFastPath: Boolean(fastPathDecision.lifecycle && fastPathDecision.lifecycle.sufficientForFastPath)
    }),
    reconciliation: Object.freeze({
      wasEscalated: Boolean(safetyFloorResult.reconciled || wasCandidateEscalated),
      policyReason: fastPathDecision.reason,
      rolesReconciled: Object.freeze(Object.keys(safetyFloorResult.requirements))
    }),
    safetyFloor: Object.freeze({
      effectiveRisk: safetyFloorResult.safetyFloor.effectiveRisk,
      reconciled: Boolean(safetyFloorResult.reconciled)
    })
  });

  const traceValidation = validateDecisionTrace(decisionTrace);
  if (!traceValidation.valid) {
    throw new Error(`Generated invalid DecisionTrace: ${traceValidation.error}`);
  }

  // 7. Assemble final immutable PlanRequirementsResult
  const finalResult = Object.freeze({
    taskId,
    source: 'hybrid_core_brain',
    confidence: null,
    requirements: Object.freeze(safetyFloorResult.requirements),
    rawPrediction: Object.freeze(safetyFloorResult.rawPrediction),
    safetyFloor: Object.freeze(safetyFloorResult.safetyFloor),
    reconciled: Boolean(safetyFloorResult.reconciled || wasCandidateEscalated),
    evidenceState,
    decisionTrace
  });

  const validation = validatePlanRequirementsResult(finalResult);
  if (!validation.valid) {
    throw new Error(`Reconciliation produced invalid PlanRequirementsResult: ${validation.error}`);
  }

  return finalResult;
}

module.exports = {
  escalateRequirement,
  monotonicallyReconcileRequirements,
  reconcileDeterministicPlan
};
