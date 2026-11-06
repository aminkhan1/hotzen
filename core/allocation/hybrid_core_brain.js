/**
 * 🌐 Universal Agent Core Hub - Deterministic Hybrid CoreBrain Pipeline
 * Phase 5.9 Implementation: TASK-5.9.5 (Deterministic Hybrid CoreBrain Integration)
 *
 * Architecture Flow:
 * Structured Planner Metadata
 *        ↓
 * validatePlanMetadataLifecycle()   (plan_metadata.js)
 *        ↓
 * evaluateFastPath()                (fast_path_policy.js)
 *        ↓
 * reconcileDeterministicPlan()      (reconciliation_engine.js + role_policy.js)
 *        ↓
 * SafetyFloor                       (safety_floor.js - authoritative lower bound)
 *        ↓
 * PlanRequirementsResult            (contracts.js - immutable, contract-compliant)
 *
 * Responsibilities:
 * - Single stable entry point connecting the frozen deterministic components.
 * - Pure orchestration/glue; does NOT duplicate metadata normalization, routing, or SafetyFloor logic.
 * - Produces abstract per-agent requirements with machine-readable EvidenceState and DecisionTrace.
 * - Exposes both synchronous (analyzePlanSync) and asynchronous (analyzePlan) CoreBrain interfaces.
 *
 * Invariants:
 * - Zero NLP, zero lexical guessing, zero keyword regex.
 * - Zero concrete model selection (ModelAllocator remains sole authority).
 * - SafetyFloor supremacy is absolute and cannot be bypassed.
 * - Missing, unknown, or malformed metadata never accidentally becomes cheap.
 */

'use strict';

const {
  CoreBrain,
  validatePlanRequirementsResult
} = require('./contracts');

const {
  validatePlanMetadataLifecycle
} = require('./plan_metadata');

const {
  evaluateFastPath
} = require('./fast_path_policy');

const {
  reconcileDeterministicPlan
} = require('./reconciliation_engine');

/**
 * HybridCoreBrain orchestrates deterministic hybrid allocation analysis.
 * Implements the CoreBrain contract interface.
 */
class HybridCoreBrain extends CoreBrain {
  /**
   * Initializes HybridCoreBrain with optional policy overrides.
   *
   * @param {object} [options]
   * @param {object} [options.rolePolicy] - Optional custom role policy configuration
   * @param {object} [options.fallbackBrain] - Optional fallback brain instance
   */
  constructor(options = {}) {
    super();
    this.rolePolicy = options.rolePolicy || null;
    this.fallbackBrain = options.fallbackBrain || null;
  }

  /**
   * Asynchronously analyzes execution plan metadata and produces abstract agent requirements.
   *
   * @param {object} input - Plan payload containing metadata or raw fields
   * @param {object} [options] - Optional execution options (e.g. candidateRequirements, rolePolicy)
   * @returns {Promise<object>} PlanRequirementsResult
   */
  async analyzePlan(input, options = {}) {
    return this.analyzePlanSync(input, options);
  }

  /**
   * Synchronously analyzes execution plan metadata through the complete deterministic pipeline.
   *
   * @param {object} input - Plan payload containing metadata or raw fields
   * @param {object} [options] - Optional execution options
   * @param {object} [options.candidateRequirements] - Optional candidate requirements to reconcile
   * @param {object} [options.rolePolicy] - Optional custom role policy override
   * @param {object} [options.fallbackBrain] - Optional fallback brain override
   * @returns {object} Immutable PlanRequirementsResult
   */
  analyzePlanSync(input, options = {}) {
    const mergedOptions = {
      rolePolicy: options.rolePolicy || this.rolePolicy,
      fallbackBrain: options.fallbackBrain || this.fallbackBrain,
      ...options
    };

    // Step 1: Prepare and normalize metadata evidence lifecycle
    const lifecycle = validatePlanMetadataLifecycle(input);

    // Step 2: Evaluate pure deterministic Fast Path routing policy
    const fastPathDecision = evaluateFastPath(lifecycle);

    // Step 3: Role policy derivation, monotonic reconciliation, and SafetyFloor enforcement
    const result = reconcileDeterministicPlan(fastPathDecision, input, mergedOptions);

    // Step 4: Validate output contract
    const validation = validatePlanRequirementsResult(result);
    if (!validation.valid) {
      throw new Error(`HybridCoreBrain produced invalid PlanRequirementsResult: ${validation.error}`);
    }

    return result;
  }
}

// Default singleton instance
const hybridCoreBrain = new HybridCoreBrain();

/**
 * Convenience entry point for synchronous deterministic hybrid plan analysis.
 *
 * @param {object} input - Plan payload containing metadata or raw fields
 * @param {object} [options] - Optional execution options
 * @returns {object} Immutable PlanRequirementsResult
 */
function analyzePlan(input, options = {}) {
  return hybridCoreBrain.analyzePlanSync(input, options);
}

module.exports = {
  HybridCoreBrain,
  hybridCoreBrain,
  analyzePlan
};
