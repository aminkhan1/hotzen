/**
 * 🌐 Universal Agent Core Hub - Conservative Task Classification Fallback Engine
 *
 * Responsibilities:
 * - Recognizes clearly trivial/local low-risk changes from natural-language planner
 *   and task prompt evidence when explicit structured metadata is absent.
 * - Categorizes trivial changes into:
 *   1. Local variable / parameter rename
 *   2. Minor typo / spelling correction
 *   3. Simple local UI label / text change
 *   4. Bounded non-behavioral comment / documentation edit
 * - Enforces conservative fail-safe invariants:
 *   - Security, auth, payment, database, network, architecture, migration, and
 *     multi-file behavioral changes are strictly disqualified and never downgraded.
 *   - Explicit structured metadata (e.g. risk_tier, change_type) always takes precedence.
 *   - Ambiguous tasks remain conservative (changeType: 2, riskTier: 'medium').
 *   - Zero LLM / provider calls; 100% deterministic and explainable.
 *   - Full dual-language coverage (English and Persian).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { extractPathTokens, UNRESOLVED_TARGET } = require('./file_target_resolver');

/**
 * Deterministically checks whether a file path represents a test or spec file.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isTestOrSpecFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  const normalized = filePath.trim().replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/');
  const fileName = segments[segments.length - 1];

  // 1. Directory indicators: test, tests, spec, specs, __tests__
  const hasTestDir = segments.slice(0, -1).some(seg => (
    seg === 'test' ||
    seg === 'tests' ||
    seg === 'spec' ||
    seg === 'specs' ||
    seg === '__tests__'
  ));

  // 2. File name indicators
  const isTestFileName = (
    fileName.startsWith('test_') ||
    fileName.startsWith('test.') ||
    /\.(?:test|spec)\.[a-z0-9]+$/i.test(fileName) ||
    /_(?:test|spec)\.[a-z0-9]+$/i.test(fileName)
  );

  return hasTestDir || isTestFileName;
}

/**
 * Checks whether a text snippet or file path contains critical domain keywords.
 *
 * @param {string} str
 * @returns {boolean}
 */
function hasCriticalDomainKeyword(str) {
  if (typeof str !== 'string' || !str.trim()) return false;
  const normalized = normalizeTaskText(str);
  const identifierSplit = normalized
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\/\\]/g, ' ');

  for (const guard of NEGATIVE_GUARDS) {
    if (guard.test(normalized) || guard.test(identifierSplit)) {
      return true;
    }
  }
  return false;
}

/**
 * High-risk and critical domain negative guards.
 * If ANY of these patterns match the task evidence, the task is strictly disqualified
 * from low-risk fallback and remains at the conservative default.
 */
const NEGATIVE_GUARDS = Object.freeze([
  // 1. Security, Authentication, Authorization, Cryptography
  /\b(?:security|auth|authentication|authorization|authorize|oauth|jwt|token|tokens|session|sessions|password|passwords|secret|secrets|credential|credentials|permission|permissions|rbac|crypto|cryptographic|encrypt|encryption|decrypt|decryption|signature|certificate|cert|tls|ssl|vulnerability|exploit|sandbox|firewall|csrf|xss|injection)\b/i,
  /(?:امنیت|امنیتی|احراز\s*هویت|اعتبارسنجی|مجوز|دسترسی|توکن|سشن|نشست|رمز\s*عبور|گذرواژه|رمزنگاری|کریپتو|امضا|گواهی|رد\s*صلاحیت|احراز)/i,

  // 2. Financial, Payment, Billing, Monetization
  /\b(?:payment|payments|billing|checkout|invoice|invoices|price|pricing|stripe|paypal|transaction|transactions|subscription|subscriptions|refund|refunds|wallet|wallets|escrow|tax|taxes|financial|finance|money|currency|credit|balance)\b/i,
  /(?:پرداخت|پرداخت‌ها|مالی|صورتحساب|فاکتور|تسویه\s*حساب|تراکنش|اشتراک|کیف\s*پول|مالیات|درگاه|کارت|بانک|موجودی)/i,

  // 3. Database, SQL, Persistence, Storage, Migrations
  /\b(?:database|databases|db|sql|postgres|postgresql|mysql|sqlite|mongo|mongodb|redis|orm|prisma|typeorm|sequelize|migration|migrations|schema|schemas|table|tables|column|columns|repository|repositories|store|storage|persist|persistence|disk|filesystem|s3|bucket|blob)\b/i,
  /(?:دیتابیس|پایگاه\s*داده|اس‌کیوال|اس\s*کیو\s*ال|مایگریشن|مهاجرت|اسکیما|طرحواره|جدول|ستون|مخزن|ریپازیتوری|ذخیره‌سازی|فایل‌سیستم|دیسک)/i,

  // 4. Network, API, Endpoints, External Communication
  /\b(?:network|api|apis|endpoint|endpoints|http|https|rest|restful|graphql|grpc|rpc|websocket|websockets|socket|sockets|webhook|webhooks|curl|fetch|axios|proxy|gateway)\b/i,
  /(?:شبکه|ای‌پی‌آی|ای\s*پی\s*آی|اندپوینت|وب‌سرویس|وب\s*سرویس|وب‌سوکت|سوکت|وب‌هوک|پروکسی|گیت‌وی)/i,

  // 5. Architecture, Refactoring, Rewriting, Infrastructure
  /\b(?:architecture|architectural|refactor|refactoring|rewrite|rewriting|redesign|restructure|restructuring|re-architect|rearchitect|infrastructure|infra|docker|dockerfile|k8s|kubernetes|container|governance|kernel|engine|protocol)\b/i,
  /(?:معماری|ریفکتور|بازنویسی|طراحی\s*مجدد|ساختاربندی\s*مجدد|زیرساخت|داکر|کوبرنتیز|کانتینر|حاکمیت|کرنل|پروتکل)/i,

  // 6. Multi-file, Global, Project-wide scope
  /\b(?:all\s+files|across\s+(?:the\s+)?(?:project|codebase|app|files)|globally|entire\s+codebase|throughout\s+(?:the\s+)?app|multi-file|everywhere)\b/i,
  /(?:در\s+تمام\s+فایل‌ها|در\s+سراسر\s+پروژه|در\s+کل\s+پروژه|سراسری|همه‌جا|همه\s*جا)/i,

  // 7. Behavioral Logic & State Machine modifications
  /\b(?:business\s+logic|state\s+machine|state\s+management|algorithm|calculation|calculate|pricing\s+rule|workflow\s+engine)\b/i,
  /(?:منطق\s*کسب\s*و\s*کار|منطق\s*تجاری|ماشین\s*حالت|مدیریت\s*وضعیت|الگوریتم|محاسبات\s*مالی)/i
]);

/**
 * Directory segments and file name patterns indicating non-presentation architectural layers.
 * Files matching any of these are strictly prohibited from being classified as presentation.
 */
const NON_PRESENTATION_PATH_PATTERNS = Object.freeze([
  // Directory segments indicating non-presentation architectural layers
  /(?:^|\/)(?:domain|data|application|business|logic|state|bloc|blocs|cubit|cubits|model|models|entity|entities|repository|repositories|service|services|usecase|usecases|use_case|use_cases|api|network|http|auth|security|payment|routing|router|navigation|store|database|db)(?:\/|$)/i,
  // File name suffixes indicating non-presentation architectural roles
  /_(?:bloc|state|event|cubit|entity|model|repo|repository|service|usecase|use_case|api|client|router|route|datasource|data_source|dao|dto)\.[a-z0-9]+$/i,
  // File name prefixes
  /(?:^|\/)(?:bloc|cubit|entity|model|repository|service|usecase|router)_[a-z0-9_]+\.[a-z0-9]+$/i
]);

/**
 * Path segments and file name patterns positively indicating UI / presentation layers.
 */
const PRESENTATION_PATH_PATTERNS = Object.freeze([
  // Path segments indicating UI/presentation
  /(?:^|\/)(?:presentation|ui|widgets?|screens?|views?|pages?|components?)(?:\/|$)/i,
  // File name indicators for UI elements
  /_(?:label|button|text|title|header|heading|caption|tooltip|placeholder|dialog|badge|card|widget|view|screen|page|component|modal|form|icon|bar|banner|sheet|tile|avatar|row|cell|item|tab|divider)\.[a-z0-9]+$/i,
  // Standalone file names or standard entrypoints
  /(?:^|\/)(?:label|button|widget|screen|view|page|component|dialog|badge|card|navbar|sidebar|header|footer|main)\.[a-z0-9]+$/i
]);

/**
 * Deterministically checks whether a file contains Flutter widget declarations.
 * Reads up to 4KB of content if the file exists on disk.
 *
 * @param {string} filePath
 * @param {string} [cwd]
 * @returns {boolean}
 */
function hasFlutterWidgetContent(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  try {
    const fullPath = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath);
    if (!fs.existsSync(fullPath)) return false;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return false;
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(Math.min(stat.size, 4096));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const content = buf.toString('utf8');
    return (
      content.includes('package:flutter/') ||
      content.includes('StatelessWidget') ||
      content.includes('StatefulWidget') ||
      content.includes('Widget build(') ||
      content.includes('ConsumerWidget') ||
      content.includes('HookWidget')
    );
  } catch {
    return false;
  }
}

/**
 * Deterministically verifies whether an implementation source file represents a presentation file.
 *
 * Rules:
 * 1. Non-presentation negative guards (domain, data, application, bloc, state, etc.) strictly take precedence.
 * 2. Positively matches presentation directory/file patterns.
 * 3. In Flutter/Dart projects, inspects file content for widget declarations if on disk.
 * 4. Never broadly classifies arbitrary lib/**.dart files as presentation.
 *
 * @param {string} filePath
 * @param {string} [cwd]
 * @returns {boolean}
 */
function isPresentationSourceFile(filePath, cwd) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  const normalized = filePath.trim().replace(/\\/g, '/');

  // 1. Strict architectural safety guard: reject domain/data/application/state/bloc/etc.
  for (const pattern of NON_PRESENTATION_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  // 2. Positive path / naming pattern match
  for (const pattern of PRESENTATION_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // 3. For Dart files, inspect content for Flutter widget evidence
  if (normalized.endsWith('.dart') && hasFlutterWidgetContent(normalized, cwd)) {
    return true;
  }

  return false;
}

/**
 * Positive evidence patterns for bounded local variable/parameter renames.
 */
const LOCAL_RENAME_PATTERNS = Object.freeze([
  /\brename\s+(?:the\s+)?(?:local\s+)?(?:variable|var|param|parameter|arg|argument|constant|const|field|identifier)\s+['"`\w]+\s+to\s+['"`\w]+/i,
  /\brename\s+(?:the\s+)?(?:local\s+)?(?:variable|var|param|parameter|arg|argument|constant|const)\s+['"`\w]+/i,
  /\brename\s+(?:a\s+)?local\s+(?:variable|var|param|parameter|arg|argument|const|identifier)\b/i,
  /\brename\s+variable\s+['"`\w]+/i,
  /\brename\s+variable\b/i,
  /\blocal\s+variable\s+rename\b/i,
  /\brename\s+local\s+variable\b/i,
  /(?:تغییر\s*نام|تغییرنام|عوض\s*کردن\s*نام)\s+(?:متغیر|پارامتر|آرگومان|ثابت)(?:\s+محلی)?(?:\s+['"`\w\u0600-\u06FF]+)?(?:\s+به\s+['"`\w\u0600-\u06FF]+)?/i,
  /(?:تغییر\s*نام|تغییرنام)\s+(?:یک\s+)?متغیر(?:\s+محلی)?/i,
  /تغییر\s*نام\s+فیلد(?:\s+محلی)?/i
]);

/**
 * Positive evidence patterns for minor typo, spelling, or grammatical fixes.
 */
const TYPO_PATTERNS = Object.freeze([
  /\b(?:fix|correct|cleanup|remove)\s+(?:a\s+)?(?:small\s+|minor\s+|simple\s+)?(?:typo|spelling|spelling\s+mistake|misspelling|grammar\s+issue|grammatical\s+error)\b/i,
  /\b(?:small\s+|minor\s+|simple\s+)?typo\s+(?:fix|correction|cleanup)\b/i,
  /\bspelling\s+(?:fix|correction)\b/i,
  /\btypo\s+correction\b/i,
  /(?:اصلاح|تصحیح|رفع|درست\s*کردن)\s+(?:غلط\s*املایی|تایپو|اشتباه\s*تایپی|خطای\s*تایپی|املای\s*کلمه|غلط\s*تایپی)/i,
  /(?:اصلاح|تصحیح|رفع)\s+تایپوی?/i,
  /رفع\s+(?:اشتباه|خطای)\s+تایپی/i
]);

/**
 * Positive evidence patterns for simple local UI text or label changes.
 */
const UI_TEXT_PATTERNS = Object.freeze([
  /\b(?:change|update|fix|edit|replace|modify)\s+(?:the\s+|a\s+|an\s+)?(?:[\w\-]+\s+){0,3}(?:button|label|text|title|header|heading|caption|tooltip|placeholder|message|dialog|badge|copy)\s+(?:text|label|string|caption|copy|title)\b/i,
  /\b(?:change|update|edit|replace|fix|modify)\s+(?:the\s+|a\s+|an\s+)?(?:[\w\-]+\s+){0,3}(?:label|text\s+string|ui\s+text|button\s+text|display\s+text|button\s+label|validation\s+label)\b/i,
  /\b(?:change|update|edit|replace|fix|modify)\s+(?:the\s+|a\s+|an\s+)?(?:[\w\-]+\s+){0,3}(?:button|label|text|title|header|heading|caption|tooltip|placeholder|message|dialog|badge|copy)\s+(?:from\s+['"`\w\-]+\s+to\s+['"`\w\-]+|to\s+['"`\w\-]+)\b/i,
  /\bsimple\s+local\s+ui\s+text\s+change\b/i,
  /\bchange\s+(?:a\s+)?label\s*\/\s*text\s+string\b/i,
  /\btext\s+string\s+change\b/i,
  /\blabel\s+change\b/i,
  /(?:تغییر|ویرایش|اصلاح|بروزرسانی)\s+(?:متن|لیبل|عنوان|تیتر|کپشن|تولتیپ|پلیس‌هولدر|پلیس\s*هولدر|پیام)\s*(?:دکمه|فرم|دیالوگ|صفحه|کاربری|یوآی)?/i,
  /تغییر\s+(?:متن|لیبل)\s+['"`\w\u0600-\u06FF]+\s+به\s+['"`\w\u0600-\u06FF]+/i,
  /تغییر\s+لیبل\s+(?:یا\s+)?متن/i,
  /تغییر\s+متن\s+(?:ساده|محلی)?/i
]);

/**
 * Positive evidence patterns for bounded non-behavioral comment or documentation updates.
 */
const COMMENT_DOC_PATTERNS = Object.freeze([
  /\b(?:update|add|edit|fix|cleanup)\s+(?:code\s+)?(?:comment|comments|docstring|docstrings|jsdoc|readme)\b/i,
  /\b(?:comment|docstring)\s+(?:update|fix|typo)\b/i,
  /(?:تغییر|ویرایش|اصلاح|بروزرسانی)\s+(?:کامنت|کامنت‌ها|توضیحات\s*کد|داک‌استرینگ|مستندات|داکیومنت)/i
]);

/**
 * Normalizes text for deterministic multilingual matching (handles Arabic/Persian letter variants & ZWNJ).
 * @param {string} str
 * @returns {string}
 */
function normalizeTaskText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\u064A/g, 'ی') // Arabic Yeh -> Persian Yeh
    .replace(/\u0643/g, 'ک') // Arabic Kaf -> Persian Kaf
    .replace(/[\u200c\u200b]/g, ' ') // ZWNJ / zero-width space -> space
    .trim();
}

/**
 * Infers conservative low-risk classification (changeType: 1, riskTier: 'low')
 * strictly from natural-language task evidence when structured planner metadata is absent.
 *
 * Invariants & Multi-File Rules:
 * 1. Single-file behavior remains unchanged.
 * 2. More than 2 files => strictly rejected (remains conservative default).
 * 3. Exactly 2 files may qualify ONLY when:
 *    a) The positive category is ui_text, typo_fix, or comment_doc (variable_rename is strictly rejected).
 *    b) Exactly one file is clearly a test/spec file.
 *    c) The other file is the implementation/presentation/documentation target.
 *    d) No existing critical-domain negative guard matches either file path.
 *    e) No security/auth/payment/network/database/persistence/architecture/business-logic scope is present.
 * 4. Ambiguous tasks remain conservative (changeType: 2, riskTier: 'medium').
 * 5. Explicit structured metadata always takes precedence.
 * 6. Zero LLM / provider calls; 100% deterministic and explainable.
 *
 * @param {string} text Primary text evidence (taskPrompt, goal, or planner output)
 * @param {object} [options]
 * @param {string} [options.taskPrompt]
 * @param {string} [options.goal]
 * @param {string[]} [options.filesToModify]
 * @returns {{
 *   isTrivial: boolean,
 *   changeType: number,
 *   riskTier: 'low',
 *   affectedLayers: string[],
 *   category: 'variable_rename' | 'typo_fix' | 'ui_text' | 'comment_doc',
 *   rationale: string
 * } | null}
 */
function inferTrivialTaskClassification(text, options = {}) {
  const pieces = [
    typeof text === 'string' ? text : '',
    options && typeof options.taskPrompt === 'string' ? options.taskPrompt : '',
    options && typeof options.goal === 'string' ? options.goal : ''
  ];
  const combined = pieces.filter(Boolean).join(' ');
  const normalized = normalizeTaskText(combined);

  if (!normalized) return null;

  // 1. Check critical-domain negative guards on prompt/goal text
  if (hasCriticalDomainKeyword(normalized)) {
    return null;
  }

  // 2. Resolve explicit target files from options and prompt text
  const explicitOptionsFiles = (options && Array.isArray(options.filesToModify))
    ? options.filesToModify
    : ((options && Array.isArray(options.files)) ? options.files : null);

  const promptFiles = extractPathTokens(normalized);

  const rawCandidateFiles = [];
  if (explicitOptionsFiles && explicitOptionsFiles.length > 0) {
    rawCandidateFiles.push(...explicitOptionsFiles);
  }
  if (promptFiles.length > 0) {
    rawCandidateFiles.push(...promptFiles);
  }

  // Deduplicate and filter out unresolved placeholders
  const targetFiles = Array.from(new Set(
    rawCandidateFiles
      .filter(f => typeof f === 'string' && f.trim() && f !== UNRESOLVED_TARGET)
      .map(f => f.trim().replace(/\\/g, '/'))
  ));

  const workspaceCwd = (options && (options.cwd || options.targetDir || options.workspace)) || process.cwd();

  // Multi-file boundary rule:
  // - More than 2 files => strictly rejected
  if (targetFiles.length > 2) {
    return null;
  }

  // - Exactly 2 files may qualify only under narrow bounded rule:
  //   1) positive category is ui_text, typo_fix, or comment_doc (variable_rename is strictly rejected)
  //   2) one file is clearly a test/spec file
  //   3) the other file is the implementation/presentation/documentation target
  //   4) no existing critical-domain negative guard matches either file
  //   5) no security/auth/payment/network/database/persistence/architecture/business-logic scope
  let hasTestFile = false;
  if (targetFiles.length === 2) {
    const testFiles = targetFiles.filter(isTestOrSpecFile);
    const nonTestFiles = targetFiles.filter(f => !isTestOrSpecFile(f));

    // Exactly one test file and one non-test implementation/doc file
    if (testFiles.length !== 1 || nonTestFiles.length !== 1) {
      return null;
    }

    // Check critical-domain negative guards on both file paths
    for (const file of targetFiles) {
      if (hasCriticalDomainKeyword(file)) {
        return null;
      }
    }

    hasTestFile = true;
  } else if (targetFiles.length === 1) {
    // Single file must not touch critical domains either
    if (hasCriticalDomainKeyword(targetFiles[0])) {
      return null;
    }
  }

  // 3. Positive matchers

  // Category 1: Bounded local variable or parameter rename
  // NOTE: variable_rename is strictly prohibited for multi-file (must be <= 1 file)
  if (targetFiles.length <= 1) {
    for (const pattern of LOCAL_RENAME_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          isTrivial: true,
          changeType: 1,
          riskTier: 'low',
          affectedLayers: ['application'],
          category: 'variable_rename',
          rationale: 'Conservative fallback: Bounded local variable or parameter rename'
        };
      }
    }
  }

  // Category 2: Minor typo or spelling correction
  for (const pattern of TYPO_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        isTrivial: true,
        changeType: 1,
        riskTier: 'low',
        affectedLayers: hasTestFile ? ['documentation', 'testing'] : ['documentation'],
        category: 'typo_fix',
        rationale: hasTestFile
          ? 'Conservative fallback: Bounded typo/spelling correction with single test'
          : 'Conservative fallback: Bounded typo or spelling correction'
      };
    }
  }

  // Category 3: Simple local UI text or label change
  for (const pattern of UI_TEXT_PATTERNS) {
    if (pattern.test(normalized)) {
      const nonTestImplFile = targetFiles.find(f => !isTestOrSpecFile(f));
      if (nonTestImplFile && !isPresentationSourceFile(nonTestImplFile, workspaceCwd)) {
        return null;
      }
      return {
        isTrivial: true,
        changeType: 1,
        riskTier: 'low',
        affectedLayers: hasTestFile ? ['presentation', 'testing'] : ['presentation'],
        category: 'ui_text',
        rationale: hasTestFile
          ? 'Conservative fallback: Bounded local UI label/text change with single test'
          : 'Conservative fallback: Bounded local UI label or text change'
      };
    }
  }

  // Category 4: Bounded non-behavioral comment or documentation update
  for (const pattern of COMMENT_DOC_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        isTrivial: true,
        changeType: 1,
        riskTier: 'low',
        affectedLayers: hasTestFile ? ['documentation', 'testing'] : ['documentation'],
        category: 'comment_doc',
        rationale: hasTestFile
          ? 'Conservative fallback: Bounded comment/documentation update with single test'
          : 'Conservative fallback: Bounded non-behavioral comment or documentation update'
      };
    }
  }

  // Ambiguous or unrecognized: remain conservative
  return null;
}

module.exports = {
  inferTrivialTaskClassification,
  isTestOrSpecFile,
  isPresentationSourceFile,
  hasFlutterWidgetContent,
  hasCriticalDomainKeyword,
  NON_PRESENTATION_PATH_PATTERNS,
  PRESENTATION_PATH_PATTERNS,
  NEGATIVE_GUARDS,
  LOCAL_RENAME_PATTERNS,
  TYPO_PATTERNS,
  UI_TEXT_PATTERNS,
  COMMENT_DOC_PATTERNS
};
