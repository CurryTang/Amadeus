'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function deriveRunWorkspacePath(run = {}, { runtimeFiles = null, stepResults = [] } = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const explicit = cleanString(metadata.runWorkspacePath);
  if (explicit) return explicit;

  const hasRemoteExecution = Array.isArray(stepResults)
    && stepResults.some((item) => cleanString(item?.metrics?.execServerId));
  const runtimeRoot = cleanString(runtimeFiles?.rootDir);
  if (hasRemoteExecution && cleanString(run?.id)) {
    return `/tmp/researchops-runs/${cleanString(run.id)}`;
  }
  return runtimeRoot || '';
}

function findRunReportHighlights(artifacts = []) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const summaryArtifact = list.find((item) => cleanString(item?.kind) === 'run_summary_md') || null;
  const finalOutputArtifact = list.find((item) => (
    ['agent_final_json', 'implementation_summary_json', 'experiment_final_json', 'result_manifest', 'agent-output']
      .includes(cleanString(item?.kind))
  )) || null;
  return {
    summaryArtifactId: summaryArtifact?.id || null,
    finalOutputArtifactId: finalOutputArtifact?.id || null,
  };
}

module.exports = {
  deriveRunWorkspacePath,
  findRunReportHighlights,
};
