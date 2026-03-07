use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use researchops_local_daemon::executor::{
    ExecutionHandle,
    ExecutionJobSpec,
    ExecutionRequest,
    Executor,
    ExecutorPlane,
    HostExecutor,
    NoopExecutor,
    WorkspaceSnapshot,
};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}

fn build_request(backend: &str, runtime_class: &str) -> ExecutionRequest {
    ExecutionRequest {
        run_id: "run_exec_1".to_string(),
        project_id: "proj_1".to_string(),
        workspace_snapshot: WorkspaceSnapshot {
            path: None,
        },
        job_spec: ExecutionJobSpec {
            backend: backend.to_string(),
            runtime_class: runtime_class.to_string(),
            argv: vec!["/usr/bin/printf".to_string(), "hello".to_string()],
            env: BTreeMap::new(),
        },
    }
}

#[test]
fn executor_host_dispatches_requests_by_backend_and_runtime() {
    let plane = ExecutorPlane::new(Box::new(HostExecutor::default()), Box::new(NoopExecutor::new("queued", None)));

    let host_request = build_request("local", "wasm-lite");
    let container_request = build_request("container", "container-fast");

    assert_eq!(plane.resolve_executor_type(&host_request), "host");
    assert_eq!(plane.resolve_executor_type(&container_request), "noop");
}

#[test]
fn executor_host_runs_commands_in_the_workspace_and_returns_lifecycle_state() {
    let workspace_dir = unique_temp_dir("researchops-host-executor");
    fs::create_dir_all(&workspace_dir).expect("create workspace dir");

    let mut env = BTreeMap::new();
    env.insert("OUTPUT_NAME".to_string(), "host-output.txt".to_string());

    let request = ExecutionRequest {
        run_id: "run_host_1".to_string(),
        project_id: "proj_1".to_string(),
        workspace_snapshot: WorkspaceSnapshot {
            path: Some(workspace_dir.clone()),
        },
        job_spec: ExecutionJobSpec {
            backend: "local".to_string(),
            runtime_class: "wasm-lite".to_string(),
            argv: vec![
                "/bin/sh".to_string(),
                "-lc".to_string(),
                "printf host-run > \"$OUTPUT_NAME\"".to_string(),
            ],
            env,
        },
    };

    let executor = HostExecutor::default();
    let handle: ExecutionHandle = executor.start(&request);
    let result = executor.execute(&request, &handle).expect("host execution result");

    assert_eq!(handle.executor_type, "host");
    assert_eq!(handle.status, "running");
    assert!(!handle.execution_id.is_empty());
    assert_eq!(result.execution_id, handle.execution_id);
    assert_eq!(result.executor_type, "host");
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(
        fs::read_to_string(workspace_dir.join("host-output.txt")).expect("read host output"),
        "host-run"
    );

    fs::remove_dir_all(&workspace_dir).expect("cleanup workspace dir");
}

#[test]
fn executor_host_supports_noop_executor_for_deterministic_tests() {
    let request = build_request("container", "container-guarded");
    let executor = NoopExecutor::new("cancelled", Some(130));

    let handle = executor.start(&request);
    let result = executor.execute(&request, &handle).expect("noop execution result");

    assert_eq!(handle.executor_type, "noop");
    assert_eq!(handle.status, "running");
    assert_eq!(result.execution_id, handle.execution_id);
    assert_eq!(result.executor_type, "noop");
    assert_eq!(result.status, "cancelled");
    assert_eq!(result.exit_code, Some(130));
}
