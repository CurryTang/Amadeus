use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum WorkspaceMode {
    Mount,
    Stage,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RuntimeClassPolicy {
    pub runtime_class: String,
    pub workspace_mode: WorkspaceMode,
    pub network_enabled: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ContainerRuntimeSpec {
    pub cli: String,
    pub image: String,
    pub container_name: String,
    pub runtime_class: String,
    pub workspace_host_path: PathBuf,
    pub container_workspace_path: String,
    pub argv: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PreparedWorkspace {
    pub host_path: PathBuf,
    pub mode: WorkspaceMode,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ContainerCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn runtime_class_policy(runtime_class: &str) -> RuntimeClassPolicy {
    let normalized = normalize_runtime_class(runtime_class);
    match normalized.as_str() {
        "container-guarded" => RuntimeClassPolicy {
            runtime_class: "container-guarded".to_string(),
            workspace_mode: WorkspaceMode::Stage,
            network_enabled: false,
        },
        _ => RuntimeClassPolicy {
            runtime_class: "container-fast".to_string(),
            workspace_mode: WorkspaceMode::Mount,
            network_enabled: true,
        },
    }
}

pub fn prepare_workspace(spec: &ContainerRuntimeSpec, staging_root: &Path) -> Result<PreparedWorkspace> {
    let policy = runtime_class_policy(&spec.runtime_class);
    if policy.workspace_mode == WorkspaceMode::Mount {
        return Ok(PreparedWorkspace {
            host_path: spec.workspace_host_path.clone(),
            mode: WorkspaceMode::Mount,
        });
    }

    let staged_path = staging_root.join(&spec.container_name).join("workspace");
    if staged_path.exists() {
        fs::remove_dir_all(&staged_path).context("remove previous staged workspace")?;
    }
    copy_directory_recursive(&spec.workspace_host_path, &staged_path)?;
    Ok(PreparedWorkspace {
        host_path: staged_path,
        mode: WorkspaceMode::Stage,
    })
}

pub fn build_run_command(spec: &ContainerRuntimeSpec, prepared_workspace: &PreparedWorkspace) -> ContainerCommand {
    let policy = runtime_class_policy(&spec.runtime_class);
    let mut args = Vec::new();
    args.push("run".to_string());
    args.push("--rm".to_string());
    args.push("--name".to_string());
    args.push(spec.container_name.clone());
    args.push("-w".to_string());
    args.push(spec.container_workspace_path.clone());
    if !policy.network_enabled {
        args.push("--network".to_string());
        args.push("none".to_string());
    }

    let mount_mode = if prepared_workspace.mode == WorkspaceMode::Stage {
        "ro"
    } else {
        "rw"
    };
    args.push("-v".to_string());
    args.push(format!(
        "{}:{}:{}",
        prepared_workspace.host_path.display(),
        spec.container_workspace_path,
        mount_mode
    ));

    for (key, value) in &spec.env {
        args.push("-e".to_string());
        args.push(format!("{key}={value}"));
    }

    args.push(spec.image.clone());
    args.extend(spec.argv.iter().cloned());

    if let Some(timeout_seconds) = spec.timeout_seconds {
        let mut wrapped_args = Vec::new();
        wrapped_args.push(timeout_seconds.to_string());
        wrapped_args.push(spec.cli.clone());
        wrapped_args.extend(args);
        return ContainerCommand {
            program: "timeout".to_string(),
            args: wrapped_args,
        };
    }

    ContainerCommand {
        program: spec.cli.clone(),
        args,
    }
}

pub fn build_cancel_command(cli: &str, container_name: &str) -> ContainerCommand {
    ContainerCommand {
        program: cli.trim().to_string(),
        args: vec![
            "stop".to_string(),
            "--time".to_string(),
            "5".to_string(),
            container_name.trim().to_string(),
        ],
    }
}

fn normalize_runtime_class(value: &str) -> String {
    match value.trim().to_ascii_lowercase().replace(['_', ' '], "-").as_str() {
        "guarded" => "container-guarded".to_string(),
        "fast" | "" => "container-fast".to_string(),
        other => other.to_string(),
    }
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination).with_context(|| format!("create directory {}", destination.display()))?;
    for entry in fs::read_dir(source).with_context(|| format!("read directory {}", source.display()))? {
        let entry = entry.context("read directory entry")?;
        let file_type = entry.file_type().context("read entry type")?;
        let destination_path = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory_recursive(&entry.path(), &destination_path)?;
        } else {
            fs::copy(entry.path(), &destination_path).with_context(|| {
                format!(
                    "copy file {} to {}",
                    entry.path().display(),
                    destination_path.display()
                )
            })?;
        }
    }
    Ok(())
}
