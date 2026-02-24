#!/usr/bin/env node
/**
 * Lemmafit daemon CLI - watches and verifies Dafny files.
 *
 * Usage:
 *   lemmafit-daemon [project-dir] [--once]
 */

const path = require('path');
const { Daemon } = require('../lib/daemon');

const args = process.argv.slice(2);
const projectDir = args.find(a => !a.startsWith('-')) || '.';
const once = args.includes('--once');

const daemon = new Daemon(projectDir);

if (once) {
  daemon.runOnce().then((result) => {
    process.exit(result.verified && result.compiled ? 0 : 1);
  });
} else {
  daemon.watch();
}
