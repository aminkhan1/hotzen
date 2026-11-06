/**
 * 🌐 Universal Agent Core Hub - Critic Subsystem Entry Point
 */

'use strict';

const deterministicCritic = require('./deterministic_workspace_critic');
const { runVerificationWithCritic } = require('../workflow/verification_with_critic');

module.exports = {
  ...deterministicCritic,
  runVerificationWithCritic
};
