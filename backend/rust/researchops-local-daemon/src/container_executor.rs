use std::env;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::container_runtime::{
    build_cancel_command,
    build_run_command,
    prepare_workspace,
    ContainerCommand,
    ContainerRuntimeSpec,
    PreparedWorkspace,
};
use crate::executor::ExecutionRequest;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ContainerExecutionPlan {
    pub runtime_spec: ContainerRuntimeSpec,
    pub prepared_workspace: PreparedWorkspace,
    pub run_command: ContainerCommand,
    pub cancel_command: ContainerCommand,
}

#[derive(Debug, Clone)]
pub struct ContainerExecutor {
    cli: String,
    image: String,
    staging_root: PathBuf,
    default_timeout_seconds: u64,
}

impl ContainerExecutor {
    pub fn new(cli: impl Into<String>, image: impl Into<String>) -> Self {
        Self {
            cli: cli.into(),
            image: image.into(),
            staging_root: env::temp_dir().join("researchops-container-staging"),
            default_timeout_seconds: 90,
        }
    }

    pub fn plan(&self, request: &ExecutionRequest) -> Result<ContainerExecutionPlan> {
        let workspace_host_path = request
            .workspace_snapshot
            .path
            .clone()
            .context("container executor requires a workspace snapshot path")?;
        let runtime_spec = ContainerRuntimeSpec {
            cli: self.cli.clone(),
            image: self.image.clone(),
            container_name: format!("exec-{}", request.run_id.trim()),
            runtime_class: request.job_spec.runtime_class.trim().to_string(),
            workspace_host_path,
            container_workspace_path: "/workspace".to_string(),
            argv: request.job_spec.argv.clone(),
            env: request.job_spec.env.clone(),
            timeout_seconds: Some(self.default_timeout_seconds),
        };
        let prepared_workspace = prepare_workspace(&runtime_spec, &self.staging_root)?;
        let run_command = build_run_command(&runtime_spec, &prepared_workspace);
        let cancel_command = build_cancel_command(&self.cli, &runtime_spec.container_name);
        Ok(ContainerExecutionPlan {
            runtime_spec,
            prepared_workspace,
            run_command,
            cancel_command,
        })
    }
}
