#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook for lemmafit.
 *
 * Reads lemmafit/.vibe/status.json and writes it to stdout so Claude
 * sees the current verification status before processing every prompt.
 *
 * Hook receives JSON on stdin with { "cwd": "..." }
 */

const path = require('path');
const fs = require('fs');
const { initLog, log } = require('../lib/log');

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function findProjectRoot(dir) {
  let current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'lemmafit'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

async function main() {
  const input = await readStdin();

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const cwd = hookData.cwd;
  if (!cwd) {
    process.exit(0);
  }

  const projectDir = findProjectRoot(cwd);
  if (!projectDir) {
    process.exit(0);
  }

  initLog(projectDir);
  log('context', 'Injecting status into prompt');

  const statusPath = path.join(projectDir, 'lemmafit', '.vibe', 'status.json');
  let status;
  try {
    status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    log('context', 'status.json missing or unreadable');
    const context = `<lemmafit-status>
{ "state": "unavailable", "error": "status.json missing or unreadable — is the daemon running?" }
</lemmafit-status>`;
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      }
    }));
    process.exit(0);
  }

  // Inject status with full spec queue items so Claude can act on them directly
  const summary = {
    state: status.state,
    compiled: status.compiled,
    lastCompiled: status.lastCompiled,
    timestamp: status.timestamp,
    files: status.files,
    axioms: status.axioms,
    compileError: status.compileError || undefined,
    specQueue: status.specQueue || [],
  };

  const context = `<lemmafit-status>
${JSON.stringify(summary, null, 2)}
</lemmafit-status>
<lemmafit-status-file>${statusPath}</lemmafit-status-file>`;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    }
  }));
}

main().catch((err) => {
  console.error('Context hook error:', err.message);
  process.exit(1);
});
