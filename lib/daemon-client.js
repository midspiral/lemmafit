/**
 * Unix domain socket client for communicating with the lemmafit daemon.
 * Used by verify-hook and spec-hook to request verification/spec processing
 * without polling status.json.
 */

const net = require('net');
const path = require('path');
const crypto = require('crypto');

function getIpcPath(vibeDir) {
  if (process.platform === 'win32') {
    const hash = crypto.createHash('md5').update(vibeDir).digest('hex').slice(0, 8);
    return '\\\\.\\pipe\\lemmafit-daemon-' + hash;
  }
  return path.join(vibeDir, 'daemon.sock');
}

function requestDaemon(sockPath, message, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sockPath);
    const chunks = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.destroy();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for daemon response`));
      }
    }, timeoutMs);
    timeout.unref();

    client.on('connect', () => {
      client.write(JSON.stringify(message) + '\n');
    });

    client.on('data', (chunk) => {
      chunks.push(chunk);
    });

    client.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.destroy();
      try {
        const data = Buffer.concat(chunks).toString('utf8').trim();
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error(`Invalid response from daemon: ${err.message}`));
      }
    });

    client.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Cannot connect to daemon: ${err.message}`));
    });
  });
}

module.exports = { requestDaemon, getIpcPath };
