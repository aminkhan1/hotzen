/**
 * 🌐 Universal Agent Core Hub - Task Plan Generator
 * Task 4B1 Implementation: Offline / Non-Interactive Plan Generation & Allocation
 *
 * Responsibilities:
 * 1. Resolves consumer workspace and reads local runtime_config.json.
 * 2. Normalizes task prompt and extracts contract-compliant plan structure.
 * 3. Uses HybridCoreBrain & ModelAllocator deterministically without LLM provider calls.
 * 4. Generates truthful agentExecutionPlan (Tester/Critic isModelCall: false, null model).
 * 5. Formats user-visible plan suitable for interactive agent / user approval.
 * 6. Hard recursion guard: never executes CodexAdapter, ClaudeCodeAdapter, or child CLI processes.
 * 7. Leaves consumer application source, git state, metrics, and SQLite history unmutated.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  ModelAllocator,
  HybridCoreBrain,
  ExecutionHistoryStore,
  resolveHistoryDbPath,
  getModelSwitchingStatus
} = require('../allocation');
const { resolveRoleRequirement } = require('../allocation/deterministic_fallback_brain');

const {
  buildAgentExecutionPlan,
  renderUserPlan,
  normalizePlanLocale
} = require('./plan_display');

const { parsePlannerOutput, assertManagedCheckpointPolicyAvailable } = require('./core_workflow_engine');
const { createPlanReceipt, nativeExecutorForHost } = require('./plan_receipt');
const { resolvePlanFilesToModify } = require('./file_target_resolver');
const { resolveVerificationContract, captureApprovedFileStates } = require('./verification_contract');
const { resolveProviderId, assertAdapterProvider } = require('../allocation/execution_handoff');

/**
 * Generates an authoritative, truthful task plan and allocation without provider execution.
 *
 * @param {object} params
 * @param {string|object} params.task Task string prompt or task object
 * @param {string} [params.taskPrompt] Explicit task prompt string
 * @param {string} [params.cwd] Consumer project directory
 * @param {string} [params.workspace] Consumer project directory alias
 * @param {string} [params.provider] Provider override ('codex' | 'claude_code')
 * @param {boolean} [params.modelSwitchingEnabled] Explicit switching override
 * @param {string} [params.providerModel] Explicit Core-managed Provider model
 * @param {object} [params.catalog] Custom provider catalog
 * @param {object} [params.coreBrain] Custom core brain instance
 * @param {object} [params.allocator] Custom model allocator instance
 * @param {object} [params.historyStore] Custom history store instance
 * @param {object} [params.options] Additional options
 * @returns {object} Structured plan result
 */
function generateTaskPlan(params = {}) {
  const options = params.options || params;
  const targetDir = path.resolve(params.cwd || params.workspace || options.cwd || options.workspace || process.cwd());
  const planLocale = normalizePlanLocale(options.planLocale ?? params.planLocale);

  // 1. Task prompt extraction and normalization
  const rawInput = params.structuredTask || params.taskPrompt || params.task || options.taskPrompt || options.task || '';
  const taskPrompt = (typeof rawInput === 'string')
    ? rawInput.trim()
    : (rawInput.userPrompt || rawInput.title || rawInput.goal || '').trim();

  if (!taskPrompt) {
    throw new Error('Task prompt is required for plan generation.');
  }

  if (params.structuredTask !== undefined) {
    const spec = params.structuredTask;
    assertManagedCheckpointPolicyAvailable(spec?.managedExecutionPolicy);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || typeof spec.goal !== 'string' ||
        !spec.goal.trim() || !Array.isArray(spec.filesToModify) || spec.filesToModify.length === 0 ||
        !Array.isArray(spec.acceptanceCriteria) || spec.acceptanceCriteria.length === 0 ||
        !spec.acceptanceCriteria.every(item => typeof item === 'string' && item.trim().length > 0)) {
      throw new Error('Structured Plan input requires a non-empty goal, filesToModify list, and non-empty string acceptance criteria.');
    }
    if (spec.reportingRequirements !== undefined &&
        (!Array.isArray(spec.reportingRequirements) ||
         spec.reportingRequirements.some((item) => item !== 'criterion_matrix_v1') ||
         new Set(spec.reportingRequirements).size !== spec.reportingRequirements.length)) {
      throw new Error('Structured Plan reportingRequirements must contain only unique supported values: criterion_matrix_v1.');
    }
    if ((params.filesToModify || options.filesToModify) &&
        JSON.stringify(params.filesToModify || options.filesToModify) !== JSON.stringify(spec.filesToModify)) {
      throw new Error('Structured Plan filesToModify must exactly match the explicit --files scope.');
    }
  }

  const taskId = (typeof rawInput === 'object' && rawInput.id) ? rawInput.id : `TASK-${Date.now()}`;
  const taskCategory = (typeof rawInput === 'object' && rawInput.category) ? rawInput.category : (options.taskCategory || 'general');

  const taskObj = {
    id: taskId,
    userPrompt: taskPrompt,
    category: taskCategory
  };

  // History text is opt-in. Never derive it from the task prompt or Plan goal.
  if (options.historyTitle !== undefined || params.historyTitle !== undefined) {
    const rawTitle = options.historyTitle !== undefined ? options.historyTitle : params.historyTitle;
    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
    if (!title || Array.from(title).length > 120 || /[\u0000-\u001f\u007f]/u.test(title) ||
        /(?:bearer\s+\S+|-----BEGIN|(?:api[_-]?key|token|password|secret)\s*[:=])/iu.test(title)) {
      throw new Error('Invalid history title: supply a short, single-line title without credentials.');
    }
    taskObj.historyTitle = title;
  }

  const native = options.native === true;
  const nativeHost = options.nativeHost;
  if (nativeHost !== undefined && !native) throw new Error('Native host requires explicit Native planning.');
  if (native && (!nativeExecutorForHost(nativeHost) ||
      ['provider', 'providerModel', 'adapter', 'catalog', 'allocator', 'selectedModel',
        'modelSwitchingEnabled', 'semanticCriticMaxProviderCalls', 'semanticCriticPolicy'].some(key =>
        options[key] !== undefined || (options !== params && params[key] !== undefined)))) {
    throw new Error('Native planning requires an explicit supported host and forbids Provider/model/Adapter options.');
  }
  const identity = native ? { executionKind: 'native', nativeHost } : {};

  // 2. Read consumer project runtime configuration
  const switchingStatus = native ? { enabled: false, source: 'native_host' } : getModelSwitchingStatus({ cwd: targetDir, ...options });
  const isSwitchingEnabled = switchingStatus.enabled;

  const providerModel = isSwitchingEnabled
    ? null
    : ((typeof options.providerModel === 'string' && options.providerModel.trim())
      ? options.providerModel.trim()
      : ((typeof params.providerModel === 'string' && params.providerModel.trim()) ? params.providerModel.trim() : null));
  const selectedModel = isSwitchingEnabled ? (options.selectedModel || params.selectedModel || switchingStatus.selectedModel || null) : null;

  // 3. Resolve from explicit selection or existing provider-bearing configuration only.
  const configuredCatalog = options.catalog || params.catalog;
  const provider = native ? null : resolveProviderId([
    options.provider,
    params.provider,
    options.adapter && options.adapter.providerId,
    configuredCatalog && configuredCatalog.providerId
  ], { required: true });
  if (!native) assertAdapterProvider(provider, options.adapter);

  // 4. Construct offline provider catalog
  const fallbackModels = native ? [] : (provider === 'codex')
    ? [
        { id: 'gpt-6-astra', displayName: 'Astra', discoverable: true, access: 'unknown', supportedEfforts: [] },
        { id: 'gpt-5.6-luna', displayName: 'Luna', discoverable: true, access: 'unknown', supportedEfforts: [] }
      ]
    : [
        { id: 'haiku', displayName: 'Haiku', discoverable: true, access: 'unknown', supportedEfforts: [] },
        { id: 'sonnet', displayName: 'Sonnet', discoverable: true, access: 'unknown', supportedEfforts: [] }
      ];

  const catalog = native ? null : configuredCatalog || {
    providerId: provider,
    current: null,
    models: fallbackModels
  };

  // 5. Read existing execution history without creating or migrating its schema.
  const dbPath = resolveHistoryDbPath({ cwd: targetDir, ...options });
  let historyStore = options.historyStore || params.historyStore || null;
  let createdStore = false;

  if (!native && !historyStore) {
    const hasExistingDbData = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
    if (hasExistingDbData) {
      const readOnlyStore = new ExecutionHistoryStore({ cwd: targetDir, dbPath, readOnly: true });
      if (readOnlyStore.isAvailable()) {
        historyStore = readOnlyStore;
        createdStore = true;
      } else {
        readOnlyStore.close();
      }
    }
  }

  try {
    // Resolve active project languages early
    let activeLanguages = null;
    try {
      const { getProjectLanguages } = require('../languages');
      activeLanguages = options.languages || params.languages || getProjectLanguages({ cwd: targetDir });
    } catch {}

    const explicitFiles = params.filesToModify || options.filesToModify || params.files || options.files ||
      (typeof rawInput === 'object' ? (rawInput.filesToModify || rawInput.files) : null);

    // 6. Parse and normalize plan structure
    const parsedPlan = parsePlannerOutput(params.structuredTask ? JSON.stringify(params.structuredTask) : taskPrompt, {
      cwd: targetDir,
      targetDir,
      languages: activeLanguages,
      taskPrompt,
      filesToModify: explicitFiles
    });
    if (parsedPlan.reportingRequirements !== undefined &&
        (!Array.isArray(parsedPlan.reportingRequirements) ||
         parsedPlan.reportingRequirements.some((item) => item !== 'criterion_matrix_v1') ||
         new Set(parsedPlan.reportingRequirements).size !== parsedPlan.reportingRequirements.length)) {
      throw new Error('Plan reportingRequirements contains an unsupported report contract.');
    }
    if (!parsedPlan.goal || parsedPlan.goal === 'Implementation Plan' || parsedPlan.goal === 'Default Implementation Plan') {
      parsedPlan.goal = taskPrompt;
    }

    // Authoritative deterministic file target resolution
    parsedPlan.filesToModify = resolvePlanFilesToModify(parsedPlan, {
      cwd: targetDir,
      targetDir,
      languages: activeLanguages,
      taskPrompt,
      filesToModify: explicitFiles
    });
    delete parsedPlan.managedExecutionPolicy;
    const managedPolicy = params.structuredTask?.managedExecutionPolicy;
    if (managedPolicy !== undefined) {
      if (native || provider !== 'codex' || isSwitchingEnabled || managedPolicy !== 'checkpoint_after_implementation' ||
          params.semanticCriticMaxProviderCalls !== undefined || parsedPlan.semanticCriticReview ||
          (params.structuredTask.fileOperations ?? []).length !== 0) {
        throw new Error('Unsupported managed execution policy.');
      }
      parsedPlan.managedExecutionPolicy = managedPolicy;
    }
    Object.assign(parsedPlan, identity);
    if (native && parsedPlan.semanticCriticReview !== undefined) throw new Error('Native semantic review is unsupported.');
    const fileOperations = native || managedPolicy !== undefined ? (params.structuredTask?.fileOperations ?? []) : params.structuredTask && params.structuredTask.fileOperations;
    const fileStates = fileOperations !== undefined
      ? captureApprovedFileStates(targetDir, parsedPlan.filesToModify, fileOperations) : undefined;
    parsedPlan.verificationContract = resolveVerificationContract(targetDir, {
      expectedFiles: parsedPlan.filesToModify,
      ...(fileStates !== undefined ? { fileStates } : {})
    });

    // 7. Deterministic requirements analysis via HybridCoreBrain
    const brain = native ? null : options.coreBrain || params.coreBrain || new HybridCoreBrain();
    const planRequirements = native ? null : brain.analyzePlanSync(parsedPlan);

    // 8. Allocation via ModelAllocator
    const allocator = native ? null : options.allocator || params.allocator || new ModelAllocator({ historyStore });
    const strongModel = native ? null : (provider === 'codex') ? 'gpt-6-astra' : 'sonnet';
    const plannerConfig = native ? null : {
      status: providerModel ? 'allocated' : 'passthrough',
      providerId: provider,
      model: providerModel,
      reasoningEffort: null,
      reason: providerModel ? 'explicit_provider_model' : 'provider_default_model'
    };

    let planAllocations;
    if (native) {
      planAllocations = { ...identity, providerId: null, allocations: {} };
    } else if (isSwitchingEnabled) {
      planAllocations = allocator.allocatePlan(planRequirements, catalog, null, {
        ...options,
        task: taskObj,
        taskCategory,
        modelSwitchingEnabled: true,
        selectedModel: providerModel,
        providerModel,
        historyStore
      });

      // Conservative Planner down-routing for proven low-risk trivial tasks
      if (parsedPlan.riskTier === 'low' && parsedPlan.changeType === 1) {
        const plannerReq = resolveRoleRequirement('planner', 'low');
        const downroutedPlanner = allocator.allocate(plannerReq, catalog, null, {
          ...options,
          role: 'planner',
          task: taskObj,
          taskCategory,
          modelSwitchingEnabled: true,
          selectedModel: providerModel,
          providerModel,
          historyStore
        });
        if (downroutedPlanner && downroutedPlanner.status === 'allocated' && downroutedPlanner.model) {
          planAllocations.allocations.planner = downroutedPlanner;
        }
      }
    } else {
      // Switching OFF: preserve the selected model preference while letting
      // ModelAllocator enforce capability, availability, and Safety Floor rules.
      planAllocations = allocator.allocatePlan(planRequirements, catalog, null, {
        ...options,
        task: taskObj,
        taskCategory,
        modelSwitchingEnabled: false,
        selectedModel: providerModel,
        providerModel,
        historyStore
      });
    }

    const semanticCriticAllocation = planAllocations && planAllocations.allocations
      ? { ...planAllocations.allocations.critic } : null;

    const semanticCriticMaxProviderCalls = options.semanticCriticMaxProviderCalls ?? params.semanticCriticMaxProviderCalls;
    if (semanticCriticMaxProviderCalls !== undefined &&
        (!Number.isSafeInteger(semanticCriticMaxProviderCalls) || semanticCriticMaxProviderCalls < 1 || semanticCriticMaxProviderCalls > 1000)) {
      throw new Error('semanticCriticMaxProviderCalls must be a positive safe integer no greater than 1000.');
    }
    if (semanticCriticMaxProviderCalls !== undefined && provider !== 'codex') {
      throw new Error('Semantic Critic opt-in currently requires the read-only Codex Adapter.');
    }
    if (semanticCriticMaxProviderCalls !== undefined) {
      parsedPlan.semanticCriticReview = {
        requested: true,
        providerId: 'codex',
        maxProviderCalls: semanticCriticMaxProviderCalls,
        allocation: semanticCriticAllocation && {
          status: semanticCriticAllocation.status || 'unknown',
          model: semanticCriticAllocation.model || null,
          reasoningEffort: semanticCriticAllocation.reasoningEffort || null
        }
      };
    }

    // Normalize deterministic non-model roles in public planAllocations contract
    if (!native && planAllocations && planAllocations.allocations) {
      planAllocations.allocations.tester = {
        status: 'deterministic',
        executionType: 'deterministic_verification',
        isModelCall: false,
        providerId: null,
        model: null,
        requestedModel: null,
        reasoningEffort: null,
        reason: 'deterministic_verification_rule_based_no_llm'
      };

      planAllocations.allocations.critic = {
        status: 'deterministic',
        executionType: 'rule_based_critic',
        isModelCall: false,
        providerId: null,
        model: null,
        requestedModel: null,
        reasoningEffort: null,
        reason: 'rule_based_critic_deterministic_no_llm'
      };
    }

    const effectivePlannerConfig = (planAllocations && planAllocations.allocations && planAllocations.allocations.planner)
      ? planAllocations.allocations.planner
      : plannerConfig;

    const recommendationEntry = Array.isArray(catalog?.models)
      ? catalog.models.find(model => model && model.id === strongModel)
      : null;
    const modelRecommendation = recommendationEntry ? Object.freeze({
      providerId: provider,
      model: strongModel,
      advisory: true,
      availability: 'not_verified'
    }) : null;

    // 9. Build truthful Agent Execution Plan
    const agentExecutionPlan = buildAgentExecutionPlan({
      ...identity,
      planAllocations,
      plannerConfig: effectivePlannerConfig,
      coderConfig: planAllocations && planAllocations.allocations ? planAllocations.allocations.coder : null,
      strongModel,
      providerModel,
      modelSwitchingEnabled: isSwitchingEnabled,
      catalog
    });

    // 10. Format user-visible plan
    parsedPlan.modelRecommendation = modelRecommendation;
    parsedPlan.planLocale = planLocale;
    if (taskObj.historyTitle) parsedPlan.historyTitle = taskObj.historyTitle;
    const userVisiblePlan = renderUserPlan(parsedPlan, {
      agentExecutionPlan,
      languages: activeLanguages,
      planLocale
    });

    parsedPlan.agentExecutionPlan = agentExecutionPlan;
    parsedPlan.userVisiblePlan = userVisiblePlan;

    const planReceipt = createPlanReceipt({
      task: taskObj,
      taskPrompt,
      workspacePath: targetDir,
      plan: parsedPlan,
      planAllocations,
      runtimeConfig: {
        ...identity,
        modelSwitchingEnabled: isSwitchingEnabled,
        selectedModel: null,
        providerModel,
        planLocale,
        source: switchingStatus.source,
        provider
      }
    });

    const coderConfig = (planAllocations && planAllocations.allocations && planAllocations.allocations.coder)
      ? { ...planAllocations.allocations.coder }
      : null;
    const snapshotPlannerConfig = effectivePlannerConfig ? { ...effectivePlannerConfig } : null;

    const snapshotSelectedModel = isSwitchingEnabled ? selectedModel : null;

    const approvedPlanSnapshot = Object.freeze({
      ...identity,
      taskId: taskObj.id,
      task: Object.freeze({ ...taskObj }),
      goal: parsedPlan.goal,
      riskTier: parsedPlan.riskTier,
      affectedLayers: Array.isArray(parsedPlan.affectedLayers) ? Object.freeze([...parsedPlan.affectedLayers]) : Object.freeze([]),
      filesToModify: Array.isArray(parsedPlan.filesToModify) ? Object.freeze([...parsedPlan.filesToModify]) : Object.freeze([]),
      acceptanceCriteria: Array.isArray(parsedPlan.acceptanceCriteria) ? Object.freeze([...parsedPlan.acceptanceCriteria]) : Object.freeze([]),
      reportingRequirements: Array.isArray(parsedPlan.reportingRequirements) ? Object.freeze([...parsedPlan.reportingRequirements]) : Object.freeze([]),
      plan: parsedPlan,
      userVisiblePlan,
      agentExecutionPlan,
      allocations: planAllocations ? planAllocations.allocations : null,
      coderConfig: coderConfig ? Object.freeze(coderConfig) : null,
      plannerConfig: snapshotPlannerConfig ? Object.freeze(snapshotPlannerConfig) : null,
      providerModel,
      planReceipt,
      verificationContract: parsedPlan.verificationContract,
      runtimeSnapshot: Object.freeze({
        ...identity,
        modelSwitchingEnabled: isSwitchingEnabled,
        selectedModel: snapshotSelectedModel,
        providerModel,
        planLocale,
        languages: Array.isArray(activeLanguages) ? Object.freeze([...activeLanguages]) : null,
        coderModel: coderConfig ? coderConfig.model : null,
        plannerModel: snapshotPlannerConfig ? snapshotPlannerConfig.model : null
      })
    });

    return {
      ok: true,
      task: taskObj,
      plan: parsedPlan,
      agentExecutionPlan,
      userVisiblePlan,
      planAllocations,
      planReceipt,
      approvedPlanSnapshot,
      runtimeConfig: {
        ...identity,
        modelSwitchingEnabled: isSwitchingEnabled,
        selectedModel: snapshotSelectedModel,
        providerModel,
        planLocale,
        source: switchingStatus.source,
        provider
      }
    };
  } finally {
    if (createdStore && historyStore) {
      try {
        historyStore.close();
      } catch {}
    }
  }
}

/**
 * Builds an immutable approved plan snapshot from a structured plan result.
 *
 * @param {object} planResult
 * @param {object} [options]
 * @returns {object}
 */
function buildApprovedPlanSnapshot(planResult, options = {}) {
  if (planResult && planResult.approvedPlanSnapshot) {
    return planResult.approvedPlanSnapshot;
  }
  if (!planResult || !planResult.plan) {
    throw new Error('Valid planResult with plan is required to build approved plan snapshot');
  }
  const taskObj = planResult.task || { id: `TASK-${Date.now()}`, userPrompt: planResult.plan.goal || 'Task' };
  const parsedPlan = planResult.plan;
  const planAllocations = planResult.planAllocations;
  const coderConfig = (planAllocations && planAllocations.allocations && planAllocations.allocations.coder)
    ? { ...planAllocations.allocations.coder }
    : null;
  const plannerConfig = (planAllocations && planAllocations.allocations && planAllocations.allocations.planner)
    ? { ...planAllocations.allocations.planner }
    : null;
  const runtimeConfig = planResult.runtimeConfig || {};
  const snapshotSelectedModel = runtimeConfig.modelSwitchingEnabled
    ? (runtimeConfig.selectedModel || null)
    : null;
  const providerModel = runtimeConfig.providerModel
    || (coderConfig && coderConfig.model)
    || null;

  let activeLanguages = null;
  try {
    const { getProjectLanguages } = require('../languages');
    activeLanguages = options.languages || (typeof getProjectLanguages === 'function' ? getProjectLanguages({ cwd: options.cwd || process.cwd() }) : null);
  } catch {}

  return Object.freeze({
    taskId: taskObj.id,
    task: Object.freeze({ ...taskObj }),
    goal: parsedPlan.goal,
    riskTier: parsedPlan.riskTier,
    affectedLayers: Array.isArray(parsedPlan.affectedLayers) ? Object.freeze([...parsedPlan.affectedLayers]) : Object.freeze([]),
    filesToModify: Array.isArray(parsedPlan.filesToModify) ? Object.freeze([...parsedPlan.filesToModify]) : Object.freeze([]),
    acceptanceCriteria: Array.isArray(parsedPlan.acceptanceCriteria) ? Object.freeze([...parsedPlan.acceptanceCriteria]) : Object.freeze([]),
    reportingRequirements: Array.isArray(parsedPlan.reportingRequirements) ? Object.freeze([...parsedPlan.reportingRequirements]) : Object.freeze([]),
    plan: parsedPlan,
    userVisiblePlan: planResult.userVisiblePlan,
    agentExecutionPlan: planResult.agentExecutionPlan,
    allocations: planAllocations ? planAllocations.allocations : null,
    coderConfig: coderConfig ? Object.freeze(coderConfig) : null,
    plannerConfig: plannerConfig ? Object.freeze(plannerConfig) : null,
    providerModel,
    planReceipt: planResult.planReceipt || null,
    runtimeSnapshot: Object.freeze({
      modelSwitchingEnabled: Boolean(runtimeConfig.modelSwitchingEnabled),
      selectedModel: snapshotSelectedModel,
      providerModel,
      ...(runtimeConfig.planLocale !== undefined ? { planLocale: runtimeConfig.planLocale } : {}),
      languages: Array.isArray(activeLanguages) ? Object.freeze([...activeLanguages]) : null,
      coderModel: coderConfig ? coderConfig.model : null,
      plannerModel: plannerConfig ? plannerConfig.model : null
    })
  });
}

module.exports = {
  generateTaskPlan,
  buildApprovedPlanSnapshot
};
