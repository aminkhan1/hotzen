/**
 * 🌐 Universal Agent Core Hub - Codex Interactive Handoff Layer
 *
 * Implements deterministic model and reasoning effort handoff for existing
 * interactive Codex sessions via the Codex local App Server daemon protocol.
 *
 * Transports JSON-RPC over WebSocket on the App Server Unix domain control socket,
 * issuing `thread/settings/update` without starting external tasks or falsifying
 * model attribution.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Status enumeration for interactive handoff outcomes.
 */
const HANDOFF_STATUS = Object.freeze({
  SUCCESS: 'success',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
  FAILURE: 'failure'
});

/**
 * Resolves the canonical path to the Codex App Server control socket.
 *
 * Precedence:
 * 1. Explicit custom path
 * 2. Environment variable CODEX_APP_SERVER_SOCKET
 * 3. ~/.codex/app-server-control/app-server-control.sock (with CODEX_HOME support)
 *
 * @param {string} [customPath]
 * @returns {string}
 */
function resolveCodexAppServerControlSocket(customPath, env = process.env) {
  if (typeof customPath === 'string' && customPath.trim().length > 0) {
    return path.resolve(customPath.trim());
  }

  if (env.CODEX_APP_SERVER_SOCKET && env.CODEX_APP_SERVER_SOCKET.trim().length > 0) {
    return path.resolve(env.CODEX_APP_SERVER_SOCKET.trim());
  }

  const codexHome = env.CODEX_HOME && env.CODEX_HOME.trim().length > 0
    ? path.resolve(env.CODEX_HOME.trim())
    : path.join(os.homedir(), '.codex');

  return path.join(codexHome, 'app-server-control', 'app-server-control.sock');
}

/**
 * Canonical RFC 4122 / UUID string format validator (UUID v1-v7: 8-4-4-4-12 hex).
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates whether a candidate string is a canonical UUID thread identifier.
 * @param {string} candidate
 * @returns {boolean}
 */
function isValidCodexThreadId(candidate) {
  if (typeof candidate !== 'string') return false;
  return UUID_REGEX.test(candidate.trim());
}

/**
 * Canonicalizes a workspace filesystem path for exact comparison:
 * Resolves symlinks (via realpathSync if existing), resolves absolute path,
 * and strips trailing slashes.
 *
 * @param {string} rawPath
 * @returns {string}
 */
function canonicalizeWorkspacePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  const trimmed = rawPath.trim();
  if (!trimmed) return '';
  try {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved)) {
      return fs.realpathSync(resolved).replace(/[\/\\]+$/, '');
    }
    return resolved.replace(/[\/\\]+$/, '');
  } catch {
    return path.resolve(trimmed).replace(/[\/\\]+$/, '');
  }
}

/**
 * Formats a truthful, helpful manual fallback message conforming to Codex 0.163.0 UX.
 * Instructs user to obtain Session UUID via /status, retry core handoff, or use /model picker.
 * Never instructs '/model <name>'.
 *
 * @param {string} [requestedModel]
 * @param {string} [reason]
 * @returns {string}
 */
function formatManualFallbackMessage(requestedModel, reason) {
  const lines = [];
  const isSocketMissing = Boolean(
    reason && (
      reason.includes('socket not found') ||
      reason.includes('app-server socket not found') ||
      reason.includes('ENOENT')
    )
  );

  if (isSocketMissing) {
    if (reason) {
      lines.push(`Codex app-server socket is unavailable (${reason}).`);
    } else {
      lines.push('Codex app-server socket is unavailable.');
    }
    lines.push('Interactive model switching requires an active connection to Codex app-server.');
    lines.push('');
    lines.push('Available Options:');
    lines.push('  1. Retry handoff once Codex app-server socket connection is restored:');
    lines.push('     core handoff --receipt="<receipt>"');
    lines.push('  2. Switch Environment / Model: Switch to a supported CLI/host environment');
    lines.push(`     or manually select model: run '/model' and select '${requestedModel || 'the allocated model'}' from the picker.`);
    lines.push('  3. Proceed Outside Core (Unmanaged):');
    lines.push('     Continue implementation manually without Core management.');
    lines.push('     ⚠️ WARNING: Unmanaged execution will NOT be recorded as verified Core execution.');
    return lines.join('\n');
  }

  if (reason) {
    lines.push(`Codex interactive thread could not be resolved (${reason}).`);
  } else {
    lines.push('Codex interactive thread could not be resolved.');
  }
  lines.push('To enforce the allocated model on your active thread:');
  lines.push("  1. Run '/status' in Codex to obtain your current Session UUID.");
  lines.push('  2. Retry handoff:');
  lines.push('     core handoff --receipt="<receipt>" --thread-id="<session-uuid>"');
  lines.push('');
  lines.push(`Alternatively, run '/model' and select '${requestedModel || 'the allocated model'}' from the picker.`);
  return lines.join('\n');
}

/**
 * Resolves the authoritative Codex thread ID using strict deterministic precedence:
 * 1. Explicit threadId (passed via options.threadId or params.threadId)
 * 2. Environment variable CODEX_THREAD_ID (injected by Codex tool runtime)
 * 3. Fail closed / unavailable
 *
 * Never resolves via cwd, recency, rollout files, loaded-thread guessing, or filesystem heuristics.
 *
 * @param {object} [params]
 * @param {string} [params.threadId]
 * @param {object} [options]
 * @param {string} [options.threadId]
 * @param {object} [options.env] Override environment object (defaults to process.env)
 * @returns {object} { ok: boolean, status: string, threadId: string | null, source: 'explicit' | 'env' | null, error?: string }
 */
function resolveCodexThreadId(params = {}, options = {}) {
  const env = (options && options.env) ? options.env : process.env;

  // 1. Explicit threadId from options or params
  const rawExplicit = (options && options.threadId !== undefined)
    ? options.threadId
    : (params && params.threadId !== undefined ? params.threadId : undefined);

  if (rawExplicit !== undefined && rawExplicit !== null) {
    if (typeof rawExplicit !== 'string' || !rawExplicit.trim()) {
      return {
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        threadId: null,
        source: null,
        error: 'Explicit threadId must be a non-empty string'
      };
    }
    const trimmed = rawExplicit.trim();
    if (!UUID_REGEX.test(trimmed)) {
      return {
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        threadId: null,
        source: null,
        error: `Explicit threadId '${trimmed}' is not a valid UUID format`
      };
    }
    return {
      ok: true,
      status: HANDOFF_STATUS.SUCCESS,
      threadId: trimmed,
      source: 'explicit'
    };
  }

  // 2. Authoritative environment variable injected by Codex tool execution
  const envThreadId = env && typeof env.CODEX_THREAD_ID === 'string'
    ? env.CODEX_THREAD_ID.trim()
    : null;

  if (envThreadId && envThreadId.length > 0) {
    if (!UUID_REGEX.test(envThreadId)) {
      return {
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        threadId: null,
        source: null,
        error: `Environment variable CODEX_THREAD_ID '${envThreadId}' is not a valid UUID format`
      };
    }
    return {
      ok: true,
      status: HANDOFF_STATUS.SUCCESS,
      threadId: envThreadId,
      source: 'env'
    };
  }

  // 3. Fail closed - unavailable
  return {
    ok: false,
    status: HANDOFF_STATUS.UNAVAILABLE,
    threadId: null,
    source: null,
    error: 'No active Codex thread ID found. Explicit threadId was not provided and CODEX_THREAD_ID is absent from environment.'
  };
}

/**
 * Detects whether the current execution context is an authoritative interactive Codex session.
 *
 * Strict Invariants:
 * 1. Explicit options.interactive === false => returns false (explicit opt-out).
 * 2. Explicit options.interactive === true => returns true (preserves compatibility / test hook).
 * 3. Non-Codex provider => returns false (cannot be interactive Codex session).
 * 4. Authoritative check: resolveCodexThreadId({}, options).ok must be true (valid UUID threadId in env or options).
 * 5. Does NOT guess by cwd, process names, recent sessions, or filesystem heuristics.
 *
 * @param {object} [options]
 * @param {boolean} [options.interactive] Explicit override
 * @param {string} [options.threadId] Explicit thread identifier
 * @param {object} [options.env] Environment override (defaults to process.env)
 * @param {string} [providerId] Active or resolved provider ('codex', 'claude_code', etc.)
 * @returns {boolean}
 */
function isInteractiveCodexSession(options = {}, providerId = 'codex') {
  if (options && options.interactive === false) {
    return false;
  }
  if (options && options.interactive === true) {
    return true;
  }
  const effectiveProvider = providerId || (options && options.provider) || 'codex';
  if (effectiveProvider !== 'codex') {
    return false;
  }
  const resolved = resolveCodexThreadId({}, options);
  return Boolean(resolved && resolved.ok);
}

/**
 * Encodes a UTF-8 text message into a masked RFC 6455 client WebSocket frame.
 * @param {string} text
 * @returns {Buffer}
 */
function encodeClientFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  let offset = 0;

  if (len < 126) {
    header = Buffer.alloc(2 + 4);
    header[0] = 0x81; // FIN (0x80) + Text opcode (0x01)
    header[1] = 0x80 | len; // Mask bit (0x80) + length
    offset = 2;
  } else if (len < 65536) {
    header = Buffer.alloc(4 + 4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    offset = 4;
  } else {
    header = Buffer.alloc(10 + 4);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    offset = 10;
  }

  const mask = crypto.randomBytes(4);
  mask.copy(header, offset);

  const maskedPayload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    maskedPayload[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, maskedPayload]);
}

/**
 * Encodes a masked RFC 6455 client Close frame.
 * @param {number} [code=1000]
 * @returns {Buffer}
 */
function encodeCloseFrame(code = 1000) {
  const header = Buffer.alloc(2 + 4 + 2);
  header[0] = 0x88; // FIN + Close opcode
  header[1] = 0x80 | 2; // Mask bit + 2 bytes
  const mask = crypto.randomBytes(4);
  mask.copy(header, 2);
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  for (let i = 0; i < 2; i++) {
    header[6 + i] = payload[i] ^ mask[i % 4];
  }
  return header;
}

/**
 * Stream frame decoder for RFC 6455 WebSocket frames.
 */
class WebSocketFrameDecoder {
  /**
   * @param {Function} onMessage Callback invoked with decoded string payload
   */
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    if (!chunk || chunk.length === 0) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let headerLen = 2;

      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        headerLen = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const bigLen = this.buffer.readBigUInt64BE(2);
        if (bigLen > BigInt(16 * 1024 * 1024)) {
          throw new RangeError('WebSocket frame exceeds 16MB safety cap');
        }
        len = Number(bigLen);
        headerLen = 10;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = headerLen + maskLen + len;
      if (this.buffer.length < totalLen) return;

      let payload = this.buffer.slice(headerLen + maskLen, totalLen);
      if (masked) {
        const mask = this.buffer.slice(headerLen, headerLen + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < len; i++) {
          payload[i] ^= mask[i % 4];
        }
      }

      this.buffer = this.buffer.slice(totalLen);

      if (opcode === 0x01) { // Text frame
        this.onMessage(payload.toString('utf8'));
      }
    }
  }
}

/**
 * Updates an existing interactive Codex thread's model and reasoning effort settings
 * via the local App Server daemon protocol.
 *
 * @param {object} params
 * @param {string} params.threadId Target thread UUID (required)
 * @param {string} [params.model] Target model identifier (e.g. 'gpt-5.6-luna')
 * @param {string} [params.effort] Target reasoning effort (e.g. 'medium')
 * @param {object} [options]
 * @param {string} [options.socketPath] Override Unix domain socket path
 * @param {number} [options.timeoutMs=5000] Connection and RPC timeout in ms
 * @param {object} [options.clientInfo] Custom client info for initialize
 * @returns {Promise<object>} Result conforming to handoff contract
 */
/**
 * Authoritatively resolves an active Codex interactive thread ID adhering to strict precedence:
 * A. Explicit options.threadId or params.threadId (verified via thread/read + workspace check)
 * B. process.env.CODEX_THREAD_ID (verified via thread/read + workspace check)
 * C. App Server singleton resolution:
 *    - call thread/loaded/list
 *    - call thread/read for each candidate
 *    - canonicalize workspace paths
 *    - filter exact workspace matches
 *    - accept ONLY if exactly one matching loaded thread exists
 * D. Otherwise fail closed (status: unavailable / failure, manualFallbackRequired: true)
 *
 * Forbidden:
 * - cwd-only selection without singleton loaded verification
 * - newest/recent thread heuristic
 * - timestamps
 * - rollout/session files
 * - process-tree guessing
 *
 * @param {object} [params]
 * @param {string} [params.threadId]
 * @param {string} [params.cwd]
 * @param {object} [options]
 * @param {string} [options.threadId]
 * @param {string} [options.cwd]
 * @param {object} [options.env]
 * @param {string} [options.socketPath]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.skipThreadReadVerification]
 * @returns {Promise<object>}
 */
function resolveAuthoritativeCodexThreadId(params = {}, options = {}) {
  const env = (options && options.env) ? options.env : process.env;
  const targetCwd = canonicalizeWorkspacePath(options.cwd || params.cwd || process.cwd());

  const rawExplicit = (options && options.threadId !== undefined)
    ? options.threadId
    : (params && params.threadId !== undefined ? params.threadId : undefined);

  let candidateThreadId = null;
  let resolutionSource = null;

  if (rawExplicit !== undefined && rawExplicit !== null) {
    if (typeof rawExplicit !== 'string' || !rawExplicit.trim()) {
      return Promise.resolve({
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        manualFallbackRequired: true,
        threadId: null,
        threadResolutionSource: null,
        error: 'Explicit threadId must be a non-empty string',
        message: formatManualFallbackMessage(null, 'Explicit threadId must be a non-empty string')
      });
    }
    const trimmed = rawExplicit.trim();
    if (!UUID_REGEX.test(trimmed)) {
      return Promise.resolve({
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        manualFallbackRequired: true,
        threadId: null,
        threadResolutionSource: null,
        error: `Explicit threadId '${trimmed}' is not a valid UUID format`,
        message: formatManualFallbackMessage(null, `Explicit threadId '${trimmed}' is not a valid UUID format`)
      });
    }
    candidateThreadId = trimmed;
    resolutionSource = 'explicit';
  } else {
    const envThreadId = env && typeof env.CODEX_THREAD_ID === 'string'
      ? env.CODEX_THREAD_ID.trim()
      : null;

    if (envThreadId && envThreadId.length > 0) {
      if (!UUID_REGEX.test(envThreadId)) {
        return Promise.resolve({
          ok: false,
          status: HANDOFF_STATUS.FAILURE,
          manualFallbackRequired: true,
          threadId: null,
          threadResolutionSource: null,
          error: `Environment variable CODEX_THREAD_ID '${envThreadId}' is not a valid UUID format`,
          message: formatManualFallbackMessage(null, `Environment variable CODEX_THREAD_ID '${envThreadId}' is not a valid UUID format`)
        });
      }
      candidateThreadId = envThreadId;
      resolutionSource = 'env';
    }
  }

  // Fast-path bypass for mock testing if explicitly requested
  if (options.skipThreadReadVerification && candidateThreadId) {
    return Promise.resolve({
      ok: true,
      status: HANDOFF_STATUS.SUCCESS,
      threadId: candidateThreadId,
      threadResolutionSource: resolutionSource,
      thread: null
    });
  }

  const socketPath = resolveCodexAppServerControlSocket(options.socketPath, env);
  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
    ? options.timeoutMs
    : 5000;

  if (!fs.existsSync(socketPath)) {
    return Promise.resolve({
      ok: false,
      status: HANDOFF_STATUS.UNAVAILABLE,
      executionPermitted: false,
      manualFallbackRequired: true,
      threadId: null,
      threadResolutionSource: null,
      error: `Codex app-server socket not found at '${socketPath}'`,
      options: [
        {
          id: 'retry',
          label: 'Retry handoff once Codex app-server socket connection is restored',
          action: 'core handoff --receipt="<receipt>"'
        },
        {
          id: 'switch_environment',
          label: 'Switch to a supported host/CLI environment or reconfigure model in host',
          action: 'Run within Codex CLI or launch with supported model configuration'
        },
        {
          id: 'unmanaged_continue',
          label: 'Proceed outside Core management (Unmanaged: will not be recorded as verified Core execution)',
          action: 'Manual continuation outside Core protocol'
        }
      ],
      message: formatManualFallbackMessage(null, `Codex app-server socket not found at '${socketPath}'`)
    });
  }

  return new Promise((resolve) => {
    let isSettled = false;
    let timer = null;
    let rawSocket = null;

    function settle(result) {
      if (isSettled) return;
      isSettled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (rawSocket && !rawSocket.destroyed) {
        try { rawSocket.write(encodeCloseFrame()); rawSocket.end(); } catch {}
        setTimeout(() => { try { if (!rawSocket.destroyed) rawSocket.destroy(); } catch {} }, 50);
      }
      resolve(result);
    }

    timer = setTimeout(() => {
      settle({
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        manualFallbackRequired: true,
        threadId: candidateThreadId,
        threadResolutionSource: resolutionSource,
        error: `Codex app-server request timed out after ${timeoutMs}ms`,
        message: formatManualFallbackMessage(null, `Codex app-server request timed out after ${timeoutMs}ms`)
      });
    }, timeoutMs);

    const secKey = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      socketPath,
      path: '/',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': secKey
      }
    });

    req.on('error', (err) => {
      const isUnsupported = ['EPERM', 'EACCES'].includes(err.code);
      const isUnavailable = ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTSOCK'].includes(err.code);
      const status = isUnsupported
        ? HANDOFF_STATUS.UNSUPPORTED
        : (isUnavailable ? HANDOFF_STATUS.UNAVAILABLE : HANDOFF_STATUS.FAILURE);
      settle({
        ok: false,
        status,
        manualFallbackRequired: true,
        threadId: candidateThreadId,
        threadResolutionSource: resolutionSource,
        error: `Codex app-server connection failed: ${err.message}`,
        code: err.code,
        message: formatManualFallbackMessage(null, `Codex app-server connection failed: ${err.message}`)
      });
    });

    req.on('response', (res) => {
      settle({
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        manualFallbackRequired: true,
        threadId: candidateThreadId,
        threadResolutionSource: resolutionSource,
        error: `Codex app-server rejected WebSocket upgrade with HTTP ${res.statusCode}`,
        message: formatManualFallbackMessage(null, `HTTP ${res.statusCode}`)
      });
    });

    req.on('upgrade', (res, socket, head) => {
      rawSocket = socket;

      socket.on('error', (err) => {
        settle({
          ok: false,
          status: HANDOFF_STATUS.FAILURE,
          manualFallbackRequired: true,
          threadId: candidateThreadId,
          threadResolutionSource: resolutionSource,
          error: `Socket communication error: ${err.message}`,
          message: formatManualFallbackMessage(null, err.message)
        });
      });

      socket.on('close', () => {
        if (!isSettled) {
          settle({
            ok: false,
            status: HANDOFF_STATUS.FAILURE,
            manualFallbackRequired: true,
            threadId: candidateThreadId,
            threadResolutionSource: resolutionSource,
            error: 'Connection closed unexpectedly during thread resolution',
            message: formatManualFallbackMessage(null, 'Connection closed unexpectedly')
          });
        }
      });

      function sendClientJson(msg) {
        if (socket.destroyed) return;
        socket.write(encodeClientFrame(JSON.stringify(msg)));
      }

      let loadedCandidates = [];
      let pendingReads = 0;
      const matchingThreads = [];

      const decoder = new WebSocketFrameDecoder((msgStr) => {
        let msg = null;
        try { msg = JSON.parse(msgStr); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        if (msg.id === 1) {
          if (msg.error) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              error: `Initialize rejected: ${msg.error.message || JSON.stringify(msg.error)}`,
              message: formatManualFallbackMessage(null, msg.error.message)
            });
            return;
          }

          sendClientJson({ method: 'initialized' });

          if (candidateThreadId) {
            // Precedence A or B: verify explicit or env threadId via thread/read
            sendClientJson({
              id: 2,
              method: 'thread/read',
              params: { threadId: candidateThreadId }
            });
            return;
          }

          // Precedence C: App Server singleton resolution
          sendClientJson({
            id: 2,
            method: 'thread/loaded/list',
            params: {}
          });
          return;
        }

        // Response for candidate verification (Precedence A or B)
        if (msg.id === 2 && candidateThreadId) {
          if (msg.error) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              error: `Thread verification failed for ${resolutionSource} thread '${candidateThreadId}': ${msg.error.message || 'thread not found'}`,
              message: formatManualFallbackMessage(null, `thread/read rejected for ${candidateThreadId}`)
            });
            return;
          }

          const threadObj = (msg.result && msg.result.thread) ? msg.result.thread : null;
          if (!threadObj || threadObj.id !== candidateThreadId || !threadObj.cwd || !targetCwd) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              error: `thread/read did not confirm thread '${candidateThreadId}' and its workspace`,
              message: formatManualFallbackMessage(null, 'thread/read did not confirm thread identity and workspace')
            });
            return;
          }
          const threadCwd = canonicalizeWorkspacePath(threadObj.cwd);
          if (!threadCwd || threadCwd !== targetCwd) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              error: `Thread '${candidateThreadId}' belongs to workspace '${threadCwd || 'unknown'}' which does not match target workspace '${targetCwd}'`,
              message: formatManualFallbackMessage(null, `workspace mismatch: ${threadCwd || 'unknown'} !== ${targetCwd}`)
            });
            return;
          }

          settle({
            ok: true,
            status: HANDOFF_STATUS.SUCCESS,
            threadId: candidateThreadId,
            threadResolutionSource: resolutionSource,
            thread: threadObj
          });
          return;
        }

        // Response for thread/loaded/list (Precedence C)
        if (msg.id === 2 && !candidateThreadId) {
          if (msg.error) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.UNAVAILABLE,
              manualFallbackRequired: true,
              threadId: null,
              threadResolutionSource: null,
              error: `thread/loaded/list failed: ${msg.error.message || 'unknown error'}`,
              message: formatManualFallbackMessage(null, 'thread/loaded/list failed')
            });
            return;
          }

          const rawList = (msg.result && Array.isArray(msg.result.threads)) ? msg.result.threads : [];
          loadedCandidates = [...new Set(rawList.filter(id => typeof id === 'string' && UUID_REGEX.test(id.trim())).map(id => id.trim()))];

          if (loadedCandidates.length === 0) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.UNAVAILABLE,
              manualFallbackRequired: true,
              threadId: null,
              threadResolutionSource: null,
              error: 'No loaded threads found on Codex App Server',
              message: formatManualFallbackMessage(null, 'no loaded threads found')
            });
            return;
          }

          pendingReads = loadedCandidates.length;
          for (let i = 0; i < loadedCandidates.length; i++) {
            sendClientJson({
              id: 10 + i,
              method: 'thread/read',
              params: { threadId: loadedCandidates[i] }
            });
          }
          return;
        }

        // Responses for candidate thread/read (Precedence C)
        if (msg.id >= 10 && msg.id < 10 + loadedCandidates.length && !candidateThreadId) {
          if (msg.error) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              threadId: null,
              threadResolutionSource: null,
              error: `thread/read failed for loaded thread '${loadedCandidates[msg.id - 10]}': ${msg.error.message || 'unknown error'}`,
              message: formatManualFallbackMessage(null, 'thread/read failed for a loaded thread')
            });
            return;
          }
          const threadObj = (msg.result && msg.result.thread) ? msg.result.thread : null;
          if (threadObj && threadObj.cwd) {
            const threadCwd = canonicalizeWorkspacePath(threadObj.cwd);
            if (threadObj.id === loadedCandidates[msg.id - 10] && threadCwd && threadCwd === targetCwd) {
              matchingThreads.push(threadObj);
            }
          }
          pendingReads--;

          if (pendingReads === 0) {
            if (matchingThreads.length === 0) {
              settle({
                ok: false,
                status: HANDOFF_STATUS.UNAVAILABLE,
                manualFallbackRequired: true,
                threadId: null,
                threadResolutionSource: null,
                error: `No loaded thread matches target workspace '${targetCwd}'`,
                message: formatManualFallbackMessage(null, `no loaded thread matches workspace '${targetCwd}'`)
              });
              return;
            }

            if (matchingThreads.length > 1) {
              settle({
                ok: false,
                status: HANDOFF_STATUS.UNAVAILABLE,
                manualFallbackRequired: true,
                threadId: null,
                threadResolutionSource: null,
                error: `Ambiguous: multiple matching loaded threads (${matchingThreads.length}) found for workspace '${targetCwd}'`,
                message: formatManualFallbackMessage(null, `ambiguous: multiple matching loaded threads (${matchingThreads.length})`)
              });
              return;
            }

            const singleton = matchingThreads[0];
            settle({
              ok: true,
              status: HANDOFF_STATUS.SUCCESS,
              threadId: singleton.id,
              threadResolutionSource: 'app_server_singleton',
              thread: singleton
            });
          }
        }
      });

      if (head && head.length > 0) decoder.push(head);
      socket.on('data', (chunk) => {
        try { decoder.push(chunk); }
        catch (err) {
          settle({
            ok: false,
            status: HANDOFF_STATUS.FAILURE,
            manualFallbackRequired: true,
            error: `Frame decoding failure: ${err.message}`,
            message: formatManualFallbackMessage(null, err.message)
          });
        }
      });

      const clientInfo = options.clientInfo || { name: 'agent-core-handoff', version: '1.0.0' };
      sendClientJson({
        id: 1,
        method: 'initialize',
        params: { clientInfo, capabilities: { experimentalApi: true } }
      });
    });

    req.end();
  });
}

/**
 * Updates settings for a live Codex interactive thread by strictly resolving
 * the authoritative thread and sending thread/settings/update via JSON-RPC.
 *
 * @param {object} params
 * @param {string} [params.threadId] Target thread UUID
 * @param {string} [params.cwd] Target workspace directory
 * @param {string} [params.model] Target model identifier (e.g. 'gpt-5.6-luna')
 * @param {string} [params.effort] Target reasoning effort (e.g. 'medium')
 * @param {object} [options]
 * @param {string} [options.socketPath] Override Unix domain socket path
 * @param {number} [options.timeoutMs=5000] Connection and RPC timeout in ms
 * @param {object} [options.clientInfo] Custom client info for initialize
 * @param {boolean} [options.skipThreadReadVerification] Bypass thread/read for simple test mocks
 * @returns {Promise<object>} Result conforming to handoff contract
 */
function updateCodexThreadSettings(params = {}, options = {}) {
  const { model, effort } = params;
  const normalizedModel = (typeof model === 'string' && model.trim().length > 0) ? model.trim() : null;
  const normalizedEffort = (typeof effort === 'string' && effort.trim().length > 0) ? effort.trim() : null;

  const resolved = resolveCodexThreadId(params, options);
  if (!resolved.ok) {
    return Promise.resolve({
      ok: false,
      status: resolved.status,
      manualFallbackRequired: true,
      threadId: null,
      threadResolutionSource: null,
      requestedModel: normalizedModel,
      enforcedModel: null,
      model: normalizedModel,
      effort: normalizedEffort,
      error: resolved.error,
      message: formatManualFallbackMessage(normalizedModel, resolved.error)
    });
  }

  const candidateThreadId = resolved.threadId;
  const resolutionSource = resolved.source;

  const socketPath = resolveCodexAppServerControlSocket(options.socketPath, options.env || process.env);
  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
    ? options.timeoutMs
    : 5000;

  if (!fs.existsSync(socketPath)) {
    return Promise.resolve({
      ok: false,
      status: HANDOFF_STATUS.UNAVAILABLE,
      executionPermitted: false,
      manualFallbackRequired: true,
      error: `Codex app-server socket not found at '${socketPath}'`,
      threadId: candidateThreadId,
      threadResolutionSource: resolutionSource,
      requestedModel: normalizedModel,
      enforcedModel: null,
      model: normalizedModel,
      effort: normalizedEffort,
      options: [
        {
          id: 'retry',
          label: 'Retry handoff once Codex app-server socket connection is restored',
          action: 'core handoff --receipt="<receipt>"'
        },
        {
          id: 'switch_environment',
          label: 'Switch to a supported host/CLI environment or reconfigure model in host',
          action: 'Run within Codex CLI or launch with supported model configuration'
        },
        {
          id: 'unmanaged_continue',
          label: 'Proceed outside Core management (Unmanaged: will not be recorded as verified Core execution)',
          action: 'Manual continuation outside Core protocol'
        }
      ],
      message: formatManualFallbackMessage(normalizedModel, `Codex app-server socket not found at '${socketPath}'`)
    });
  }

  return new Promise((resolve) => {
    let isSettled = false;
    let timer = null;
    let rawSocket = null;

    function settle(result) {
      if (isSettled) return;
      isSettled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (rawSocket && !rawSocket.destroyed) {
        try { rawSocket.write(encodeCloseFrame()); rawSocket.end(); } catch {}
        setTimeout(() => { try { if (!rawSocket.destroyed) rawSocket.destroy(); } catch {} }, 50);
      }
      resolve(result);
    }

    timer = setTimeout(() => {
      settle({
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        manualFallbackRequired: true,
        error: `Codex app-server request timed out after ${timeoutMs}ms`,
        threadId: candidateThreadId,
        threadResolutionSource: resolutionSource,
        requestedModel: normalizedModel,
        enforcedModel: null,
        model: normalizedModel,
        effort: normalizedEffort,
        message: formatManualFallbackMessage(normalizedModel, `Codex app-server request timed out after ${timeoutMs}ms`)
      });
    }, timeoutMs);

    const secKey = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      socketPath,
      path: '/',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': secKey
      }
    });

    req.on('error', (err) => {
      const isUnsupported = ['EPERM', 'EACCES'].includes(err.code);
      const isUnavailable = ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTSOCK'].includes(err.code);
      const status = isUnsupported
        ? HANDOFF_STATUS.UNSUPPORTED
        : (isUnavailable ? HANDOFF_STATUS.UNAVAILABLE : HANDOFF_STATUS.FAILURE);
      settle({
        ok: false,
        status,
        manualFallbackRequired: true,
        error: `Codex app-server connection failed: ${err.message}`,
        code: err.code,
        threadId: candidateThreadId,
        threadResolutionSource: resolutionSource,
        requestedModel: normalizedModel,
        enforcedModel: null,
        model: normalizedModel,
        effort: normalizedEffort,
        message: formatManualFallbackMessage(normalizedModel, `Codex app-server connection failed: ${err.message}`)
      });
    });

    req.on('response', (res) => {
      settle({
        ok: false,
        status: HANDOFF_STATUS.FAILURE,
        manualFallbackRequired: true,
        error: `Codex app-server rejected WebSocket upgrade with HTTP ${res.statusCode}`,
        code: res.statusCode,
        threadId: candidateThreadId,
        threadResolutionSource: resolutionSource,
        requestedModel: normalizedModel,
        enforcedModel: null,
        model: normalizedModel,
        effort: normalizedEffort,
        message: formatManualFallbackMessage(normalizedModel, `HTTP ${res.statusCode}`)
      });
    });

    req.on('upgrade', (res, socket, head) => {
      rawSocket = socket;

      socket.on('error', (err) => {
        settle({
          ok: false,
          status: HANDOFF_STATUS.FAILURE,
          manualFallbackRequired: true,
          error: `Socket communication error: ${err.message}`,
          threadId: candidateThreadId,
          threadResolutionSource: resolutionSource,
          requestedModel: normalizedModel,
          enforcedModel: null,
          model: normalizedModel,
          effort: normalizedEffort,
          message: formatManualFallbackMessage(normalizedModel, err.message)
        });
      });

      socket.on('close', () => {
        if (!isSettled) {
          settle({
            ok: false,
            status: HANDOFF_STATUS.FAILURE,
            manualFallbackRequired: true,
            error: 'Connection closed unexpectedly before settings update response',
            threadId: candidateThreadId,
            threadResolutionSource: resolutionSource,
            requestedModel: normalizedModel,
            enforcedModel: null,
            model: normalizedModel,
            effort: normalizedEffort,
            message: formatManualFallbackMessage(normalizedModel, 'Connection closed unexpectedly')
          });
        }
      });

      function sendClientJson(msg) {
        if (socket.destroyed) return;
        socket.write(encodeClientFrame(JSON.stringify(msg)));
      }

      const decoder = new WebSocketFrameDecoder((msgStr) => {
        let msg = null;
        try { msg = JSON.parse(msgStr); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        // Step 1: Handshake response (id: 1)
        if (msg.id === 1) {
          if (msg.error) {
            settle({
              ok: false,
              status: HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              error: `Initialize rejected: ${msg.error.message || JSON.stringify(msg.error)}`,
              code: msg.error.code,
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              requestedModel: normalizedModel,
              enforcedModel: null,
              model: normalizedModel,
              effort: normalizedEffort,
              rawResponse: msg,
              message: formatManualFallbackMessage(normalizedModel, msg.error.message)
            });
            return;
          }

          sendClientJson({ method: 'initialized' });

          const updateParams = { threadId: candidateThreadId };
          if (normalizedModel) updateParams.model = normalizedModel;
          if (normalizedEffort) updateParams.effort = normalizedEffort;

          sendClientJson({ id: 2, method: 'thread/settings/update', params: updateParams });
          return;
        }

        // Step 2: Settings update response (id: 2)
        if (msg.id === 2) {
          if (msg.error) {
            const errCode = msg.error.code;
            const errMsg = String(msg.error.message || '');
            const isUnsupported = errCode === -32601 || /method not found/i.test(errMsg) || /unsupported/i.test(errMsg);

            settle({
              ok: false,
              status: isUnsupported ? HANDOFF_STATUS.UNSUPPORTED : HANDOFF_STATUS.FAILURE,
              manualFallbackRequired: true,
              error: errMsg || 'thread/settings/update RPC returned error',
              code: errCode,
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              requestedModel: normalizedModel,
              enforcedModel: null,
              model: normalizedModel,
              effort: normalizedEffort,
              rawResponse: msg,
              message: formatManualFallbackMessage(normalizedModel, errMsg)
            });
            return;
          }

          if (msg.result !== undefined && msg.result !== null) {
            settle({
              ok: true,
              status: HANDOFF_STATUS.SUCCESS,
              enforcedStatus: 'enforced',
              threadId: candidateThreadId,
              threadResolutionSource: resolutionSource,
              requestedModel: normalizedModel,
              enforcedModel: normalizedModel,
              model: normalizedModel,
              effort: normalizedEffort,
              rawResponse: msg
            });
            return;
          }

          settle({
            ok: false,
            status: HANDOFF_STATUS.FAILURE,
            manualFallbackRequired: true,
            error: 'Malformed RPC response: missing result payload',
            threadId: candidateThreadId,
            threadResolutionSource: resolutionSource,
            requestedModel: normalizedModel,
            enforcedModel: null,
            model: normalizedModel,
            effort: normalizedEffort,
            rawResponse: msg,
            message: formatManualFallbackMessage(normalizedModel, 'missing result payload')
          });
        }
      });

      if (head && head.length > 0) decoder.push(head);
      socket.on('data', (chunk) => {
        try { decoder.push(chunk); }
        catch (err) {
          settle({
            ok: false,
            status: HANDOFF_STATUS.FAILURE,
            manualFallbackRequired: true,
            error: `Frame decoding failure: ${err.message}`,
            threadId: candidateThreadId,
            threadResolutionSource: resolutionSource,
            requestedModel: normalizedModel,
            enforcedModel: null,
            model: normalizedModel,
            effort: normalizedEffort,
            message: formatManualFallbackMessage(normalizedModel, err.message)
          });
        }
      });

      const clientInfo = options.clientInfo || { name: 'agent-core-handoff', version: '1.0.0' };
      sendClientJson({
        id: 1,
        method: 'initialize',
        params: { clientInfo, capabilities: { experimentalApi: true } }
      });
    });

    req.end();
  });
}

/**
 * Object-oriented wrapper for Codex interactive handoff operations.
 */
class CodexInteractiveHandoff {
  /**
   * @param {object} [options]
   * @param {string} [options.socketPath]
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    this.socketPath = options.socketPath || null;
    this.timeoutMs = options.timeoutMs || 5000;
  }

  /**
   * Updates settings for a live Codex interactive thread.
   * @param {object} params
   * @param {string} params.threadId
   * @param {string} [params.model]
   * @param {string} [params.effort]
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async updateThreadSettings(params, options = {}) {
    return updateCodexThreadSettings(params, {
      socketPath: options.socketPath || this.socketPath,
      timeoutMs: options.timeoutMs || this.timeoutMs,
      ...options
    });
  }
}

module.exports = {
  HANDOFF_STATUS,
  UUID_REGEX,
  isValidCodexThreadId,
  canonicalizeWorkspacePath,
  formatManualFallbackMessage,
  resolveCodexThreadId,
  resolveAuthoritativeCodexThreadId,
  isInteractiveCodexSession,
  resolveCodexAppServerControlSocket,
  encodeClientFrame,
  encodeCloseFrame,
  WebSocketFrameDecoder,
  updateCodexThreadSettings,
  CodexInteractiveHandoff
};
