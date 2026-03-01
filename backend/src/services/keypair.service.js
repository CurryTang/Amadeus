const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const MANAGED_KEY_DIR = path.join(os.homedir(), '.auto-researcher');
const MANAGED_KEY_PATH = path.join(MANAGED_KEY_DIR, 'id_ed25519');
const MANAGED_KEY_PUB_PATH = `${MANAGED_KEY_PATH}.pub`;
const KEY_COMMENT = `auto-researcher@${os.hostname()}`;

async function ensureKeypair() {
  await fs.mkdir(MANAGED_KEY_DIR, { recursive: true, mode: 0o700 });
  try {
    await fs.access(MANAGED_KEY_PATH);
    return { keyPath: MANAGED_KEY_PATH, pubKeyPath: MANAGED_KEY_PUB_PATH, created: false };
  } catch {
    await execFileAsync('ssh-keygen', [
      '-t', 'ed25519',
      '-f', MANAGED_KEY_PATH,
      '-N', '',
      '-C', KEY_COMMENT,
    ]);
    await fs.chmod(MANAGED_KEY_PATH, 0o600);
    console.log(`[keypair] Generated Ed25519 keypair at ${MANAGED_KEY_PATH}`);
    return { keyPath: MANAGED_KEY_PATH, pubKeyPath: MANAGED_KEY_PUB_PATH, created: true };
  }
}

async function getPublicKey() {
  try {
    return (await fs.readFile(MANAGED_KEY_PUB_PATH, 'utf8')).trim();
  } catch {
    return null;
  }
}

module.exports = {
  ensureKeypair,
  getPublicKey,
  MANAGED_KEY_PATH,
  MANAGED_KEY_PUB_PATH,
};
