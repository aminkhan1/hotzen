/**
 * 🌐 Universal Agent Core Hub - User Plan Model & Engine Display
 * V1 Final Feature: Resolved Execution Model Display in User-Visible Plan
 *
 * Responsibilities:
 * 1. Resolve and format the execution engine/model for each planned agent role.
 * 2. LLM-based roles show actual resolved model identifiers and capability tier.
 * 3. Non-LLM/deterministic roles display "Deterministic" (never an invented model name).
 * 4. Recovery is clearly marked as conditional; when switching is OFF, displays selected model.
 * 5. When model switching is OFF, displays selected model, switching OFF status, and source.
 * 6. Unresolved models are displayed honestly as "Unresolved" without fabrication.
 * 7. Pure presentation layer: does NOT modify allocations, safety floor, routing, or provider calls.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { UNRESOLVED_TARGET } = require('./file_target_resolver');

function normalizePlanLocale(locale) {
  if (locale === undefined || locale === null) return 'en';
  if (locale === 'en' || locale === 'fa') return locale;
  throw new Error("Invalid --plan-locale value; expected 'en' or 'fa'.");
}

const PERSIAN_ROLE_NAMES = Object.freeze({
  planner: 'برنامه‌ریز',
  coder: 'پیاده‌ساز',
  tester: 'آزمون‌گر',
  critic: 'منتقد',
  recovery: 'بازیابی'
});

const PERSIAN_ROLE_VALUES = Object.freeze({
  'Provider default': 'پیش‌فرض Provider',
  'explicit Provider model': 'مدل صریح Provider',
  adaptive_routing: 'مسیریابی تطبیقی',
  recovery_escalation: 'افزایش توان در بازیابی',
  'only if recovery is required': 'فقط در صورت نیاز به بازیابی',
  'quota exhausted': 'سهمیه تمام‌شده',
  Strong: 'قوی',
  Lightweight: 'سبک',
  Balanced: 'متعادل',
  Low: 'کم',
  Medium: 'متوسط',
  High: 'زیاد',
  Unresolved: 'نامشخص'
});

function persianValue(value) {
  return PERSIAN_ROLE_VALUES[value] || value;
}

/**
 * Built-in fallback tier mappings for common models.
 */
const FALLBACK_TIER_MAP = Object.freeze({
  'haiku': 'Lightweight',
  'gpt-5.5': 'Lightweight',
  'gpt-5.6-luna': 'Lightweight',
  'sonnet': 'Strong',
  'sonnet[1m]': 'Strong',
  'opus': 'Strong',
  'best': 'Strong',
  'default': 'Strong',
  'gpt-5.6-sol': 'Strong',
  'gpt-6-astra': 'Strong',
  'gpt-6-sol': 'Strong',
  'gpt-6.1-sol': 'Strong',
  'fable': 'Balanced',
  'gpt-5.6-terra': 'Balanced',
  'gpt-6-luna': 'Balanced'
});

/**
 * Loads model profiles from .agents/model_profiles.json if present.
 * @returns {Record<string, object>}
 */
function loadModelProfiles() {
  const profilePath = path.join(__dirname, '..', '..', '.agents', 'model_profiles.json');
  try {
    if (fs.existsSync(profilePath)) {
      const data = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      return data.profiles || {};
    }
  } catch {}
  return {};
}

/**
 * Capitalizes a string (e.g. 'strong' -> 'Strong').
 * @param {string} str
 * @returns {string}
 */
function capitalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Resolves capability tier for a given model identifier.
 * @param {string | null} modelId
 * @param {Record<string, object>} [profiles]
 * @returns {string | null}
 */
function resolveModelTier(modelId, profiles) {
  if (!modelId || typeof modelId !== 'string') return null;

  const profs = profiles || loadModelProfiles();
  if (profs[modelId] && profs[modelId].capabilityTier) {
    return capitalize(profs[modelId].capabilityTier);
  }

  // Case-insensitive profile lookup
  const lower = modelId.toLowerCase();
  for (const [k, v] of Object.entries(profs)) {
    if (k.toLowerCase() === lower && v && v.capabilityTier) {
      return capitalize(v.capabilityTier);
    }
  }

  // Check fallback mapping
  if (FALLBACK_TIER_MAP[lower]) {
    return FALLBACK_TIER_MAP[lower];
  }

  return null;
}

/**
 * Builds the structured role execution descriptor for a single agent role.
 *
 * @param {object} params
 * @param {string} params.role Role name ('planner', 'coder', 'tester', 'critic', 'recovery')
 * @param {object} [params.roleConfig] Resolved execution config from allocator
 * @param {boolean} [params.isSwitchingEnabled=true] Whether model switching is ON
 * @param {string | null} [params.providerModel] Explicit Core-managed Provider model
 * @param {string | null} [params.selectedModel] Legacy switching-path model value
 * @param {string | null} [params.strongModel] Provider baseline strong model
 * @param {Record<string, object>} [params.profiles]
 * @returns {object} Structured role descriptor
 */
function resolveRoleExecution(params) {
  const {
    role,
    roleConfig,
    isSwitchingEnabled = true,
    providerModel = null,
    selectedModel = null,
    strongModel = null,
    profiles = null
  } = params;

  // 1. Deterministic / non-LLM roles: tester, critic
  if (role === 'tester' || role === 'critic') {
    const executionType = role === 'tester' ? 'deterministic_verification' : 'rule_based_critic';
    return Object.freeze({
      role,
      displayName: capitalize(role),
      executionType,
      isModelCall: false,
      model: null,
      reasoningEffort: null,
      requestedModel: null,
      actualModel: null,
      requestedReasoningEffort: null,
      actualReasoningEffort: null,
      execution: 'Deterministic',
      tier: null,
      switching: null,
      source: null,
      condition: null
    });
  }

  // 2. Recovery role
  if (role === 'recovery') {
    let resolvedModel = null;
    let source = null;

    if (!isSwitchingEnabled) {
      resolvedModel = (roleConfig && roleConfig.model) || providerModel || null;
      source = resolvedModel ? 'explicit Provider model' : 'Provider default';
    } else {
      // When switching is ON: planned recovery escalates to strong model
      resolvedModel = strongModel || (roleConfig && roleConfig.model) || null;
      source = 'recovery_escalation';
    }

    const tier = resolvedModel ? resolveModelTier(resolvedModel, profiles) : null;
    const reasoningEffort = (roleConfig && roleConfig.reasoningEffort) || null;

    return Object.freeze({
      role: 'recovery',
      displayName: 'Recovery',
      executionType: 'model_call',
      isModelCall: true,
      execution: 'llm',
      model: resolvedModel,
      reasoningEffort,
      requestedModel: resolvedModel,
      requestedReasoningEffort: reasoningEffort,
      tier: isSwitchingEnabled ? tier : null,
      switching: isSwitchingEnabled ? 'ON' : 'OFF',
      source: !isSwitchingEnabled ? (resolvedModel ? 'explicit Provider model' : 'Provider default') : source,
      condition: 'only if recovery is required'
    });
  }

  // 3. LLM roles: planner, coder
  let resolvedModel = null;
  let source = null;

  if (!isSwitchingEnabled) {
    if (roleConfig && ['unavailable', 'insufficient_capability'].includes(roleConfig.status)) {
      resolvedModel = null;
    } else if (roleConfig && ['allocated', 'passthrough'].includes(roleConfig.status) && roleConfig.model) {
      resolvedModel = roleConfig.model;
    } else {
      resolvedModel = (roleConfig && roleConfig.model) || providerModel || null;
    }
    source = resolvedModel ? 'explicit Provider model' : 'Provider default';
  } else {
    resolvedModel = (roleConfig && (roleConfig.fallbackModel || roleConfig.model)) || null;
    source = (roleConfig && roleConfig.source) || 'adaptive_routing';
  }

  const tier = resolvedModel ? resolveModelTier(resolvedModel, profiles) : null;
  const reasoningEffort = (roleConfig && roleConfig.reasoningEffort) || null;
  const fallbackModel = (roleConfig && roleConfig.fallbackModel) || null;
  const originallyResolvedModel = (roleConfig && roleConfig.originallyResolvedModel) || null;
  const availability = (roleConfig && roleConfig.availability)
    || (roleConfig && (roleConfig.rejectionReason === 'MODEL_QUOTA_EXHAUSTED' || roleConfig.fallbackReason === 'quota_fallback') ? 'quota exhausted' : null);
  const fallbackReason = (roleConfig && roleConfig.fallbackReason) || null;
  const contextHealth = (roleConfig && roleConfig.contextHealth) || null;
  const contextMeasurement = (roleConfig && roleConfig.contextMeasurement) || null;

  return Object.freeze({
    role,
    displayName: capitalize(role),
    executionType: 'model_call',
    isModelCall: true,
    execution: 'llm',
    model: resolvedModel,
    reasoningEffort,
    requestedModel: resolvedModel,
    requestedReasoningEffort: reasoningEffort,
    tier: isSwitchingEnabled ? tier : null,
    switching: isSwitchingEnabled ? 'ON' : 'OFF',
    source,
    condition: null,
    fallbackModel,
    originallyResolvedModel,
    availability,
    fallbackReason,
    contextHealth,
    contextMeasurement
  });
}

/**
 * Builds the complete structured Agent Execution Plan across all canonical roles.
 *
 * @param {object} options
 * @param {object} [options.planAllocations] PlanAllocationResult from ModelAllocator
 * @param {object} [options.plannerConfig] Resolved execution config for Planner
 * @param {object} [options.coderConfig] Resolved execution config for Coder
 * @param {string | null} [options.strongModel] Provider baseline strong model
 * @param {string | null} [options.providerModel] Explicit Core-managed Provider model
 * @param {string | null} [options.selectedModel] Legacy switching-path model value
 * @param {boolean} [options.modelSwitchingEnabled=true] Runtime model switching state
 * @param {object} [options.catalog] Provider catalog
 * @param {Record<string, object>} [options.profiles]
 * @returns {object} Structured agent execution plan
 */
function buildAgentExecutionPlan(options = {}) {
  if (options.executionKind === 'native') {
    return { executionKind: options.executionKind, nativeHost: options.nativeHost, modelSwitchingEnabled: false, roles: {},
      coder: 'external_unverified', tester: 'deterministic', critic: 'deterministic', recovery: 'not_executed' };
  }

  const {
    planAllocations = null,
    plannerConfig = null,
    coderConfig = null,
    strongModel = null,
    providerModel = null,
    selectedModel = null,
    modelSwitchingEnabled = true,
    profiles = null
  } = options;

  const allocations = (planAllocations && planAllocations.allocations) || {};
  const activeProfiles = profiles || loadModelProfiles();

  // Resolve planner role config:
  // If plannerConfig has live execution evidence (actualModel, fallbackApplied, escalatedFrom), respect it.
  // Otherwise, prioritize the authoritative allocation from ModelAllocator over static/unallocated configs.
  const hasLivePlannerEvidence = plannerConfig && (
    plannerConfig.fallbackApplied ||
    plannerConfig.escalatedFrom ||
    plannerConfig.actualModel ||
    plannerConfig.isModelCall ||
    plannerConfig.isExecuted ||
    plannerConfig.executed
  );
  const effectivePlannerConfig = hasLivePlannerEvidence
    ? plannerConfig
    : ((allocations && allocations.planner && allocations.planner.status === 'allocated')
        ? allocations.planner
        : (plannerConfig || allocations.planner || null));

  // Resolve coder role config
  const effectiveCoderConfig = coderConfig || allocations.coder || null;

  const roles = {
    planner: resolveRoleExecution({
      role: 'planner',
      roleConfig: effectivePlannerConfig,
      isSwitchingEnabled: modelSwitchingEnabled,
      providerModel,
      selectedModel,
      strongModel,
      profiles: activeProfiles
    }),
    coder: resolveRoleExecution({
      role: 'coder',
      roleConfig: effectiveCoderConfig,
      isSwitchingEnabled: modelSwitchingEnabled,
      providerModel,
      selectedModel,
      strongModel,
      profiles: activeProfiles
    }),
    tester: resolveRoleExecution({
      role: 'tester',
      roleConfig: allocations.tester || null,
      isSwitchingEnabled: modelSwitchingEnabled,
      providerModel,
      selectedModel,
      strongModel,
      profiles: activeProfiles
    }),
    critic: resolveRoleExecution({
      role: 'critic',
      roleConfig: allocations.critic || null,
      isSwitchingEnabled: modelSwitchingEnabled,
      providerModel,
      selectedModel,
      strongModel,
      profiles: activeProfiles
    }),
    recovery: resolveRoleExecution({
      role: 'recovery',
      roleConfig: allocations.recovery || null,
      isSwitchingEnabled: modelSwitchingEnabled,
      providerModel,
      selectedModel,
      strongModel,
      profiles: activeProfiles
    })
  };

  return Object.freeze({
    modelSwitchingEnabled,
    roles
  });
}

/**
 * Formats a single role execution descriptor as user-visible lines.
 *
 * @param {object} roleDesc
 * @returns {string} Formatted role block
 */
function formatPersianRoleBlock(roleDesc) {
  const lines = [PERSIAN_ROLE_NAMES[roleDesc.role] || roleDesc.displayName || roleDesc.role];
  if (roleDesc.execution === 'Deterministic') {
    lines.push('- اجرا: قطعی');
    return lines.join('\n');
  }

  if (roleDesc.fallbackModel) {
    lines.push(`- مدل درخواست‌شده/تعیین‌شده: ${roleDesc.originallyResolvedModel || roleDesc.model}`);
    if (roleDesc.availability) lines.push(`- دسترسی: ${persianValue(roleDesc.availability)}`);
    lines.push(`- مدل جایگزین: ${roleDesc.fallbackModel}`);
    if (roleDesc.fallbackReason) lines.push(`- دلیل: ${persianValue(roleDesc.fallbackReason)}`);
    if (roleDesc.tier && roleDesc.fallbackModel !== 'Unresolved') lines.push(`- رده: ${persianValue(roleDesc.tier)}`);
  } else {
    if (roleDesc.switching === 'ON') {
      lines.push(`- مدل: ${roleDesc.model || 'نامشخص'}`);
    } else {
      lines.push(roleDesc.model
        ? `- مدل Provider: ${roleDesc.model}`
        : '- مدل Provider: مشخص نشده؛ پیش‌فرض Adapter/Provider');
    }
    if (roleDesc.tier && roleDesc.model !== 'Unresolved') lines.push(`- رده: ${persianValue(roleDesc.tier)}`);
  }

  if (roleDesc.contextHealth && roleDesc.contextHealth !== 'OK') {
    lines.push(`- وضعیت Context: ${roleDesc.contextHealth}`);
    if (roleDesc.contextMeasurement) lines.push(`- اندازه‌گیری Context: ${roleDesc.contextMeasurement}`);
  }
  if (roleDesc.switching === 'OFF') {
    lines.push('- تغییر مدل: خاموش');
    if (roleDesc.source) lines.push(`- منبع: ${persianValue(roleDesc.source)}`);
  }
  if (roleDesc.condition) lines.push(`- شرط: ${persianValue(roleDesc.condition)}`);
  return lines.join('\n');
}

function formatRoleBlock(roleDesc, options = {}) {
  if (!roleDesc || typeof roleDesc !== 'object') return '';
  if (normalizePlanLocale(options.planLocale) === 'fa') return formatPersianRoleBlock(roleDesc);

  const lines = [roleDesc.displayName || capitalize(roleDesc.role)];

  if (roleDesc.execution === 'Deterministic') {
    lines.push('- Execution: Deterministic');
    return lines.join('\n');
  }

  // LLM Role
  if (roleDesc.fallbackModel) {
    lines.push(`- Requested/Resolved Model: ${roleDesc.originallyResolvedModel || roleDesc.model}`);
    if (roleDesc.availability) {
      lines.push(`- Availability: ${roleDesc.availability}`);
    }
    lines.push(`- Fallback Model: ${roleDesc.fallbackModel}`);
    if (roleDesc.fallbackReason) {
      lines.push(`- Reason: ${roleDesc.fallbackReason}`);
    }
    if (roleDesc.tier && roleDesc.fallbackModel !== 'Unresolved') {
      lines.push(`- Tier: ${roleDesc.tier}`);
    }
  } else {
    if (roleDesc.switching === 'ON') {
      lines.push(`- Model: ${roleDesc.model || 'Unresolved'}`);
    } else {
      lines.push(roleDesc.model
        ? `- Provider Model: ${roleDesc.model}`
        : '- Provider Model: omitted; Adapter/Provider default');
    }
    if (roleDesc.tier && roleDesc.model !== 'Unresolved') {
      lines.push(`- Tier: ${roleDesc.tier}`);
    }
  }

  // Context Health (displayed only when not OK or when explicitly tracked)
  if (roleDesc.contextHealth && roleDesc.contextHealth !== 'OK') {
    lines.push(`- Context Health: ${roleDesc.contextHealth}`);
    if (roleDesc.contextMeasurement) {
      lines.push(`- Context Measurement: ${roleDesc.contextMeasurement}`);
    }
  }

  // When switching is OFF, display explicit switching status and source
  if (roleDesc.switching === 'OFF') {
    lines.push('- Model Switching: OFF');
    if (roleDesc.source) {
      lines.push(`- Source: ${roleDesc.source}`);
    }
  }

  // Conditional note for Recovery
  if (roleDesc.condition) {
    lines.push(`- Condition: ${roleDesc.condition}`);
  }

  return lines.join('\n');
}

/**
 * Formats the entire Agent Execution Plan into the standard user-visible representation.
 *
 * @param {object} agentExecutionPlan
 * @returns {string} Formatted multi-role execution plan text
 */
function renderAgentExecutionPlan(agentExecutionPlan, options = {}) {
  if (agentExecutionPlan && agentExecutionPlan.executionKind === 'native') {
    return `Native host: ${agentExecutionPlan.nativeHost} (declared, not authenticated)\n` +
      'Planner: deterministic; Coder: external_unverified; Tester: deterministic; Critic: deterministic; Recovery: not_executed\n' +
      'Provider: none; Model allocation: none; Native write tools: not_controlled';
  }
  if (!agentExecutionPlan || !agentExecutionPlan.roles) {
    return '';
  }

  const roleOrder = ['planner', 'coder', 'tester', 'critic', 'recovery'];
  const blocks = [];

  for (const role of roleOrder) {
    const desc = agentExecutionPlan.roles[role];
    if (desc) {
      blocks.push(formatRoleBlock(desc, options));
    }
  }

  return blocks.join('\n\n');
}

/**
 * Renders the full user-visible plan incorporating task requirements,
 * acceptance criteria, and the resolved Agent Execution Plan.
 *
 * @param {object} plan Parsed or raw plan object
 * @param {object} [options]
 * @param {object} [options.agentExecutionPlan] Pre-built agent execution plan
 * @param {boolean} [options.executionOnly=false] Render only the Agent Execution Plan
 * @returns {string} Formatted user-visible plan markdown
 */
function renderUserPlan(plan, options = {}) {
  const planLocale = normalizePlanLocale(options.planLocale);
  // If plan is already an agentExecutionPlan (or executionOnly requested)
  if (options.executionOnly || (plan && plan.roles && plan.modelSwitchingEnabled !== undefined)) {
    const execPlan = (plan && plan.roles) ? plan : options.agentExecutionPlan;
    return renderAgentExecutionPlan(execPlan, { planLocale });
  }

  const execPlan = options.agentExecutionPlan || (plan && plan.agentExecutionPlan) || null;
  const execPlanText = execPlan ? renderAgentExecutionPlan(execPlan, { planLocale }) : '';

  const safePlan = (plan && typeof plan === 'object') ? plan : {};
  const goal = safePlan.goal || 'Execute Implementation Plan';
  const riskTier = safePlan.riskTier ? capitalize(safePlan.riskTier) : 'Low';
  const affectedLayers = Array.isArray(safePlan.affectedLayers) ? safePlan.affectedLayers.join(', ') : 'application';
  let filesToModifyText = UNRESOLVED_TARGET;
  if (Array.isArray(safePlan.filesToModify) && safePlan.filesToModify.length > 0) {
    const validFiles = safePlan.filesToModify.filter(f => typeof f === 'string' && f.trim());
    if (validFiles.length > 0) {
      filesToModifyText = validFiles.join(', ');
    }
  } else if (typeof safePlan.filesToModify === 'string' && safePlan.filesToModify.trim()) {
    filesToModifyText = safePlan.filesToModify.trim();
  }

  const acceptanceCriteria = Array.isArray(safePlan.acceptanceCriteria) ? safePlan.acceptanceCriteria : [];

  const sections = [];

  sections.push(planLocale === 'fa' ? `# طرح پیاده‌سازی: ${goal}` : `# Implementation Plan: ${goal}`);
  if (safePlan.managedExecutionPolicy === 'checkpoint_after_implementation') {
    sections.push('Managed execution stops after artifact application and awaits separate verification approval.');
  }
  if (safePlan.historyTitle) {
    sections.push(planLocale === 'fa'
      ? `- عنوان اختیاری تاریخچه (پس از Approval در SQLite ثبت می‌شود؛ محرمانه نباشد): ${safePlan.historyTitle}`
      : `- Optional history title (recorded in SQLite after approval; do not include secrets): ${safePlan.historyTitle}`);
  }
  const metaLines = [
    planLocale === 'fa' ? `- سطح ریسک: ${persianValue(riskTier)}` : `- Risk Tier: ${riskTier}`,
    planLocale === 'fa' ? `- لایه‌های درگیر: ${affectedLayers}` : `- Affected Layers: ${affectedLayers}`,
    planLocale === 'fa' ? `- فایل‌های قابل تغییر: ${filesToModifyText}` : `- Files to Modify: ${filesToModifyText}`
  ];

  const languages = options.languages || safePlan.languages || options.activeLanguages || null;
  if (languages) {
    const langList = (Array.isArray(languages) ? languages : [languages]).filter(Boolean);
    if (langList.length > 0) {
      metaLines.push(planLocale === 'fa'
        ? `- زبان‌های برنامه‌نویسی فعال: ${langList.join(', ')}`
        : `- Active Languages: ${langList.join(', ')}`);
    }
  }

  sections.push(metaLines.join('\n'));

  if (acceptanceCriteria.length > 0) {
    const acLines = acceptanceCriteria.map(ac => `- ${ac}`).join('\n');
    sections.push(`${planLocale === 'fa' ? '## معیارهای پذیرش' : '## Acceptance Criteria'}\n${acLines}`);
  }

  if (Array.isArray(safePlan.reportingRequirements) && safePlan.reportingRequirements.includes('criterion_matrix_v1')) {
    sections.push(planLocale === 'fa'
      ? '## الزام گزارش نهایی\n- برای هر معیار پذیرش یک ردیف با وضعیت و ارجاع شواهد Critic درج شود. وضعیت‌ها و ارجاع‌ها باید عیناً با خروجی Critic تطبیق کنند؛ گزارش‌ساز شاهد یا تأیید تازه ایجاد نمی‌کند. گزارش ناقص تحویل موفق نیست.'
      : '## Final Reporting Requirement\n- Include one row per acceptance criterion with Critic status and evidence references. Statuses and references must match the original Critic output; the report generator creates no evidence or confirmation. An incomplete report is not successful delivery.');
  }

  const semanticReview = safePlan.semanticCriticReview;
  if (semanticReview && semanticReview.requested === true) {
    const allocation = semanticReview.allocation || {};
    sections.push(planLocale === 'fa'
      ? `## بازبینی معنایی اختیاری\n- نقش: Critic مدل‌محور با Codex Adapter در حالت read-only\n- مدل: ${allocation.model || 'پیش‌فرض Codex؛ هنگام Plan آفلاین حل‌نشده'}\n- سقف کل Provider Call مصوب: ${semanticReview.maxProviderCalls}\n- حداکثر یک فراخوانی Critic در هر دور؛ هزینهٔ واقعی تا زمان پاسخ Provider نامعلوم است.`
      : `## Optional Semantic Review\n- Role: model-based Critic through the Codex Adapter in read-only mode\n- Model: ${allocation.model || 'Codex provider default; unresolved during offline planning'}\n- Approved total Provider-call ceiling: ${semanticReview.maxProviderCalls}\n- At most one Critic call per review round; actual monetary cost is unknown until returned by the Provider.`);
  } else {
    sections.push(planLocale === 'fa'
      ? '## بازبینی معنایی: درخواست‌نشده (بدون فراخوانی Provider)'
      : '## Semantic Review: NOT_REQUESTED (no Provider call)');
  }

  if (safePlan.verificationContract) {
    const contract = safePlan.verificationContract;
    const statusName = (status) => planLocale === 'fa'
      ? ({ available: 'موجود', missing: 'ناموجود', unavailable: 'غیرقابل‌بررسی' }[status] || status)
      : status;
    const reasonText = (reason) => planLocale === 'fa' && reason === 'No test directory or approved test file'
      ? 'پوشهٔ test یا فایل تست مصوب وجود ندارد'
      : reason;
    const lines = [
      planLocale === 'fa' ? `- Stack: ${contract.stack}` : `- Stack: ${contract.stack}`,
      planLocale === 'fa' ? `- وضعیت: ${contract.status === 'ready' ? 'آماده' : 'مسدود'}` : `- Status: ${contract.status}`
    ];
    if (contract.fileStates) {
      for (const op of contract.fileStates.operations) {
        lines.push(op.type === 'delete' ? `- delete: ${op.path}` : `- move: ${op.from} -> ${op.to}`);
      }
      for (const entry of contract.fileStates.entries) {
        lines.push(`- ${entry.file}: ${entry.initial.state}${entry.initial.digest ? ` (SHA-256: ${entry.initial.digest})` : ''} -> ${entry.expectedState}`);
      }
    }
    for (const check of contract.checks || []) {
      if (!check.required) {
        lines.push(planLocale === 'fa'
          ? `- نامربوط: ${check.cmd} — ${reasonText(check.reason)}`
          : `- Not applicable: ${check.cmd} — ${check.reason}`);
      } else {
        lines.push(planLocale === 'fa'
          ? `- ضروری (${statusName(check.tool.status)}): ${check.cmd}${check.tool.path ? ` — ${check.tool.path}` : ''}${check.tool.reason ? ` — ${check.tool.reason}` : ''}`
          : `- Required (${check.tool.status}): ${check.cmd}${check.tool.path ? ` — ${check.tool.path}` : ''}${check.tool.reason ? ` — ${check.tool.reason}` : ''}`);
      }
    }
    for (const reason of contract.blockingReasons || []) {
      lines.push(planLocale === 'fa' ? `- علت توقف: ${reason}` : `- Blocked: ${reason}`);
    }
    sections.push(`${planLocale === 'fa' ? '## قرارداد بررسی' : '## Verification Contract'}\n${lines.join('\n')}`);
  }

  if (safePlan.modelRecommendation) {
    sections.push(planLocale === 'fa'
      ? `## پیشنهاد اطلاع‌رسانی مدل\n- مدل پیشنهادی: ${safePlan.modelRecommendation.model}\n- دسترسی مدل بررسی نشده و این پیشنهاد، تخصیص اجرایی نیست.`
      : `## Advisory Model Recommendation\n- Suggested: ${safePlan.modelRecommendation.model}\n- Advisory only; availability is not verified and this is not an execution assignment.`);
  }

  if (execPlanText) {
    sections.push(`${planLocale === 'fa' ? '## طرح اجرای نقش‌ها' : '## Agent Execution Plan'}\n\n${execPlanText}`);
  }

  return sections.join('\n\n');
}

/**
 * Formats the complete user-visible plan with the standard approval prompt banner.
 *
 * @param {string} planText User-visible plan markdown/text
 * @returns {string} Banner-wrapped approval prompt text
 */
function formatPlanApprovalPrompt(planText, options = {}) {
  const planLocale = normalizePlanLocale(options.planLocale);
  const divider = '='.repeat(50);
  const cleanPlan = (planText || '').trim();
  return [
    divider,
    planLocale === 'fa' ? 'طرح' : 'PLAN',
    divider,
    '',
    cleanPlan,
    '',
    divider,
    '',
    planLocale === 'fa' ? 'آیا این طرح را تأیید می‌کنید؟' : 'Proceed with this plan?',
    '',
    planLocale === 'fa' ? '[Y] تأیید' : '[Y] Approve',
    planLocale === 'fa' ? '[N] رد' : '[N] Reject',
    planLocale === 'fa' ? '[C] لغو' : '[C] Cancel'
  ].join('\n');
}

module.exports = {
  normalizePlanLocale,
  FALLBACK_TIER_MAP,
  loadModelProfiles,
  resolveModelTier,
  resolveRoleExecution,
  buildAgentExecutionPlan,
  formatRoleBlock,
  renderAgentExecutionPlan,
  renderUserPlan,
  formatPlanApprovalPrompt
};
