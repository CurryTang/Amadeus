const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

test('db module does not load libsql client until initDatabase runs', async () => {
  const dbModulePath = path.resolve(__dirname, '..', 'index.js');
  delete require.cache[dbModulePath];

  const originalLoad = Module._load;
  const loaded = [];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@libsql/client') {
      loaded.push({ request, parent: parent?.id || '' });
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    const dbModule = require('../index.js');
    assert.equal(typeof dbModule.initDatabase, 'function');
    assert.equal(loaded.length, 0);
  } finally {
    Module._load = originalLoad;
    delete require.cache[dbModulePath];
  }
});
