#!/usr/bin/env python3
"""
🔒 Enterprise Security & Secret Leak Scanner
Scans git-staged changes or modified workspace files for hardcoded secrets,
sensitive tokens, credentials, and blocked configuration files.
"""

import os
import sys
import re
import subprocess

# Sensitive file extensions and filenames that must never be committed
BLOCKED_FILES = [
    r"^\.env(\..+)?$",                    # .env, .env.local, .env.prod, .env.production, .env.staging, .env.dev, etc.
    r".*\.pem$",                          # SSL / RSA PEM keys
    r".*\.key$",                          # Private keys
    r".*\.p12$",                          # PKCS#12 certificates
    r".*\.pfx$",                          # PFX certificates
    r"^id_rsa.*$",                        # SSH RSA keys
    r"^id_ed25519.*$",                    # SSH Ed25519 keys
    r"^id_ecdsa.*$",                      # SSH ECDSA keys
    r".*credentials.*\.json$",            # Google / AWS credentials JSON
    r".*service_account.*\.json$",        # Service account keys
    r".*service-account.*\.json$",        # Service account keys
    r"^secrets?\.ya?ml$",                 # Secrets YAML
    r".*\.keystore$",                     # Android keystores
    r".*\.jks$",                          # Java KeyStores
]

# Sensitive Token & Secret RegEx Patterns (High Precision)
SECRET_PATTERNS = [
    ("OpenAI API Key", r"\bsk-[a-zA-Z0-9]{20,}\b|\bsk-proj-[a-zA-Z0-9_\-]{20,}\b"),
    ("Anthropic API Key", r"\bsk-ant-(api03-)?[a-zA-Z0-9_\-]{20,}\b"),
    ("Google / Gemini API Key", r"\bAIza[0-9A-Za-z\-_]{35}\b"),
    ("AWS Access Key ID", r"\b(AKIA|ASIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b"),
    ("AWS Secret Key", r"(?i)aws_secret_access_key\s*[:=]\s*['\"][0-9a-zA-Z/+=]{40}['\"]"),
    ("GitHub Token", r"\b(gh[pousr]_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})\b"),
    ("Stripe API Secret", r"\bsk_live_[0-9a-zA-Z]{24,}\b"),
    ("Slack Token", r"\bxox[baprs]-[0-9a-zA-Z]{10,48}\b"),
    ("Slack Webhook URL", r"https://hooks\.slack\.com/services/T[0-9A-Z]+/B[0-9A-Z]+/[0-9a-zA-Z]+"),
    ("Generic Private Key", r"-----BEGIN (RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----"),
    ("Database Connection String with Password", r"(postgres|mysql|mongodb|redis)://[^:]+:[^@\s]+@[^/\s]+"),
]

# Anti-Lazy Code Patterns (Blocks lazy placeholder code from reaching production)
LAZY_CODE_PATTERNS = [
    ("Lazy code ellipsis", r"(?i)//\s*\.\.\.\s*(rest of|remaining|existing)\s+(code|implementation)"),
    ("Lazy implementation placeholder", r"(?i)//\s*TODO:?\s*(implement\s+(this|later|here)|code\s+here)"),
    ("Incomplete code block", r"(?i)/\*+\s*\.\.\.\s*(rest of|remaining)?\s*code\s*\.\.\.\s*\*+/"),
]

SOURCE_CODE_EXTENSIONS = (
    ".js", ".ts", ".jsx", ".tsx", ".py", ".dart", ".rs", ".go",
    ".sol", ".php", ".cs", ".java", ".kt", ".swift", ".cpp", ".c", ".h"
)

# Known documentation placeholders (Safe to ignore)
KNOWN_SAFE_SUBSTRINGS = [
    "AKIAIOSFODNN7EXAMPLE",
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "your_api_key_here",
    "your_token_here",
    "your-api-key",
    "<your-api-key>",
    "<api_key>",
    "<token>",
    "insert_secret_here",
    "sk-ant-api03-placeholder",
    "00000000000000000000",
    "xxxxxxxxxxxxxxxxxxxx",
]

def get_staged_or_modified_files():
    """Returns list of staged files in git index, or fallback to modified files."""
    try:
        res = subprocess.run(['git', 'diff', '--name-only', '--cached', '--diff-filter=ACM'], capture_output=True, text=True)
        files = [f.strip() for f in res.stdout.splitlines() if f.strip()]
        if not files:
            res2 = subprocess.run(['git', 'diff', '--name-only', 'HEAD~1'], capture_output=True, text=True)
            files = [f.strip() for f in res2.stdout.splitlines() if f.strip()]
        return files
    except Exception:
        all_files = []
        for root, _, filenames in os.walk("."):
            if any(p in root for p in [".git", "node_modules", "vendor", "target", "dist", "build"]):
                continue
            for fn in filenames:
                all_files.append(os.path.relpath(os.path.join(root, fn)))
        return all_files

def get_file_content(filepath):
    """Fetches staged blob from git index first, falls back to disk."""
    try:
        res = subprocess.run(['git', 'show', f':{filepath}'], capture_output=True, text=True)
        if res.returncode == 0:
            return res.stdout.splitlines(keepends=True)
    except Exception:
        pass

    if os.path.exists(filepath) and not os.path.isdir(filepath):
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                return f.readlines()
        except Exception:
            return []
    return []

def is_safe_placeholder(matched_text, line_text):
    """Checks if the secret match is a known documentation placeholder."""
    for safe in KNOWN_SAFE_SUBSTRINGS:
        if safe.lower() in matched_text.lower() or safe.lower() in line_text.lower():
            return True
    return False

def is_public_certificate(lines):
    """
    Checks if file is strictly a public certificate / public key (e.g. SSL pinning cert, CA bundle)
    and does NOT contain any private key declarations, encrypted keys, or hardcoded secrets.
    """
    content = "".join(lines)
    # Reject if it contains ANY private key or encrypted key declarations
    if re.search(r"-----BEGIN[ A-Z0-9_-]*(PRIVATE KEY|ENCRYPTED)-----", content, re.IGNORECASE):
        return False
    # Accept if it declares standard public certificate or public key headers
    if re.search(r"-----BEGIN CERTIFICATE-----", content) or re.search(r"-----BEGIN PUBLIC KEY-----", content):
        # Ensure no other secret leaks are present alongside the certificate
        for _, pattern in SECRET_PATTERNS:
            if re.search(pattern, content):
                return False
        return True
    return False

def scan_file(filepath):
    issues = []
    basename = os.path.basename(filepath)

    # 1. Check blocked file extensions and names
    for pattern in BLOCKED_FILES:
        if re.match(pattern, basename, re.IGNORECASE):
            # Special check for certificate files (.pem, .crt, .key) that may contain only public certificates
            if basename.lower().endswith((".pem", ".crt", ".key")):
                lines = get_file_content(filepath)
                if is_public_certificate(lines):
                    # Public certificate detected without private key or secrets -> Allowed
                    break
            issues.append(f"❌ BLOCKED SENSITIVE FILE: '{filepath}' should never be committed!")
            return issues

    # Skip files over 1MB or scanner script itself
    if os.path.exists(filepath):
        if os.path.getsize(filepath) > 1024 * 1024 or "security_scanner.py" in filepath:
            return issues

    lines = get_file_content(filepath)
    is_source_code = filepath.endswith(SOURCE_CODE_EXTENSIONS) and not any(k in filepath.lower() for k in ["test", "mock", "fixture"])

    for line_idx, line in enumerate(lines, start=1):
        # 2. Check for secret leaks
        for name, pattern in SECRET_PATTERNS:
            match = re.search(pattern, line)
            if match:
                matched_secret = match.group(0)
                if not is_safe_placeholder(matched_secret, line):
                    masked = matched_secret[:6] + "..." + matched_secret[-4:] if len(matched_secret) > 12 else "***"
                    issues.append(f"❌ LEAK DETECTED [{name}] in {filepath}:{line_idx}\n   Secret snippet: {masked}")

        # 3. Check for lazy AI placeholder code
        if is_source_code:
            for name, pattern in LAZY_CODE_PATTERNS:
                if re.search(pattern, line):
                    issues.append(f"❌ LAZY CODE DETECTED [{name}] in {filepath}:{line_idx}\n   Snippet: {line.strip()}\n   Directive: Full, complete implementation required. Do not leave lazy placeholders.")

    return issues

def main():
    print("🔒 Running Enterprise Security & Secret Leak Scanner...")
    files = get_staged_or_modified_files()
    if not files:
        for root, _, filenames in os.walk("."):
            if any(p in root for p in [".git", "node_modules", "vendor", "target", "dist"]):
                continue
            for fn in filenames:
                files.append(os.path.relpath(os.path.join(root, fn)))

    total_issues = []
    for f in files:
        issues = scan_file(f)
        if issues:
            total_issues.extend(issues)

    if total_issues:
        print("\n" + "=" * 80)
        print("🚨 SECURITY VIOLATION: HARDCODED SECRETS OR SENSITIVE FILES DETECTED!")
        print("=" * 80)
        for issue in total_issues:
            print(issue)
        print("=" * 80)
        print("🛑 COMMIT BLOCKED: Please remove all hardcoded secrets and place them in .env!")
        sys.exit(1)
    else:
        print("✅ Clean: Zero sensitive files or hardcoded credentials detected.")
        sys.exit(0)

if __name__ == "__main__":
    main()
