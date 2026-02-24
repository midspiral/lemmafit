#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook for lemmafit.
 *
 * When Claude writes a .dfy file, this hook:
 * 1. Requests verification from the daemon via Unix socket
 * 2. Outputs result for Claude to see
 *
 * Hook receives JSON on stdin:
 * {
 *   "hook": "PostToolUse",
 *   "tool_name": "Write",
 *   "tool_input": { "file_path": "...", "content": "..." },
 *   "tool_output": "..."
 * }
 */

const path = require('path');
const fs = require('fs');
const { initLog, log } = require('../lib/log');
const { requestDaemon } = require('../lib/daemon-client');

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function findProjectRoot(filePath) {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'lemmafit'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function readStatus(projectDir) {
  const statusPath = path.join(projectDir, 'lemmafit', '.vibe', 'status.json');
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

function formatErrors(status) {
  const lines = [];
  for (const [file, fileStatus] of Object.entries(status.files || {})) {
    for (const error of fileStatus.errors || []) {
      lines.push(`  ${file}:${error.line}: ${error.message}`);
    }
  }
  return lines.join('\n');
}

function formatWarnings(status) {
  const lines = [];
  for (const [file, fileStatus] of Object.entries(status.files || {})) {
    for (const warning of fileStatus.warnings || []) {
      lines.push(`  ${file}:${warning.line}: ${warning.message}`);
    }
  }
  return lines.join('\n');
}

function formatAxioms(status) {
  const axioms = status.axioms || [];
  if (axioms.length === 0) return '';

  const lines = axioms.map(a => `  ${a.file}:${a.line}: ${a.content}`);
  return `\nAxioms (unproven assumptions):\n${lines.join('\n')}`;
}

function formatSpecQueue(status) {
  const queue = status.specQueue;
  if (!queue || queue.length === 0) return '';

  const verified = queue.filter(c => c.verifiedAt).length;
  const unverified = queue.length - verified;
  const summary = [
    unverified > 0 ? `${unverified} pending` : null,
    verified > 0 ? `${verified} verified` : null,
  ].filter(Boolean).join(', ');

  const lines = ['', `Spec queue (${summary}):`];
  for (const c of queue) {
    const tag = c.verifiedAt ? ' [verified]' : '';
    if (c.type === 'added') {
      lines.push(`  +${c.line}: ${c.text}${tag}`);
    } else if (c.type === 'removed') {
      lines.push(`  - ${c.text}${tag}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const input = await readStdin();

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const toolName = hookData.tool_name;
  const filePath = hookData.tool_input?.file_path;

  if ((toolName !== 'Write' && toolName !== 'Edit') || !filePath?.endsWith('.dfy')) {
    process.exit(0);
  }

  const projectDir = findProjectRoot(filePath);
  if (!projectDir) {
    console.log(JSON.stringify({
      systemMessage: '[lemmafit] verify-hook executed (no project found)',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Note: Not in a lemmafit project (no lemmafit directory found)' }
    }));
    process.exit(0);
  }

  initLog(projectDir);
  log('verify', `Write detected: ${filePath}`);

  const lines = ['Verifying...'];
  let status;

  try {
    const sockPath = path.join(projectDir, 'lemmafit', '.vibe', 'daemon.sock');
    status = await requestDaemon(sockPath, { action: 'verify' });
    log('verify', 'Used daemon (socket)');
  } catch (err) {
    log('verify', `Socket failed, falling back to direct: ${err.message}`);
    const { Daemon } = require('../lib/daemon');
    const daemon = new Daemon(projectDir);
    await daemon.runOnce();
    status = readStatus(projectDir);
  }

  if (!status) {
    lines.push('Warning: Could not read verification status');
    console.log(JSON.stringify({
      systemMessage: '[lemmafit] verify-hook executed',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') }
    }));
    process.exit(0);
  }

  if (status.state === 'verified') {
    const axiomNote = (status.axioms?.length > 0)
      ? ` (${status.axioms.length} axiom${status.axioms.length > 1 ? 's' : ''})`
      : '';
    log('verify', `Verified${axiomNote}`);
    lines.push(`✓ Verified and compiled${axiomNote}`);
    if (status.axioms?.length > 0) {
      lines.push(formatAxioms(status));
    }

    // Stamp unverified spec queue items so Claude knows code compiled with them in scope
    if (status.specQueue?.length > 0) {
      const now = new Date().toISOString();
      let stamped = 0;
      for (const item of status.specQueue) {
        if (!item.verifiedAt) {
          item.verifiedAt = now;
          stamped++;
        }
      }
      if (stamped > 0) {
        const statusPath = path.join(projectDir, 'lemmafit', '.vibe', 'status.json');
        status.timestamp = new Date().toISOString();
        fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
        log('verify', `Stamped ${stamped} spec queue item(s) as verified`);
      }
    }
  } else if (status.state === 'error') {
    const errorCount = Object.values(status.files || {})
      .reduce((sum, f) => sum + (f.errors?.length || 0), 0);
    const warningCount = Object.values(status.files || {})
      .reduce((sum, f) => sum + (f.warnings?.length || 0), 0);
    if (errorCount === 0 && warningCount > 0) {
      log('verify', `Verification passed, compilation blocked (${warningCount} warning(s))`);
      lines.push(`⚠ Verification passed, compilation blocked (${warningCount} warning${warningCount !== 1 ? 's' : ''}):`);
      lines.push(formatWarnings(status));
    } else {
      log('verify', `Failed with ${errorCount} error(s)`);
      lines.push(`✗ Verification failed (${errorCount} error${errorCount !== 1 ? 's' : ''}):`);
      lines.push(formatErrors(status));
      if (warningCount > 0) {
        lines.push(`\n⚠ Warnings (${warningCount}):`);
        lines.push(formatWarnings(status));
      }
    }
    if (status.compileError) {
      lines.push(`\nCompilation error: ${status.compileError}`);
    }
  } else {
    lines.push(`Status: ${status.state}`);
  }

  const specLine = formatSpecQueue(status);
  if (specLine) {
    lines.push(specLine);
  }

  console.log(JSON.stringify({
    systemMessage: '[lemmafit] verify-hook executed',
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') }
  }));
}

main().catch((err) => {
  console.error('Hook error:', err.message);
  process.exit(1);
});
