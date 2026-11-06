/**
 * 🌐 Universal Agent Core Hub - Allocation Contracts & Validators
 * Phase 2 Implementation: CoreBrain Requirements & Validation Specifications
 */

'use strict';

const VALID_CAPABILITIES = Object.freeze(['lightweight', 'balanced', 'strong']);
const VALID_REASONING_LEVELS = Object.freeze(['none', 'low', 'medium', 'high']);
const VALID_RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);
const VALID_SOURCES = Object.freeze(['local_brain', 'deterministic_fallback', 'hybrid_core_brain']);

const VALID_CONFIDENCE_TIERS = Object.freeze(['high', 'medium', 'low']);

const VALID_CONFIDENCE_REASONS = Object.freeze([
  'fast_path_verified_scope',
  'fast_path_high_risk_ceiling',
  'metadata_semantic_agreement',
  'topic_suppressed_by_scope',
  'incomplete_metadata_escalation',
  'conflicting_evidence_conservative_fallback',
  'deterministic_fallback_no_metadata'
]);

const VALID_DECISION_PATHS = Object.freeze([
  'fast_path_a',
  'fast_path_b',
  'fast_path_layer_suppressed',
  'reconciled',
  'deterministic_fallback'
]);

const VALID_LIFECYCLE_STAGES = Object.freeze([
  'none',
  'present',
  'structurally_valid',
  'normalized',
  'internally_consistent',
  'sufficient_for_fast_path'
]);

/**
 * Validates an individual AgentRequirement object against Phase 1 specifications.
 * @param {object} req
 * @returns {{ valid: boolean, error?: string }}
 */
function validateAgentRequirement(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    return { valid: false, error: 'AgentRequirement must be a non-null object' };
  }

  if (!VALID_CAPABILITIES.includes(req.capability)) {
    return { valid: false, error: `Invalid capability '${req.capability}'. Expected one of: ${VALID_CAPABILITIES.join(', ')}` };
  }

  if (!VALID_REASONING_LEVELS.includes(req.reasoning)) {
    return { valid: false, error: `Invalid reasoning '${req.reasoning}'. Expected one of: ${VALID_REASONING_LEVELS.join(', ')}` };
  }

  if (!VALID_RISK_LEVELS.includes(req.risk)) {
    return { valid: false, error: `Invalid risk '${req.risk}'. Expected one of: ${VALID_RISK_LEVELS.join(', ')}` };
  }

  if (req.confidence !== null && req.confidence !== undefined) {
    if (typeof req.confidence !== 'number' || req.confidence < 0 || req.confidence > 1 || Number.isNaN(req.confidence)) {
      return { valid: false, error: `Confidence must be null, undefined, or a number between 0.0 and 1.0, got: ${req.confidence}` };
    }
  }

  if (req.rationale !== undefined && typeof req.rationale !== 'string') {
    return { valid: false, error: 'Rationale, if provided, must be a string' };
  }

  return { valid: true };
}

/**
 * Validates an EvidenceState object against Phase 5.8 specifications.
 * Invariants:
 * - NO fake numeric confidence
 * - NO probability semantics
 * - Structured machine-readable confidenceTier and confidenceReason
 *
 * @param {object} state
 * @returns {{ valid: boolean, error?: string }}
 */
function validateEvidenceState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, error: 'EvidenceState must be a non-null object' };
  }

  if (!VALID_CONFIDENCE_TIERS.includes(state.confidenceTier)) {
    return {
      valid: false,
      error: `Invalid confidenceTier '${state.confidenceTier}'. Expected one of: ${VALID_CONFIDENCE_TIERS.join(', ')}`
    };
  }

  if (!VALID_CONFIDENCE_REASONS.includes(state.confidenceReason)) {
    return {
      valid: false,
      error: `Invalid confidenceReason '${state.confidenceReason}'. Expected one of: ${VALID_CONFIDENCE_REASONS.join(', ')}`
    };
  }

  if ('confidence' in state && state.confidence !== null) {
    return { valid: false, error: 'EvidenceState must not contain numeric confidence; use confidenceTier instead' };
  }

  if ('probability' in state || 'probabilities' in state) {
    return { valid: false, error: 'EvidenceState must not contain probability fields' };
  }

  return { valid: true };
}

/**
 * Validates a DecisionTrace object against Phase 5.8 specifications.
 * Ensures forward-compatible diagnostic observability structure without implementing routing logic.
 *
 * @param {object} trace
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDecisionTrace(trace) {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
    return { valid: false, error: 'DecisionTrace must be a non-null object' };
  }

  if (trace.path !== undefined && trace.path !== null) {
    if (typeof trace.path !== 'string' || !VALID_DECISION_PATHS.includes(trace.path)) {
      return {
        valid: false,
        error: `Invalid decision path '${trace.path}'. Expected one of: ${VALID_DECISION_PATHS.join(', ')}`
      };
    }
  }

  if (trace.metadataValidity !== undefined && trace.metadataValidity !== null) {
    if (typeof trace.metadataValidity !== 'object' || Array.isArray(trace.metadataValidity)) {
      return { valid: false, error: 'DecisionTrace.metadataValidity must be an object' };
    }
  }

  if (trace.semanticSensor !== undefined && trace.semanticSensor !== null) {
    if (typeof trace.semanticSensor !== 'object' || Array.isArray(trace.semanticSensor)) {
      return { valid: false, error: 'DecisionTrace.semanticSensor must be an object' };
    }
  }

  if (trace.reconciliation !== undefined && trace.reconciliation !== null) {
    if (typeof trace.reconciliation !== 'object' || Array.isArray(trace.reconciliation)) {
      return { valid: false, error: 'DecisionTrace.reconciliation must be an object' };
    }
  }

  if (trace.safetyFloor !== undefined && trace.safetyFloor !== null) {
    if (typeof trace.safetyFloor !== 'object' || Array.isArray(trace.safetyFloor)) {
      return { valid: false, error: 'DecisionTrace.safetyFloor must be an object' };
    }
  }

  return { valid: true };
}

/**
 * Validates an externally exchanged MetadataLifecycleResult object shape.
 * Adheres strictly to boundary isolation: does not duplicate plan_metadata.js normalization or contradiction logic.
 *
 * @param {object} result
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMetadataLifecycleResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, error: 'MetadataLifecycleResult must be a non-null object' };
  }

  if (typeof result.present !== 'boolean') {
    return { valid: false, error: 'MetadataLifecycleResult.present must be a boolean' };
  }

  if (typeof result.structurallyValid !== 'boolean') {
    return { valid: false, error: 'MetadataLifecycleResult.structurallyValid must be a boolean' };
  }

  if (typeof result.normalized !== 'boolean') {
    return { valid: false, error: 'MetadataLifecycleResult.normalized must be a boolean' };
  }

  if (typeof result.internallyConsistent !== 'boolean') {
    return { valid: false, error: 'MetadataLifecycleResult.internallyConsistent must be a boolean' };
  }

  if (typeof result.sufficientForFastPath !== 'boolean') {
    return { valid: false, error: 'MetadataLifecycleResult.sufficientForFastPath must be a boolean' };
  }

  if (!VALID_LIFECYCLE_STAGES.includes(result.stageReached)) {
    return {
      valid: false,
      error: `Invalid stageReached '${result.stageReached}'. Expected one of: ${VALID_LIFECYCLE_STAGES.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Validates a PlanRequirementsResult object against Phase 1 & Phase 5.8 specifications.
 * Preserves 100% backward compatibility with existing callers.
 *
 * @param {object} result
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePlanRequirementsResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, error: 'PlanRequirementsResult must be a non-null object' };
  }

  if (typeof result.taskId !== 'string' || !result.taskId.trim()) {
    return { valid: false, error: 'taskId must be a non-empty string' };
  }

  if (!VALID_SOURCES.includes(result.source)) {
    return { valid: false, error: `Invalid source '${result.source}'. Expected one of: ${VALID_SOURCES.join(', ')}` };
  }

  if (result.confidence !== null && result.confidence !== undefined) {
    if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1 || Number.isNaN(result.confidence)) {
      return { valid: false, error: `Confidence must be null, undefined, or a number between 0.0 and 1.0, got: ${result.confidence}` };
    }
  }

  if (result.evidenceState !== undefined && result.evidenceState !== null) {
    const evidenceCheck = validateEvidenceState(result.evidenceState);
    if (!evidenceCheck.valid) {
      return { valid: false, error: `evidenceState: ${evidenceCheck.error}` };
    }
  }

  if (result.decisionTrace !== undefined && result.decisionTrace !== null) {
    const traceCheck = validateDecisionTrace(result.decisionTrace);
    if (!traceCheck.valid) {
      return { valid: false, error: `decisionTrace: ${traceCheck.error}` };
    }
  }

  if (!result.requirements || typeof result.requirements !== 'object' || Array.isArray(result.requirements)) {
    return { valid: false, error: 'requirements must be a non-null object mapping role names to AgentRequirement' };
  }

  const roles = Object.keys(result.requirements);
  if (roles.length === 0) {
    return { valid: false, error: 'requirements must contain at least one role mapping' };
  }

  for (const role of roles) {
    const check = validateAgentRequirement(result.requirements[role]);
    if (!check.valid) {
      return { valid: false, error: `Role '${role}': ${check.error}` };
    }
  }

  return { valid: true };
}

const VALID_ACCESS_TYPES = Object.freeze(['included', 'credits-required', 'unavailable', 'unknown']);

/**
 * Validates a ModelDescriptor object against Phase 3 specifications.
 * @param {object} model
 * @returns {{ valid: boolean, error?: string }}
 */
function validateModelDescriptor(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return { valid: false, error: 'ModelDescriptor must be a non-null object' };
  }

  if (typeof model.id !== 'string' || !model.id.trim()) {
    return { valid: false, error: 'ModelDescriptor.id must be a non-empty string' };
  }

  if (model.displayName !== undefined && typeof model.displayName !== 'string') {
    return { valid: false, error: 'ModelDescriptor.displayName, if provided, must be a string' };
  }

  if (typeof model.discoverable !== 'boolean') {
    return { valid: false, error: 'ModelDescriptor.discoverable must be a boolean' };
  }

  if (!VALID_ACCESS_TYPES.includes(model.access)) {
    return { valid: false, error: `Invalid access '${model.access}'. Expected one of: ${VALID_ACCESS_TYPES.join(', ')}` };
  }

  if (!Array.isArray(model.supportedEfforts)) {
    return { valid: false, error: 'ModelDescriptor.supportedEfforts must be an array of strings' };
  }

  for (const effort of model.supportedEfforts) {
    if (typeof effort !== 'string' || !effort.trim()) {
      return { valid: false, error: 'ModelDescriptor.supportedEfforts entries must be non-empty strings' };
    }
  }

  if (model.defaultEffort !== undefined && model.defaultEffort !== null && typeof model.defaultEffort !== 'string') {
    return { valid: false, error: 'ModelDescriptor.defaultEffort, if provided, must be a string' };
  }

  return { valid: true };
}

/**
 * Validates a ProviderCatalog object against Phase 3 specifications.
 * @param {object} catalog
 * @returns {{ valid: boolean, error?: string }}
 */
function validateProviderCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { valid: false, error: 'ProviderCatalog must be a non-null object' };
  }

  if (typeof catalog.providerId !== 'string' || !catalog.providerId.trim()) {
    return { valid: false, error: 'ProviderCatalog.providerId must be a non-empty string' };
  }

  if (catalog.current !== undefined && catalog.current !== null && typeof catalog.current !== 'string') {
    return { valid: false, error: 'ProviderCatalog.current, if provided, must be a string or null' };
  }

  if (!Array.isArray(catalog.models)) {
    return { valid: false, error: 'ProviderCatalog.models must be an array' };
  }

  for (let i = 0; i < catalog.models.length; i++) {
    const check = validateModelDescriptor(catalog.models[i]);
    if (!check.valid) {
      return { valid: false, error: `Model index ${i} (${catalog.models[i] && catalog.models[i].id}): ${check.error}` };
    }
  }

  return { valid: true };
}

/**
 * Validates an individual UsageWindow object.
 * @param {object} win
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUsageWindow(win) {
  if (!win || typeof win !== 'object' || Array.isArray(win)) {
    return { valid: false, error: 'UsageWindow must be a non-null object' };
  }

  const name = win.name || win.id;
  if (typeof name !== 'string' || !name.trim()) {
    return { valid: false, error: 'UsageWindow must have a non-empty string name or id' };
  }

  if (win.usedPercent !== null && win.usedPercent !== undefined) {
    if (typeof win.usedPercent !== 'number' || win.usedPercent < 0 || win.usedPercent > 100 || Number.isNaN(win.usedPercent)) {
      return { valid: false, error: `UsageWindow.usedPercent must be null or a number between 0 and 100, got: ${win.usedPercent}` };
    }
  }

  if (win.remainingPercent !== null && win.remainingPercent !== undefined) {
    if (typeof win.remainingPercent !== 'number' || win.remainingPercent < 0 || win.remainingPercent > 100 || Number.isNaN(win.remainingPercent)) {
      return { valid: false, error: `UsageWindow.remainingPercent must be null or a number between 0 and 100, got: ${win.remainingPercent}` };
    }
  }

  if (win.resetAt !== null && win.resetAt !== undefined && typeof win.resetAt !== 'string') {
    return { valid: false, error: 'UsageWindow.resetAt, if provided, must be a string or null' };
  }

  return { valid: true };
}

/**
 * Validates a ProviderUsage object against Phase 3 specifications.
 * @param {object} usage
 * @returns {{ valid: boolean, error?: string }}
 */
function validateProviderUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { valid: false, error: 'ProviderUsage must be a non-null object' };
  }

  if (usage.ordinaryUsageAllowed !== null && usage.ordinaryUsageAllowed !== undefined && typeof usage.ordinaryUsageAllowed !== 'boolean') {
    return { valid: false, error: 'ProviderUsage.ordinaryUsageAllowed must be a boolean, null, or undefined' };
  }

  if (!Array.isArray(usage.windows)) {
    return { valid: false, error: 'ProviderUsage.windows must be an array' };
  }

  for (let i = 0; i < usage.windows.length; i++) {
    const check = validateUsageWindow(usage.windows[i]);
    if (!check.valid) {
      return { valid: false, error: `Window index ${i}: ${check.error}` };
    }
  }

  return { valid: true };
}

const VALID_ALLOCATION_STATUSES = Object.freeze([
  'allocated',
  'passthrough',
  'unavailable',
  'insufficient_capability'
]);

const VALID_PLAN_ALLOCATION_STATUSES = Object.freeze([
  'allocated',
  'passthrough',
  'partial',
  'unavailable',
  'insufficient_capability'
]);

/**
 * Validates a ResolvedExecutionConfig object against Phase 4 specifications.
 * @param {object} config
 * @returns {{ valid: boolean, error?: string }}
 */
function validateResolvedExecutionConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { valid: false, error: 'ResolvedExecutionConfig must be a non-null object' };
  }

  if (!VALID_ALLOCATION_STATUSES.includes(config.status)) {
    return { valid: false, error: `Invalid allocation status '${config.status}'. Expected one of: ${VALID_ALLOCATION_STATUSES.join(', ')}` };
  }

  if (typeof config.providerId !== 'string' || !config.providerId.trim()) {
    return { valid: false, error: 'ResolvedExecutionConfig.providerId must be a non-empty string' };
  }

  if (config.status === 'allocated') {
    if (typeof config.model !== 'string' || !config.model.trim()) {
      return { valid: false, error: "ResolvedExecutionConfig.model must be a non-empty string when status is 'allocated'" };
    }
  } else if (config.model !== undefined && config.model !== null && typeof config.model !== 'string') {
    return { valid: false, error: 'ResolvedExecutionConfig.model must be a string, null, or undefined' };
  }

  if (config.reasoningEffort !== undefined && config.reasoningEffort !== null && typeof config.reasoningEffort !== 'string') {
    return { valid: false, error: 'ResolvedExecutionConfig.reasoningEffort, if provided, must be a string or null' };
  }

  if (config.reason !== undefined && typeof config.reason !== 'string') {
    return { valid: false, error: 'ResolvedExecutionConfig.reason, if provided, must be a string' };
  }

  if (config.fallbackApplied !== undefined && typeof config.fallbackApplied !== 'boolean') {
    return { valid: false, error: 'ResolvedExecutionConfig.fallbackApplied, if provided, must be a boolean' };
  }

  return { valid: true };
}

/**
 * Validates a multi-role PlanAllocationResult object.
 * @param {object} result
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePlanAllocationResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, error: 'PlanAllocationResult must be a non-null object' };
  }

  if (typeof result.taskId !== 'string' || !result.taskId.trim()) {
    return { valid: false, error: 'PlanAllocationResult.taskId must be a non-empty string' };
  }

  if (typeof result.providerId !== 'string' || !result.providerId.trim()) {
    return { valid: false, error: 'PlanAllocationResult.providerId must be a non-empty string' };
  }

  if (!VALID_PLAN_ALLOCATION_STATUSES.includes(result.status)) {
    return { valid: false, error: `Invalid plan allocation status '${result.status}'. Expected one of: ${VALID_PLAN_ALLOCATION_STATUSES.join(', ')}` };
  }

  if (!result.allocations || typeof result.allocations !== 'object' || Array.isArray(result.allocations)) {
    return { valid: false, error: 'PlanAllocationResult.allocations must be a non-null object mapping roles to configs' };
  }

  for (const [role, cfg] of Object.entries(result.allocations)) {
    const check = validateResolvedExecutionConfig(cfg);
    if (!check.valid) {
      return { valid: false, error: `Role '${role}': ${check.error}` };
    }
  }

  return { valid: true };
}

const VALID_PROVENANCE_SOURCES = Object.freeze([
  'benchmark',
  'provider_metadata',
  'manual_override',
  'unknown'
]);

/**
 * Validates a ModelCapabilityProfile object against Phase 4.1 provenance rules.
 * @param {object} profile
 * @returns {{ valid: boolean, error?: string }}
 */
function validateModelCapabilityProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { valid: false, error: 'ModelCapabilityProfile must be a non-null object' };
  }

  if (profile.capabilityTier !== undefined && profile.capabilityTier !== null) {
    if (!VALID_CAPABILITIES.includes(profile.capabilityTier)) {
      return { valid: false, error: `Invalid capabilityTier '${profile.capabilityTier}'. Expected one of: ${VALID_CAPABILITIES.join(', ')}` };
    }
  }

  const source = profile.source || 'unknown';
  if (!VALID_PROVENANCE_SOURCES.includes(source)) {
    return { valid: false, error: `Invalid capability provenance source '${source}'. Expected one of: ${VALID_PROVENANCE_SOURCES.join(', ')}` };
  }

  if (profile.confidence !== undefined && profile.confidence !== null) {
    if (typeof profile.confidence !== 'number' || profile.confidence < 0 || profile.confidence > 1 || Number.isNaN(profile.confidence)) {
      return { valid: false, error: `Confidence must be null, undefined, or a number between 0.0 and 1.0, got: ${profile.confidence}` };
    }
  }

  if (profile.relativeCost !== undefined && profile.relativeCost !== null) {
    if (typeof profile.relativeCost !== 'number' || profile.relativeCost < 0 || Number.isNaN(profile.relativeCost)) {
      return { valid: false, error: `relativeCost, if provided, must be a non-negative number, got: ${profile.relativeCost}` };
    }
  }

  if (profile.costSource !== undefined && profile.costSource !== null) {
    if (!VALID_PROVENANCE_SOURCES.includes(profile.costSource)) {
      return { valid: false, error: `Invalid costSource '${profile.costSource}'. Expected one of: ${VALID_PROVENANCE_SOURCES.join(', ')}` };
    }
  }

  if (profile.supportsReasoning !== undefined && profile.supportsReasoning !== null && typeof profile.supportsReasoning !== 'boolean') {
    return { valid: false, error: 'supportsReasoning, if provided, must be a boolean' };
  }

  return { valid: true };
}

class CoreBrain {
  /**
   * Analyzes an execution plan and returns abstract agent requirements.
   * @param {object} _input
   * @returns {Promise<object>}
   */
  async analyzePlan(_input) {
    throw new Error('CoreBrain.analyzePlan() must be implemented by concrete subclass or provider');
  }
}

module.exports = {
  CoreBrain,
  VALID_CAPABILITIES,
  VALID_REASONING_LEVELS,
  VALID_RISK_LEVELS,
  VALID_SOURCES,
  VALID_CONFIDENCE_TIERS,
  VALID_CONFIDENCE_REASONS,
  VALID_DECISION_PATHS,
  VALID_LIFECYCLE_STAGES,
  VALID_ACCESS_TYPES,
  VALID_ALLOCATION_STATUSES,
  VALID_PLAN_ALLOCATION_STATUSES,
  VALID_PROVENANCE_SOURCES,
  validateAgentRequirement,
  validatePlanRequirementsResult,
  validateEvidenceState,
  validateDecisionTrace,
  validateMetadataLifecycleResult,
  validateModelDescriptor,
  validateProviderCatalog,
  validateUsageWindow,
  validateProviderUsage,
  validateResolvedExecutionConfig,
  validatePlanAllocationResult,
  validateModelCapabilityProfile
};
