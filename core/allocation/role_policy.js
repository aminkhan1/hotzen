/**
 * 🌐 Universal Agent Core Hub - Configurable Role Policy Mapping
 * Phase 5.9 Implementation: TASK-5.9.4 (Role Policy & Deterministic Requirements)
 *
 * Responsibilities:
 * - Maps Fast Path routing decisions to abstract per-agent AgentRequirement records.
 * - Keeps role mappings explicit, auditable, and replaceable as configuration policy.
 * - Does NOT select concrete models, providers, or costs (CoreBrain vs ModelAllocator boundary).
 * - Integrates with DeterministicFallbackBrain for conservative middle-path baseline.
 *
 * Invariants:
 * - Zero NLP, zero lexical guessing.
 * - Concrete role mappings are policy, not frozen architecture.
 * - Fast Path A is lightweight ONLY with verified positive evidence.
 * - Fast Path B strictly respects high SafetyFloor baseline.
 * - Middle path (path: null) fails conservatively to fallback brain (never accidentally cheap).
 */

'use strict';

const {
  validateAgentRequirement
} = require('./contracts');

const {
  deterministicFallbackBrain
} = require('./deterministic_fallback_brain');

/**
 * Provisional configurable role policy mappings.
 * These are policy definitions, not frozen architecture invariants.
 * Can be overridden or extended via options.rolePolicy.
 */
const DEFAULT_ROLE_POLICY = Object.freeze({
  fast_path_a: Object.freeze({
    planner: Object.freeze({
      capability: 'balanced',
      reasoning: 'low',
      risk: 'low',
      confidence: null,
      rationale: 'Fast Path A: Verified low-risk presentation/docs scope requires balanced planning'
    }),
    coder: Object.freeze({
      capability: 'lightweight',
      reasoning: 'none',
      risk: 'low',
      confidence: null,
      rationale: 'Fast Path A: Verified low-risk scope mapped to lightweight execution'
    }),
    tester: Object.freeze({
      capability: 'lightweight',
      reasoning: 'none',
      risk: 'low',
      confidence: null,
      rationale: 'Fast Path A: Verified low-risk scope mapped to lightweight verification'
    }),
    critic: Object.freeze({
      capability: 'lightweight',
      reasoning: 'low',
      risk: 'low',
      confidence: null,
      rationale: 'Fast Path A: Verified low-risk scope requires lightweight regression check'
    })
  }),
  fast_path_b: Object.freeze({
    planner: Object.freeze({
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: 'Fast Path B: Explicit high-risk structural ceiling requires strong planning'
    }),
    coder: Object.freeze({
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: 'Fast Path B: Explicit high-risk structural ceiling requires strong execution'
    }),
    tester: Object.freeze({
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: 'Fast Path B: Explicit high-risk structural ceiling requires comprehensive verification'
    }),
    critic: Object.freeze({
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: 'Fast Path B: Explicit high-risk structural ceiling requires rigorous critique'
    })
  })
});

/**
 * Resolves a single role requirement from a role policy map.
 *
 * @param {'fast_path_a'|'fast_path_b'} path
 * @param {string} role
 * @param {object} [customPolicy]
 * @returns {object} AgentRequirement
 */
function resolvePolicyRoleRequirement(path, role, customPolicy = null) {
  const policy = customPolicy || DEFAULT_ROLE_POLICY;
  const pathMap = policy[path];

  if (pathMap && pathMap[role]) {
    return { ...pathMap[role] };
  }

  // Fallback defaults for unknown custom roles
  if (path === 'fast_path_a') {
    return {
      capability: 'lightweight',
      reasoning: 'none',
      risk: 'low',
      confidence: null,
      rationale: `Fast Path A: Low-risk default for custom role '${role}'`
    };
  }

  return {
    capability: 'strong',
    reasoning: 'high',
    risk: 'high',
    confidence: null,
    rationale: `Fast Path B: High-risk default for custom role '${role}'`
  };
}

/**
 * Derives abstract per-agent requirements from a FastPathDecision and plan input.
 *
 * Behavior:
 * - fast_path_a: maps roles via Fast Path A policy (lightweight / verified low-risk).
 * - fast_path_b: maps roles via Fast Path B policy (strong / high-risk ceiling).
 * - middle path (path: null): delegates to DeterministicFallbackBrain (conservative baseline).
 *
 * @param {object} fastPathDecision - FastPathDecision from evaluateFastPath()
 * @param {object} rawPlanInput - Raw plan object (for middle path fallback & assignedRoles)
 * @param {object} [options]
 * @param {object} [options.rolePolicy] - Optional custom role policy mapping
 * @param {DeterministicFallbackBrain} [options.fallbackBrain] - Optional fallback brain instance
 * @param {string[]} [options.roles] - Optional explicit roles array
 * @returns {Object.<string, object>} Map of role name -> validated AgentRequirement
 */
function deriveRoleRequirements(fastPathDecision, rawPlanInput, options = {}) {
  if (!fastPathDecision || typeof fastPathDecision !== 'object' || typeof fastPathDecision.eligible !== 'boolean') {
    throw new TypeError('deriveRoleRequirements requires a valid FastPathDecision object');
  }

  const rolePolicy = options.rolePolicy || DEFAULT_ROLE_POLICY;
  const fallbackBrain = options.fallbackBrain || deterministicFallbackBrain;

  // Determine active roles
  const lifecycle = fastPathDecision.lifecycle;
  let roles = ['planner', 'coder', 'tester', 'critic'];
  if (Array.isArray(options.roles) && options.roles.length > 0) {
    roles = options.roles;
  } else if (lifecycle && lifecycle.data && Array.isArray(lifecycle.data.assignedRoles) && lifecycle.data.assignedRoles.length > 0) {
    roles = lifecycle.data.assignedRoles;
  } else if (rawPlanInput && Array.isArray(rawPlanInput.assignedRoles) && rawPlanInput.assignedRoles.length > 0) {
    roles = rawPlanInput.assignedRoles;
  }

  const requirements = {};

  // Case 1: Fast Path A (Verified Low-Risk Scope)
  if (fastPathDecision.path === 'fast_path_a') {
    for (const role of roles) {
      const req = resolvePolicyRoleRequirement('fast_path_a', role, rolePolicy);
      const validation = validateAgentRequirement(req);
      if (!validation.valid) {
        throw new Error(`Role policy produced invalid requirement for role '${role}': ${validation.error}`);
      }
      requirements[role] = Object.freeze(req);
    }
    return Object.freeze(requirements);
  }

  // Case 2: Fast Path B (High-Risk Ceiling)
  if (fastPathDecision.path === 'fast_path_b') {
    for (const role of roles) {
      const req = resolvePolicyRoleRequirement('fast_path_b', role, rolePolicy);
      const validation = validateAgentRequirement(req);
      if (!validation.valid) {
        throw new Error(`Role policy produced invalid requirement for role '${role}': ${validation.error}`);
      }
      requirements[role] = Object.freeze(req);
    }
    return Object.freeze(requirements);
  }

  // Case 3: Middle Path (Unresolved / Standard / Incomplete)
  // MUST NOT silently become lightweight. Delegates to DeterministicFallbackBrain for conservative baseline.
  const safeInput = (rawPlanInput && typeof rawPlanInput === 'object') ? rawPlanInput : {};
  const enrichedInput = {
    ...safeInput,
    assignedRoles: roles
  };

  const fallbackResult = fallbackBrain.analyzePlanSync(enrichedInput);
  const fallbackReqs = fallbackResult.requirements || {};

  for (const role of roles) {
    const fallbackRoleReq = fallbackReqs[role] || {
      capability: 'strong',
      reasoning: 'high',
      risk: 'high',
      confidence: null,
      rationale: `Middle path fallback for role '${role}'`
    };

    const validation = validateAgentRequirement(fallbackRoleReq);
    if (!validation.valid) {
      throw new Error(`Fallback brain produced invalid requirement for role '${role}': ${validation.error}`);
    }

    requirements[role] = Object.freeze({
      capability: fallbackRoleReq.capability,
      reasoning: fallbackRoleReq.reasoning,
      risk: fallbackRoleReq.risk,
      confidence: null,
      rationale: `Middle path baseline: ${fallbackRoleReq.rationale || 'conservative fallback'}`
    });
  }

  return Object.freeze(requirements);
}

module.exports = {
  DEFAULT_ROLE_POLICY,
  resolvePolicyRoleRequirement,
  deriveRoleRequirements
};
