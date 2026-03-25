#!/usr/bin/env node
const { execSync } = require('child_process');

try {
  execSync('claimcheck --version', { stdio: 'ignore' });
} catch {
  if (process.env.npm_config_global === 'true') {
    console.log('Installing claimcheck CLI...');
    try {
      execSync('npm install -g claimcheck', { stdio: 'inherit' });
    } catch {
      console.warn(
        '\n⚠  Failed to install claimcheck. Install it manually:\n' +
        '   npm install -g claimcheck\n'
      );
    }
  } else {
    console.warn(
      '\n⚠  lemmafit requires the claimcheck CLI, but it was not found on your PATH.\n' +
      '   Install it with:  npm install -g claimcheck\n'
    );
  }
}
