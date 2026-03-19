#!/usr/bin/env node
/**
 * Lemmafit sync - writes system-owned files into a lemmafit project.
 *
 * Runs automatically as postinstall when lemmafit is installed/updated.
 * Also available as `lemmafit sync [dir]`.
 *
 * System files written:
 *   .claude/settings.json  - Claude Code hook configuration
 *   .claude/CLAUDE.md      - Pointer to package instructions (append-safe)
 */

const path = require('path');
const fs = require('fs');
const { initLog, log } = require('../lib/log');

const POINTER_LINE = 
`============================== LEMMAFIT SYSTEM PROMPT - DO NOT EDIT ====================================
This project uses lemmafit to formally verify logic. 
You MUST read the lemmafit project instructions at node_modules/lemmafit/docs/CLAUDE_INSTRUCTIONS.md before writing any code. 
===============================================================================================
`;

const SETTINGS = {
  permissions: {
    allow: [
      // Lemmafit project files Claude needs to read/write without prompting
      "Read(SPEC.yaml)",
      "Read(lemmafit/**)",
      "Read(src/dafny/**)",
      "Read(node_modules/lemmafit/docs/**)",
      "Edit(SPEC.yaml)",
      "Edit(lemmafit/dafny/*.dfy)",
      "Write(SPEC.yaml)",
      "Write(lemmafit/dafny/*.dfy)",
      // Common build/dev commands
      "Bash(npm run build:*)",
      "Bash(npm run dev:*)",
      "Bash(npx tsc:*)"
    ]
  },
  hooks: {
    PostToolUse: [
      {
        matcher: "Write|Edit",
        hooks: [
          { type: "command", command: "lemmafit-verify-hook" }
        ]
      }
    ],
    UserPromptSubmit: [
      {
        hooks: [
          { type: "command", command: "lemmafit-context-hook" }
        ]
      }
    ],
    SessionStart: [
      {
        hooks: [
          { type: "command", command: "lemmafit-session-hook" }
        ]
      }
    ]
  }
};

function findProjectRoot() {
  // When run as postinstall, CWD is inside node_modules/lemmafit.
  // Walk up to find the project root (has package.json but is not this package).
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name !== 'lemmafit') {
          return dir;
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return null;
}

function syncProject(targetDir) {
  const absTarget = path.resolve(targetDir);

  initLog(absTarget);
  log('sync', 'Starting sync');

  // Write .claude/settings.json
  const claudeDir = path.join(absTarget, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  fs.writeFileSync(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify(SETTINGS, null, 2) + '\n'
  );

  // Write or append .claude/CLAUDE.md
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf8');
    if (!existing.includes(POINTER_LINE)) {
      fs.appendFileSync(claudeMdPath, '\n' + POINTER_LINE + '\n');
    }
  } else {
    fs.writeFileSync(claudeMdPath, POINTER_LINE + '\n');
  }

  // Sync .claude/skills/ from package
  const srcSkills = path.join(__dirname, '..', 'skills');
  if (fs.existsSync(srcSkills)) {
    const skillsDir = path.join(claudeDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    for (const skillFolder of fs.readdirSync(srcSkills)) {
      const srcSkillDir = path.join(srcSkills, skillFolder);
      if (!fs.statSync(srcSkillDir).isDirectory()) continue;
      const destSkillDir = path.join(skillsDir, skillFolder);
      fs.mkdirSync(destSkillDir, { recursive: true });
      for (const file of fs.readdirSync(srcSkillDir)) {
        fs.copyFileSync(
          path.join(srcSkillDir, file),
          path.join(destSkillDir, file)
        );
      }
    }
  }

  log('sync', 'Synced system files to .claude/');
  console.log('lemmafit: synced system files to .claude/');
}

module.exports = { syncProject };

// Run as script when invoked directly
if (require.main === module) {

// Determine target directory
const explicitTarget = process.argv[2];

if (explicitTarget) {
  // Called as `lemmafit sync <dir>` or `node cli/sync.js <dir>`
  syncProject(explicitTarget);
} else {
  // Called as postinstall or `lemmafit sync` (no arg)
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    syncProject(projectRoot);
  }
  // If no project root found (e.g. installing lemmafit globally), silently do nothing.
}
}
