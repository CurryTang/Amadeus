const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const store = require('./store');
const s3Service = require('../s3.service');
const contextPackService = require('./context-pack.service');
const AgentRunModule = require('./modules/agent-run.module');
const BashRunModule = require('./modules/bash-run.module');
const CheckpointModule = require('./modules/checkpoint.module');
const ReportRenderModule = require('./modules/report-render.module');
const ArtifactPublishModule = require('./modules/artifact-publish.module');
const workflowSchemaService = require('./workflow-schema.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extensionForMime(mimeType = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('json')) return 'json';
  if (mime.includes('markdown')) return 'md';
  if (mime.includes('csv')) return 'csv';
  if (mime.includes('tab-separated-values')) return 'tsv';
  if (mime.includes('text')) return 'txt';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('pdf')) return 'pdf';
  return 'bin';
}

function isTextMimeType(mimeType = '') {
  const mime = cleanString(mimeType).toLowerCase();
  return (
    mime.startsWith('text/')
    || mime.includes('json')
    || mime.includes('xml')
    || mime.includes('yaml')
    || mime.includes('csv')
    || mime.includes('tab-separated-values')
    || mime.includes('markdown')
  );
}

async function detectExistingDir(candidate = '') {
  const target = cleanString(candidate);
  if (!target) return null;
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory() ? target : null;
  } catch (_) {
    return null;
  }
}

async function resolveSkillsDir(run = {}) {
  const metadataSkillsDir = cleanString(run?.metadata?.skillsDir);
  const envSkillsDir = cleanString(process.env.RESEARCHOPS_SKILLS_DIR);
  const codexHome = cleanString(process.env.CODEX_HOME);
  const codexHomeSkills = codexHome ? path.join(codexHome, 'skills') : '';
  const localSkills = path.resolve(process.cwd(), 'skills');

  const candidates = [
    metadataSkillsDir,
    envSkillsDir,
    codexHomeSkills,
    localSkills,
  ];

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await detectExistingDir(candidate);
    if (existing) return existing;
  }
  return null;
}

async function stageRuntimeFiles(run = {}, contextPack = {}) {
  const runId = cleanString(run.id);
  if (!runId) return null;
  const rootDir = path.join(os.tmpdir(), 'researchops-runs', runId);
  await fs.mkdir(rootDir, { recursive: true });

  const contextJsonPath = path.join(rootDir, 'context-pack.json');
  const contextMarkdownPath = path.join(rootDir, 'context-pack.md');
  const skillRefsPath = path.join(rootDir, 'skill-refs.json');
  const runSpecPath = path.join(rootDir, 'run-spec.json');
  const skillsDir = await resolveSkillsDir(run);

  const skillManifest = {
    runId,
    projectId: cleanString(run.projectId),
    generatedAt: new Date().toISOString(),
    skillsDir: skillsDir || null,
    skillRefs: Array.isArray(run.skillRefs) ? run.skillRefs : [],
  };

  await Promise.all([
    fs.writeFile(contextJsonPath, JSON.stringify(contextPack || {}, null, 2), 'utf8'),
    fs.writeFile(contextMarkdownPath, String(contextPack?.markdown || ''), 'utf8'),
    fs.writeFile(skillRefsPath, JSON.stringify(skillManifest, null, 2), 'utf8'),
    fs.writeFile(runSpecPath, JSON.stringify(run || {}, null, 2), 'utf8'),
  ]);

  // Stage parent run artifacts for continuation runs
  let parentArtifactsDir = null;
  const parentRunId = cleanString(run?.metadata?.parentRunId);
  const uid = cleanString(run?.userId);
  if (parentRunId && uid) {
    try {
      const parentArtifacts = await store.listRunArtifacts(uid, parentRunId, { limit: 100 });
      const textArtifacts = parentArtifacts.filter(
        (a) => a.metadata?.inlinePreview && isTextMimeType(a.mimeType)
      );
      if (textArtifacts.length > 0) {
        parentArtifactsDir = path.join(rootDir, 'parent-artifacts');
        await fs.mkdir(parentArtifactsDir, { recursive: true });
        await Promise.all(textArtifacts.map(async (artifact) => {
          const safeTitle = String(artifact.title || artifact.id || 'artifact')
            .replace(/[^a-zA-Z0-9_.-]/g, '_')
            .slice(0, 80);
          const ext = extensionForMime(artifact.mimeType);
          const filePath = path.join(parentArtifactsDir, `${safeTitle}.${ext}`);
          await fs.writeFile(filePath, String(artifact.metadata.inlinePreview || ''), 'utf8');
        }));
      }
    } catch (_) {
      // non-fatal — parent artifact staging failure should not block the run
    }
  }

  return {
    rootDir,
    contextJsonPath,
    contextMarkdownPath,
    skillRefsPath,
    runSpecPath,
    skillsDir,
    parentArtifactsDir,
  };
}

function normalizeTokenList(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => cleanString(item).toLowerCase())
    .filter(Boolean);
}

function normalizeStringList(values) {
  if (Array.isArray(values)) {
    return values
      .map((item) => cleanString(item))
      .filter(Boolean);
  }
  const single = cleanString(values);
  if (!single) return [];
  return [single];
}

function isTableLikeArtifact(artifact = {}) {
  const kind = cleanString(artifact.kind).toLowerCase();
  const mimeType = cleanString(artifact.mimeType).toLowerCase();
  const p = cleanString(artifact.path).toLowerCase();
  if (kind.includes('table')) return true;
  if (mimeType.includes('csv') || mimeType.includes('tab-separated-values')) return true;
  return p.endsWith('.csv') || p.endsWith('.tsv');
}

function isFigureLikeArtifact(artifact = {}) {
  const kind = cleanString(artifact.kind).toLowerCase();
  const mimeType = cleanString(artifact.mimeType).toLowerCase();
  const p = cleanString(artifact.path).toLowerCase();
  if (kind.includes('figure') || kind.includes('plot') || kind.includes('chart')) return true;
  if (mimeType.startsWith('image/')) return true;
  return (
    p.endsWith('.png')
    || p.endsWith('.jpg')
    || p.endsWith('.jpeg')
    || p.endsWith('.svg')
    || p.endsWith('.gif')
    || p.endsWith('.webp')
  );
}

function artifactMatchesToken(artifact = {}, token = '') {
  const normalized = cleanString(token).toLowerCase();
  if (!normalized) return true;
  const haystack = [
    cleanString(artifact.kind),
    cleanString(artifact.title),
    cleanString(artifact.path),
    cleanString(artifact?.metadata?.reportKey),
  ].join(' ').toLowerCase();
  return haystack.includes(normalized);
}

function defaultWorkflow(run = {}) {
  const runType = cleanString(run?.runType).toUpperCase();
  if (runType === 'EXPERIMENT') {
    const experimentCmd = cleanString(run?.metadata?.experimentCommand || run?.metadata?.command)
      || 'echo "No experiment command provided"';
    const bashExecServerId = cleanString(run?.metadata?.bashExecServerId);
    return [
      {
        id: 'experiment_main',
        type: 'bash.run',
        inputs: {
          cmd: experimentCmd,
          ...(bashExecServerId ? { execServerId: bashExecServerId } : {}),
        },
      },
      {
        id: 'report',
        type: 'report.render',
        inputs: {
          format: 'md+json',
        },
      },
    ];
  }

  const prompt = cleanString(run?.metadata?.prompt);
  return [
    {
      id: 'agent_main',
      type: 'agent.run',
      inputs: {
        ...(prompt ? { prompt } : {}),
      },
    },
    {
      id: 'report',
      type: 'report.render',
      inputs: {
        format: 'md+json',
      },
    },
  ];
}

class ResearchOpsOrchestrator {
  constructor() {
    this.modules = new Map([
      ['agent.run', new AgentRunModule()],
      ['bash.run', new BashRunModule()],
      ['checkpoint.hitl', new CheckpointModule()],
      ['report.render', new ReportRenderModule()],
      ['artifact.publish', new ArtifactPublishModule()],
    ]);
  }

  getModule(type) {
    const key = cleanString(type).toLowerCase();
    return this.modules.get(key) || null;
  }

  async executeV2Run(userId, run, { onRegisterCancel, onUnregisterCancel } = {}) {
    const uid = cleanString(userId).toLowerCase() || 'czk';
    if (!run?.id) throw new Error('Invalid run');
    const runId = run.id;
    const startedAt = Date.now();
    let cancelled = false;
    const cancelFns = new Set();
    const stepResults = [];
    let cachedArtifacts = null;
    let runtimeFiles = null;

    const contextPack = await contextPackService.buildContextPack(uid, {
      runId,
      projectId: run.projectId,
      contextRefs: run.contextRefs || run.metadata?.contextRefs || {},
      explicitAssetIds: run.metadata?.pinnedAssetIds || [],
    });

    if (contextPack?.storage?.json?.key) {
      await store.createRunArtifact(uid, runId, {
        kind: 'context_pack_json',
        title: 'Knowledge Context Pack (JSON)',
        path: 'context/knowledge-pack.json',
        mimeType: 'application/json',
        objectKey: contextPack.storage.json.key,
        objectUrl: contextPack.storage.json.url,
        metadata: {
          groups: (contextPack.groups || []).length,
          assets: (contextPack.assets || []).length,
          documents: (contextPack.documents || []).length,
        },
      });
    }
    if (contextPack?.storage?.markdown?.key) {
      await store.createRunArtifact(uid, runId, {
        kind: 'context_pack_md',
        title: 'Knowledge Context Pack (Markdown)',
        path: 'context/knowledge-pack.md',
        mimeType: 'text/markdown',
        objectKey: contextPack.storage.markdown.key,
        objectUrl: contextPack.storage.markdown.url,
      });
    }

    try {
      runtimeFiles = await stageRuntimeFiles(run, contextPack);
      if (runtimeFiles?.skillRefsPath) {
        await store.createRunArtifact(uid, runId, {
          kind: 'skill_refs_manifest',
          title: 'Skill Refs Manifest',
          path: 'context/skill-refs.json',
          mimeType: 'application/json',
          metadata: {
            localPath: runtimeFiles.skillRefsPath,
            skillCount: Array.isArray(run.skillRefs) ? run.skillRefs.length : 0,
            skillsDir: runtimeFiles.skillsDir || null,
          },
        });
      }
      if (runtimeFiles?.runSpecPath) {
        await store.createRunArtifact(uid, runId, {
          kind: 'run_spec_snapshot',
          title: 'Run Spec Snapshot',
          path: 'context/run-spec.json',
          mimeType: 'application/json',
          metadata: {
            localPath: runtimeFiles.runSpecPath,
            schemaVersion: cleanString(run.schemaVersion) || '2.0',
          },
        });
      }
      await store.publishRunEvents(uid, runId, [{
        eventType: 'LOG_LINE',
        status: 'INFO',
        message: `[runtime-stage] context=${runtimeFiles?.contextJsonPath || 'n/a'} skills=${runtimeFiles?.skillsDir || 'n/a'}`,
      }]);
    } catch (error) {
      await store.publishRunEvents(uid, runId, [{
        eventType: 'LOG_LINE',
        status: 'WARNING',
        message: `[runtime-stage-warning] ${error.message}`,
      }]);
    }

    const context = {
      run,
      userId: uid,
      runId,
      contextPack,
      runtimeFiles,
      runtimeEnv: {
        RESEARCHOPS_RUN_ID: runId,
        RESEARCHOPS_PROJECT_ID: cleanString(run.projectId),
        RESEARCHOPS_TMPDIR: runtimeFiles?.rootDir || '',
        RESEARCHOPS_CONTEXT_PACK_JSON_PATH: runtimeFiles?.contextJsonPath || '',
        RESEARCHOPS_CONTEXT_PACK_MD_PATH: runtimeFiles?.contextMarkdownPath || '',
        RESEARCHOPS_SKILL_REFS_PATH: runtimeFiles?.skillRefsPath || '',
        RESEARCHOPS_RUN_SPEC_PATH: runtimeFiles?.runSpecPath || '',
        RESEARCHOPS_SKILLS_DIR: runtimeFiles?.skillsDir || '',
        RESEARCHOPS_PARENT_ARTIFACTS_DIR: runtimeFiles?.parentArtifactsDir || '',
        VIBE_TMPDIR: runtimeFiles?.rootDir || '',
        VIBE_CONTEXT_PACK_JSON_PATH: runtimeFiles?.contextJsonPath || '',
        VIBE_CONTEXT_PACK_MD_PATH: runtimeFiles?.contextMarkdownPath || '',
        VIBE_SKILL_REFS_PATH: runtimeFiles?.skillRefsPath || '',
        VIBE_RUN_SPEC_PATH: runtimeFiles?.runSpecPath || '',
        VIBE_SKILLS_DIR: runtimeFiles?.skillsDir || '',
        VIBE_PARENT_ARTIFACTS_DIR: runtimeFiles?.parentArtifactsDir || '',
      },
      isCancelled: () => cancelled,
      registerCancelable: (fn) => {
        if (typeof fn === 'function') cancelFns.add(fn);
      },
      emitEvent: async (event = {}) => {
        await store.publishRunEvents(uid, runId, [event]);
      },
      emitStepLog: async (step, text, { isError = false } = {}) => {
        const line = String(text || '').trim();
        if (!line) return;
        await store.publishRunEvents(uid, runId, [{
          eventType: 'STEP_LOG',
          status: isError ? 'ERROR' : 'INFO',
          message: line.slice(0, 8000),
          payload: {
            stepId: step.id,
            moduleType: cleanString(step.type).toLowerCase(),
          },
        }]);
      },
      createArtifact: async (step, payload = {}) => {
        let contentBuffer = null;
        if (Buffer.isBuffer(payload.content)) {
          contentBuffer = payload.content;
        } else if (typeof payload.contentBase64 === 'string' && payload.contentBase64.length > 0) {
          contentBuffer = Buffer.from(payload.contentBase64, 'base64');
        } else {
          contentBuffer = Buffer.from(payload.content !== undefined ? String(payload.content) : '', 'utf8');
        }
        const mimeType = cleanString(payload.mimeType) || 'text/plain';
        const extension = extensionForMime(mimeType);
        const hash = crypto.createHash('sha256').update(contentBuffer).digest('hex').slice(0, 10);
        const pathHint = cleanString(payload.pathHint);
        const artifactPath = pathHint || `artifacts/${step.id}_${Date.now()}_${hash}.${extension}`;
        const objectKey = `runs/${runId}/${artifactPath.replace(/^\/+/, '')}`;
        let uploaded = null;
        try {
          uploaded = await s3Service.uploadBuffer(contentBuffer, objectKey, mimeType);
        } catch (error) {
          uploaded = null;
          await store.publishRunEvents(uid, runId, [{
            eventType: 'LOG_LINE',
            message: `[artifact-upload-warning] ${error.message}`,
            payload: {
              stepId: step.id,
              kind: cleanString(payload.kind) || 'artifact',
            },
          }]);
        }

        const created = await store.createRunArtifact(uid, runId, {
          stepId: step.id,
          kind: cleanString(payload.kind).toLowerCase() || 'artifact',
          title: cleanString(payload.title) || null,
          path: artifactPath,
          mimeType,
          objectKey: uploaded?.key || null,
          objectUrl: uploaded?.location || null,
          metadata: {
            ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
            bytes: contentBuffer.length,
            sha256: crypto.createHash('sha256').update(contentBuffer).digest('hex'),
            inlinePreview: isTextMimeType(mimeType)
              ? (() => {
                const text = contentBuffer.toString('utf8');
                if (text.length <= 200000) return text;
                return `${text.slice(0, 5000)}\n\n[truncated ${text.length - 5000} chars]`;
              })()
              : null,
          },
        });

        await store.publishRunEvents(uid, runId, [{
          eventType: 'ARTIFACT_CREATED',
          status: 'SUCCEEDED',
          message: `${created.kind} artifact created`,
          payload: {
            stepId: step.id,
            artifactId: created.id,
            kind: created.kind,
            path: created.path,
          },
        }]);

        cachedArtifacts = null;
        return created;
      },
      createCheckpoint: async (step, payload = {}) => {
        const checkpointStatus = cleanString(payload.status).toUpperCase() || 'PENDING';
        return store.createRunCheckpoint(uid, runId, {
          stepId: step.id,
          ...payload,
          status: checkpointStatus,
          decision: payload.decision && typeof payload.decision === 'object' ? payload.decision : null,
          decidedAt: payload.decidedAt || null,
        });
      },
      waitForCheckpointDecision: async (checkpointId, timeoutMs = 60 * 60 * 1000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          if (cancelled) {
            throw new Error('Run cancelled while waiting for checkpoint decision');
          }
          // eslint-disable-next-line no-await-in-loop
          const checkpoint = await store.getRunCheckpoint(uid, runId, checkpointId);
          if (!checkpoint) throw new Error(`Checkpoint ${checkpointId} not found`);
          if (checkpoint.status === 'APPROVED' || checkpoint.status === 'REJECTED') {
            return checkpoint;
          }
          // eslint-disable-next-line no-await-in-loop
          await sleep(2000);
        }
        throw new Error(`Checkpoint ${checkpointId} timed out after ${timeoutMs}ms`);
      },
      getStepResults: () => stepResults.slice(),
      listArtifacts: async () => {
        if (!cachedArtifacts) {
          cachedArtifacts = await store.listRunArtifacts(uid, runId, { limit: 1000 });
        }
        return cachedArtifacts.slice();
      },
    };

    const register = typeof onRegisterCancel === 'function'
      ? onRegisterCancel(() => {
        cancelled = true;
        for (const fn of cancelFns) {
          try {
            fn();
          } catch (_) {
            // ignore cancel callback errors
          }
        }
      })
      : null;

    try {
      const workflowInput = Array.isArray(run.workflow) && run.workflow.length
        ? run.workflow
        : defaultWorkflow(run);
      const normalizedWorkflow = workflowSchemaService.normalizeAndValidateWorkflow(workflowInput, {
        allowEmpty: false,
      });
      const workflow = workflowSchemaService.topologicallySortWorkflow(normalizedWorkflow);
      const stepOutcomeById = new Map();

      for (let index = 0; index < workflow.length; index += 1) {
        if (cancelled) throw new Error('Run cancelled');
        const step = workflow[index] || {};
        const stepId = cleanString(step.id) || `step_${index + 1}`;
        const moduleType = cleanString(step.type || step.moduleType).toLowerCase();
        const moduleImpl = this.getModule(moduleType);
        if (!moduleImpl) {
          throw new Error(`Unsupported workflow module type: ${moduleType || '(empty)'}`);
        }

        const stepRef = {
          ...step,
          id: stepId,
          type: moduleType,
        };
        const dependsOn = Array.isArray(step.dependsOn) ? step.dependsOn : [];
        const blockingDependency = dependsOn.find((depId) => {
          const depStatus = stepOutcomeById.get(depId);
          return depStatus && depStatus !== 'SUCCEEDED';
        });
        if (blockingDependency) {
          const message = `Step ${stepId} skipped due to dependency ${blockingDependency}`;
          const startedAtIso = new Date().toISOString();
          const endedAtIso = startedAtIso;
          const skipped = {
            stepId,
            moduleType,
            status: 'SKIPPED',
            metrics: {
              skippedByDependency: blockingDependency,
            },
            outputs: {},
            artifacts: [],
            startedAt: startedAtIso,
            endedAt: endedAtIso,
          };
          stepResults.push(skipped);
          stepOutcomeById.set(stepId, 'SKIPPED');
          // eslint-disable-next-line no-await-in-loop
          await store.upsertRunStep(uid, runId, {
            stepId,
            moduleType,
            status: 'SKIPPED',
            order: index,
            startedAt: startedAtIso,
            endedAt: endedAtIso,
            message,
            metrics: skipped.metrics,
            outputs: skipped.outputs,
          });
          // eslint-disable-next-line no-await-in-loop
          await store.publishRunEvents(uid, runId, [{
            eventType: 'STEP_RESULT',
            status: 'SKIPPED',
            message,
            payload: {
              stepId,
              moduleType,
              dependency: blockingDependency,
            },
          }]);
          continue;
        }

        const retryPolicy = stepRef.retryPolicy && typeof stepRef.retryPolicy === 'object'
          ? stepRef.retryPolicy
          : {};
        const maxRetries = Number.isFinite(Number(retryPolicy.maxRetries))
          ? Math.min(Math.max(Math.floor(Number(retryPolicy.maxRetries)), 0), 20)
          : 0;
        const onFailure = ['pause', 'skip', 'abort'].includes(cleanString(retryPolicy.onFailure).toLowerCase())
          ? cleanString(retryPolicy.onFailure).toLowerCase()
          : 'abort';
        let attempt = 0;
        let stepSucceeded = false;

        while (!stepSucceeded && attempt <= maxRetries) {
          const startedAtIso = new Date().toISOString();
          // eslint-disable-next-line no-await-in-loop
          await store.upsertRunStep(uid, runId, {
            stepId,
            moduleType,
            status: 'RUNNING',
            order: index,
            startedAt: startedAtIso,
            message: attempt === 0 ? `Step ${stepId} started` : `Step ${stepId} retry ${attempt}/${maxRetries}`,
            metrics: {
              attempt: attempt + 1,
              maxAttempts: maxRetries + 1,
            },
          });
          // eslint-disable-next-line no-await-in-loop
          await store.publishRunEvents(uid, runId, [{
            eventType: 'STEP_STARTED',
            status: 'RUNNING',
            message: attempt === 0 ? `Step ${stepId} started` : `Step ${stepId} retry ${attempt}/${maxRetries}`,
            payload: {
              stepId,
              moduleType,
              order: index,
              attempt: attempt + 1,
              maxAttempts: maxRetries + 1,
            },
          }]);

          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await moduleImpl.run(stepRef, context);
            const endedAtIso = new Date().toISOString();
            const shapedResult = {
              stepId,
              moduleType,
              status: result?.status || 'SUCCEEDED',
              metrics: {
                ...(result?.metrics || {}),
                attempt: attempt + 1,
                maxAttempts: maxRetries + 1,
              },
              outputs: result?.outputs || {},
              artifacts: Array.isArray(result?.artifacts) ? result.artifacts : [],
              startedAt: startedAtIso,
              endedAt: endedAtIso,
            };
            stepResults.push(shapedResult);
            stepOutcomeById.set(stepId, shapedResult.status);
            // eslint-disable-next-line no-await-in-loop
            await store.upsertRunStep(uid, runId, {
              stepId,
              moduleType,
              status: shapedResult.status,
              order: index,
              startedAt: startedAtIso,
              endedAt: endedAtIso,
              message: `Step ${stepId} ${shapedResult.status.toLowerCase()}`,
              metrics: shapedResult.metrics,
              outputs: shapedResult.outputs,
            });
            // eslint-disable-next-line no-await-in-loop
            await store.publishRunEvents(uid, runId, [{
              eventType: 'STEP_RESULT',
              status: shapedResult.status,
              message: `Step ${stepId} ${shapedResult.status.toLowerCase()}`,
              payload: {
                stepId,
                moduleType,
                metrics: shapedResult.metrics,
                artifactCount: shapedResult.artifacts.length,
              },
            }]);

            const knowledgeUpdates = normalizeStringList(
              shapedResult?.outputs?.knowledge_updates
              || shapedResult?.outputs?.knowledgeUpdates
            );
            if (knowledgeUpdates.length > 0) {
              // eslint-disable-next-line no-await-in-loop
              await context.createArtifact(stepRef, {
                kind: 'knowledge_update',
                title: `${stepId}-knowledge-updates`,
                mimeType: 'application/json',
                content: JSON.stringify({
                  stepId,
                  updates: knowledgeUpdates,
                }, null, 2),
                metadata: {
                  updates: knowledgeUpdates,
                },
              });
              // eslint-disable-next-line no-await-in-loop
              await store.publishRunEvents(uid, runId, [{
                eventType: 'RESULT_SUMMARY',
                message: `Knowledge updates from ${stepId}: ${knowledgeUpdates.length}`,
                payload: {
                  stepId,
                  updates: knowledgeUpdates,
                },
              }]);
            }

            const suggestedNextSteps = normalizeStringList(
              shapedResult?.outputs?.suggested_next_steps
              || shapedResult?.outputs?.suggestedNextSteps
            );
            if (suggestedNextSteps.length > 0) {
              // eslint-disable-next-line no-await-in-loop
              await context.createArtifact(stepRef, {
                kind: 'suggested_next_step',
                title: `${stepId}-next-steps`,
                mimeType: 'application/json',
                content: JSON.stringify({
                  stepId,
                  suggestions: suggestedNextSteps,
                }, null, 2),
                metadata: {
                  suggestions: suggestedNextSteps,
                },
              });
              // eslint-disable-next-line no-await-in-loop
              await store.publishRunEvents(uid, runId, [{
                eventType: 'RESULT_SUMMARY',
                message: `Suggested next steps from ${stepId}: ${suggestedNextSteps.length}`,
                payload: {
                  stepId,
                  suggestions: suggestedNextSteps,
                },
              }]);

              for (const suggestion of suggestedNextSteps.slice(0, 8)) {
                // eslint-disable-next-line no-await-in-loop
                await store.createIdea(uid, {
                  projectId: run.projectId,
                  title: suggestion.length > 120 ? `${suggestion.slice(0, 117)}...` : suggestion,
                  hypothesis: suggestion,
                  summary: `Auto-generated from run ${runId} step ${stepId}`,
                  status: 'OPEN',
                }).catch(() => null);
              }
            }
            stepSucceeded = true;
          } catch (error) {
            const isLastAttempt = attempt >= maxRetries;
            if (!isLastAttempt) {
              // eslint-disable-next-line no-await-in-loop
              await store.publishRunEvents(uid, runId, [{
                eventType: 'STEP_LOG',
                status: 'RUNNING',
                message: `Step ${stepId} failed attempt ${attempt + 1}/${maxRetries + 1}; retrying`,
                payload: {
                  stepId,
                  moduleType,
                  error: cleanString(error?.message) || 'Step failed',
                },
              }]);
              attempt += 1;
              continue;
            }

            const endedAtIso = new Date().toISOString();
            const result = error?.result && typeof error.result === 'object'
              ? error.result
              : {
                stepId,
                moduleType,
                status: 'FAILED',
                metrics: {},
                outputs: {
                  error: cleanString(error?.message) || 'Step failed',
                },
                artifacts: [],
              };

            if (onFailure === 'skip') {
              const skipped = {
                stepId,
                moduleType,
                status: 'SKIPPED',
                metrics: {
                  ...(result.metrics || {}),
                  onFailure,
                  attempt: attempt + 1,
                  maxAttempts: maxRetries + 1,
                },
                outputs: {
                  ...(result.outputs || {}),
                  skippedReason: cleanString(error?.message) || 'Step failed',
                },
                artifacts: [],
                startedAt: startedAtIso,
                endedAt: endedAtIso,
              };
              stepResults.push(skipped);
              stepOutcomeById.set(stepId, 'SKIPPED');
              // eslint-disable-next-line no-await-in-loop
              await store.upsertRunStep(uid, runId, {
                stepId,
                moduleType,
                status: 'SKIPPED',
                order: index,
                startedAt: startedAtIso,
                endedAt: endedAtIso,
                message: `Step ${stepId} skipped after failure`,
                metrics: skipped.metrics,
                outputs: skipped.outputs,
              });
              // eslint-disable-next-line no-await-in-loop
              await store.publishRunEvents(uid, runId, [{
                eventType: 'STEP_RESULT',
                status: 'SKIPPED',
                message: `Step ${stepId} skipped after failure`,
                payload: {
                  stepId,
                  moduleType,
                  onFailure,
                  error: cleanString(error?.message) || 'Step failed',
                },
              }]);
              stepSucceeded = true;
              continue;
            }

            const failedResult = {
              ...result,
              metrics: {
                ...(result.metrics || {}),
                onFailure,
                attempt: attempt + 1,
                maxAttempts: maxRetries + 1,
              },
            };
            stepOutcomeById.set(stepId, 'FAILED');
            // eslint-disable-next-line no-await-in-loop
            await store.upsertRunStep(uid, runId, {
              stepId,
              moduleType,
              status: 'FAILED',
              order: index,
              startedAt: startedAtIso,
              endedAt: endedAtIso,
              message: cleanString(error?.message) || 'Step failed',
              metrics: failedResult.metrics || {},
              outputs: failedResult.outputs || {},
            });
            // eslint-disable-next-line no-await-in-loop
            await store.publishRunEvents(uid, runId, [{
              eventType: 'STEP_RESULT',
              status: 'FAILED',
              message: cleanString(error?.message) || `Step ${stepId} failed`,
              payload: {
                stepId,
                moduleType,
                metrics: failedResult.metrics || {},
              },
            }]);
            throw error;
          }
        }
      }

      if (run.mode === 'headless') {
        const required = Array.isArray(run?.outputContract?.requiredArtifacts)
          ? run.outputContract.requiredArtifacts
          : [];
        const requiredKinds = normalizeTokenList(required);
        if (run?.outputContract?.summaryRequired) {
          requiredKinds.push('run_summary_md');
        }

        const artifacts = await store.listRunArtifacts(uid, runId, { limit: 2000 });
        const kinds = new Set(artifacts.map((item) => cleanString(item.kind).toLowerCase()).filter(Boolean));
        const missingKinds = requiredKinds.filter((kind) => !kinds.has(kind));
        if (missingKinds.length > 0) {
          throw new Error(`Headless output contract failed: missing artifacts ${missingKinds.join(', ')}`);
        }

        const expectedTables = normalizeTokenList(run?.outputContract?.tables);
        const expectedFigures = normalizeTokenList(run?.outputContract?.figures);
        if (expectedTables.length > 0) {
          const tableArtifacts = artifacts.filter((item) => isTableLikeArtifact(item));
          const missingTables = expectedTables.filter((token) => !tableArtifacts.some((item) => artifactMatchesToken(item, token)));
          if (missingTables.length > 0) {
            throw new Error(`Headless output contract failed: missing tables ${missingTables.join(', ')}`);
          }
        }
        if (expectedFigures.length > 0) {
          const figureArtifacts = artifacts.filter((item) => isFigureLikeArtifact(item));
          const missingFigures = expectedFigures.filter((token) => !figureArtifacts.some((item) => artifactMatchesToken(item, token)));
          if (missingFigures.length > 0) {
            throw new Error(`Headless output contract failed: missing figures ${missingFigures.join(', ')}`);
          }
        }
      }

      // Collect continuation spec from any agent.run step, or from run metadata (for chained phases)
      const continuationFromStep = stepResults
        .slice()
        .reverse()
        .find((r) => r.continuation && typeof r.continuation === 'object' && r.continuation.nextRun)
        ?.continuation || null;
      const pendingContinuation = run?.metadata?.pendingContinuation
        && typeof run.metadata.pendingContinuation === 'object'
        ? run.metadata.pendingContinuation
        : null;
      const effectiveContinuation = continuationFromStep || pendingContinuation || null;

      await store.publishRunEvents(uid, runId, [{
        eventType: 'RUN_SUMMARY',
        status: 'SUCCEEDED',
        message: effectiveContinuation
          ? `Workflow completed — continuation phase: ${effectiveContinuation.phase || 'next'}`
          : 'Workflow completed successfully',
        payload: {
          stepCount: stepResults.length,
          durationMs: Date.now() - startedAt,
          hasContinuation: !!effectiveContinuation,
        },
      }]);

      return {
        ok: true,
        stepCount: stepResults.length,
        continuation: effectiveContinuation,
      };
    } finally {
      if (typeof onUnregisterCancel === 'function') {
        onUnregisterCancel(register);
      }
    }
  }
}

module.exports = new ResearchOpsOrchestrator();
