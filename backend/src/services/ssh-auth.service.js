const transport = require('./ssh-transport.service');

module.exports = {
  buildResearchOpsSshArgs: transport.buildSshArgs,
  buildResearchOpsScpArgs: transport.buildScpArgs,
  resolveResearchOpsTargetKeyPaths: transport.resolveTargetKeyPaths,
  runSshCommand: transport.exec,
  classifySshError: transport.classifyError,
};
