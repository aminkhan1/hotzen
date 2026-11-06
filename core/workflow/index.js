/**
 * 🌐 Universal Agent Core Hub - Core Workflow Subsystem Entry Point
 * Phase 2 Implementation: Real Multi-Stage Orchestration & Adaptive Routing Integration
 */

'use strict';

const workflowEngine = require('./core_workflow_engine');
const planDisplay = require('./plan_display');
const failureUx = require('./failure_ux');
const planGenerator = require('./plan_generator');
const planReceipt = require('./plan_receipt');
const verificationWithCritic = require('./verification_with_critic');
const verifyRecord = require('./verify_record');
const handoffExecutor = require('./handoff_executor');
const fileTargetResolver = require('./file_target_resolver');
const taskClassificationFallback = require('./task_classification_fallback');
const projectArtifactExtractor = require('./project_artifact_extractor');
const projectVerifier = require('./project_verifier');
const critic = require('../critic');

module.exports = {
  ...workflowEngine,
  ...planDisplay,
  ...failureUx,
  ...planGenerator,
  ...planReceipt,
  ...verificationWithCritic,
  ...verifyRecord,
  ...handoffExecutor,
  ...fileTargetResolver,
  ...taskClassificationFallback,
  ...projectArtifactExtractor,
  ...projectVerifier,
  ...critic
};
