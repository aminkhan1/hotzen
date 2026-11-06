/**
 * 🌐 Universal Agent Core Hub - Model Allocator
 * Phase 4 Implementation: Deterministic Capability Matching, Cost Optimization & Reasoning Mapping
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  validateAgentRequirement,
  validateProviderCatalog,
  validateProviderUsage,
  validateResolvedExecutionConfig,
  validatePlanAllocationResult
} = require('./contracts');
const { isModelSwitchingEnabled } = require('./model_switching_toggle');

const TIER_SCORES = Object.freeze({
  lightweight: 1,
  balanced: 2,
  strong: 3
});

const DEFAULT_PROFILES_REL_PATH = path.join(__dirname, '../../.agents/model_profiles.json');

const TRUSTED_PROVENANCE_SOURCES = Object.freeze([
  'benchmark',
  'provider_metadata',
  'manual_override'
]);

/**
 * Checks whether a capability profile is verified and trustworthy.
 * Hypothesized or unverified profiles with source: 'unknown' cannot be used
 * to claim known capability quality and must fall back to passthrough.
 * @param {object} profile
 * @returns {boolean}
 */
function isTrustworthyProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (!profile.capabilityTier) return false;
  const source = profile.source || 'unknown';
  if (!TRUSTED_PROVENANCE_SOURCES.includes(source)) return false;
  if (profile.confidence !== null && profile.confidence !== undefined && profile.confidence < 0.5) {
    return false;
  }
  return true;
}

/**
 * ModelAllocator resolves abstract AgentRequirement specifications into
 * concrete, provider-native ResolvedExecutionConfig objects using explicit
 * capability profiles and provider discovery metadata.
 */
class ModelAllocator {
  /**
   * @param {object} [options]
   * @param {object} [options.profiles] Explicit capability profiles map
   * @param {string} [options.profilesPath] Path to model_profiles.json
   * @param {boolean} [options.allowFallbackToCurrent=true] Whether to fallback to provider's current model
   * @param {boolean} [options.preferCheapestSufficient=true] Whether to pick cheapest sufficient model
   * @param {boolean} [options.modelSwitchingEnabled] Runtime model switching override
   */
  constructor(options = {}) {
    this.allowFallbackToCurrent = options.allowFallbackToCurrent !== false;
    this.preferCheapestSufficient = options.preferCheapestSufficient !== false;
    this.profiles = options.profiles || this._loadProfilesFromDisk(options.profilesPath || DEFAULT_PROFILES_REL_PATH);
    this.historyStore = options.historyStore || null;
    this.modelSwitchingEnabled = options.modelSwitchingEnabled !== undefined ? options.modelSwitchingEnabled : null;
  }

  /**
   * Sets runtime model switching for this allocator instance.
   * @param {boolean} enabled
   */
  setModelSwitchingEnabled(enabled) {
    this.modelSwitchingEnabled = Boolean(enabled);
  }

  /**
   * Safely loads capability profiles from JSON on disk.
   * @param {string} filePath
   * @returns {Record<string, object>}
   * @private
   */
  _loadProfilesFromDisk(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed.profiles || {};
      }
    } catch {
      // Ignore read errors and return empty profile map
    }
    return {};
  }

  /**
   * Resolves an execution config for a single AgentRequirement.
   *
   * @param {object} requirement Abstract AgentRequirement from CoreBrain
   * @param {object} catalog Discovered ProviderCatalog from ProviderAdapter
   * @param {object} [usage] Discovered ProviderUsage
   * @param {object} [options] Override options
   * @returns {object} ResolvedExecutionConfig
   */
  allocate(requirement, catalog, usage, options = {}) {
    const profiles = options.profiles || this.profiles;
    const providerId = (catalog && typeof catalog.providerId === 'string' && catalog.providerId.trim())
      ? catalog.providerId.trim()
      : 'unknown';

    // 1. Guard against invalid inputs -> Safe passthrough
    const reqCheck = validateAgentRequirement(requirement);
    if (!reqCheck.valid) {
      return this._buildConfig('passthrough', providerId, (catalog && catalog.current) || null, null, 'invalid_requirement', true);
    }

    const catCheck = validateProviderCatalog(catalog);
    if (!catCheck.valid) {
      return this._buildConfig('passthrough', providerId, null, null, 'invalid_catalog', true);
    }

    // 2. Authoritative Quota / Usage Check
    // "ordinaryUsageAllowed === false must prevent ordinary allocation when that information is authoritative."
    // "Unknown usage must not mean exhausted usage."
    if (usage && usage.ordinaryUsageAllowed === false) {
      return this._buildConfig('unavailable', providerId, null, null, 'quota_exhausted', false);
    }

    // 3. Filter Eligible Models
    // "Unknown entitlement must not mean unavailable."
    const exhaustedList = [
      ...(Array.isArray(usage?.exhaustedModels) ? usage.exhaustedModels : []),
      ...(Array.isArray(options?.exhaustedModels) ? options.exhaustedModels : [])
    ];
    const unavailableList = Array.isArray(options?.unavailableModels) ? options.unavailableModels : [];

    const models = Array.isArray(catalog.models) ? catalog.models : [];
    const eligibleModels = models.filter(m =>
      m && m.id &&
      m.access !== 'unavailable' &&
      !unavailableList.includes(m.id) &&
      m.quotaExhausted !== true &&
      !exhaustedList.includes(m.id)
    );

    if (eligibleModels.length === 0) {
      if (this.allowFallbackToCurrent && catalog.current && !exhaustedList.includes(catalog.current)) {
        return this._buildConfig('passthrough', providerId, catalog.current, null, 'no_candidate_models_fallback_to_current', true);
      }
      const hadQuotaExhausted = models.some(m => m && (m.quotaExhausted === true || exhaustedList.includes(m.id)));
      const reason = hadQuotaExhausted ? 'quota_exhausted' : 'no_available_models';
      return this._buildConfig('unavailable', providerId, null, null, reason, false);
    }

    // 4. Capability Sufficiency Matching
    const requiredTier = requirement.capability;
    const requiredScore = TIER_SCORES[requiredTier] || 1;

    const sufficientCandidates = [];
    const insufficientCandidates = [];
    const unprofiledCandidates = [];

    for (const model of eligibleModels) {
      const profile = this._findProfile(model, profiles);
      if (!profile || !isTrustworthyProfile(profile)) {
        // Untrusted, speculative or unprofiled capability
        unprofiledCandidates.push({ model, profile: profile || null });
        continue;
      }

      const modelScore = TIER_SCORES[profile.capabilityTier] || 0;
      if (modelScore >= requiredScore) {
        sufficientCandidates.push({ model, profile, score: modelScore });
      } else {
        insufficientCandidates.push({ model, profile, score: modelScore });
      }
    }

    // 5. Outcome Resolution
    if (sufficientCandidates.length > 0) {
      // Sort sufficient models:
      // Only optimize by cost when comparable TRUSTED cost data exists.
      sufficientCandidates.sort((a, b) => {
        const trustedCostA = (typeof a.profile.relativeCost === 'number' && a.profile.costSource && a.profile.costSource !== 'unknown')
          ? a.profile.relativeCost
          : null;
        const trustedCostB = (typeof b.profile.relativeCost === 'number' && b.profile.costSource && b.profile.costSource !== 'unknown')
          ? b.profile.relativeCost
          : null;

        if (trustedCostA !== null && trustedCostB !== null && trustedCostA !== trustedCostB) {
          return trustedCostA - trustedCostB; // Lowest trusted cost first
        }

        // Smallest sufficient tier score first
        if (a.score !== b.score) {
          return a.score - b.score;
        }

        // Entitlement preference: included (0) > unknown (1) > credits-required (2)
        const accessRank = { included: 0, unknown: 1, 'credits-required': 2 };
        const rankA = accessRank[a.model.access] !== undefined ? accessRank[a.model.access] : 1;
        const rankB = accessRank[b.model.access] !== undefined ? accessRank[b.model.access] : 1;
        return rankA - rankB;
      });

      let winner = sufficientCandidates[0];
      let historyEscalated = false;
      const originalCandidateModel = winner.model.id;
      const historyStore = options.historyStore || this.historyStore;

      if (historyStore && typeof historyStore.evaluateModelCandidate === 'function') {
        try {
          const role = options.role || 'coder';
          const taskCategory = options.taskCategory || (options.task && options.task.category) || 'general';
          const env = options.environment || 'production';

          // Evaluate candidate models in order of sufficiency preference
          let selectedCandidate = null;
          for (let i = 0; i < sufficientCandidates.length; i++) {
            const cand = sufficientCandidates[i];
            const evalResult = historyStore.evaluateModelCandidate({
              model: cand.model.id,
              role,
              taskCategory,
              environment: env
            });

            if (!evalResult.shouldEscalate) {
              selectedCandidate = cand;
              if (i > 0) {
                historyEscalated = true;
              }
              break;
            }
          }

          if (selectedCandidate) {
            winner = selectedCandidate;
          } else if (sufficientCandidates.length > 1) {
            // All lower sufficient candidates flagged; conservatively escalate to strongest available sufficient candidate
            winner = sufficientCandidates[sufficientCandidates.length - 1];
            historyEscalated = true;
          }
        } catch {
          // Bounded fallback: retain initial winner without throwing
        }
      }

      const reasoningEffort = this._mapReasoningEffort(requirement.reasoning, winner.model, winner.profile, options);
      const reason = historyEscalated
        ? `sufficient_capability_matched_with_history_escalation_from_${originalCandidateModel}`
        : 'sufficient_capability_matched';

      return this._buildConfig('allocated', providerId, winner.model.id, reasoningEffort, reason, false, historyEscalated);
    }

    // If no sufficient model found, but there are unprofiled or untrusted models:
    // "If capability sufficiency cannot be established, use a conservative deterministic policy rather than fabricated ranking."
    if (unprofiledCandidates.length > 0) {
      if (this.allowFallbackToCurrent && catalog.current) {
        return this._buildConfig('passthrough', providerId, catalog.current, null, 'unprofiled_catalog_fallback_to_current', true);
      }
      return this._buildConfig('passthrough', providerId, null, null, 'capability_unestablished', true);
    }

    // If all available models are profiled with trustworthy sources and strictly insufficient:
    return this._buildConfig('insufficient_capability', providerId, null, null, 'no_sufficient_capability_model', false);
  }

  /**
   * Resolves execution configs for an entire plan across all assigned roles.
   *
   * @param {object} planResult PlanRequirementsResult from CoreBrain
   * @param {object} catalog ProviderCatalog
   * @param {object} [usage] ProviderUsage
   * @param {object} [options] Allocation options
   * @returns {object} PlanAllocationResult
   */
  allocatePlan(planResult, catalog, usage, options = {}) {
    const taskId = (planResult && typeof planResult.taskId === 'string') ? planResult.taskId : 'UNKNOWN_TASK';
    const providerId = (catalog && typeof catalog.providerId === 'string') ? catalog.providerId : 'unknown';

    if (!planResult || !planResult.requirements || typeof planResult.requirements !== 'object') {
      const emptyResult = {
        taskId,
        providerId,
        status: 'passthrough',
        allocations: {}
      };
      validatePlanAllocationResult(emptyResult);
      return emptyResult;
    }

    const switchingEnabled = (typeof options.modelSwitchingEnabled === 'boolean')
      ? options.modelSwitchingEnabled
      : (this.modelSwitchingEnabled !== null && this.modelSwitchingEnabled !== undefined
        ? this.modelSwitchingEnabled
        : isModelSwitchingEnabled(options));

    if (!switchingEnabled) {
      return this._allocatePlanFixedSelected(planResult, catalog, usage, options);
    }

    const allocations = {};
    const statuses = new Set();
    const taskCategory = options.taskCategory || (options.task && options.task.category) || (planResult && planResult.taskCategory) || 'general';

    for (const [role, req] of Object.entries(planResult.requirements)) {
      const roleOptions = {
        ...options,
        role,
        taskCategory
      };
      const config = this.allocate(req, catalog, usage, roleOptions);
      allocations[role] = config;
      statuses.add(config.status);
    }

    let overallStatus = 'allocated';
    if (statuses.size === 1) {
      overallStatus = Array.from(statuses)[0];
    } else if (statuses.has('allocated')) {
      overallStatus = 'partial';
    } else if (statuses.has('passthrough')) {
      overallStatus = 'passthrough';
    } else if (statuses.has('unavailable')) {
      overallStatus = 'unavailable';
    } else {
      overallStatus = 'insufficient_capability';
    }

    const result = {
      taskId,
      providerId,
      status: overallStatus,
      allocations
    };

    validatePlanAllocationResult(result);
    return result;
  }

  /**
   * Allocates plan when model switching is disabled.
   * Uses only an explicitly selected Core-managed Provider model. Without one,
   * it leaves the model unset for the Adapter/Provider default; recommendations
   * and host-selected models are never turned into executable assignments.
   *
   * @param {object} planResult
   * @param {object} catalog
   * @param {object} [usage]
   * @param {object} [options]
   * @returns {object} PlanAllocationResult
   * @private
   */
  _allocatePlanFixedSelected(planResult, catalog, usage, options = {}) {
    const taskId = (planResult && typeof planResult.taskId === 'string') ? planResult.taskId : 'UNKNOWN_TASK';
    const providerId = (catalog && typeof catalog.providerId === 'string') ? catalog.providerId : 'unknown';
    const allocations = {};
    const statuses = new Set();

    // 1. Authoritative Quota / Usage Check
    if (usage && usage.ordinaryUsageAllowed === false) {
      for (const role of Object.keys(planResult.requirements || {})) {
        const config = this._buildConfig('unavailable', providerId, null, null, 'quota_exhausted', false);
        config.failureIdentifier = 'MODEL_QUOTA_EXHAUSTED';
        config.rejectionReason = 'MODEL_QUOTA_EXHAUSTED';
        allocations[role] = config;
        statuses.add('unavailable');
      }
      const res = { taskId, providerId, status: 'unavailable', allocations, failureIdentifier: 'MODEL_QUOTA_EXHAUSTED' };
      validatePlanAllocationResult(res);
      return res;
    }

    // V1 never turns a recommendation, catalog current value, or host model into
    // an execution assignment. Only the explicit Core-managed Provider choice
    // is sent to the Adapter; null means use its native default.
    const selectedModel = typeof options.providerModel === 'string' && options.providerModel.trim()
      ? options.providerModel.trim()
      : null;

    // 3. Check Authoritative Model Availability & Quota
    const exhaustedList = [
      ...(Array.isArray(usage?.exhaustedModels) ? usage.exhaustedModels : []),
      ...(Array.isArray(options?.exhaustedModels) ? options.exhaustedModels : [])
    ];
    const unavailableList = Array.isArray(options?.unavailableModels) ? options.unavailableModels : [];

    const modelDesc = catalog && Array.isArray(catalog.models)
      ? catalog.models.find(m => m && (m.id === selectedModel || m.displayName === selectedModel))
      : null;

    const isQuotaExhausted = Boolean(
      (modelDesc && modelDesc.quotaExhausted === true) ||
      (selectedModel && exhaustedList.includes(selectedModel))
    );
    const isModelUnavailable = Boolean(
      (modelDesc && modelDesc.access === 'unavailable') ||
      (selectedModel && unavailableList.includes(selectedModel))
    );

    if (isQuotaExhausted || isModelUnavailable) {
      const reason = isQuotaExhausted ? 'quota_exhausted' : 'selected_model_unavailable';
      const failureIdentifier = isQuotaExhausted ? 'MODEL_QUOTA_EXHAUSTED' : 'MODEL_UNAVAILABLE';
      for (const role of Object.keys(planResult.requirements || {})) {
        const config = this._buildConfig('unavailable', providerId, null, null, reason, false);
        config.failureIdentifier = failureIdentifier;
        config.rejectionReason = failureIdentifier;
        allocations[role] = config;
        statuses.add('unavailable');
      }
      const res = { taskId, providerId, status: 'unavailable', allocations, failureIdentifier };
      validatePlanAllocationResult(res);
      return res;
    }

    // V1 recommendations do not impose an execution capability floor.
    // An explicit model stays unchanged; absent a choice, the Adapter uses its
    // Provider-native default. Capability profiles remain available to the
    // separate advisory recommendation display.
    for (const [role, req] of Object.entries(planResult.requirements || {})) {
      const config = this._buildConfig(
        selectedModel ? 'allocated' : 'passthrough',
        providerId,
        selectedModel,
        null,
        selectedModel ? 'explicit_provider_model' : 'provider_default_model',
        false
      );
      allocations[role] = config;
      statuses.add(config.status);
    }

    let overallStatus = 'allocated';
    if (statuses.size === 1) {
      overallStatus = Array.from(statuses)[0];
    } else if (statuses.has('unavailable')) {
      overallStatus = 'unavailable';
    } else if (statuses.has('insufficient_capability')) {
      overallStatus = 'insufficient_capability';
    } else if (statuses.has('allocated')) {
      overallStatus = 'allocated';
    } else {
      overallStatus = 'passthrough';
    }

    const result = {
      taskId,
      providerId,
      status: overallStatus,
      allocations
    };

    validatePlanAllocationResult(result);
    return result;
  }

  /**
   * Finds a capability profile matching model id or display name.
   * @param {object} model
   * @param {Record<string, object>} profiles
   * @returns {object | null}
   * @private
   */
  _findProfile(model, profiles) {
    if (!profiles || typeof profiles !== 'object') return null;

    if (profiles[model.id]) return profiles[model.id];
    if (model.displayName && profiles[model.displayName]) return profiles[model.displayName];

    // Case-insensitive lookup fallback
    const lowerId = model.id.toLowerCase();
    for (const [k, v] of Object.entries(profiles)) {
      if (k.toLowerCase() === lowerId) return v;
    }

    return null;
  }

  /**
   * Maps Core normalized reasoning level to provider-native effort string.
   * Nearest sufficient provider-native effort is chosen (never maximum or extended efforts like xhigh/max/ultra).
   *
   * @param {string} reqReasoning Core reasoning level ('none' | 'low' | 'medium' | 'high')
   * @param {object} model ModelDescriptor
   * @param {object} [profile] ModelCapabilityProfile
   * @param {object} [options] Allocation options
   * @returns {string | null}
   * @private
   */
  _mapReasoningEffort(reqReasoning, model, profile, options = {}) {
    const supported = Array.isArray(model.supportedEfforts) ? model.supportedEfforts : [];

    // If model does not support reasoning, return null
    if (supported.length === 0) {
      return null;
    }

    // Core reasoning mapping
    if (reqReasoning === 'none') {
      if (supported.includes('none')) return 'none';
      return null; // Omit reasoning parameter
    }

    if (reqReasoning === 'low') {
      if (supported.includes('low')) return 'low';
      if (model.defaultEffort === 'low') return 'low';
      return null;
    }

    if (reqReasoning === 'medium') {
      if (supported.includes('medium')) return 'medium';
      if (supported.includes('low')) return 'low';
      return null;
    }

    if (reqReasoning === 'high') {
      // Maps to nearest sufficient effort: strictly 'high' when available.
      // xhigh, max, and ultra are NEVER selected automatically.
      if (supported.includes('high')) return 'high';
      if (options.allowExtendedEffort) {
        if (supported.includes('xhigh')) return 'xhigh';
        if (supported.includes('max')) return 'max';
        if (supported.includes('ultra')) return 'ultra';
      }
      if (supported.includes('medium')) return 'medium';
      return null;
    }

    return null;
  }

  /**
   * Constructs and validates a ResolvedExecutionConfig.
   * @private
   */
  _buildConfig(status, providerId, model, reasoningEffort, reason, fallbackApplied, historyEscalated = false) {
    const config = {
      status,
      providerId,
      model: model || null,
      reasoningEffort: reasoningEffort || null,
      reason: reason || '',
      fallbackApplied: Boolean(fallbackApplied),
      historyEscalated: Boolean(historyEscalated)
    };

    const check = validateResolvedExecutionConfig(config);
    if (!check.valid) {
      throw new Error(`ModelAllocator internal error: ${check.error}`);
    }

    return config;
  }
}

const defaultModelAllocator = new ModelAllocator();

module.exports = {
  ModelAllocator,
  modelAllocator: defaultModelAllocator,
  TIER_SCORES,
  TRUSTED_PROVENANCE_SOURCES,
  isTrustworthyProfile
};
