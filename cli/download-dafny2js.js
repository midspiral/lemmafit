#!/usr/bin/env node
/**
 * Downloads prebuilt dafny2js binary for the current platform.
 * Called during npm postinstall.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const DAFNY2JS_VERSION = '0.10.0';

const PLATFORM_RIDS = {
  'darwin-arm64': 'osx-arm64',
  'darwin-x64': 'osx-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'win32-x64': 'win-x64',
};

function getPlatformKey() {
  return `${os.platform()}-${os.arch()}`;
}

function guessRid(platformKey) {
  return PLATFORM_RIDS[platformKey] || (platformKey === 'win32-x64' ? 'win-x64' : platformKey);
}

function printBuildInstructions(rid) {
  const installDir = path.join(os.homedir(), '.lemmafit', '.dafny2js');
  console.error('');
  console.error('To build from source (requires .NET 8 SDK):');
  console.error('  git clone https://github.com/metareflection/dafny2js.git');
  console.error('  cd dafny2js');
  console.error(`  dotnet publish -c Release -r ${rid} --self-contained /p:PublishSingleFile=true`);
  console.error('');
  const binaryName = os.platform() === 'win32' ? 'dafny2js.exe' : 'dafny2js';
  console.error('Then copy the binary to:');
  console.error(`  ${path.join(installDir, binaryName)}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
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
          process.stdout.write(`\rDownloading dafny2js... ${pct}%`);
        });

        const file = fs.createWriteStream(dest);
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
  const rid = PLATFORM_RIDS[platformKey];

  if (!rid) {
    console.error(`No prebuilt dafny2js binary available for: ${platformKey}`);
    console.error('Prebuilt binaries are available for:', Object.keys(PLATFORM_RIDS).join(', '));
    printBuildInstructions(guessRid(platformKey));
    process.exit(1);
  }

  const installDir = path.join(os.homedir(), '.lemmafit', '.dafny2js');
  const binaryName = os.platform() === 'win32' ? 'dafny2js.exe' : 'dafny2js';
  const binaryPath = path.join(installDir, binaryName);
  const versionFile = path.join(installDir, 'version');

  // Check if correct version is already installed
  if (fs.existsSync(binaryPath) && fs.existsSync(versionFile)) {
    const installed = fs.readFileSync(versionFile, 'utf8').trim();
    if (installed === DAFNY2JS_VERSION) {
      console.log(`dafny2js v${DAFNY2JS_VERSION} already installed.`);
      return;
    }
    console.log(`dafny2js ${installed} -> ${DAFNY2JS_VERSION}, upgrading...`);
  }

  fs.mkdirSync(installDir, { recursive: true });

  const asset = `dafny2js-${rid}.tar.gz`;
  const url = `https://github.com/metareflection/dafny2js/releases/download/v${DAFNY2JS_VERSION}/${asset}`;
  const tarPath = path.join(installDir, asset);

  console.log(`Downloading dafny2js v${DAFNY2JS_VERSION} for ${platformKey}...`);
  await download(url, tarPath);

  console.log('Extracting...');
  execSync(`tar xzf "${tarPath}" -C "${installDir}"`, { stdio: 'inherit' });

  fs.unlinkSync(tarPath);

  if (os.platform() !== 'win32') {
    fs.chmodSync(binaryPath, '755');
  }

  fs.writeFileSync(versionFile, DAFNY2JS_VERSION);
  console.log(`dafny2js v${DAFNY2JS_VERSION} installed to ${installDir}`);
}

main().catch((err) => {
  console.error('Failed to download dafny2js:', err.message);
  console.error('');
  console.error('You can download it manually from:');
  console.error('  https://github.com/metareflection/dafny2js/releases');
  printBuildInstructions(guessRid(getPlatformKey()));
});
