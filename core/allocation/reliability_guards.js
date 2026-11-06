/**
 * 🌐 Universal Agent Core Hub - Reliability Guards
 * Quota/Token Safety & Context Window Protection Layer
 *
 * Responsibilities:
 * 1. Authoritative model availability and quota evaluation.
 * 2. Strict non-switching enforcement when modelSwitchingEnabled === false.
 * 3. Safe compliant fallback resolution respecting Safety Floor when switching is ON.
 * 4. Context window health classification: OK, WARNING, CRITICAL, UNKNOWN.
 * 5. Distinct context measurement tracking: exact, estimated, unavailable.
 * 6. Protection before Planner, Coder, and Recovery calls.
 */

'use strict';

const { TIER_SCORES } = require('./model_allocator');
const { isTrustworthyProfile } = require('./model_allocator');

/**
 * Standard Failure Identifiers
 */
const FAILURE_IDENTIFIERS = Object.freeze({
  MODEL_QUOTA_EXHAUSTED: 'MODEL_QUOTA_EXHAUSTED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  NO_USABLE_MODEL_AVAILABLE: 'NO_USABLE_MODEL_AVAILABLE',
  CONTEXT_WINDOW_CRITICAL: 'CONTEXT_WINDOW_CRITICAL'
});

/**
 * Context Health Classifications
 */
const CONTEXT_HEALTH = Object.freeze({
  OK: 'OK',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Context Measurement Provenance
 */
const CONTEXT_MEASUREMENT = Object.freeze({
  EXACT: 'exact',
  ESTIMATED: 'estimated',
  UNAVAILABLE: 'unavailable'
});

/**
 * Evaluates whether a specific model is available and within usable quota.
 *
 * @param {string | null} modelId Model identifier
 * @param {object} [catalog] Normalized ProviderCatalog
 * @param {object} [usage] Normalized ProviderUsage
 * @param {object} [options]
 * @returns {object} { available: boolean, reason: string, failureIdentifier: string | null, message: string | null }
 */
function evaluateModelAvailability(modelId, catalog, usage, options = {}) {
  // 1. Check account/provider-wide usage limit
  if ((usage && usage.ordinaryUsageAllowed === false) || options?.ordinaryUsageAllowed === false) {
    return {
      available: false,
      reason: 'provider_quota_exhausted',
      failureIdentifier: FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED,
      message: 'Provider usage quota is exhausted for all models.'
    };
  }

  if (!modelId || typeof modelId !== 'string') {
    return {
      available: false,
      reason: 'model_unspecified',
      failureIdentifier: FAILURE_IDENTIFIERS.MODEL_UNAVAILABLE,
      message: 'No model identifier was specified.'
    };
  }

  // 2. Check explicit quota-exhausted models list in usage or options
  const exhaustedModels = [
    ...(Array.isArray(usage?.exhaustedModels) ? usage.exhaustedModels : []),
    ...(Array.isArray(options?.exhaustedModels) ? options.exhaustedModels : [])
  ];
  if (exhaustedModels.includes(modelId)) {
    return {
      available: false,
      reason: 'quota_exhausted',
      failureIdentifier: FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED,
      message: `Selected model '${modelId}' unavailable because provider quota is exhausted.`
    };
  }

  // 3. Check explicit unavailable models list in options
  const unavailableModels = Array.isArray(options?.unavailableModels) ? options.unavailableModels : [];
  if (unavailableModels.includes(modelId)) {
    return {
      available: false,
      reason: 'model_unavailable',
      failureIdentifier: FAILURE_IDENTIFIERS.MODEL_UNAVAILABLE,
      message: `Selected model '${modelId}' is marked unavailable.`
    };
  }

  // 4. Check model catalog description
  if (catalog && Array.isArray(catalog.models)) {
    const modelDesc = catalog.models.find(m => m && (m.id === modelId || m.displayName === modelId));
    if (modelDesc) {
      if (modelDesc.quotaExhausted === true) {
        return {
          available: false,
          reason: 'quota_exhausted',
          failureIdentifier: FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED,
          message: `Selected model '${modelId}' unavailable because provider quota is exhausted.`
        };
      }
      if (modelDesc.access === 'unavailable' || modelDesc.access === 'denied' || modelDesc.available === false || modelDesc.discoverable === false) {
        return {
          available: false,
          reason: 'model_unavailable',
          failureIdentifier: FAILURE_IDENTIFIERS.MODEL_UNAVAILABLE,
          message: `Selected model '${modelId}' is marked unavailable in provider catalog.`
        };
      }
    }
  }

  // 5. Model is considered available
  return {
    available: true,
    reason: 'available',
    failureIdentifier: null,
    message: null
  };
}

/**
 * Resolves a compliant fallback model when Model Switching = ON, strictly respecting Safety Floor.
 *
 * @param {object} params
 * @param {string} params.failedModel The model that was quota-exhausted or unavailable
 * @param {string} params.requiredTier Required capability tier ('lightweight', 'balanced', 'strong')
 * @param {string} [params.safetyFloorTier] Minimum safety floor tier
 * @param {object} [params.catalog] Provider catalog
 * @param {object} [params.usage] Provider usage
 * @param {object} [params.profiles] Model capability profiles
 * @param {object} [params.options]
 * @returns {object} Fallback resolution result
 */
function resolveQuotaFallback(params = {}) {
  const {
    failedModel,
    requiredTier = 'lightweight',
    safetyFloorTier = 'lightweight',
    catalog = null,
    usage = null,
    profiles = {},
    options = {}
  } = params;

  // Global provider usage check
  if ((usage && usage.ordinaryUsageAllowed === false) || options?.ordinaryUsageAllowed === false) {
    return {
      fallbackFound: false,
      fallbackModel: null,
      originallyResolvedModel: failedModel,
      rejectionReason: FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED,
      safetyFloorDecision: 'floor_unmet',
      failureIdentifier: FAILURE_IDENTIFIERS.NO_USABLE_MODEL_AVAILABLE,
      reason: 'provider_quota_exhausted'
    };
  }

  const reqScore = TIER_SCORES[requiredTier] || 1;
  const floorScore = TIER_SCORES[safetyFloorTier] || 1;
  const minRequiredScore = Math.max(reqScore, floorScore);

  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const candidates = [];

  for (const m of models) {
    if (!m || !m.id || m.id === failedModel) continue;

    // Check availability
    const avail = evaluateModelAvailability(m.id, catalog, usage, options);
    if (!avail.available) continue;

    // Check capability score
    const profile = profiles ? (profiles[m.id] || profiles[m.displayName] || null) : null;
    let score = 1;
    if (profile && isTrustworthyProfile(profile)) {
      score = TIER_SCORES[profile.capabilityTier] || 1;
    } else if (m.id.includes('sonnet') || m.id.includes('astra') || m.id.includes('opus')) {
      score = 3;
    } else if (m.id.includes('terra') || m.id.includes('fable') || m.id.includes('sol')) {
      score = 2;
    }

    if (score >= minRequiredScore) {
      candidates.push({ model: m.id, score, profile });
    }
  }

  if (candidates.length === 0) {
    return {
      fallbackFound: false,
      fallbackModel: null,
      originallyResolvedModel: failedModel,
      rejectionReason: FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED,
      safetyFloorDecision: 'floor_unmet',
      failureIdentifier: FAILURE_IDENTIFIERS.NO_USABLE_MODEL_AVAILABLE,
      reason: 'no_sufficient_model_satisfies_safety_floor'
    };
  }

  // Sort candidates: prefer closest match to minRequiredScore, then alphabetically
  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.model.localeCompare(b.model);
  });

  const chosen = candidates[0].model;

  return {
    fallbackFound: true,
    fallbackModel: chosen,
    originallyResolvedModel: failedModel,
    rejectionReason: FAILURE_IDENTIFIERS.MODEL_QUOTA_EXHAUSTED,
    safetyFloorDecision: minRequiredScore > reqScore ? 'enforced' : 'satisfied',
    failureIdentifier: null,
    reason: 'quota_fallback_resolved'
  };
}

/**
 * Evaluates the context health before executing a model operation.
 *
 * Rules:
 * - Exact: only when provider explicitly reports remaining/used percentage or compaction/overflow.
 * - Estimated: only when an authoritative context limit is known and accumulated tokens exist.
 * - Unavailable: when no authoritative limit or provider report is available.
 *
 * @param {object} params
 * @param {string} [params.providerId] Provider identifier
 * @param {string} [params.model] Model identifier
 * @param {number} [params.sessionTokens] Accumulated tokens used across session so far
 * @param {number} [params.callTokens] Tokens used in the most recent invocation
 * @param {number} [params.contextLimit] Authoritative context limit in tokens
 * @param {string} [params.rawOutput] Raw stdout/stderr to inspect for overflow warnings
 * @param {number} [params.exactUsedPercent] Provider-reported used percentage
 * @param {number} [params.exactRemainingPercent] Provider-reported remaining percentage
 * @param {object} [params.profile] Model profile
 * @returns {object} { health: string, measurement: string, tokensUsed: number | null, contextLimit: number | null, percentUsed: number | null, warningMessage: string | null }
 */
function evaluateContextHealth(params = {}) {
  const {
    sessionTokens = null,
    callTokens = null,
    contextLimit = null,
    rawOutput = null,
    exactUsedPercent = null,
    exactRemainingPercent = null,
    profile = null
  } = params;

  // 1. Exact provider-reported percentage
  if (exactUsedPercent !== null && exactUsedPercent !== undefined && Number.isFinite(exactUsedPercent)) {
    const percent = Math.min(100, Math.max(0, Math.round(exactUsedPercent)));
    let health = CONTEXT_HEALTH.OK;
    let warningMessage = null;

    if (percent >= 90) {
      health = CONTEXT_HEALTH.CRITICAL;
      warningMessage = `Provider reported critical context usage: ${percent}% of window capacity reached.`;
    } else if (percent >= 75) {
      health = CONTEXT_HEALTH.WARNING;
      warningMessage = `Provider reported context pressure warning: ${percent}% of window capacity reached.`;
    }

    return {
      health,
      measurement: CONTEXT_MEASUREMENT.EXACT,
      tokensUsed: sessionTokens ?? callTokens ?? null,
      contextLimit: contextLimit ?? null,
      percentUsed: percent,
      warningMessage
    };
  }

  if (exactRemainingPercent !== null && exactRemainingPercent !== undefined && Number.isFinite(exactRemainingPercent)) {
    const remaining = Math.min(100, Math.max(0, Math.round(exactRemainingPercent)));
    const percent = 100 - remaining;
    let health = CONTEXT_HEALTH.OK;
    let warningMessage = null;

    if (remaining <= 10) {
      health = CONTEXT_HEALTH.CRITICAL;
      warningMessage = `Provider reported critical remaining context: ${remaining}% remaining (${percent}% used).`;
    } else if (remaining <= 25) {
      health = CONTEXT_HEALTH.WARNING;
      warningMessage = `Provider reported context pressure warning: ${remaining}% remaining (${percent}% used).`;
    }

    return {
      health,
      measurement: CONTEXT_MEASUREMENT.EXACT,
      tokensUsed: sessionTokens ?? callTokens ?? null,
      contextLimit: contextLimit ?? null,
      percentUsed: percent,
      warningMessage
    };
  }

  // 2. Explicit provider compaction / context overflow messages in stdout/stderr
  if (typeof rawOutput === 'string' && rawOutput.length > 0) {
    const isCriticalOverflow = /context (?:window|length) (?:exceeded|full|overflow|limit reached)|(?:prompt|input) is too long|maximum context length/i.test(rawOutput);
    if (isCriticalOverflow) {
      return {
        health: CONTEXT_HEALTH.CRITICAL,
        measurement: CONTEXT_MEASUREMENT.EXACT,
        tokensUsed: sessionTokens ?? callTokens ?? null,
        contextLimit: contextLimit ?? null,
        percentUsed: 100,
        warningMessage: 'Provider reported context window overflow / capacity exceeded.'
      };
    }

    const isWarningPressure = /approaching context window limit|context window near capacity/i.test(rawOutput);
    if (isWarningPressure) {
      return {
        health: CONTEXT_HEALTH.WARNING,
        measurement: CONTEXT_MEASUREMENT.EXACT,
        tokensUsed: sessionTokens ?? callTokens ?? null,
        contextLimit: contextLimit ?? null,
        percentUsed: 80,
        warningMessage: 'Provider reported approaching context window limit.'
      };
    }
  }

  // 3. Estimated from authoritative context limit + execution telemetry
  // Authoritative context limit: explicit contextLimit parameter, or profile.contextWindow from trustworthy benchmark profile
  const authoritativeLimit = (typeof contextLimit === 'number' && contextLimit > 0)
    ? contextLimit
    : ((profile && isTrustworthyProfile(profile) && typeof profile.contextWindow === 'number' && profile.contextWindow > 0)
      ? profile.contextWindow
      : null);

  const accumulatedTokens = (typeof sessionTokens === 'number' && sessionTokens > 0)
    ? sessionTokens
    : ((typeof callTokens === 'number' && callTokens > 0) ? callTokens : null);

  if (authoritativeLimit !== null && accumulatedTokens !== null) {
    const percent = Math.min(100, Math.round((accumulatedTokens / authoritativeLimit) * 100));
    let health = CONTEXT_HEALTH.OK;
    let warningMessage = null;

    if (percent >= 90) {
      health = CONTEXT_HEALTH.CRITICAL;
      warningMessage = `Estimated context pressure CRITICAL: ~${percent}% of limit used (${accumulatedTokens} / ${authoritativeLimit} tokens).`;
    } else if (percent >= 75) {
      health = CONTEXT_HEALTH.WARNING;
      warningMessage = `Estimated context pressure WARNING: ~${percent}% of limit used (${accumulatedTokens} / ${authoritativeLimit} tokens).`;
    }

    return {
      health,
      measurement: CONTEXT_MEASUREMENT.ESTIMATED,
      tokensUsed: accumulatedTokens,
      contextLimit: authoritativeLimit,
      percentUsed: percent,
      warningMessage
    };
  }

  // 4. Unavailable / Unknown: do not fabricate limit or percentage
  return {
    health: CONTEXT_HEALTH.UNKNOWN,
    measurement: CONTEXT_MEASUREMENT.UNAVAILABLE,
    tokensUsed: accumulatedTokens,
    contextLimit: null,
    percentUsed: null,
    warningMessage: null
  };
}

/**
 * Checks whether the given provider adapter supports safe fresh-session rollover.
 *
 * @param {object} adapter
 * @returns {boolean}
 */
function checkFreshSessionRolloverSupport(adapter) {
  if (!adapter) return false;
  if (typeof adapter.supportsFreshSessionRollover === 'boolean') {
    return adapter.supportsFreshSessionRollover;
  }
  if (typeof adapter.resetSession === 'function') {
    return true;
  }
  return false;
}

module.exports = {
  FAILURE_IDENTIFIERS,
  CONTEXT_HEALTH,
  CONTEXT_MEASUREMENT,
  evaluateModelAvailability,
  resolveQuotaFallback,
  evaluateContextHealth,
  checkFreshSessionRolloverSupport
};
