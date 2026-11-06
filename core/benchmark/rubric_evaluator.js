/**
 * 🌐 Universal Agent Core Hub - Hidden Rubric Scoring Evaluator
 * Phase 6 Implementation: 100-Point Scoring Engine & Fatal Failure Enforcement
 */

'use strict';

const {
  RUBRIC_CATEGORIES,
  RUBRIC_WEIGHTS,
  MAX_RUBRIC_SCORE
} = require('./contracts');

class RubricEvaluator {
  /**
   * Evaluates an agent execution output against a task's hidden rubric.
   *
   * @param {object} task BenchmarkTask definition
   * @param {object} evidence Collected automated and qualitative evaluation evidence
   * @param {object} [evidence.functionalTests] { passed: number, total: number, failures: string[] }
   * @param {object} [evidence.edgeCaseTests] { passed: number, total: number, failures: string[] }
   * @param {object} [evidence.securityTests] { passed: number, total: number, violations: string[] }
   * @param {object} [evidence.architectureCheck] { cleanBoundaries: boolean, unneededDepsCount: number }
   * @param {object} [evidence.requirementCheck] { inferredCriteriaPassed: number, inferredCriteriaTotal: number }
   * @param {string|null} [evidence.fatalViolation] Explicit fatal failure trigger
   * @param {object} [options]
   * @returns {{
   *   finalQualityScore: number,
   *   fatalFailure: boolean,
   *   fatalReason: string|null,
   *   breakdown: Record<string, number>,
   *   details: object
   * }}
   */
  static evaluate(task, evidence = {}, _options = {}) {
    if (!task || typeof task !== 'object') {
      throw new TypeError('task must be a valid BenchmarkTask');
    }

    const breakdown = {
      [RUBRIC_CATEGORIES.FUNCTIONAL_CORRECTNESS]: 0,
      [RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING]: 0,
      [RUBRIC_CATEGORIES.ARCHITECTURE_DISCIPLINE]: 0,
      [RUBRIC_CATEGORIES.EDGE_CASES]: 0,
      [RUBRIC_CATEGORIES.SECURITY_SAFETY]: 0,
      [RUBRIC_CATEGORIES.REGRESSION_SAFETY]: 0
    };

    // Safe handling of null/non-object/empty evidence: fails safely with 0 score
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.keys(evidence).length === 0) {
      return Object.freeze({
        finalQualityScore: 0,
        fatalFailure: true,
        fatalReason: 'Missing or empty verification evidence',
        breakdown: Object.freeze(breakdown),
        details: Object.freeze({
          rawTotalBeforeFatal: 0,
          breakdownBeforeFatal: Object.freeze({ ...breakdown }),
          evidence: Object.freeze({})
        })
      });
    }

    const hasRecognizedEvidence = Boolean(
      (evidence.functionalTests && typeof evidence.functionalTests === 'object') ||
      (evidence.edgeCaseTests && typeof evidence.edgeCaseTests === 'object') ||
      (evidence.securityTests && typeof evidence.securityTests === 'object') ||
      typeof evidence.testsTotal === 'number' ||
      typeof evidence.testsPassed === 'number' ||
      typeof evidence.fatalViolation === 'string' ||
      evidence.fatalFailure === true
    );

    if (!hasRecognizedEvidence) {
      return Object.freeze({
        finalQualityScore: 0,
        fatalFailure: true,
        fatalReason: 'Malformed verification evidence: No test evidence reported',
        breakdown: Object.freeze(breakdown),
        details: Object.freeze({
          rawTotalBeforeFatal: 0,
          breakdownBeforeFatal: Object.freeze({ ...breakdown }),
          evidence: Object.freeze({ ...evidence })
        })
      });
    }

    let fatalFailure = false;
    let fatalReason = null;

    // 1. Fatal Failure Check: Security/correctness violations that MUST NOT be compensated
    if (typeof evidence.fatalViolation === 'string' && evidence.fatalViolation.trim()) {
      fatalFailure = true;
      fatalReason = evidence.fatalViolation.trim();
    }
    if (evidence.fatalFailure === true && !fatalFailure) {
      fatalFailure = true;
      fatalReason = (typeof evidence.fatalReason === 'string' && evidence.fatalReason.trim())
        ? evidence.fatalReason.trim()
        : 'Fatal failure flagged in verification evidence';
    }

    // Check automated security test violations for fatal flags
    if (evidence.securityTests && Array.isArray(evidence.securityTests.violations) && evidence.securityTests.violations.length > 0) {
      fatalFailure = true;
      const secMsg = `Fatal security violation detected: ${evidence.securityTests.violations.join('; ')}`;
      fatalReason = fatalReason ? `${fatalReason}; ${secMsg}` : secMsg;
    }

    // Check nested test failures for fatal safety violation keywords
    const allFailures = [
      ...(evidence.functionalTests && Array.isArray(evidence.functionalTests.failures) ? evidence.functionalTests.failures : []),
      ...(evidence.edgeCaseTests && Array.isArray(evidence.edgeCaseTests.failures) ? evidence.edgeCaseTests.failures : []),
      ...(Array.isArray(evidence.failures) ? evidence.failures : [])
    ];
    for (const f of allFailures) {
      if (typeof f === 'string' && (f.toLowerCase().includes('fatal') || f.toLowerCase().includes('prototype pollution') || f.toLowerCase().includes('timing attack') || f.toLowerCase().includes('timing side-channel') || f.toLowerCase().includes('fails open'))) {
        fatalFailure = true;
        fatalReason = fatalReason ? `${fatalReason}; ${f}` : f;
      }
    }

    // Safe ratio calculator preventing NaN, divide-by-zero, negative numbers, or overflow
    const safeRatio = (passed, total) => {
      if (typeof passed !== 'number' || typeof total !== 'number' || isNaN(passed) || isNaN(total) || total <= 0) {
        return 0;
      }
      return Math.max(0, Math.min(1, passed / total));
    };

    // 2. Functional Correctness (Max 30)
    if (evidence.functionalTests && typeof evidence.functionalTests === 'object') {
      const ratio = safeRatio(evidence.functionalTests.passed, evidence.functionalTests.total);
      breakdown[RUBRIC_CATEGORIES.FUNCTIONAL_CORRECTNESS] = Math.round(ratio * RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.FUNCTIONAL_CORRECTNESS]);
    }

    // 3. Requirement Understanding (Max 20)
    // Rewards defensible ambiguity handling (recognizing ambiguity, clarifying, or documenting reasonable assumptions)
    if (evidence.requirementCheck && typeof evidence.requirementCheck === 'object') {
      if (
        evidence.requirementCheck.ambiguityHandledDefensibly ||
        evidence.requirementCheck.clarifiedRequirements ||
        evidence.requirementCheck.documentedAssumptions
      ) {
        breakdown[RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING] = RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING];
      } else if (typeof evidence.requirementCheck.inferredCriteriaTotal === 'number' && evidence.requirementCheck.inferredCriteriaTotal > 0) {
        const ratio = safeRatio(evidence.requirementCheck.inferredCriteriaPassed, evidence.requirementCheck.inferredCriteriaTotal);
        breakdown[RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING] = Math.round(ratio * RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING]);
      } else if (evidence.requirementCheck.understoodSpec === true) {
        breakdown[RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING] = RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.REQUIREMENT_UNDERSTANDING];
      }
    }

    // 4. Architecture / Scope Discipline (Max 15)
    const hasEvidenceOfCode = Boolean(
      (evidence.functionalTests && typeof evidence.functionalTests.total === 'number' && evidence.functionalTests.total > 0) ||
      (evidence.edgeCaseTests && typeof evidence.edgeCaseTests.total === 'number' && evidence.edgeCaseTests.total > 0)
    );
    const hasPassingTests = Boolean(
      (evidence.functionalTests && evidence.functionalTests.passed > 0) ||
      (evidence.edgeCaseTests && evidence.edgeCaseTests.passed > 0)
    );

    let archScore = 0;
    if (evidence.architectureCheck && typeof evidence.architectureCheck === 'object' && hasEvidenceOfCode && !evidence.architectureCheck.missingModule) {
      if (evidence.architectureCheck.cleanBoundaries !== false) {
        archScore = RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.ARCHITECTURE_DISCIPLINE];
        if (typeof evidence.architectureCheck.unneededDepsCount === 'number' && evidence.architectureCheck.unneededDepsCount > 0) {
          archScore -= Math.min(7, evidence.architectureCheck.unneededDepsCount * 3);
        }
      } else if (hasPassingTests) {
        archScore = Math.max(0, RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.ARCHITECTURE_DISCIPLINE] - 8);
      }
    }
    breakdown[RUBRIC_CATEGORIES.ARCHITECTURE_DISCIPLINE] = Math.max(0, archScore);

    // 5. Edge Cases (Max 15)
    if (evidence.edgeCaseTests && typeof evidence.edgeCaseTests === 'object') {
      const ratio = safeRatio(evidence.edgeCaseTests.passed, evidence.edgeCaseTests.total);
      breakdown[RUBRIC_CATEGORIES.EDGE_CASES] = Math.round(ratio * RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.EDGE_CASES]);
    }

    // 6. Security / Safety (Max 10)
    if (evidence.securityTests && typeof evidence.securityTests === 'object') {
      const ratio = safeRatio(evidence.securityTests.passed, evidence.securityTests.total);
      breakdown[RUBRIC_CATEGORIES.SECURITY_SAFETY] = Math.round(ratio * RUBRIC_WEIGHTS[RUBRIC_CATEGORIES.SECURITY_SAFETY]);
    } else {
      breakdown[RUBRIC_CATEGORIES.SECURITY_SAFETY] = 0;
    }

    // 7. Regression Safety (Max 10)
    // Measures test completeness: automated verification suite present and deterministic
    if (evidence.regressionSafety && typeof evidence.regressionSafety === 'object' && hasEvidenceOfCode) {
      const hasTests = Boolean(evidence.regressionSafety.testsPresent);
      const isDeterministic = evidence.regressionSafety.deterministic !== false;
      let regScore = 0;
      if (hasTests) regScore += 7;
      if (isDeterministic && hasTests) regScore += 3;
      breakdown[RUBRIC_CATEGORIES.REGRESSION_SAFETY] = regScore;
    } else if (hasPassingTests && evidence.functionalTests && evidence.functionalTests.total > 0) {
      breakdown[RUBRIC_CATEGORIES.REGRESSION_SAFETY] = Math.min(8, Math.round(safeRatio(evidence.functionalTests.passed, evidence.functionalTests.total) * 8));
    } else {
      breakdown[RUBRIC_CATEGORIES.REGRESSION_SAFETY] = 0;
    }

    // Calculate Raw Total
    let totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
    totalScore = Math.min(MAX_RUBRIC_SCORE, Math.max(0, totalScore));

    const breakdownBeforeFatal = { ...breakdown };

    // Fatal failure rule: Fatal violations immediately nullify score
    let finalQualityScore = totalScore;
    if (fatalFailure) {
      finalQualityScore = 0;
      for (const cat of Object.keys(breakdown)) {
        breakdown[cat] = 0;
      }
    }

    return Object.freeze({
      finalQualityScore,
      fatalFailure,
      fatalReason,
      breakdown: Object.freeze(breakdown),
      details: Object.freeze({
        rawTotalBeforeFatal: totalScore,
        breakdownBeforeFatal: Object.freeze(breakdownBeforeFatal),
        evidence: Object.freeze({ ...evidence })
      })
    });
  }
}

module.exports = {
  RubricEvaluator
};
