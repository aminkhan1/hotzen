/**
 * 🌐 Universal Agent Core Hub - Planner Metadata Lifecycle & Normalization Engine
 * Phase 5.9 Implementation: TASK-5.9.1
 *
 * Responsibilities:
 * 1. Closed 11-Layer Canonical Ontology & Deterministic Alias Normalization.
 * 2. 5-Stage Validity Lifecycle:
 *    [present] ➔ [structurally_valid] ➔ [normalized] ➔ [internally_consistent] ➔ [sufficient_for_fast_path]
 * 3. Structured Contradiction Detection.
 *
 * Invariants (Phase 5.8 Revision 3):
 * - ZERO natural-language text inspection (no regex, no keyword scanning, no multilingual dictionaries).
 * - Reasons strictly over normalized structured metadata.
 * - Unknown layers strictly normalize to 'unknown' and disqualify low-risk fast-path sufficiency.
 * - Empty layers array [] fails positive evidence requirements.
 * - Criticality is monotonic: mixed arrays (e.g. presentation + auth) preserve every layer and flag hasCritical = true.
 * - In this task, 'sufficient_for_fast_path' represents metadata quality/sufficiency only.
 *   It does NOT make the actual model allocation or routing dispatch (owned by TASK-5.9.3 / TASK-5.9.5).
 */

'use strict';

const {
  normalizeRiskTier,
  normalizeChangeType
} = require('./deterministic_fallback_brain');

/**
 * Closed 11-Layer Canonical Ontology
 */
const CANONICAL_LAYERS = Object.freeze([
  'presentation',
  'documentation',
  'testing',
  'application',
  'infrastructure',
  'domain',
  'data',
  'authentication',
  'financial',
  'core',
  'unknown'
]);

/**
 * Recognized non-critical layers eligible for Fast Path A
 */
const NON_CRITICAL_LAYERS = Object.freeze(new Set([
  'presentation',
  'documentation',
  'testing'
]));

/**
 * Standard application and infrastructure layers
 */
const STANDARD_LAYERS = Object.freeze(new Set([
  'application',
  'infrastructure'
]));

/**
 * Critical architectural layers
 */
const CRITICAL_LAYERS = Object.freeze(new Set([
  'domain',
  'data',
  'authentication',
  'financial',
  'core'
]));

/**
 * Validity lifecycle stages
 */
const LIFECYCLE_STAGES = Object.freeze([
  'none',
  'present',
  'structurally_valid',
  'normalized',
  'internally_consistent',
  'sufficient_for_fast_path'
]);

/**
 * Deterministic alias dictionary mapping legacy, shorthand, and framework terms
 * to canonical layer identifiers.
 */
const LAYER_ALIASES = Object.freeze({
  // presentation (Section 4.1: ui, frontend, css, view, views, styling, html, widget)
  presentation: 'presentation',
  ui: 'presentation',
  frontend: 'presentation',
  css: 'presentation',
  view: 'presentation',
  views: 'presentation',
  styling: 'presentation',
  html: 'presentation',
  widget: 'presentation',

  // documentation (Section 4.1: docs, doc, readme, markdown, documentation)
  documentation: 'documentation',
  docs: 'documentation',
  doc: 'documentation',
  readme: 'documentation',
  markdown: 'documentation',

  // testing (Section 4.1: test, tests, testing, spec, specs, mock, fixtures)
  testing: 'testing',
  test: 'testing',
  tests: 'testing',
  spec: 'testing',
  specs: 'testing',
  mock: 'testing',
  fixtures: 'testing',

  // application (Section 4.1: app, application, controller, handlers, api, endpoints, viewmodel)
  application: 'application',
  app: 'application',
  controller: 'application',
  handlers: 'application',
  api: 'application',
  endpoints: 'application',
  viewmodel: 'application',

  // infrastructure (Section 4.1: infra, infrastructure, docker, k8s, network, cache, redis, ci)
  infrastructure: 'infrastructure',
  infra: 'infrastructure',
  docker: 'infrastructure',
  k8s: 'infrastructure',
  network: 'infrastructure',
  cache: 'infrastructure',
  redis: 'infrastructure',
  ci: 'infrastructure',

  // domain (Section 4.1: domain, business, entity, entities, usecase, spi)
  domain: 'domain',
  business: 'domain',
  entity: 'domain',
  entities: 'domain',
  usecase: 'domain',
  spi: 'domain',

  // data (Section 4.1: data, db, database, sql, orm, repository, repositories, migration)
  data: 'data',
  db: 'data',
  database: 'data',
  sql: 'data',
  orm: 'data',
  repository: 'data',
  repositories: 'data',
  migration: 'data',

  // authentication (Section 4.1: auth, authentication, security, session, crypto, rbac, secret, vault)
  authentication: 'authentication',
  auth: 'authentication',
  security: 'authentication',
  session: 'authentication',
  crypto: 'authentication',
  rbac: 'authentication',
  secret: 'authentication',
  vault: 'authentication',

  // financial (Section 4.1: payment, payments, billing, financial, finance, ledger, wallet, escrow, tax)
  financial: 'financial',
  payment: 'financial',
  payments: 'financial',
  billing: 'financial',
  finance: 'financial',
  ledger: 'financial',
  wallet: 'financial',
  escrow: 'financial',
  tax: 'financial',

  // core (Section 4.1: core, kernel, engine, governance)
  core: 'core',
  kernel: 'core',
  engine: 'core',
  governance: 'core'
});

/**
 * Normalizes an individual layer string to its canonical enum or 'unknown'.
 * Pure function: deterministic, zero side-effects.
 *
 * @param {unknown} rawLayer
 * @returns {string} One of CANONICAL_LAYERS
 */
function normalizeLayer(rawLayer) {
  if (typeof rawLayer !== 'string') {
    return 'unknown';
  }
  const cleaned = rawLayer.toLowerCase().trim();
  if (!cleaned) {
    return 'unknown';
  }
  return LAYER_ALIASES[cleaned] || 'unknown';
}

/**
 * Normalizes an array of layer strings into a deduplicated, deterministically ordered
 * array of canonical layer enums with safety classification flags.
 *
 * Invariants:
 * - Empty array [] produces isEmpty = true.
 * - Malformed array (non-array, primitives, or non-string elements) produces isMalformed = true and contains 'unknown'.
 * - Mixed critical and non-critical layers preserve every canonical layer and set hasCritical = true.
 * - Deduplication is deterministic and order is stably aligned with CANONICAL_LAYERS index.
 *
 * @param {unknown} rawLayers
 * @returns {{
 *   canonicalLayers: string[],
 *   hasCritical: boolean,
 *   hasUnknown: boolean,
 *   isEmpty: boolean,
 *   isMalformed: boolean
 * }}
 */
function normalizeAffectedLayers(rawLayers) {
  if (rawLayers === null || rawLayers === undefined) {
    return {
      canonicalLayers: [],
      hasCritical: false,
      hasUnknown: false,
      isEmpty: true,
      isMalformed: false
    };
  }

  if (!Array.isArray(rawLayers)) {
    return {
      canonicalLayers: ['unknown'],
      hasCritical: false,
      hasUnknown: true,
      isEmpty: false,
      isMalformed: true
    };
  }

  if (rawLayers.length === 0) {
    return {
      canonicalLayers: [],
      hasCritical: false,
      hasUnknown: false,
      isEmpty: true,
      isMalformed: false
    };
  }

  let isMalformed = false;
  const normalizedSet = new Set();

  for (const item of rawLayers) {
    if (typeof item !== 'string') {
      isMalformed = true;
      normalizedSet.add('unknown');
    } else {
      const canonical = normalizeLayer(item);
      normalizedSet.add(canonical);
    }
  }

  // Stable deterministic sorting according to CANONICAL_LAYERS index
  const canonicalLayers = Array.from(normalizedSet).sort((a, b) => {
    const idxA = CANONICAL_LAYERS.indexOf(a);
    const idxB = CANONICAL_LAYERS.indexOf(b);
    return idxA - idxB;
  });

  const hasCritical = canonicalLayers.some(l => CRITICAL_LAYERS.has(l));
  const hasUnknown = canonicalLayers.includes('unknown');

  return {
    canonicalLayers,
    hasCritical,
    hasUnknown,
    isEmpty: false,
    isMalformed
  };
}

/**
 * Validates Planner metadata against the frozen 5-Stage Validity Lifecycle:
 * [present] ➔ [structurally_valid] ➔ [normalized] ➔ [internally_consistent] ➔ [sufficient_for_fast_path]
 *
 * Reasons strictly over structured fields:
 * - changeType (integer 1..5)
 * - riskTier ('low' | 'medium' | 'high')
 * - affectedLayers (string[])
 * - securitySensitive / isSecuritySensitive (boolean)
 * - affectsCriticalPath (boolean)
 * - filesToModifyCount (number >= 0)
 *
 * @param {object} input
 * @returns {{
 *   present: boolean,
 *   structurallyValid: boolean,
 *   normalized: boolean,
 *   internallyConsistent: boolean,
 *   sufficientForFastPath: boolean,
 *   stageReached: 'none' | 'present' | 'structurally_valid' | 'normalized' | 'internally_consistent' | 'sufficient_for_fast_path',
 *   data: {
 *     changeType: number | null,
 *     riskTier: 'low' | 'medium' | 'high' | null,
 *     canonicalLayers: string[],
 *     securitySensitive: boolean,
 *     affectsCriticalPath: boolean,
 *     filesToModifyCount: number | null,
 *     assignedRoles: string[]
 *   },
 *   layers: {
 *     canonicalLayers: string[],
 *     hasCritical: boolean,
 *     hasUnknown: boolean,
 *     isEmpty: boolean,
 *     isMalformed: boolean
 *   },
 *   contradictions: string[],
 *   insufficientReasons: string[],
 *   structuralErrors: string[]
 * }}
 */
function validatePlanMetadataLifecycle(input) {
  const inputObj = (input && typeof input === 'object' && !Array.isArray(input)) ? input : null;

  let meta = null;
  let isExplicitlyPresent = false;

  if (inputObj) {
    if (inputObj.planMetadata !== undefined) {
      isExplicitlyPresent = true;
      if (inputObj.planMetadata && typeof inputObj.planMetadata === 'object' && !Array.isArray(inputObj.planMetadata)) {
        meta = inputObj.planMetadata;
      }
    } else if (
      inputObj.changeType !== undefined ||
      inputObj.riskTier !== undefined ||
      inputObj.affectedLayers !== undefined ||
      inputObj.securitySensitive !== undefined ||
      inputObj.affectsCriticalPath !== undefined
    ) {
      isExplicitlyPresent = true;
      meta = inputObj;
    }
  }

  // Stage 1: present
  const present = isExplicitlyPresent && meta !== null && typeof meta === 'object' && !Array.isArray(meta);

  if (!present) {
    return Object.freeze({
      present: false,
      structurallyValid: false,
      normalized: false,
      internallyConsistent: false,
      sufficientForFastPath: false,
      stageReached: 'none',
      data: Object.freeze({
        changeType: null,
        riskTier: null,
        canonicalLayers: Object.freeze([]),
        securitySensitive: false,
        affectsCriticalPath: false,
        filesToModifyCount: null,
        assignedRoles: Object.freeze([])
      }),
      layers: Object.freeze({
        canonicalLayers: Object.freeze([]),
        hasCritical: false,
        hasUnknown: false,
        isEmpty: true,
        isMalformed: false
      }),
      contradictions: Object.freeze([]),
      insufficientReasons: Object.freeze(['missing_plan_metadata']),
      structuralErrors: Object.freeze(['metadata_object_not_present'])
    });
  }

  // Stage 2: structurally_valid
  const structuralErrors = [];

  // Check changeType
  if (meta.changeType !== undefined && meta.changeType !== null) {
    const parsedType = normalizeChangeType(meta.changeType);
    if (parsedType === null) {
      structuralErrors.push('invalid_change_type');
    }
  }

  // Check riskTier
  if (meta.riskTier !== undefined && meta.riskTier !== null) {
    const parsedTier = normalizeRiskTier(meta.riskTier);
    if (parsedTier === null) {
      structuralErrors.push('invalid_risk_tier');
    }
  }

  // Check affectedLayers
  if (meta.affectedLayers !== undefined && meta.affectedLayers !== null) {
    if (!Array.isArray(meta.affectedLayers)) {
      structuralErrors.push('malformed_affected_layers_not_array');
    } else if (meta.affectedLayers.some(x => typeof x !== 'string')) {
      structuralErrors.push('malformed_affected_layers_contains_non_string');
    }
  }

  // Check boolean flags
  if (meta.securitySensitive !== undefined && meta.securitySensitive !== null) {
    if (typeof meta.securitySensitive !== 'boolean') {
      structuralErrors.push('invalid_security_sensitive_flag_not_boolean');
    }
  }

  if (meta.isSecuritySensitive !== undefined && meta.isSecuritySensitive !== null) {
    if (typeof meta.isSecuritySensitive !== 'boolean') {
      structuralErrors.push('invalid_is_security_sensitive_flag_not_boolean');
    }
  }

  if (meta.affectsCriticalPath !== undefined && meta.affectsCriticalPath !== null) {
    if (typeof meta.affectsCriticalPath !== 'boolean') {
      structuralErrors.push('invalid_affects_critical_path_flag_not_boolean');
    }
  }

  // Check filesToModifyCount
  if (meta.filesToModifyCount !== undefined && meta.filesToModifyCount !== null) {
    if (typeof meta.filesToModifyCount !== 'number' || !Number.isInteger(meta.filesToModifyCount) || meta.filesToModifyCount < 0) {
      structuralErrors.push('invalid_files_to_modify_count');
    }
  }

  const structurallyValid = structuralErrors.length === 0;

  if (!structurallyValid) {
    return Object.freeze({
      present: true,
      structurallyValid: false,
      normalized: false,
      internallyConsistent: false,
      sufficientForFastPath: false,
      stageReached: 'present',
      data: Object.freeze({
        changeType: null,
        riskTier: null,
        canonicalLayers: Object.freeze(['unknown']),
        securitySensitive: false,
        affectsCriticalPath: false,
        filesToModifyCount: null,
        assignedRoles: Object.freeze([])
      }),
      layers: Object.freeze({
        canonicalLayers: Object.freeze(['unknown']),
        hasCritical: false,
        hasUnknown: true,
        isEmpty: false,
        isMalformed: true
      }),
      contradictions: Object.freeze([]),
      insufficientReasons: Object.freeze(['structural_validation_failed', ...structuralErrors]),
      structuralErrors: Object.freeze(structuralErrors)
    });
  }

  // Stage 3: normalized
  const changeType = normalizeChangeType(meta.changeType);
  const riskTier = normalizeRiskTier(meta.riskTier);
  const layers = normalizeAffectedLayers(meta.affectedLayers);
  const securitySensitive = meta.securitySensitive === true || meta.isSecuritySensitive === true;
  const affectsCriticalPath = meta.affectsCriticalPath === true;
  const filesToModifyCount = (typeof meta.filesToModifyCount === 'number') ? meta.filesToModifyCount : null;

  let assignedRoles = [];
  if (Array.isArray(meta.assignedRoles)) {
    assignedRoles = Array.from(new Set(
      meta.assignedRoles
        .filter(r => typeof r === 'string' && r.trim().length > 0)
        .map(r => r.trim().toLowerCase())
    ));
  }

  // Stage 4: internally_consistent
  const contradictions = [];

  if (changeType === 1 && affectsCriticalPath === true) {
    contradictions.push('change_type_1_affects_critical_path');
  }

  if (riskTier === 'low' && securitySensitive === true) {
    contradictions.push('low_risk_marked_security_sensitive');
  }

  if (changeType === 1 && layers.hasCritical) {
    contradictions.push('change_type_1_touches_critical_layer');
  }

  if (riskTier === 'low' && layers.hasCritical) {
    contradictions.push('low_risk_touches_critical_layer');
  }

  if (changeType === 1 && riskTier === 'high') {
    contradictions.push('change_type_1_marked_high_risk');
  }

  if (changeType !== null && changeType >= 4 && riskTier === 'low') {
    contradictions.push('major_change_type_marked_low_risk');
  }

  const internallyConsistent = contradictions.length === 0;

  if (!internallyConsistent) {
    return Object.freeze({
      present: true,
      structurallyValid: true,
      normalized: true,
      internallyConsistent: false,
      sufficientForFastPath: false,
      stageReached: 'normalized',
      data: Object.freeze({
        changeType,
        riskTier,
        canonicalLayers: Object.freeze(layers.canonicalLayers),
        securitySensitive,
        affectsCriticalPath,
        filesToModifyCount,
        assignedRoles: Object.freeze(assignedRoles)
      }),
      layers: Object.freeze(layers),
      contradictions: Object.freeze(contradictions),
      insufficientReasons: Object.freeze(['internal_contradiction_detected', ...contradictions]),
      structuralErrors: Object.freeze([])
    });
  }

  // Stage 5: sufficient_for_fast_path (Quality & completeness assessment for Fast Path A)
  const insufficientReasons = [];

  if (changeType !== 1) {
    insufficientReasons.push(changeType === null ? 'change_type_missing' : 'change_type_not_trivial');
  }

  if (riskTier !== 'low') {
    insufficientReasons.push(riskTier === null ? 'risk_tier_missing' : 'risk_tier_not_low');
  }

  if (layers.isEmpty) {
    insufficientReasons.push('empty_affected_layers');
  }

  if (layers.hasUnknown) {
    insufficientReasons.push('unknown_layer_present');
  }

  if (layers.hasCritical) {
    insufficientReasons.push('critical_layer_present');
  }

  if (!layers.isEmpty && layers.canonicalLayers.some(l => !NON_CRITICAL_LAYERS.has(l))) {
    insufficientReasons.push('non_presentation_layer_present');
  }

  if (securitySensitive) {
    insufficientReasons.push('security_sensitive_flag_set');
  }

  if (affectsCriticalPath) {
    insufficientReasons.push('affects_critical_path_flag_set');
  }

  if (filesToModifyCount !== null && filesToModifyCount > 5) {
    insufficientReasons.push('files_count_exceeds_threshold');
  }

  const sufficientForFastPath = insufficientReasons.length === 0;
  const stageReached = sufficientForFastPath ? 'sufficient_for_fast_path' : 'internally_consistent';

  return Object.freeze({
    present: true,
    structurallyValid: true,
    normalized: true,
    internallyConsistent: true,
    sufficientForFastPath,
    stageReached,
    data: Object.freeze({
      changeType,
      riskTier,
      canonicalLayers: Object.freeze(layers.canonicalLayers),
      securitySensitive,
      affectsCriticalPath,
      filesToModifyCount,
      assignedRoles: Object.freeze(assignedRoles)
    }),
    layers: Object.freeze(layers),
    contradictions: Object.freeze([]),
    insufficientReasons: Object.freeze(insufficientReasons),
    structuralErrors: Object.freeze([])
  });
}

module.exports = {
  CANONICAL_LAYERS,
  NON_CRITICAL_LAYERS,
  STANDARD_LAYERS,
  CRITICAL_LAYERS,
  LIFECYCLE_STAGES,
  LAYER_ALIASES,
  normalizeLayer,
  normalizeAffectedLayers,
  validatePlanMetadataLifecycle
};
