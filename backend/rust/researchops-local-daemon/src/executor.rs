use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct WorkspaceSnapshot {
    pub path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct ExecutionJobSpec {
    pub backend: String,
    pub runtime_class: String,
    pub argv: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct ExecutionRequest {
    pub run_id: String,
    pub project_id: String,
    pub workspace_snapshot: WorkspaceSnapshot,
    pub job_spec: ExecutionJobSpec,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResolvedRuntime {
    pub backend: String,
    pub runtime_class: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExecutionHandle {
    pub execution_id: String,
    pub executor_type: String,
    pub status: String,
    pub started_at: String,
    pub resolved_runtime: ResolvedRuntime,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExecutionResult {
    pub execution_id: String,
    pub executor_type: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExecutionOutcome {
    pub handle: ExecutionHandle,
    pub result: ExecutionResult,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExecutorDescriptor {
    pub executor_type: &'static str,
    pub backends: Vec<&'static str>,
    pub runtime_classes: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ExecutorCatalog {
    pub executors: Vec<ExecutorDescriptor>,
}

pub trait Executor: Send + Sync {
    fn executor_type(&self) -> &'static str;

    fn start(&self, request: &ExecutionRequest) -> ExecutionHandle {
        ExecutionHandle {
            execution_id: build_execution_id(request),
            executor_type: self.executor_type().to_string(),
            status: "running".to_string(),
            started_at: current_timestamp(),
            resolved_runtime: resolve_runtime(request),
        }
    }

    fn execute(&self, request: &ExecutionRequest, handle: &ExecutionHandle) -> Result<ExecutionResult>;
}

#[derive(Debug, Default)]
pub struct HostExecutor;

impl Executor for HostExecutor {
    fn executor_type(&self) -> &'static str {
        "host"
    }

    fn execute(&self, request: &ExecutionRequest, handle: &ExecutionHandle) -> Result<ExecutionResult> {
        let program = request
            .job_spec
            .argv
            .first()
            .context("host executor requires at least one argv entry")?;
        let mut command = Command::new(program);
        if request.job_spec.argv.len() > 1 {
            command.args(&request.job_spec.argv[1..]);
        }
        if let Some(path) = &request.workspace_snapshot.path {
            command.current_dir(path);
        }
        for (key, value) in &request.job_spec.env {
            command.env(key, value);
        }

        let output = command.output().with_context(|| format!("run host command: {program}"))?;
        Ok(ExecutionResult {
            execution_id: handle.execution_id.clone(),
            executor_type: self.executor_type().to_string(),
            status: if output.status.success() {
                "succeeded".to_string()
            } else {
                "failed".to_string()
            },
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct NoopExecutor {
    status: String,
    exit_code: Option<i32>,
}

impl NoopExecutor {
    pub fn new(status: impl Into<String>, exit_code: Option<i32>) -> Self {
        Self {
            status: status.into(),
            exit_code,
        }
    }
}

impl Executor for NoopExecutor {
    fn executor_type(&self) -> &'static str {
        "noop"
    }

    fn execute(&self, _request: &ExecutionRequest, handle: &ExecutionHandle) -> Result<ExecutionResult> {
        Ok(ExecutionResult {
            execution_id: handle.execution_id.clone(),
            executor_type: self.executor_type().to_string(),
            status: self.status.clone(),
            exit_code: self.exit_code,
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

pub struct ExecutorPlane {
    host_executor: Box<dyn Executor>,
    fallback_executor: Box<dyn Executor>,
}

impl ExecutorPlane {
    pub fn new(host_executor: Box<dyn Executor>, fallback_executor: Box<dyn Executor>) -> Self {
        Self {
            host_executor,
            fallback_executor,
        }
    }

    pub fn resolve_executor_type(&self, request: &ExecutionRequest) -> &'static str {
        if should_use_host_executor(request) {
            self.host_executor.executor_type()
        } else {
            self.fallback_executor.executor_type()
        }
    }

    pub fn submit(&self, request: &ExecutionRequest) -> Result<ExecutionOutcome> {
        let executor = if should_use_host_executor(request) {
            &self.host_executor
        } else {
            &self.fallback_executor
        };
        let handle = executor.start(request);
        let result = executor.execute(request, &handle)?;
        Ok(ExecutionOutcome { handle, result })
    }
}

pub fn build_executor_catalog() -> ExecutorCatalog {
    ExecutorCatalog {
        executors: vec![
            ExecutorDescriptor {
                executor_type: "host",
                backends: vec!["local"],
                runtime_classes: vec!["wasm-lite"],
            },
            ExecutorDescriptor {
                executor_type: "noop",
                backends: vec!["container", "k8s", "slurm"],
                runtime_classes: vec!["container-fast", "container-guarded", "microvm-strong"],
            },
        ],
    }
}

fn should_use_host_executor(request: &ExecutionRequest) -> bool {
    let backend = normalize_backend(&request.job_spec.backend);
    let runtime_class = normalize_runtime_class(&request.job_spec.runtime_class);
    backend == "local"
        || runtime_class == "wasm-lite"
        || (backend.is_empty() && runtime_class.is_empty())
}

fn normalize_backend(value: &str) -> String {
    let normalized = normalize_token(value);
    match normalized.as_str() {
        "" => String::new(),
        "host" | "native" => "local".to_string(),
        "docker" | "containerd" => "container".to_string(),
        _ => normalized,
    }
}

fn normalize_runtime_class(value: &str) -> String {
    let normalized = normalize_token(value);
    match normalized.as_str() {
        "" => String::new(),
        "fast" => "container-fast".to_string(),
        "guarded" => "container-guarded".to_string(),
        "microvm" => "microvm-strong".to_string(),
        "wasm" => "wasm-lite".to_string(),
        _ => normalized,
    }
}

fn normalize_token(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['_', ' '], "-")
}

fn build_execution_id(request: &ExecutionRequest) -> String {
    let run_id = request.run_id.trim();
    if run_id.is_empty() {
        format!("exec-{}", current_timestamp())
    } else {
        format!("exec-{run_id}")
    }
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn resolve_runtime(request: &ExecutionRequest) -> ResolvedRuntime {
    ResolvedRuntime {
        backend: normalize_backend(&request.job_spec.backend),
        runtime_class: normalize_runtime_class(&request.job_spec.runtime_class),
    }
}
