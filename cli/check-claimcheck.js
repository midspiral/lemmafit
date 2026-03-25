#!/usr/bin/env node
const { execSync } = require('child_process');

try {
  execSync('claimcheck --version', { stdio: 'ignore' });
} catch {
  console.warn(
    '\n⚠  lemmafit requires the claimcheck CLI, but it was not found on your PATH.\n' +
    '   Install it with:  npm install -g claimcheck\n'
  );
}
