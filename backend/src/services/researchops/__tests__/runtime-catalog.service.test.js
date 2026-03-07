'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EXECUTION_RUNTIME_CATALOG_VERSION,
  buildExecutionRuntimeCatalog,
  buildExecutionRuntimeProfile,
  buildRecommendedExecutionRuntime,
  normalizeExecutionBackend,
  normalizeRuntimeClass,
} = require('../runtime-catalog.service');

test('normalizeExecutionBackend canonicalizes known aliases while preserving unknown values', () => {
  assert.equal(normalizeExecutionBackend('docker'), 'container');
  assert.equal(normalizeExecutionBackend('kubernetes'), 'k8s');
  assert.equal(normalizeExecutionBackend('slurm'), 'slurm');
  assert.equal(normalizeExecutionBackend('custom-runner'), 'custom-runner');
  assert.equal(normalizeExecutionBackend(''), '');
});

test('normalizeRuntimeClass canonicalizes known aliases while preserving unknown values', () => {
  assert.equal(normalizeRuntimeClass('fast'), 'container-fast');
  assert.equal(normalizeRuntimeClass('guarded'), 'container-guarded');
  assert.equal(normalizeRuntimeClass('microvm'), 'microvm-strong');
  assert.equal(normalizeRuntimeClass('wasm'), 'wasm-lite');
  assert.equal(normalizeRuntimeClass('custom-runtime'), 'custom-runtime');
  assert.equal(normalizeRuntimeClass(''), '');
});

test('buildExecutionRuntimeProfile derives runtime family and isolation tier from normalized runtime classes', () => {
  assert.deepEqual(buildExecutionRuntimeProfile({
    backend: 'docker',
    runtimeClass: 'guarded',
    location: 'remote',
  }), {
    catalogVersion: EXECUTION_RUNTIME_CATALOG_VERSION,
    backend: 'container',
    runtimeClass: 'container-guarded',
    backendKnown: true,
    runtimeClassKnown: true,
    backendLabel: 'Container',
    runtimeClassLabel: 'Container Guarded',
    runtimeFamily: 'container',
    isolationTier: 'guarded',
    executionTarget: 'managed-runner',
    compatibilityStatus: 'compatible',
    compatibilityWarning: '',
  });
});

test('buildExecutionRuntimeProfile falls back to local-native semantics when no runtime class exists', () => {
  assert.deepEqual(buildExecutionRuntimeProfile({
    backend: '',
    runtimeClass: '',
    location: 'local',
  }), {
    catalogVersion: EXECUTION_RUNTIME_CATALOG_VERSION,
    backend: 'local',
    runtimeClass: null,
    backendKnown: true,
    runtimeClassKnown: null,
    backendLabel: 'Local Host',
    runtimeClassLabel: '',
    runtimeFamily: 'native',
    isolationTier: 'none',
    executionTarget: 'backend-host',
    compatibilityStatus: 'compatible',
    compatibilityWarning: '',
  });
});

test('buildExecutionRuntimeProfile flags incompatible backend and runtime-class combinations', () => {
  assert.deepEqual(buildExecutionRuntimeProfile({
    backend: 'local',
    runtimeClass: 'container-fast',
    location: 'local',
  }), {
    catalogVersion: EXECUTION_RUNTIME_CATALOG_VERSION,
    backend: 'local',
    runtimeClass: 'container-fast',
    backendKnown: true,
    runtimeClassKnown: true,
    backendLabel: 'Local Host',
    runtimeClassLabel: 'Container Fast',
    runtimeFamily: 'container',
    isolationTier: 'standard',
    executionTarget: 'backend-host',
    compatibilityStatus: 'mismatch',
    compatibilityWarning: 'Container Fast is not advertised for Local Host.',
  });
});

test('buildExecutionRuntimeCatalog exposes the current backend and runtime-class descriptors', () => {
  const catalog = buildExecutionRuntimeCatalog();

  assert.equal(catalog.version, EXECUTION_RUNTIME_CATALOG_VERSION);
  assert.equal(catalog.backends.length, 4);
  assert.equal(catalog.runtimeClasses.length, 4);
  assert.deepEqual(catalog.backends.map((item) => item.id), ['local', 'container', 'k8s', 'slurm']);
  assert.deepEqual(catalog.runtimeClasses.map((item) => item.id), [
    'wasm-lite',
    'container-fast',
    'container-guarded',
    'microvm-strong',
  ]);
});

test('buildRecommendedExecutionRuntime prefers guarded container runtime when managed rust runtime is available', () => {
  assert.deepEqual(buildRecommendedExecutionRuntime({
    runtimeSummary: {
      rustManagedRunning: true,
      rustSnapshotReady: true,
      bridgeReadyClients: 1,
      onlineClients: 2,
    },
  }), {
    backend: 'container',
    runtimeClass: 'container-guarded',
    reason: 'Managed Rust bridge runtime is online for guarded execution.',
  });
});

test('buildRecommendedExecutionRuntime falls back to fast container runtime when bridge-ready clients exist', () => {
  assert.deepEqual(buildRecommendedExecutionRuntime({
    runtimeSummary: {
      rustManagedRunning: false,
      bridgeReadyClients: 2,
      onlineClients: 2,
    },
  }), {
    backend: 'container',
    runtimeClass: 'container-fast',
    reason: 'Bridge-ready client runtimes are available for container execution.',
  });
});
