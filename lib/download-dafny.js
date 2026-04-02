#!/usr/bin/env node
/**
 * Downloads Dafny binary for the current platform.
 * Called during npm postinstall.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const DAFNY_VERSION = '4.11.0';

const PLATFORM_ASSETS = {
  'darwin-arm64': `dafny-${DAFNY_VERSION}-arm64-macos-13.zip`,
  'darwin-x64': `dafny-${DAFNY_VERSION}-x64-macos-13.zip`,
  'linux-x64': `dafny-${DAFNY_VERSION}-x64-ubuntu-22.04.zip`,
  'linux-arm64': `dafny-${DAFNY_VERSION}-arm64-ubuntu-22.04.zip`,
  'win32-x64': `dafny-${DAFNY_VERSION}-x64-windows-2022.zip`,
  'win32-arm64': `dafny-${DAFNY_VERSION}-x64-windows-2022.zip`,
};

function getPlatformKey() {
  const platform = os.platform();
  const arch = os.arch();
  return `${platform}-${arch}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const request = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          const pct = total ? Math.round((downloaded / total) * 100) : '?';
          process.stdout.write(`\rDownloading Dafny... ${pct}%`);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(' Done.');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };

    request(url);
  });
}

async function main() {
  const platformKey = getPlatformKey();
  const asset = PLATFORM_ASSETS[platformKey];

  if (!asset) {
    console.error(`Unsupported platform: ${platformKey}`);
    console.error('Supported platforms:', Object.keys(PLATFORM_ASSETS).join(', '));
    process.exit(1);
  }

  // Install to shared cache directory (~/.lemmafit/.dafny)
  const cacheDir = path.join(os.homedir(), '.lemmafit');
  const installDir = path.join(cacheDir, '.dafny');
  const dafnyDir = path.join(installDir, 'dafny');
  const dafnyBinName = os.platform() === 'win32' ? 'Dafny.exe' : 'dafny';
  const dafnyBin = path.join(dafnyDir, dafnyBinName);
  const versionFile = path.join(installDir, 'version');

  // Check if correct version is already installed
  if (fs.existsSync(dafnyBin) && fs.existsSync(versionFile)) {
    const installed = fs.readFileSync(versionFile, 'utf8').trim();
    if (installed === DAFNY_VERSION) {
      console.log(`Dafny ${DAFNY_VERSION} already installed.`);
      return;
    }
    console.log(`Dafny ${installed} -> ${DAFNY_VERSION}, upgrading...`);
    fs.rmSync(dafnyDir, { recursive: true, force: true });
  }

  // Create install directory
  fs.mkdirSync(installDir, { recursive: true });

  // Download
  const url = `https://github.com/dafny-lang/dafny/releases/download/v${DAFNY_VERSION}/${asset}`;
  const zipPath = path.join(installDir, asset);

  console.log(`Downloading Dafny ${DAFNY_VERSION} for ${platformKey}...`);
  await download(url, zipPath);

  // Extract
  console.log('Extracting...');
  if (os.platform() === 'win32') {
    execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${installDir}' -Force"`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -q -o "${zipPath}" -d "${installDir}"`, { stdio: 'inherit' });
  }

  // Clean up zip
  fs.unlinkSync(zipPath);

  // Make executable
  if (os.platform() !== 'win32') {
    fs.chmodSync(dafnyBin, '755');
  }

  fs.writeFileSync(versionFile, DAFNY_VERSION);
  console.log(`Dafny ${DAFNY_VERSION} installed to ${dafnyDir}`);
}

main().catch((err) => {
  console.error('Failed to download Dafny:', err.message);
  console.error('You may need to install Dafny manually: https://github.com/dafny-lang/dafny/releases');
  // Don't exit with error - allow npm install to continue
});
