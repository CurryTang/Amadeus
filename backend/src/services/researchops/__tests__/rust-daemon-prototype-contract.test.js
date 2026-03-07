'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');

test('rust daemon prototype task catalog stays aligned with the JS daemon task catalog', async () => {
  const backendRoot = path.resolve(__dirname, '../../../..');
  const scriptPath = path.join(backendRoot, 'scripts', 'verify-rust-daemon-prototype.js');

  const result = await new Promise((resolve, reject) => {
    execFile('node', [scriptPath], {
      cwd: backendRoot,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

  assert.match(result.stdout, /rust daemon prototype contract ok/i);
  assert.match(result.stdout, /rust daemon prototype proxy ok/i);
  assert.match(result.stdout, /rust daemon prototype task execution ok/i);
});
