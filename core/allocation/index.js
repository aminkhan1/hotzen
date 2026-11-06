/**
 * 🌐 Universal Agent Core Hub - Allocation Subsystem Entry Point
 * Phase 2 Implementation: CoreBrain Contracts & Deterministic Fallback
 */

'use strict';

const contracts = require('./contracts');
const {
  DeterministicFallbackBrain,
  deterministicFallbackBrain
} = require('./deterministic_fallback_brain');

const { ProviderAdapter } = require('./provider_adapter');
const { ClaudeCodeAdapter } = require('./adapters/claude_code_adapter');
const { CodexAdapter } = require('./adapters/codex_adapter');
const {
  ModelAllocator,
  modelAllocator,
  TIER_SCORES,
  TRUSTED_PROVENANCE_SOURCES,
  isTrustworthyProfile
} = require('./model_allocator');
const {
  LocalBrain,
  localBrain
} = require('./local_brain');

const { CoreBrain } = contracts;

module.exports = {
  // Core Interface & Types
  CoreBrain,
  contracts,

  // Fallback Engine
  DeterministicFallbackBrain,
  deterministicFallbackBrain,

  // Local Brain (Phase 5)
  LocalBrain,
  localBrain,
  buildPrompt: require('./local_brain').buildPrompt,
  extractJson: require('./local_brain').extractJson,
  normalizeModelOutput: require('./local_brain').normalizeModelOutput,
  reconcileWithSafetyFloor: require('./local_brain').reconcileWithSafetyFloor,

  // Hybrid CoreBrain (Phase 5.9 - TASK-5.9.5)
  HybridCoreBrain: require('./hybrid_core_brain').HybridCoreBrain,
  hybridCoreBrain: require('./hybrid_core_brain').hybridCoreBrain,
  analyzePlan: require('./hybrid_core_brain').analyzePlan,

  // Deterministic Safety Floor (Phase 5.4)
  computeSafetyFloor: require('./safety_floor').computeSafetyFloor,
  CAPABILITY_RANK: require('./safety_floor').CAPABILITY_RANK,
  REASONING_RANK: require('./safety_floor').REASONING_RANK,
  RISK_RANK: require('./safety_floor').RISK_RANK,

  // Provider Adapters
  ProviderAdapter,
  ClaudeCodeAdapter,
  CodexAdapter,

  // Execution Handoff (Phase 5.9 Extension)
  executeAllocatedRole: require('./execution_handoff').executeAllocatedRole,
  executeAllocatedRoleSync: require('./execution_handoff').executeAllocatedRoleSync,
  enforceInteractiveModelHandoff: require('./execution_handoff').enforceInteractiveModelHandoff,
  isInteractiveCodexSession: require('./execution_handoff').isInteractiveCodexSession,
  updateCodexThreadSettings: require('./adapters/codex_interactive_handoff').updateCodexThreadSettings,
  CodexInteractiveHandoff: require('./adapters/codex_interactive_handoff').CodexInteractiveHandoff,
  CODEX_HANDOFF_STATUS: require('./adapters/codex_interactive_handoff').HANDOFF_STATUS,
  resolveCodexThreadId: require('./adapters/codex_interactive_handoff').resolveCodexThreadId,
  resolveAuthoritativeCodexThreadId: require('./adapters/codex_interactive_handoff').resolveAuthoritativeCodexThreadId,
  canonicalizeWorkspacePath: require('./adapters/codex_interactive_handoff').canonicalizeWorkspacePath,
  formatManualFallbackMessage: require('./adapters/codex_interactive_handoff').formatManualFallbackMessage,
  isValidCodexThreadId: require('./adapters/codex_interactive_handoff').isValidCodexThreadId,

  // Model Allocator & Provenance
  ModelAllocator,
  modelAllocator,
  ExecutionHistoryStore: require('./execution_history_store').ExecutionHistoryStore,
  resolveHistoryDbPath: require('./execution_history_store').resolveHistoryDbPath,
  DEFAULT_DB_PATH: require('./execution_history_store').DEFAULT_DB_PATH,
  isModelSwitchingEnabled: require('./model_switching_toggle').isModelSwitchingEnabled,
  setModelSwitchingEnabled: require('./model_switching_toggle').setModelSwitchingEnabled,
  enableModelSwitching: require('./model_switching_toggle').enableModelSwitching,
  disableModelSwitching: require('./model_switching_toggle').disableModelSwitching,
  getModelSwitchingStatus: require('./model_switching_toggle').getModelSwitchingStatus,
  resetModelSwitching: require('./model_switching_toggle').resetModelSwitching,
  TIER_SCORES,
  TRUSTED_PROVENANCE_SOURCES,
  isTrustworthyProfile,
  VALID_PROVENANCE_SOURCES: contracts.VALID_PROVENANCE_SOURCES,
  VALID_SOURCES: contracts.VALID_SOURCES,
  VALID_CONFIDENCE_TIERS: contracts.VALID_CONFIDENCE_TIERS,
  VALID_CONFIDENCE_REASONS: contracts.VALID_CONFIDENCE_REASONS,
  VALID_DECISION_PATHS: contracts.VALID_DECISION_PATHS,
  VALID_LIFECYCLE_STAGES: contracts.VALID_LIFECYCLE_STAGES,

  // Fast Path Policy (Phase 5.9)
  evaluateFastPath: require('./fast_path_policy').evaluateFastPath,

  // Role Policy & Deterministic Reconciliation (Phase 5.9 - TASK-5.9.4)
  DEFAULT_ROLE_POLICY: require('./role_policy').DEFAULT_ROLE_POLICY,
  resolvePolicyRoleRequirement: require('./role_policy').resolvePolicyRoleRequirement,
  deriveRoleRequirements: require('./role_policy').deriveRoleRequirements,
  escalateRequirement: require('./reconciliation_engine').escalateRequirement,
  monotonicallyReconcileRequirements: require('./reconciliation_engine').monotonicallyReconcileRequirements,
  reconcileDeterministicPlan: require('./reconciliation_engine').reconcileDeterministicPlan,

  // Plan Metadata & Lifecycle (Phase 5.9)
  validatePlanMetadataLifecycle: require('./plan_metadata').validatePlanMetadataLifecycle,
  normalizeLayer: require('./plan_metadata').normalizeLayer,
  normalizeAffectedLayers: require('./plan_metadata').normalizeAffectedLayers,
  CANONICAL_LAYERS: require('./plan_metadata').CANONICAL_LAYERS,
  NON_CRITICAL_LAYERS: require('./plan_metadata').NON_CRITICAL_LAYERS,
  STANDARD_LAYERS: require('./plan_metadata').STANDARD_LAYERS,
  CRITICAL_LAYERS: require('./plan_metadata').CRITICAL_LAYERS,

  // Plan Display & User-Visible Plan Rendering (V1 Final)
  buildAgentExecutionPlan: require('../workflow/plan_display').buildAgentExecutionPlan,
  renderAgentExecutionPlan: require('../workflow/plan_display').renderAgentExecutionPlan,
  renderUserPlan: require('../workflow/plan_display').renderUserPlan,

  // Reliability Guards (Quota & Context Safety)
  evaluateModelAvailability: require('./reliability_guards').evaluateModelAvailability,
  resolveQuotaFallback: require('./reliability_guards').resolveQuotaFallback,
  evaluateContextHealth: require('./reliability_guards').evaluateContextHealth,
  checkFreshSessionRolloverSupport: require('./reliability_guards').checkFreshSessionRolloverSupport,
  FAILURE_IDENTIFIERS: require('./reliability_guards').FAILURE_IDENTIFIERS,
  CONTEXT_HEALTH: require('./reliability_guards').CONTEXT_HEALTH,
  CONTEXT_MEASUREMENT: require('./reliability_guards').CONTEXT_MEASUREMENT,

  // Convenience validation functions
  validateAgentRequirement: contracts.validateAgentRequirement,
  validatePlanRequirementsResult: contracts.validatePlanRequirementsResult,
  validateEvidenceState: contracts.validateEvidenceState,
  validateDecisionTrace: contracts.validateDecisionTrace,
  validateMetadataLifecycleResult: contracts.validateMetadataLifecycleResult,
  validateModelDescriptor: contracts.validateModelDescriptor,
  validateProviderCatalog: contracts.validateProviderCatalog,
  validateUsageWindow: contracts.validateUsageWindow,
  validateProviderUsage: contracts.validateProviderUsage,
  validateResolvedExecutionConfig: contracts.validateResolvedExecutionConfig,
  validatePlanAllocationResult: contracts.validatePlanAllocationResult,
  validateModelCapabilityProfile: contracts.validateModelCapabilityProfile
};
