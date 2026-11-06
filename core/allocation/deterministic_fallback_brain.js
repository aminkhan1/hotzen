/**
 * 🌐 Universal Agent Core Hub - Deterministic Fallback Brain
 * Phase 2 Implementation: Rule-based fallback requirement generator.
 *
 * Adheres to:
 * - .agents/rules/execution_policy_engine.md (Change Types 1 to 5)
 * - .agents/rules/change_impact_analyzer.md (Risk Tiers 1 to 3)
 * - .agents/rules/adaptive_model_allocation.md (Core normalized requirements)
 */

'use strict';

const { validatePlanRequirementsResult } = require('./contracts');

const DEFAULT_ROLES = Object.freeze(['coder', 'tester', 'critic']);

/**
 * Normalizes input risk tier string to a canonical level ('low', 'medium', 'high') or null if unknown/missing.
 * @param {string|number|unknown} rawTier
 * @returns {'low'|'medium'|'high'|null}
 */
function normalizeRiskTier(rawTier) {
  if (typeof rawTier !== 'string' && typeof rawTier !== 'number') {
    return null;
  }
  const s = String(rawTier).toLowerCase().trim();
  if (s === '1' || s === 'tier 1' || s === 'tier1' || s === 'low' || s === 'green') {
    return 'low';
  }
  if (s === '3' || s === 'tier 3' || s === 'tier3' || s === 'high' || s === 'critical' || s === 'red' || s === 'orange') {
    return 'high';
  }
  if (s === '2' || s === 'tier 2' || s === 'tier2' || s === 'medium' || s === 'yellow') {
    return 'medium';
  }
  return null;
}

/**
 * Normalizes change type to an integer (1 to 5) or null if invalid/missing.
 * @param {unknown} rawType
 * @returns {number|null}
 */
function normalizeChangeType(rawType) {
  if (typeof rawType === 'number' && Number.isInteger(rawType) && rawType >= 1 && rawType <= 5) {
    return rawType;
  }
  if (typeof rawType === 'string') {
    const parsed = parseInt(rawType.replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 5) {
      return parsed;
    }
  }
  return null;
}

/**
 * Determines the effective risk tier by combining changeType, riskTier, and structured security flags.
 *
 * Safety Invariants (Phase 5.2):
 * 1. High-risk indicators (changeType >= 4, riskTier === 'high', securitySensitive === true,
 *    affectsCriticalPath === true, or critical layers touched) ALWAYS resolve to 'high'.
 * 2. Unclassified or missing metadata (both changeType === null and riskTier === null without safe evidence)
 *    FAILS CONSERVATIVELY to 'high' to guarantee that LocalBrain failure can never silently downgrade
 *    a potentially security/payment/core-sensitive task to medium.
 * 3. Resolves to 'low' or 'medium' ONLY when verified, safe lower-risk structured metadata is present.
 *
 * @param {number|null} changeType
 * @param {'low'|'medium'|'high'|null} riskTier
 * @param {object} [flags]
 * @param {boolean} [flags.securitySensitive]
 * @param {boolean} [flags.isSecuritySensitive]
 * @param {boolean} [flags.affectsCriticalPath]
 * @param {string[]} [flags.affectedLayers]
 * @returns {'low'|'medium'|'high'}
 */
function resolveEffectiveRisk(changeType, riskTier, flags = {}) {
  const isSecurity = flags.securitySensitive === true || flags.isSecuritySensitive === true;
  const isCriticalPath = flags.affectsCriticalPath === true;

  let touchesCriticalLayer = false;
  if (Array.isArray(flags.affectedLayers)) {
    const criticalLayers = ['domain', 'core', 'security', 'auth', 'payment', 'billing', 'financial', 'ledger', 'database'];
    touchesCriticalLayer = flags.affectedLayers.some(layer =>
      typeof layer === 'string' && criticalLayers.includes(layer.toLowerCase().trim())
    );
  }

  // 1. Explicit high-risk indicators
  if (isSecurity || isCriticalPath || touchesCriticalLayer) {
    return 'high';
  }
  if (changeType !== null && changeType >= 4) {
    return 'high';
  }
  if (riskTier === 'high') {
    return 'high';
  }

  // 2. Conservative Fail-Safe: Missing or unclassified risk metadata fails to 'high'
  if (changeType === null && riskTier === null) {
    return 'high';
  }

  // 3. Explicit low-risk verification (Change Type 1 and Tier 1 / low)
  if (changeType === 1 && (riskTier === 'low' || riskTier === null)) {
    return 'low';
  }
  if (riskTier === 'low' && (changeType === null || changeType === 1)) {
    return 'low';
  }

  // 4. Explicit medium-risk verification (Change Type 2 or 3, or Tier 2 / medium)
  if (changeType === 2 || changeType === 3 || riskTier === 'medium') {
    return 'medium';
  }

  // Default conservative fallback
  return 'high';
}

/**
 * Resolves qualitative requirements for a specific role based on effective risk.
 * @param {string} role
 * @param {'low'|'medium'|'high'} effectiveRisk
 * @param {boolean} [isMissingMetadata=false]
 * @returns {{ capability: 'lightweight'|'balanced'|'strong', reasoning: 'none'|'low'|'medium'|'high', risk: 'low'|'medium'|'high', confidence: null, rationale: string }}
 */
function resolveRoleRequirement(role, effectiveRisk, isMissingMetadata = false) {
  const normRole = String(role).toLowerCase().trim();

  // Low Risk (Change Type 1 / Tier 1): Trivial edits, styling, typos
  if (effectiveRisk === 'low') {
    if (normRole.includes('critic')) {
      return {
        capability: 'lightweight',
        reasoning: 'low',
        risk: 'low',
        confidence: null,
        rationale: 'Deterministic fallback: Low-risk private/trivial edit requires lightweight syntax and regression check'
      };
    }
    return {
      capability: 'lightweight',
      reasoning: 'none',
      risk: 'low',
      confidence: null,
      rationale: 'Deterministic fallback: Low-risk private/trivial edit mapped to lightweight execution'
    };
  }

  // High Risk (Change Type 4, 5 / Tier 3 / Unclassified / Security): Domain contracts, architecture, security
  if (effectiveRisk === 'high') {
    return {
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: isMissingMetadata
        ? 'Deterministic fallback: Unclassified or missing risk metadata fails conservatively to high risk (strong capability / high reasoning)'
        : 'Deterministic fallback: High-risk architectural change requires strong capability and high reasoning'
    };
  }

  // Medium Risk (Change Type 2, 3 / Tier 2): State, component updates, persistence
  if (normRole.includes('critic')) {
    return {
      capability: 'balanced',
      reasoning: 'low',
      risk: 'medium',
      confidence: null,
      rationale: 'Deterministic fallback: Medium-risk change requires balanced critic audit for KISS simplicity'
    };
  }

  return {
    capability: 'balanced',
    reasoning: 'medium',
    risk: 'medium',
    confidence: null,
    rationale: 'Deterministic fallback: Medium-risk feature logic requires balanced reasoning and verification'
  };
}

/**
 * DeterministicFallbackBrain Class / Object
 * Provides synchronous or asynchronous plan analysis strictly from structured metadata.
 * Does not parse natural language plan text.
 */
class DeterministicFallbackBrain {
  /**
   * Analyzes plan metadata and produces abstract agent requirements.
   * @param {object} input
   * @returns {Promise<object>} PlanRequirementsResult
   */
  async analyzePlan(input) {
    return this.analyzePlanSync(input);
  }

  /**
   * Synchronous implementation of analyzePlan for offline, immediate deterministic evaluation.
   * @param {object} input
   * @returns {object} PlanRequirementsResult
   */
  analyzePlanSync(input) {
    // 1. Safe handling of malformed/incomplete top-level input
    const safeInput = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};

    const taskId = (typeof safeInput.taskId === 'string' && safeInput.taskId.trim())
      ? safeInput.taskId.trim()
      : 'task-fallback';

    const meta = (safeInput.planMetadata && typeof safeInput.planMetadata === 'object' && !Array.isArray(safeInput.planMetadata))
      ? safeInput.planMetadata
      : {};

    // 2. Extract and normalize changeType, riskTier, and structured security flags
    const changeType = normalizeChangeType(meta.changeType !== undefined ? meta.changeType : safeInput.changeType);
    const rawTier = meta.riskTier !== undefined ? meta.riskTier : safeInput.riskTier;
    const normalizedTier = normalizeRiskTier(rawTier);

    const flags = {
      securitySensitive: meta.securitySensitive !== undefined ? meta.securitySensitive : safeInput.securitySensitive,
      isSecuritySensitive: meta.isSecuritySensitive !== undefined ? meta.isSecuritySensitive : safeInput.isSecuritySensitive,
      affectsCriticalPath: meta.affectsCriticalPath !== undefined ? meta.affectsCriticalPath : safeInput.affectsCriticalPath,
      affectedLayers: Array.isArray(meta.affectedLayers) ? meta.affectedLayers : (Array.isArray(safeInput.affectedLayers) ? safeInput.affectedLayers : null)
    };

    const isMissingMetadata = (
      changeType === null &&
      normalizedTier === null &&
      !flags.securitySensitive &&
      !flags.isSecuritySensitive &&
      !flags.affectsCriticalPath &&
      !flags.affectedLayers
    );

    const effectiveRisk = resolveEffectiveRisk(changeType, normalizedTier, flags);

    // 3. Extract assigned roles (or default to standard MVT team)
    let roles = [];
    if (Array.isArray(meta.assignedRoles) && meta.assignedRoles.length > 0) {
      roles = meta.assignedRoles;
    } else if (Array.isArray(safeInput.assignedRoles) && safeInput.assignedRoles.length > 0) {
      roles = safeInput.assignedRoles;
    } else {
      roles = DEFAULT_ROLES.slice();
    }

    // Clean and deduplicate role names
    const sanitizedRoles = Array.from(new Set(
      roles
        .filter(r => typeof r === 'string' && r.trim().length > 0)
        .map(r => r.trim())
    ));

    const finalRoles = sanitizedRoles.length > 0 ? sanitizedRoles : DEFAULT_ROLES.slice();

    // 4. Resolve requirements for each role
    const requirements = {};
    for (const role of finalRoles) {
      requirements[role] = resolveRoleRequirement(role, effectiveRisk, isMissingMetadata);
    }

    // 5. Construct final contract compliant with Phase 1 specification
    const result = {
      taskId,
      source: 'deterministic_fallback',
      confidence: null,
      requirements
    };

    // 6. Strict validation before returning
    const validation = validatePlanRequirementsResult(result);
    if (!validation.valid) {
      throw new Error(`DeterministicFallbackBrain produced invalid result: ${validation.error}`);
    }

    return result;
  }
}

// Export singleton instance as well as class
const fallbackBrainInstance = new DeterministicFallbackBrain();

module.exports = {
  DeterministicFallbackBrain,
  deterministicFallbackBrain: fallbackBrainInstance,
  normalizeRiskTier,
  normalizeChangeType,
  resolveEffectiveRisk,
  resolveRoleRequirement
};
