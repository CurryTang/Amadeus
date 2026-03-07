'use strict';

const EXECUTION_RUNTIME_CATALOG_VERSION = 'v0';

const BACKEND_DESCRIPTORS = [
  {
    id: 'local',
    label: 'Local Host',
    executionTarget: 'backend-host',
    supportedRuntimeClasses: ['wasm-lite'],
  },
  {
    id: 'container',
    label: 'Container',
    executionTarget: 'managed-runner',
    supportedRuntimeClasses: ['wasm-lite', 'container-fast', 'container-guarded'],
  },
  {
    id: 'k8s',
    label: 'Kubernetes',
    executionTarget: 'cluster-runner',
    supportedRuntimeClasses: ['wasm-lite', 'container-fast', 'container-guarded', 'microvm-strong'],
  },
  {
    id: 'slurm',
    label: 'Slurm',
    executionTarget: 'batch-cluster',
    supportedRuntimeClasses: ['container-fast', 'container-guarded'],
  },
];

const RUNTIME_CLASS_DESCRIPTORS = [
  {
    id: 'wasm-lite',
    label: 'WASM Lite',
    runtimeFamily: 'wasm',
    isolationTier: 'lite',
  },
  {
    id: 'container-fast',
    label: 'Container Fast',
    runtimeFamily: 'container',
    isolationTier: 'standard',
  },
  {
    id: 'container-guarded',
    label: 'Container Guarded',
    runtimeFamily: 'container',
    isolationTier: 'guarded',
  },
  {
    id: 'microvm-strong',
    label: 'MicroVM Strong',
    runtimeFamily: 'microvm',
    isolationTier: 'strong',
  },
];

const BACKEND_ALIASES = {
  docker: 'container',
  containerd: 'container',
  kubernetes: 'k8s',
};

const RUNTIME_CLASS_ALIASES = {
  fast: 'container-fast',
  containerfast: 'container-fast',
  guarded: 'container-guarded',
  containerguarded: 'container-guarded',
  microvm: 'microvm-strong',
  microvmstrong: 'microvm-strong',
  wasm: 'wasm-lite',
  wasmlite: 'wasm-lite',
};

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeToken(value = '') {
  return cleanString(value).toLowerCase().replace(/[_\s]+/g, '-');
}

function getBackendDescriptor(backend = '') {
  const normalized = normalizeExecutionBackend(backend);
  return BACKEND_DESCRIPTORS.find((item) => item.id === normalized) || null;
}

function getRuntimeClassDescriptor(runtimeClass = '') {
  const normalized = normalizeRuntimeClass(runtimeClass);
  return RUNTIME_CLASS_DESCRIPTORS.find((item) => item.id === normalized) || null;
}

function normalizeExecutionBackend(value = '') {
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  return BACKEND_ALIASES[normalized] || normalized;
}

function normalizeRuntimeClass(value = '') {
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  return RUNTIME_CLASS_ALIASES[normalized] || normalized;
}

function buildExecutionRuntimeProfile({
  backend = '',
  runtimeClass = '',
  location = '',
} = {}) {
  const normalizedBackend = normalizeExecutionBackend(backend) || (cleanString(location).toLowerCase() === 'local' ? 'local' : '');
  const normalizedRuntimeClass = normalizeRuntimeClass(runtimeClass);
  const backendDescriptor = getBackendDescriptor(normalizedBackend);
  const runtimeClassDescriptor = getRuntimeClassDescriptor(normalizedRuntimeClass);
  const supportedRuntimeClasses = Array.isArray(backendDescriptor?.supportedRuntimeClasses)
    ? backendDescriptor.supportedRuntimeClasses
    : [];
  const compatibilityStatus = !normalizedRuntimeClass
    ? 'compatible'
    : (!backendDescriptor || !runtimeClassDescriptor)
      ? 'unknown'
      : supportedRuntimeClasses.includes(normalizedRuntimeClass)
        ? 'compatible'
        : 'mismatch';
  const compatibilityWarning = compatibilityStatus === 'mismatch'
    ? `${runtimeClassDescriptor.label} is not advertised for ${backendDescriptor.label}.`
    : '';

  return {
    catalogVersion: EXECUTION_RUNTIME_CATALOG_VERSION,
    backend: normalizedBackend || null,
    runtimeClass: normalizedRuntimeClass || null,
    backendKnown: backendDescriptor ? true : Boolean(normalizedBackend) ? false : null,
    runtimeClassKnown: runtimeClassDescriptor ? true : Boolean(normalizedRuntimeClass) ? false : null,
    backendLabel: backendDescriptor?.label || cleanString(normalizedBackend),
    runtimeClassLabel: runtimeClassDescriptor?.label || cleanString(normalizedRuntimeClass),
    runtimeFamily: runtimeClassDescriptor?.runtimeFamily
      || (normalizedBackend === 'local' ? 'native' : ''),
    isolationTier: runtimeClassDescriptor?.isolationTier
      || (normalizedBackend === 'local' ? 'none' : ''),
    executionTarget: backendDescriptor?.executionTarget
      || (cleanString(location).toLowerCase() === 'local' ? 'backend-host' : ''),
    compatibilityStatus,
    compatibilityWarning,
  };
}

function buildExecutionRuntimeCatalog() {
  return {
    version: EXECUTION_RUNTIME_CATALOG_VERSION,
    backends: BACKEND_DESCRIPTORS.map((item) => ({ ...item })),
    runtimeClasses: RUNTIME_CLASS_DESCRIPTORS.map((item) => ({ ...item })),
  };
}

module.exports = {
  EXECUTION_RUNTIME_CATALOG_VERSION,
  buildExecutionRuntimeCatalog,
  buildExecutionRuntimeProfile,
  getBackendDescriptor,
  getRuntimeClassDescriptor,
  normalizeExecutionBackend,
  normalizeRuntimeClass,
};
