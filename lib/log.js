/**
 * Shared logger for lemmafit hooks and scripts.
 * Appends timestamped lines to logs/lemmafit.log in the project root.
 */

const path = require('path');
const fs = require('fs');

let _logPath = null;

function initLog(projectDir) {
  const logsDir = path.join(projectDir, 'lemmafit', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  _logPath = path.join(logsDir, 'lemmafit.log');
}

function log(source, message) {
  if (!_logPath) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${source}] ${message}\n`;
  try {
    fs.appendFileSync(_logPath, line);
  } catch {
    // Never let logging break the caller
  }
}

function getLogPath() {
  return _logPath;
}

module.exports = { initLog, log, getLogPath };
