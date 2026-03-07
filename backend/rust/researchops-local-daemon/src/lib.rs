use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::net::UnixListener;

use anyhow::{Context, Result};
use serde::Serialize;

pub const TASK_CATALOG_VERSION: &str = "v0";

pub const BUILT_IN_TASK_TYPES: [&str; 3] = [
    "project.checkPath",
    "project.ensurePath",
    "project.ensureGit",
];

pub const OPTIONAL_BRIDGE_TASK_TYPES: [&str; 5] = [
    "bridge.fetchNodeContext",
    "bridge.fetchContextPack",
    "bridge.submitNodeRun",
    "bridge.fetchRunReport",
    "bridge.submitRunNote",
];

pub trait TreePlanStore: Send + Sync {
    fn read_plan(&self, project_id: &str) -> anyhow::Result<String>;
    fn write_plan(&self, project_id: &str, plan_yaml: &str) -> anyhow::Result<()>;
}

pub trait TreeStateStore: Send + Sync {
    fn read_state(&self, project_id: &str) -> anyhow::Result<String>;
    fn write_state(&self, project_id: &str, state_json: &str) -> anyhow::Result<()>;
}

pub trait RunStore: Send + Sync {
    fn create_run(&self, run_json: &str) -> anyhow::Result<String>;
    fn get_run(&self, run_id: &str) -> anyhow::Result<Option<String>>;
    fn update_run_status(&self, run_id: &str, status: &str, message: Option<&str>) -> anyhow::Result<()>;
    fn append_run_event(&self, run_id: &str, event_json: &str) -> anyhow::Result<()>;
}

pub trait ContextPackBuilder: Send + Sync {
    fn build_knowledge_context(&self, project_id: &str, run_id: Option<&str>) -> anyhow::Result<String>;
    fn build_routed_run_context(&self, run_id: &str) -> anyhow::Result<String>;
}

pub trait ObservedSessionIndexer: Send + Sync {
    fn list_observed_sessions(&self, project_id: &str) -> anyhow::Result<Vec<String>>;
    fn refresh_observed_session(&self, project_id: &str, observed_session_id: &str) -> anyhow::Result<String>;
}

pub trait RunReportBuilder: Send + Sync {
    fn build_run_report(&self, run_id: &str) -> anyhow::Result<String>;
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RuntimeSummary {
    pub task_catalog_version: &'static str,
    pub supported_task_types: Vec<String>,
    pub supports_local_bridge_workflow: bool,
    pub missing_bridge_task_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskCatalog {
    pub version: &'static str,
    pub tasks: Vec<TaskDescriptor>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TaskDescriptor {
    pub task_type: &'static str,
    pub family: &'static str,
    pub handler_mode: &'static str,
    pub summary: &'static str,
}

pub fn task_catalog_version() -> &'static str {
    TASK_CATALOG_VERSION
}

pub fn build_runtime_summary(task_types: &[&str]) -> RuntimeSummary {
    let supported_task_types = normalize_task_types(task_types);
    let missing_bridge_task_types = OPTIONAL_BRIDGE_TASK_TYPES
        .iter()
        .filter(|task_type| !supported_task_types.iter().any(|item| item == **task_type))
        .map(|task_type| (*task_type).to_string())
        .collect::<Vec<_>>();

    RuntimeSummary {
        task_catalog_version: TASK_CATALOG_VERSION,
        supported_task_types,
        supports_local_bridge_workflow: missing_bridge_task_types.is_empty(),
        missing_bridge_task_types,
    }
}

pub fn build_task_catalog() -> TaskCatalog {
    TaskCatalog {
        version: TASK_CATALOG_VERSION,
        tasks: vec![
            TaskDescriptor {
                task_type: "project.checkPath",
                family: "project",
                handler_mode: "builtin",
                summary: "Check whether a project path exists and is a directory.",
            },
            TaskDescriptor {
                task_type: "project.ensurePath",
                family: "project",
                handler_mode: "builtin",
                summary: "Ensure the project directory exists on the client daemon host.",
            },
            TaskDescriptor {
                task_type: "project.ensureGit",
                family: "project",
                handler_mode: "builtin",
                summary: "Ensure the project directory is a git repository.",
            },
            TaskDescriptor {
                task_type: "bridge.fetchNodeContext",
                family: "bridge",
                handler_mode: "builtin-http-proxy",
                summary: "Fetch node bridge context, optionally with context pack and bridge report.",
            },
            TaskDescriptor {
                task_type: "bridge.fetchContextPack",
                family: "bridge",
                handler_mode: "builtin-http-proxy",
                summary: "Fetch a run-scoped context pack for local bridge clients.",
            },
            TaskDescriptor {
                task_type: "bridge.submitNodeRun",
                family: "bridge",
                handler_mode: "builtin-http-proxy",
                summary: "Submit a snapshot-backed node run through the bridge workflow.",
            },
            TaskDescriptor {
                task_type: "bridge.fetchRunReport",
                family: "bridge",
                handler_mode: "builtin-http-proxy",
                summary: "Fetch a compact bridge-friendly run report summary.",
            },
            TaskDescriptor {
                task_type: "bridge.submitRunNote",
                family: "bridge",
                handler_mode: "builtin-http-proxy",
                summary: "Submit a markdown bridge note as a run artifact.",
            },
        ],
    }
}

fn build_http_body(path: &str, enable_bridge: bool) -> Result<serde_json::Value> {
    match path {
        "/health" => Ok(serde_json::json!({
            "status": "ok",
            "service": "researchops-local-daemon",
            "task_catalog_version": TASK_CATALOG_VERSION,
        })),
        "/runtime" => {
            let task_types = build_runtime_task_types(enable_bridge);
            serde_json::to_value(build_runtime_summary(&task_types)).context("serialize runtime summary")
        }
        "/task-catalog" => serde_json::to_value(build_task_catalog()).context("serialize task catalog"),
        _ => Ok(serde_json::json!({
            "error": "not_found",
            "path": path,
        })),
    }
}

fn respond_to_http_connection<T: Read + Write>(stream: &mut T, enable_bridge: bool) -> Result<()> {
    let mut buffer = [0_u8; 4096];
    let bytes_read = stream.read(&mut buffer).context("read http request")?;
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    let body = build_http_body(path, enable_bridge)?;
    let status_line = if matches!(path, "/health" | "/runtime" | "/task-catalog") {
        "HTTP/1.1 200 OK"
    } else {
        "HTTP/1.1 404 Not Found"
    };
    let body_text = serde_json::to_string(&body).context("encode response body")?;
    let response = format!(
        "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body_text.len(),
        body_text
    );
    stream.write_all(response.as_bytes()).context("write http response")?;
    stream.flush().context("flush http response")?;
    Ok(())
}

pub fn serve_one_http_request(listener: TcpListener, enable_bridge: bool) -> Result<()> {
    let (mut stream, _) = listener.accept().context("accept tcp connection")?;
    respond_to_http_connection(&mut stream, enable_bridge)?;
    Ok(())
}

pub fn serve_http_requests(listener: TcpListener, enable_bridge: bool, max_requests: Option<usize>) -> Result<()> {
    let mut handled = 0_usize;
    loop {
        let (mut stream, _) = listener.accept().context("accept tcp connection")?;
        respond_to_http_connection(&mut stream, enable_bridge)?;
        handled += 1;
        if max_requests.is_some_and(|value| handled >= value) {
            break;
        }
    }
    Ok(())
}

pub fn serve_one_unix_request(listener: UnixListener, enable_bridge: bool) -> Result<()> {
    let (mut stream, _) = listener.accept().context("accept unix connection")?;
    respond_to_http_connection(&mut stream, enable_bridge)?;
    Ok(())
}

pub fn serve_unix_requests(listener: UnixListener, enable_bridge: bool, max_requests: Option<usize>) -> Result<()> {
    let mut handled = 0_usize;
    loop {
        let (mut stream, _) = listener.accept().context("accept unix connection")?;
        respond_to_http_connection(&mut stream, enable_bridge)?;
        handled += 1;
        if max_requests.is_some_and(|value| handled >= value) {
            break;
        }
    }
    Ok(())
}

pub fn build_runtime_task_types(enable_bridge: bool) -> Vec<&'static str> {
    let mut task_types = BUILT_IN_TASK_TYPES.iter().copied().collect::<Vec<_>>();
    if enable_bridge {
        task_types.extend(OPTIONAL_BRIDGE_TASK_TYPES.iter().copied());
    }
    task_types
}

fn normalize_task_types(task_types: &[&str]) -> Vec<String> {
    let mut normalized = Vec::<String>::new();
    for task_type in task_types {
        let trimmed = task_type.trim();
        if trimmed.is_empty() || normalized.iter().any(|item| item == trimmed) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}
