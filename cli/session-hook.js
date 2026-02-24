#!/usr/bin/env node
/**
 * Claude Code SessionStart hook for lemmafit.
 *
 * Fires once at the start of each session. Tells Claude to read
 * the lemmafit instructions file from the installed package.
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
  log('session', 'Session started');

  const instructionsPath = path.join(projectDir, 'node_modules', 'lemmafit', 'docs', 'CLAUDE_INSTRUCTIONS.md');
  if (fs.existsSync(instructionsPath)) {
    log('session', `Injecting instructions from ${instructionsPath}`);
    const context = `<lemmafit-instructions>\nRead and follow the project instructions at: ${instructionsPath}\n</lemmafit-instructions>`;
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context
      }
    }));
  } else {
    log('session', 'Instructions file not found (node_modules/lemmafit not installed?)');
  }
}

main().catch(() => {
  process.exit(0);
});
