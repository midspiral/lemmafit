#!/usr/bin/env node
/**
 * Lemmafit CLI - Verified vibe coding with Claude Code
 *
 * Commands:
 *   lemmafit init [dir]                   - Initialize a new lemmafit project (blank)
 *   lemmafit init --template <name> [dir] - Initialize from a named template
 *   lemmafit init --server <url|none> [dir] - Use a custom server (default: none)
 *   lemmafit add [Name]                   - Add a verified module (or just bootstrap infrastructure)
 *   lemmafit add <Name> --null-options    - Add with Option<T> → T | null mapping
 *   lemmafit add <Name> --no-json-api     - Add without JSON marshalling
 *   lemmafit add <Name> --target <target> - Set compilation target (client|node|inline|deno|cloudflare)
 *   lemmafit sync [dir]     - Sync system files from current package version
 *   lemmafit daemon [dir]   - Run the verification daemon
 *   lemmafit logs [dir]     - View the dev log
 *   lemmafit logs --clear [dir] - Clear the dev log
 *   lemmafit dashboard [dir] - Open the dashboard in a browser
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TEMPLATES_BASE = path.join(__dirname, '..');
const DEFAULT_TEMPLATE = 'blank-template';
const DEFAULT_SERVER = 'none';

function resolveTemplate(name) {
  const templateDir = path.join(TEMPLATES_BASE, name);
  if (!fs.existsSync(templateDir)) {
    const available = fs.readdirSync(TEMPLATES_BASE)
      .filter(f => f.endsWith('-template') && fs.statSync(path.join(TEMPLATES_BASE, f)).isDirectory());
    console.error(`Error: Unknown template '${name}'`);
    console.error(`Available templates: ${available.join(', ')}`);
    process.exit(1);
  }
  return templateDir;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destName = entry.name === 'template.gitignore' ? '.gitignore' : entry.name;
    const destPath = path.join(dest, destName);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function syncProject(targetDir) {
  const absTarget = path.resolve(targetDir);
  const { syncProject: sync } = require('./sync');
  sync(absTarget);
}

function initProject(targetDir, templateName, serverBase) {
  const absTarget = path.resolve(targetDir);
  const templateDir = resolveTemplate(templateName);

  const ignorable = new Set(['.git', '.DS_Store']);
  if (fs.existsSync(absTarget) && fs.readdirSync(absTarget).some(f => !ignorable.has(f))) {
    console.error(`Error: Directory '${absTarget}' is not empty`);
    process.exit(1);
  }

  console.log(`Creating lemmafit project at ${absTarget} (template: ${templateName})...`);

  // Copy template (user-owned files only)
  copyDir(templateDir, absTarget);

  // Rewrite lemmafit dependency to point to local package
  const pkgJsonPath = path.join(absTarget, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (pkg.dependencies && pkg.dependencies.lemmafit) {
      const lemmaPackageDir = path.resolve(__dirname, '..');
      const relPath = path.relative(absTarget, lemmaPackageDir);
      pkg.dependencies.lemmafit = `file:${relPath}`;
      fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  }

  // Sync system files (.claude/settings.json, .claude/CLAUDE.md)
  syncProject(absTarget);

  // Generate per-project secret and server URL, write into .vibe/config.json
  const secret = 'lf_sk_' + crypto.randomBytes(32).toString('hex');
  const projectName = path.basename(absTarget);
  const vibeDir = path.join(absTarget, 'lemmafit', '.vibe');
  const configPath = path.join(vibeDir, 'config.json');
  fs.mkdirSync(vibeDir, { recursive: true });
  let config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  }
  config.secret = secret;
  if (serverBase.toLowerCase() !== 'none') {
    const serverWsUrl = `${serverBase}/ws?project=${encodeURIComponent(projectName)}`;
    config.server = serverWsUrl;
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log('Done! Next steps:');
  console.log('');
  console.log(`  cd ${targetDir}`);
  console.log('  npm install          # Downloads Dafny, installs deps, syncs hooks');
  console.log('  npm run daemon       # In one terminal, start the verification daemon');
  console.log('  npm run dev          # In another terminal, start the Vite dev server');
  if (serverBase.toLowerCase() !== 'none') {
    console.log('  lemmafit dashboard   # Open the dashboard');
  }
  console.log('');
  if (serverBase.toLowerCase() !== 'none') {
    console.log(`Server: ${serverBase}`);
  }
  console.log('Then open Claude Code in the project directory.');
  console.log('');
}

function addModule(targetDir, moduleName, options = {}) {
  const absTarget = path.resolve(targetDir);

  const lemmafitDir = path.join(absTarget, 'lemmafit');
  const vibeDir = path.join(lemmafitDir, '.vibe');
  const dafnyDir = path.join(lemmafitDir, 'dafny');
  const configPath = path.join(vibeDir, 'config.json');
  const modulesPath = path.join(vibeDir, 'modules.json');
  const isFirstRun = !fs.existsSync(lemmafitDir);

  // First run: bootstrap lemmafit infrastructure
  if (isFirstRun) {
    console.log('First lemmafit module — bootstrapping infrastructure...');
    fs.mkdirSync(dafnyDir, { recursive: true });
    fs.mkdirSync(vibeDir, { recursive: true });

    // Minimal config (no entry/appCore since we use modules.json)
    fs.writeFileSync(configPath, JSON.stringify({}, null, 2) + '\n');

    // Empty modules array
    fs.writeFileSync(modulesPath, JSON.stringify([], null, 2) + '\n');

    // Sync .claude/ system files
    syncProject(absTarget);

    // Add lemmafit as devDependency and daemon script to package.json
    // Create a minimal package.json if one doesn't exist
    const pkgJsonPath = path.join(absTarget, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      const dirName = path.basename(absTarget);
      fs.writeFileSync(pkgJsonPath, JSON.stringify({
        name: dirName,
        private: true
      }, null, 2) + '\n');
      console.log('  Created package.json');
    }
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    if (!pkg.devDependencies) pkg.devDependencies = {};
    if (!pkg.devDependencies.lemmafit && !(pkg.dependencies && pkg.dependencies.lemmafit)) {
      const lemmaPackageDir = path.resolve(__dirname, '..');
      const relPath = path.relative(absTarget, lemmaPackageDir);
      pkg.devDependencies.lemmafit = `file:${relPath}`;
    }
    if (!pkg.scripts) pkg.scripts = {};
    if (!pkg.scripts.daemon) {
      pkg.scripts.daemon = 'lemmafit daemon';
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');

    console.log('  Created lemmafit/dafny/');
    console.log('  Created lemmafit/.vibe/config.json');
    console.log('  Created lemmafit/.vibe/modules.json');
    console.log('  Synced .claude/ system files');
    console.log('');
  }

  if (!moduleName) return;

  // Load existing modules
  let modules = [];
  if (fs.existsSync(modulesPath)) {
    try { modules = JSON.parse(fs.readFileSync(modulesPath, 'utf8')); } catch {}
  }

  // Check for duplicate
  if (modules.some(m => m.outputName === moduleName)) {
    console.error(`Error: Module '${moduleName}' already exists in modules.json`);
    process.exit(1);
  }

  // Scaffold the Dafny file
  const dafnyFile = path.join(dafnyDir, `${moduleName}.dfy`);
  if (fs.existsSync(dafnyFile)) {
    console.error(`Error: ${path.relative(absTarget, dafnyFile)} already exists`);
    process.exit(1);
  }

  const dafnyContent = `module ${moduleName} {
  // Your verified logic here
}
`;
  fs.mkdirSync(dafnyDir, { recursive: true });
  fs.writeFileSync(dafnyFile, dafnyContent);

  // Add entry to modules.json
  const moduleEntry = {
    entry: `lemmafit/dafny/${moduleName}.dfy`,
    appCore: moduleName,
    outputName: moduleName,
    jsonApi: options.jsonApi !== false,
    nullOptions: options.nullOptions || false
  };
  if (options.target) moduleEntry.target = options.target;
  modules.push(moduleEntry);
  fs.writeFileSync(modulesPath, JSON.stringify(modules, null, 2) + '\n');

  // Print results
  console.log(`  Created lemmafit/dafny/${moduleName}.dfy`);
  console.log(`  Added to lemmafit/.vibe/modules.json`);
  console.log('');
  console.log(`  Next: write your verified logic in ${moduleName}.dfy`);
  console.log(`  The daemon will compile it to src/dafny/${moduleName}.ts`);
  console.log(`  Import with: import ${moduleName} from './src/dafny/${moduleName}.ts'`);
  console.log('');
  if (modules.length > 1) {
    console.log(`  Modules: ${modules.map(m => m.outputName).join(', ')}`);
    console.log('');
  }
}

function showLogs(targetDir, clear) {
  const absTarget = path.resolve(targetDir);
  const logPath = path.join(absTarget, 'lemmafit', 'logs', 'lemmafit.log');

  if (clear) {
    try {
      fs.unlinkSync(logPath);
      console.log('Cleared lemmafit/logs/lemmafit.log');
    } catch {
      console.log('No log file to clear.');
    }
    return;
  }

  try {
    const contents = fs.readFileSync(logPath, 'utf8');
    process.stdout.write(contents);
  } catch {
    console.log('No log file found. Logs will appear after hooks run.');
  }
}

function openDashboard(targetDir) {
  const absTarget = path.resolve(targetDir);
  const configPath = path.join(absTarget, 'lemmafit', '.vibe', 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Error: No lemmafit config found. Run "lemmafit init" first.');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    console.error('Error: Could not read lemmafit/.vibe/config.json');
    process.exit(1);
  }

  if (!config.server) {
    console.error('Error: No "server" field in config. Add a server URL to lemmafit/.vibe/config.json');
    process.exit(1);
  }

  // Derive HTTP dashboard URL from the WS server URL
  // e.g. ws://localhost:8787/ws?project=foo -> http://localhost:8787/
  // No secret in URL — user authenticates via Supabase in the browser
  const wsUrl = new URL(config.server);
  const dashboardUrl = new URL(`${wsUrl.protocol === 'wss:' ? 'https' : 'http'}://${wsUrl.host}/`);

  const project = wsUrl.searchParams.get('project') || 'default';
  dashboardUrl.hash = `project=${encodeURIComponent(project)}`;

  const url = dashboardUrl.toString();
  console.log(`Opening dashboard: ${url}`);
  console.log('');
  console.log('To register this project, use these credentials:');
  console.log(`  Project: ${project}`);
  console.log(`  Secret:  ${config.secret}`);
  console.log('');

  // Open in default browser
  const { spawn } = require('child_process');
  const openCmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  spawn(openCmd, [url]);
}

function runDaemon(targetDir) {
  const absTarget = path.resolve(targetDir);
  const { Daemon } = require('../lib/daemon');
  const daemon = new Daemon(absTarget);
  daemon.watch();
}

// Parse arguments
const args = process.argv.slice(2);
const command = args[0];
const clearFlag = args.includes('--clear');
const nullOptionsFlag = args.includes('--null-options');
const noJsonApiFlag = args.includes('--no-json-api');
const targetIdx = args.indexOf('--target');
const targetFlag = targetIdx !== -1 ? args[targetIdx + 1] : null;
const templateIdx = args.indexOf('--template');
const templateName = templateIdx !== -1 ? args[templateIdx + 1] : DEFAULT_TEMPLATE;
const serverIdx = args.indexOf('--server');
const serverBase = serverIdx !== -1 ? args[serverIdx + 1] : DEFAULT_SERVER;
const positionalArgs = args.filter((a, i) =>
  a !== '--clear' && a !== '--template' && a !== '--server' &&
  a !== '--null-options' && a !== '--no-json-api' && a !== '--target' &&
  (targetIdx === -1 || i !== targetIdx + 1) &&
  (templateIdx === -1 || i !== templateIdx + 1) &&
  (serverIdx === -1 || i !== serverIdx + 1)
).slice(1);
let addModuleName = null;
let target;
if (command === 'add') {
  addModuleName = positionalArgs[0] || null;
  target = '.';
} else {
  target = positionalArgs[0] || '.';
}

switch (command) {
  case 'init':
    initProject(target, templateName, serverBase);
    break;
  case 'add':
    addModule(target, addModuleName, {
      jsonApi: !noJsonApiFlag,
      nullOptions: nullOptionsFlag,
      target: targetFlag
    });
    break;
  case 'sync':
    syncProject(target);
    break;
  case 'daemon':
    runDaemon(target);
    break;
  case 'dashboard':
    openDashboard(target);
    break;
  case 'logs':
    showLogs(target, clearFlag);
    break;
  case undefined:
  case '--help':
  case '-h':
    console.log('Lemmafit - Verified vibe coding with Claude Code');
    console.log('');
    console.log('Usage:');
    console.log('  lemmafit init [dir]                   - Create a new project (blank template)');
    console.log('  lemmafit init --template <name> [dir] - Create from a named template');
    console.log('  lemmafit init --server <url> [dir]    - Use a custom server (default: none)');
    console.log('  lemmafit add [Name]                    - Add a verified module (or just bootstrap infrastructure)');
    console.log('  lemmafit add <Name> --null-options     - Add with Option<T> → T | null mapping');
    console.log('  lemmafit add <Name> --no-json-api      - Add without JSON marshalling');
    console.log('  lemmafit add <Name> --target <target>  - Set compilation target (client|node|inline|deno|cloudflare)');
    console.log('  lemmafit sync [dir]          - Sync system files from package');
    console.log('  lemmafit daemon [dir]        - Run the verification daemon');
    console.log('  lemmafit dashboard [dir]     - Open the dashboard in a browser');
    console.log('  lemmafit logs [dir]          - View the dev log');
    console.log('  lemmafit logs --clear [dir]  - Clear the dev log');
    console.log('');
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "lemmafit --help" for usage');
    process.exit(1);
}
