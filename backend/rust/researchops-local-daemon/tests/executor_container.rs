use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use researchops_local_daemon::container_executor::ContainerExecutor;
use researchops_local_daemon::container_runtime::{
    build_cancel_command,
    prepare_workspace,
    runtime_class_policy,
    ContainerRuntimeSpec,
    WorkspaceMode,
};
use researchops_local_daemon::executor::{ExecutionJobSpec, ExecutionRequest, WorkspaceSnapshot};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}

#[test]
fn executor_container_maps_runtime_classes_to_expected_policies() {
    let fast = runtime_class_policy("container-fast");
    let guarded = runtime_class_policy("container-guarded");

    assert_eq!(fast.workspace_mode, WorkspaceMode::Mount);
    assert_eq!(fast.network_enabled, true);
    assert_eq!(guarded.workspace_mode, WorkspaceMode::Stage);
    assert_eq!(guarded.network_enabled, false);
}

#[test]
fn executor_container_builds_docker_compatible_cli_commands() {
    let workspace_dir = unique_temp_dir("researchops-container-mount");
    fs::create_dir_all(&workspace_dir).expect("create workspace dir");

    let mut env = BTreeMap::new();
    env.insert("API_TOKEN".to_string(), "secret-token".to_string());

    let request = ExecutionRequest {
        run_id: "run_container_1".to_string(),
        project_id: "proj_1".to_string(),
        workspace_snapshot: WorkspaceSnapshot {
            path: Some(workspace_dir.clone()),
        },
        job_spec: ExecutionJobSpec {
            backend: "container".to_string(),
            runtime_class: "container-fast".to_string(),
            argv: vec!["python".to_string(), "train.py".to_string()],
            env,
        },
    };

    let executor = ContainerExecutor::new("docker", "ghcr.io/example/researchops-runtime:latest");
    let plan = executor.plan(&request).expect("container plan");

    assert_eq!(plan.run_command.program, "timeout");
    assert!(plan.run_command.args.iter().any(|item| item == "docker"));
    assert!(plan.run_command.args.iter().any(|item| item == "run"));
    assert!(plan
        .run_command
        .args
        .iter()
        .any(|item: &String| item.contains(&format!("{}:/workspace:rw", workspace_dir.display()))));
    assert!(plan.run_command.args.iter().any(|item| item == "ghcr.io/example/researchops-runtime:latest"));
    assert!(plan.run_command.args.iter().any(|item| item == "API_TOKEN=secret-token"));

    fs::remove_dir_all(&workspace_dir).expect("cleanup workspace dir");
}

#[test]
fn executor_container_stages_workspace_for_guarded_runtime() {
    let workspace_dir = unique_temp_dir("researchops-container-source");
    let staging_root = unique_temp_dir("researchops-container-stage");
    fs::create_dir_all(&workspace_dir).expect("create workspace dir");
    fs::write(workspace_dir.join("README.md"), "hello staged runtime").expect("seed workspace file");

    let spec = ContainerRuntimeSpec {
        cli: "docker".to_string(),
        image: "ghcr.io/example/researchops-runtime:latest".to_string(),
        container_name: "exec-run_container_2".to_string(),
        runtime_class: "container-guarded".to_string(),
        workspace_host_path: workspace_dir.clone(),
        container_workspace_path: "/workspace".to_string(),
        argv: vec!["bash".to_string(), "-lc".to_string(), "ls".to_string()],
        env: BTreeMap::new(),
        timeout_seconds: Some(120),
    };

    let prepared = prepare_workspace(&spec, &staging_root).expect("prepare staged workspace");

    assert_eq!(prepared.mode, WorkspaceMode::Stage);
    assert_ne!(prepared.host_path, workspace_dir);
    assert_eq!(
        fs::read_to_string(prepared.host_path.join("README.md")).expect("read staged file"),
        "hello staged runtime"
    );

    fs::remove_dir_all(&workspace_dir).expect("cleanup workspace dir");
    fs::remove_dir_all(&staging_root).expect("cleanup staging root");
}

#[test]
fn executor_container_builds_cancel_command_with_timeout_wiring() {
    let cancel = build_cancel_command("docker", "exec-run_container_3");

    assert_eq!(cancel.program, "docker");
    assert_eq!(cancel.args, vec!["stop", "--time", "5", "exec-run_container_3"]);
}
