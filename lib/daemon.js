/**
 * Lemmafit Daemon - Continuous verification and compilation for verified vibe coding.
 *
 * Watches Dafny files, runs verification, compiles on success, and writes status.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { spawnClaude } = require('./spawn-claude');

class Daemon {
  constructor(projectDir, options = {}) {
    this.projectDir = path.resolve(projectDir);
    this.dafnyDir = path.join(this.projectDir, 'lemmafit', 'dafny');
    this.vibeDir = path.join(this.projectDir, 'lemmafit', '.vibe');
    this.statusPath = path.join(this.vibeDir, 'status.json');
    this.configPath = path.join(this.vibeDir, 'config.json');
    this.srcDafnyDir = path.join(this.projectDir, 'src', 'dafny');
    this.pollInterval = options.pollInterval || 500;
    this.dafnyPath = options.dafnyPath || this.findDafny();

    // Ensure directories exist
    fs.mkdirSync(this.vibeDir, { recursive: true });
    fs.mkdirSync(this.srcDafnyDir, { recursive: true });

    // Shared cache paths (~/.lemmafit), with fallback to package-local
    const cacheDir = path.join(os.homedir(), '.lemmafit');
    const cacheDafny2js = path.join(cacheDir, '.dafny2js', 'dafny2js');
    this.dafny2jsBin = fs.existsSync(cacheDafny2js)
      ? cacheDafny2js
      : path.join(__dirname, '..', '.dafny2js', 'dafny2js');
    this.kernelPath = path.join(__dirname, '..', 'kernels', 'Replay.dfy');

    // Load or create config
    this.config = this.loadConfig();
    this.modulesPath = path.join(this.vibeDir, 'modules.json');
    this.modules = this.loadModules();

    // WS relay state (only active when config.server is set)
    this.relayWs = null;
    this.relayConnected = false;
    this.relayRetryDelay = 1000;

    // Sync bundled Replay.dfy into project
    this.syncKernel();
  }

  syncKernel() {
    const target = path.join(this.dafnyDir, 'Replay.dfy');
    if (!fs.existsSync(this.kernelPath)) return;
    try {
      const src = fs.readFileSync(this.kernelPath, 'utf8');
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (src !== existing) {
        fs.mkdirSync(this.dafnyDir, { recursive: true });
        fs.writeFileSync(target, src);
      }
    } catch {}
  }

  findDafny() {
    // Check shared cache directory first (~/.lemmafit)
    const cacheDafny = path.join(os.homedir(), '.lemmafit', '.dafny', 'dafny', 'dafny');
    if (fs.existsSync(cacheDafny)) {
      return cacheDafny;
    }
    // Check lemmafit package directory (fallback)
    const lemmafitDafny = path.join(__dirname, '..', '.dafny', 'dafny', 'dafny');
    if (fs.existsSync(lemmafitDafny)) {
      return lemmafitDafny;
    }
    // Fall back to global dafny
    return 'dafny';
  }

  loadConfig() {
    const defaultConfig = {
      entry: 'lemmafit/dafny/Domain.dfy',
      appCore: 'AppCore',
      outputName: 'Domain'
    };

    if (fs.existsSync(this.configPath)) {
      try {
        return { ...defaultConfig, ...JSON.parse(fs.readFileSync(this.configPath, 'utf8')) };
      } catch {
        return defaultConfig;
      }
    }

    fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`Created default config at ${this.configPath}`);
    return defaultConfig;
  }

  loadModules() {
    if (fs.existsSync(this.modulesPath)) {
      try {
        const modules = JSON.parse(fs.readFileSync(this.modulesPath, 'utf8'));
        if (Array.isArray(modules) && modules.length > 0) {
          return modules;
        }
      } catch {}
    }
    // Fall back to single-module from config.json
    return [{
      entry: this.config.entry,
      appCore: this.config.appCore,
      outputName: this.config.outputName
    }];
  }

  isMultiModule() {
    return fs.existsSync(this.modulesPath);
  }

  readSpecFile() {
    const specPath = path.join(this.projectDir, 'SPEC.yaml');
    if (!fs.existsSync(specPath)) return null;
    try {
      return fs.readFileSync(specPath, 'utf8');
    } catch {
      return null;
    }
  }

  hashSpecFile() {
    const content = this.readSpecFile();
    if (!content) return '';
    return crypto.createHash('md5').update(content).digest('hex');
  }

  diffLines(oldText, newText) {
    const oldLines = new Set((oldText || '').split('\n'));
    const newLines = (newText || '').split('\n');
    const newSet = new Set(newLines);
    const changes = [];

    // Lines in new but not in old → added
    for (let i = 0; i < newLines.length; i++) {
      if (!oldLines.has(newLines[i])) {
        changes.push({ line: i + 1, type: 'added', text: newLines[i] });
      }
    }

    // Lines in old but not in new → removed
    for (const line of oldLines) {
      if (!newSet.has(line)) {
        changes.push({ type: 'removed', text: line });
      }
    }

    return changes;
  }

  makeChangeId(change) {
    const key = `${change.type}:${change.text}`;
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 8);
  }

  onSpecChanged(newContent) {
    const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${timestamp()}] SPEC.yaml changed`);

    let currentStatus = {};
    try {
      currentStatus = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
    } catch {}

    // Diff against ackedSpecContent (last content Claude acted on),
    // not specContent (which tracks the latest file state)
    const baseContent = currentStatus.ackedSpecContent || currentStatus.specContent || null;
    const changes = this.diffLines(baseContent, newContent);

    const specQueue = changes.map(c => ({
      id: this.makeChangeId(c),
      ...c
    }));

    for (const c of changes) {
      if (c.type === 'added') {
        console.log(`  +${c.line}: ${c.text}`);
      } else if (c.type === 'removed') {
        console.log(`  - ${c.text}`);
      }
    }

    this.writeStatus({
      ...currentStatus,
      specQueue,
      specContent: newContent
    });
    this.relaySend({ type: 'stateUpdate', key: 'spec', payload: newContent });
  }

  ackSpec() {
    const currentContent = this.readSpecFile();
    if (!currentContent) return;

    let currentStatus = {};
    try {
      currentStatus = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
    } catch {}

    currentStatus.ackedSpecContent = currentContent;
    currentStatus.specContent = currentContent;
    currentStatus.specQueue = [];

    this.writeStatus(currentStatus);
  }

  hashDafnyFiles() {
    if (!fs.existsSync(this.dafnyDir)) return '';

    const files = this.findDafnyFiles(this.dafnyDir);
    if (files.length === 0) return '';

    const hash = crypto.createHash('md5');
    for (const file of files.sort()) {
      try {
        hash.update(fs.readFileSync(file, 'utf8'));
      } catch {}
    }
    // Include modules.json so config changes trigger recompilation
    try {
      hash.update(fs.readFileSync(this.modulesPath, 'utf8'));
    } catch {}
    return hash.digest('hex');
  }

  findDafnyFiles(dir) {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.findDafnyFiles(fullPath));
      } else if (entry.name.endsWith('.dfy')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  writeStatus(status) {
    // Preserve spec fields across writes (e.g. verification cycles)
    try {
      const prev = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
      if (!('specContent' in status) && prev.specContent) {
        status.specContent = prev.specContent;
      }
      if (!('ackedSpecContent' in status) && prev.ackedSpecContent) {
        status.ackedSpecContent = prev.ackedSpecContent;
      }
      if (!('specQueue' in status) && prev.specQueue) {
        status.specQueue = prev.specQueue;
      }
    } catch {}
    status.timestamp = new Date().toISOString();
    fs.writeFileSync(this.statusPath, JSON.stringify(status, null, 2));
    this.relaySend({ type: 'stateUpdate', key: 'status', payload: status });
  }

  parseDafnyErrors(output) {
    const errors = [];
    // Match: file.dfy(line,col): Error: message
    const pattern = /([^\s(]+)\((\d+),(\d+)\):\s*Error:\s*(.+)/g;
    let match;
    while ((match = pattern.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        message: match[4]
      });
    }
    return errors;
  }

  parseDafnyWarnings(output) {
    const warnings = [];
    // Match: file.dfy(line,col): Warning: message
    const pattern = /([^\s(]+)\((\d+),(\d+)\):\s*Warning:\s*(.+)/g;
    let match;
    while ((match = pattern.exec(output)) !== null) {
      warnings.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        message: match[4]
      });
    }
    return warnings;
  }

  extractAxioms(dafnyFile) {
    const axioms = [];
    try {
      const content = fs.readFileSync(dafnyFile, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('assume {:axiom}') || line.includes('assume{:axiom}')) {
          axioms.push({
            file: path.relative(this.projectDir, dafnyFile),
            line: i + 1,
            content: line.trim()
          });
        }
      }
    } catch {}
    return axioms;
  }

  runCommand(cmd, args, cwd) {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        cwd: cwd || this.projectDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on('error', (err) => {
        resolve({ code: 1, stdout: '', stderr: err.message });
      });
    });
  }

  async verify() {
    const dafnyFiles = this.findDafnyFiles(this.dafnyDir);
    if (dafnyFiles.length === 0) {
      return { passed: false, fileStatuses: {}, axioms: [] };
    }

    const fileStatuses = {};
    const allAxioms = [];
    let allPassed = true;

    for (const dafnyFile of dafnyFiles) {
      const relPath = path.relative(this.projectDir, dafnyFile);
      const axioms = this.extractAxioms(dafnyFile);
      allAxioms.push(...axioms);

      const result = await this.runCommand(
        this.dafnyPath,
        ['verify', dafnyFile, '--verification-time-limit=300']
      );

      const output = result.stdout + result.stderr;
      const errors = this.parseDafnyErrors(output);
      const warnings = this.parseDafnyWarnings(output);

      if (result.code === 0) {
        fileStatuses[relPath] = { verified: true, errors: [], warnings, axioms };
      } else {
        fileStatuses[relPath] = { verified: false, errors, warnings, axioms };
        allPassed = false;
      }
    }

    return { passed: allPassed, fileStatuses, axioms: allAxioms };
  }

  async compile() {
    // Reload modules in case modules.json was created/changed
    this.modules = this.loadModules();

    const errors = [];
    for (const mod of this.modules) {
      const result = await this.compileModule(mod);
      if (!result.success) {
        errors.push(`${mod.outputName}: ${result.error}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, error: errors.join('\n') };
    }
    return { success: true };
  }

  async compileModule(mod) {
    const entryPath = path.join(this.projectDir, mod.entry);
    if (!fs.existsSync(entryPath)) {
      return { success: false, error: `Entry file not found: ${mod.entry}` };
    }

    const generatedDir = path.join(this.projectDir, 'generated');
    fs.mkdirSync(generatedDir, { recursive: true });

    const outputBase = path.join(generatedDir, mod.outputName);

    // Step 1: dafny translate js
    const translateResult = await this.runCommand(this.dafnyPath, [
      'translate', 'js',
      '--no-verify',
      '-o', outputBase,
      '--include-runtime',
      entryPath
    ]);

    if (translateResult.code !== 0) {
      return { success: false, error: `dafny translate failed: ${translateResult.stderr}` };
    }

    // Step 2: Copy to src/dafny/
    const generatedJs = `${outputBase}.js`;
    if (!fs.existsSync(generatedJs)) {
      return { success: false, error: `Generated JS not found: ${generatedJs}` };
    }

    const outputDir = mod.outputDir
      ? path.resolve(this.projectDir, mod.outputDir)
      : this.srcDafnyDir;
    fs.mkdirSync(outputDir, { recursive: true });

    const targetCjs = path.join(outputDir, `${mod.outputName}.cjs`);
    fs.copyFileSync(generatedJs, targetCjs);

    // Step 3: Run dafny2js to generate wrapper
    if (!fs.existsSync(this.dafny2jsBin)) {
      return { success: false, error: `dafny2js not found at ${this.dafny2jsBin}` };
    }

    // Multi-module: each module gets its own {outputName}.ts
    // Single-module (backward compat): output is app.ts
    const wrapperName = this.isMultiModule()
      ? `${mod.outputName}.ts`
      : 'app.ts';
    const wrapperPath = path.join(outputDir, wrapperName);

    const targetFlag = `--${mod.target || 'client'}`;
    const dafny2jsArgs = [
      '--file', entryPath,
      '--app-core', mod.appCore,
      '--cjs-name', `${mod.outputName}.cjs`,
      targetFlag, wrapperPath
    ];

    if (mod.jsonApi) dafny2jsArgs.push('--json-api');
    if (mod.nullOptions) dafny2jsArgs.push('--null-options');

    const dafny2jsResult = await this.runCommand(this.dafny2jsBin, dafny2jsArgs);

    if (dafny2jsResult.code !== 0) {
      return { success: false, error: `dafny2js failed: ${dafny2jsResult.stderr || dafny2jsResult.stdout}` };
    }

    return { success: true };
  }

  async extractClaims() {
    const claimsPath = path.join(this.vibeDir, 'claims.json');
    const allClaims = { axioms: [], lemmas: [], predicates: [], functions: [] };

    for (const mod of this.modules) {
      const entryPath = path.join(this.projectDir, mod.entry);
      if (!fs.existsSync(entryPath)) continue;

      const result = await this.runCommand(this.dafny2jsBin, [
        '--file', entryPath,
        '--claims'
      ]);

      if (result.code !== 0) {
        return { success: false, error: `claims extraction failed for ${mod.outputName}: ${result.stderr || result.stdout}` };
      }

      try {
        const claims = JSON.parse(result.stdout);
        for (const key of Object.keys(allClaims)) {
          if (claims[key]) allClaims[key].push(...claims[key]);
        }
      } catch (err) {
        return { success: false, error: `Failed to parse claims JSON for ${mod.outputName}: ${err.message}` };
      }
    }

    fs.writeFileSync(claimsPath, JSON.stringify(allClaims, null, 2));
    this.generateAssumptions(allClaims);
    return { success: true, claims: allClaims };
  }

  async extractLogicSurface() {
    const allSurfaces = [];

    for (const mod of this.modules) {
      const entryPath = path.join(this.projectDir, mod.entry);
      if (!fs.existsSync(entryPath)) continue;

      const result = await this.runCommand(this.dafny2jsBin, [
        '--file', entryPath,
        '--logic-surface',
        '--app-core', mod.appCore
      ]);

      if (result.code !== 0) {
        return { success: false, error: `logic surface extraction failed for ${mod.outputName}: ${result.stderr || result.stdout}` };
      }

      try {
        const surface = JSON.parse(result.stdout);
        surface._module = mod.outputName;
        allSurfaces.push(surface);
      } catch (err) {
        return { success: false, error: `Failed to parse logic surface JSON for ${mod.outputName}: ${err.message}` };
      }
    }

    // Single module: write surface directly (backward compat)
    // Multi-module: write array of surfaces
    const output = allSurfaces.length === 1 ? allSurfaces[0] : allSurfaces;
    const surfacePath = path.join(this.vibeDir, 'logic-surface.json');
    fs.writeFileSync(surfacePath, JSON.stringify(output, null, 2));
    return { success: true, surface: output };
  }

  generateAssumptions(claims) {
    const assumptionsPath = path.join(this.projectDir, 'ASSUMPTIONS.md');
    const axioms = claims.axioms || [];

    if (axioms.length === 0) {
      // No axioms, remove file if it exists
      if (fs.existsSync(assumptionsPath)) {
        fs.unlinkSync(assumptionsPath);
      }
      return;
    }

    // Group axioms by type (lemma vs inline assume)
    const lemmaAxioms = [];
    const inlineAxioms = [];

    for (const axiom of axioms) {
      if (axiom.content.startsWith('assume')) {
        inlineAxioms.push(axiom);
      } else {
        lemmaAxioms.push(axiom);
      }
    }

    let content = '# Assumptions\n\n';
    content += 'This file is auto-generated by lemmafit. It lists all axioms in the Dafny code.\n\n';

    if (lemmaAxioms.length > 0) {
      content += '## Axiom Lemmas\n\n';
      for (const axiom of lemmaAxioms) {
        const relFile = path.relative(this.projectDir, axiom.file);
        content += `- \`${axiom.module}\` (${relFile}:${axiom.line})\n`;
        content += `  \`\`\`dafny\n  ${axiom.content}\n  \`\`\`\n\n`;
      }
    }

    if (inlineAxioms.length > 0) {
      content += '## Inline Assumes\n\n';
      for (const axiom of inlineAxioms) {
        const relFile = path.relative(this.projectDir, axiom.file);
        content += `- \`${axiom.module}\` (${relFile}:${axiom.line})\n`;
        content += `  \`\`\`dafny\n  ${axiom.content}\n  \`\`\`\n\n`;
      }
    }

    fs.writeFileSync(assumptionsPath, content);
  }

  async verifyAndCompile() {
    // If already running, wait for the in-flight result instead of spawning another process
    if (this._verifyPromise) {
      return this._verifyPromise;
    }
    this._verifyPromise = this._doVerifyAndCompile();
    try {
      return await this._verifyPromise;
    } finally {
      this._verifyPromise = null;
    }
  }

  async _doVerifyAndCompile() {
    const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${timestamp()}] Change detected, verifying...`);

    this.writeStatus({ state: 'verifying', files: {}, axioms: [], compiled: false });

    // Run verification
    const { passed, fileStatuses, axioms } = await this.verify();

    if (!passed) {
      const errorCount = Object.values(fileStatuses).reduce((sum, f) => sum + f.errors.length, 0);
      const warningCount = Object.values(fileStatuses).reduce((sum, f) => sum + (f.warnings?.length || 0), 0);
      if (errorCount === 0 && warningCount > 0) {
        console.log(`[${timestamp()}] Verification passed, compilation blocked (${warningCount} warning${warningCount !== 1 ? 's' : ''})`);
      } else {
        console.log(`[${timestamp()}] Verification failed (${errorCount} error${errorCount !== 1 ? 's' : ''})`);
      }
      this.writeStatus({
        state: 'error',
        files: fileStatuses,
        axioms,
        compiled: false,
      });
      return { verified: false, fileStatuses, axioms };
    }

    console.log(`[${timestamp()}] Verification passed, compiling...`);

    // Update status to compiling
    this.writeStatus({
      state: 'compiling',
      files: fileStatuses,
      axioms,
    });

    // Run compilation
    const { success, error } = await this.compile();

    if (!success) {
      console.log(`[${timestamp()}] Compilation failed: ${error}`);
      this.writeStatus({
        state: 'error',
        files: fileStatuses,
        axioms,
        compiled: false,
        compileError: error,
      });
      return { verified: true, compiled: false, error, fileStatuses, axioms };
    }

    // Extract claims for spec matching
    const claimsResult = await this.extractClaims();
    if (!claimsResult.success) {
      console.log(`[${timestamp()}] Claims extraction failed: ${claimsResult.error}`);
    }

    // Extract logic surface
    const surfaceResult = await this.extractLogicSurface();
    if (!surfaceResult.success) {
      console.log(`[${timestamp()}] Logic surface extraction failed: ${surfaceResult.error}`);
    }

    const axiomNote = axioms.length > 0 ? ` (${axioms.length} axioms)` : '';
    console.log(`[${timestamp()}] Verified and compiled${axiomNote}`);

    this.writeStatus({
      state: 'verified',
      files: fileStatuses,
      axioms,
      compiled: true,
      lastCompiled: new Date().toISOString(),
    });

    return { verified: true, compiled: true, fileStatuses, axioms };
  }

  // --- WebSocket relay methods ---

  connectRelay() {
    let url = this.config.server;
    if (!url) return;

    // Append secret as query param for authentication
    if (this.config.secret) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}secret=${encodeURIComponent(this.config.secret)}`;
    }

    console.log(`Relay: connecting to ${this.config.server}`);
    const ws = new WebSocket(url);
    this.relayWs = ws;

    ws.on('open', () => {
      console.log('Relay: connected');
      this.relayConnected = true;
      this.relayRetryDelay = 1000;

      // Push current state on connect
      try {
        const status = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
        this.relaySend({ type: 'stateUpdate', key: 'status', payload: status });
      } catch {}

      const spec = this.readSpecFile();
      if (spec) {
        this.relaySend({ type: 'stateUpdate', key: 'spec', payload: spec });
      }

      // Push config and project info
      this.relaySend({ type: 'stateUpdate', key: 'config', payload: this.config });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        this.handleRelayCommand(msg);
      } catch (err) {
        console.error('Relay: bad message', err.message);
      }
    });

    ws.on('close', () => {
      this.relayConnected = false;
      console.log(`Relay: disconnected, retrying in ${this.relayRetryDelay}ms`);
      setTimeout(() => this.connectRelay(), this.relayRetryDelay);
      this.relayRetryDelay = Math.min(this.relayRetryDelay * 2, 30000);
    });

    ws.on('error', (err) => {
      console.error('Relay: error', err.message || err.code || err);
      // close event will handle reconnect
    });
  }

  relaySend(msg) {
    if (!this.relayConnected || !this.relayWs) return;
    try {
      this.relayWs.send(JSON.stringify(msg));
    } catch {}
  }

  async handleRelayCommand(msg) {
    const { id, type, payload } = msg;
    if (!id || !type) return;
    if (!type.includes('File')) {
      console.log(`Relay: command ${type} (id=${id})`);
    }

    try {
      let result;
      switch (type) {
        case 'spawnClaude': {
          const { prompt, model, maxTurns, effort } = payload || {};
          console.log(`Relay: spawnClaude (model=${model || 'haiku'}, prompt=${prompt.slice(0, 80)}...)`);
          const output = await spawnClaude(prompt, this.projectDir, { model, maxTurns, effort });
          console.log(`Relay: spawnClaude done (${output.length} chars)`);
          result = output;
          break;
        }
        case 'readFile': {
          const filePath = path.resolve(this.projectDir, payload.path);
          if (!filePath.startsWith(this.projectDir + path.sep) && filePath !== this.projectDir) {
            throw new Error('Path traversal not allowed');
          }
          if (!fs.existsSync(filePath)) {
            result = null;
            break;
          }
          result = fs.readFileSync(filePath, 'utf8');
          break;
        }
        case 'writeFile': {
          const filePath = path.resolve(this.projectDir, payload.path);
          if (!filePath.startsWith(this.projectDir + path.sep)) {
            throw new Error('Path traversal not allowed');
          }
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, payload.content);
          result = 'ok';
          break;
        }
        case 'listFiles': {
          const globDir = payload?.dir || '.';
          const target = path.resolve(this.projectDir, globDir);
          if (!target.startsWith(this.projectDir + path.sep) && target !== this.projectDir) {
            throw new Error('Path traversal not allowed');
          }
          result = this.globDir(target);
          break;
        }
        case 'apiProxy': {
          // Generic fallback: read/write .vibe JSON files based on API path
          const { path: apiPath, method, body } = payload || {};
          const vibeFile = this.resolveVibeFile(apiPath);
          if (!vibeFile) { result = null; break; }
          if (method === 'GET') {
            if (!fs.existsSync(vibeFile)) { result = null; break; }
            try { result = JSON.parse(fs.readFileSync(vibeFile, 'utf8')); } catch { result = fs.readFileSync(vibeFile, 'utf8'); }
          } else {
            fs.mkdirSync(path.dirname(vibeFile), { recursive: true });
            fs.writeFileSync(vibeFile, JSON.stringify(body, null, 2));
            result = { ok: true };
          }
          break;
        }
        default:
          throw new Error(`Unknown command: ${type}`);
      }
      this.relaySend({ id, type: 'result', payload: result });
    } catch (err) {
      console.error(`Relay: command ${type} error:`, err.message);
      this.relaySend({ id, type: 'error', payload: err.message });
    }
  }

  resolveVibeFile(apiPath) {
    // Map API paths like /api/foo/bar to .vibe/foo-bar.json
    if (!apiPath || !apiPath.startsWith('/api/')) return null;
    const slug = apiPath.replace('/api/', '').replace(/\//g, '-');
    const filePath = path.join(this.vibeDir, `${slug}.json`);
    if (!filePath.startsWith(this.vibeDir + path.sep) && filePath !== this.vibeDir) return null;
    return filePath;
  }

  globDir(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(this.projectDir, full);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        results.push(...this.globDir(full));
      } else {
        results.push(rel);
      }
    }
    return results;
  }

  async watch() {
    console.log(`Lemmafit daemon watching: ${this.projectDir}`);
    console.log(`  Dafny files: ${this.dafnyDir}`);
    console.log(`  Status: ${this.statusPath}`);
    if (this.isMultiModule()) {
      console.log(`  Modules: ${this.modules.map(m => m.outputName).join(', ')}`);
    } else {
      console.log(`  Entry: ${this.config.entry}`);
    }
    console.log(`  Dafny: ${this.dafnyPath}`);
    if (this.config.server) {
      console.log(`  Relay: ${this.config.server}`);
    }
    console.log('');

    // Start WS relay if configured
    if (this.config.server) {
      this.connectRelay();
    }

    // Start Unix domain socket server for hook communication
    this.startSocketServer();

    this._lastHash = null;
    this._lastSpecHash = null;

    // Detect offline spec changes and seed baseline
    const initialContent = this.readSpecFile();
    if (initialContent) {
      let status = {};
      try {
        status = JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
      } catch {}

      const ackedContent = status.ackedSpecContent || status.specContent || null;

      if (!ackedContent) {
        // First run ever — seed both baselines, no queue needed
        status.specContent = initialContent;
        status.ackedSpecContent = initialContent;
        status.specQueue = [];
        this.writeStatus(status);
      } else if (ackedContent !== initialContent) {
        // SPEC.yaml changed while daemon was off — populate queue
        console.log('Detected offline SPEC.yaml changes, populating queue...');
        this.onSpecChanged(initialContent);
      }

      this._lastSpecHash = this.hashSpecFile();
    }

    const poll = async () => {
      try {
        const currentHash = this.hashDafnyFiles();
        const currentSpecHash = this.hashSpecFile();

        const dafnyChanged = currentHash && currentHash !== this._lastHash;
        const specChanged = currentSpecHash && currentSpecHash !== this._lastSpecHash;

        if (dafnyChanged) {
          this._lastHash = currentHash;
          this._lastSpecHash = currentSpecHash;
          await this.verifyAndCompile();
        } else if (specChanged) {
          this._lastSpecHash = currentSpecHash;
          this.onSpecChanged(this.readSpecFile());
        }
      } catch (err) {
        console.error('Error:', err.message);
      }
    };

    // Initial check
    await poll();

    // Watch loop
    setInterval(poll, this.pollInterval);
  }

  startSocketServer() {
    const sockPath = path.join(this.vibeDir, 'daemon.sock');

    // Clean up stale socket from previous crash
    try { fs.unlinkSync(sockPath); } catch {}

    this._socketServer = net.createServer((conn) => {
      let buffer = '';
      conn.on('data', (chunk) => {
        buffer += chunk.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) return;

        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        let msg;
        try { msg = JSON.parse(line); } catch {
          conn.end(JSON.stringify({ error: 'Invalid JSON' }) + '\n');
          return;
        }

        this.handleSocketMessage(msg).then((result) => {
          conn.end(JSON.stringify(result) + '\n');
        }).catch((err) => {
          conn.end(JSON.stringify({ error: err.message }) + '\n');
        });
      });
    });

    this._socketServer.listen(sockPath, () => {
      console.log(`  Socket: ${sockPath}`);
    });

    this._socketServer.on('error', (err) => {
      console.error('Socket server error:', err.message);
    });

    // Cleanup on exit
    const cleanup = () => {
      try { fs.unlinkSync(sockPath); } catch {}
      process.exit();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  async handleSocketMessage(msg) {
    if (msg.action === 'verify') {
      await this.verifyAndCompile();
      // Update hashes so poll loop doesn't re-verify
      this._lastHash = this.hashDafnyFiles();
      this._lastSpecHash = this.hashSpecFile();
      // Read and return current status
      try {
        return JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
      } catch {
        return { error: 'Could not read status after verification' };
      }
    } else if (msg.action === 'specChanged' && msg.content) {
      this.onSpecChanged(msg.content);
      this._lastSpecHash = this.hashSpecFile();
      try {
        return JSON.parse(fs.readFileSync(this.statusPath, 'utf8'));
      } catch {
        return { error: 'Could not read status after spec change' };
      }
    } else {
      return { error: `Unknown action: ${msg.action}` };
    }
  }

  async runOnce() {
    return this.verifyAndCompile();
  }
}

module.exports = { Daemon };
