'use strict';

const { main } = require('../src/services/agent-session-observer/observer-cli');

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exit(1);
});
