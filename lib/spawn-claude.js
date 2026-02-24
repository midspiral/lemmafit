/**
 * Shared spawnClaude helper — runs `claude -p` as a subprocess.
 *
 * Used by both the daemon (WS relay commands) and the dashboard (vite plugin).
 */

const { spawn } = require('child_process');

const ALLOWED_MODELS = new Set(['haiku', 'sonnet', 'opus']);
const ALLOWED_EFFORTS = new Set(['low', 'medium', 'high']);
const MAX_TURNS_LIMIT = 10;

function spawnClaude(prompt, cwd, { model = 'haiku', maxTurns = 1, effort = 'low' } = {}) {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return Promise.reject(new Error('prompt must be a non-empty string'));
  }
  if (!ALLOWED_MODELS.has(model)) model = 'haiku';
  if (!ALLOWED_EFFORTS.has(effort)) effort = 'low';
  maxTurns = Math.max(1, Math.min(MAX_TURNS_LIMIT, parseInt(maxTurns, 10) || 1));

  const args = ['-p', prompt, '--output-format', 'text', '--max-turns', String(maxTurns), '--tools', ''];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // prevent nested-session detection
    const proc = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `claude exited with code ${code}`));
      } else {
        resolve(stdout);
      }
    });
    proc.on('error', err => {
      reject(new Error(`Failed to spawn claude: ${err.message}. Is Claude Code installed?`));
    });
  });
}

module.exports = { spawnClaude };
