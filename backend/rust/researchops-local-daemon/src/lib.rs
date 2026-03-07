use std::io::{Read, Write};
use std::net::TcpStream;
use std::net::TcpListener;
use std::net::Shutdown;
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

#[derive(Debug, Clone, Default)]
pub struct DaemonConfig {
    pub api_base_url: String,
    pub admin_token: String,
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

fn parse_request_target(path: &str) -> (&str, Option<&str>) {
    path.split_once('?')
        .map(|(route, query)| (route, Some(query)))
        .unwrap_or((path, None))
}

fn query_value<'a>(query: Option<&'a str>, key: &str) -> Option<&'a str> {
    query
        .unwrap_or("")
        .split('&')
        .find_map(|pair| pair.split_once('=').filter(|(name, _)| *name == key).map(|(_, value)| value))
}

fn query_flag(query: Option<&str>, key: &str) -> bool {
    matches!(query_value(query, key), Some("true" | "1" | "yes" | "on"))
}

fn payload_string<'a>(payload: Option<&'a serde_json::Value>, key: &str) -> Option<&'a str> {
    payload.and_then(|value| value.get(key)).and_then(serde_json::Value::as_str).map(str::trim).filter(|value| !value.is_empty())
}

fn payload_bool(payload: Option<&serde_json::Value>, key: &str) -> bool {
    payload
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn payload_object<'a>(payload: Option<&'a serde_json::Value>, key: &str) -> Option<&'a serde_json::Value> {
    payload.and_then(|value| value.get(key)).filter(|value| value.is_object())
}

fn http_request_via_config(
    config: &DaemonConfig,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Result<serde_json::Value> {
    let base = config.api_base_url.trim();
    if base.is_empty() {
        anyhow::bail!("api_base_url is required for backend proxy routes");
    }
    let authority = base
        .strip_prefix("http://")
        .context("only http:// backend urls are supported in the prototype")?;
    let mut stream = TcpStream::connect(authority).context("connect backend tcp stream")?;
    let auth_header = if config.admin_token.trim().is_empty() {
        String::new()
    } else {
        format!("Authorization: Bearer {}\r\n", config.admin_token.trim())
    };
    let body_text = body
        .map(serde_json::to_string)
        .transpose()
        .context("encode backend request body")?;
    let content_headers = if let Some(ref payload) = body_text {
        format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            payload.len()
        )
    } else {
        String::new()
    };
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {authority}\r\n{auth_header}{content_headers}Connection: close\r\n\r\n{}",
        body_text.as_deref().unwrap_or("")
    );
    stream.write_all(request.as_bytes()).context("write backend request")?;
    stream.flush().context("flush backend request")?;
    stream.shutdown(Shutdown::Write).context("shutdown backend write")?;

    let mut response = String::new();
    stream.read_to_string(&mut response).context("read backend response")?;
    let (_, body) = response.split_once("\r\n\r\n").context("split backend response body")?;
    serde_json::from_str(body).context("decode backend response json")
}

fn build_task_proxy_request(
    task_type: &str,
    payload: Option<&serde_json::Value>,
) -> Result<(&'static str, String, Option<serde_json::Value>)> {
    if task_type == "bridge.fetchRunReport" {
        let run_id = payload_string(payload, "runId").context("runId is required for bridge.fetchRunReport")?;
        return Ok((
            "GET",
            format!("/api/researchops/runs/{run_id}/bridge-report"),
            None,
        ));
    }
    if task_type == "bridge.fetchContextPack" {
        let run_id = payload_string(payload, "runId").context("runId is required for bridge.fetchContextPack")?;
        return Ok((
            "GET",
            format!("/api/researchops/runs/{run_id}/context-pack"),
            None,
        ));
    }
    if task_type == "bridge.fetchNodeContext" {
        let project_id = payload_string(payload, "projectId").context("projectId is required for bridge.fetchNodeContext")?;
        let node_id = payload_string(payload, "nodeId").context("nodeId is required for bridge.fetchNodeContext")?;
        let mut backend_path =
            format!("/api/researchops/projects/{project_id}/tree/nodes/{node_id}/bridge-context");
        let mut query_pairs = Vec::new();
        if payload_bool(payload, "includeContextPack") {
            query_pairs.push("includeContextPack=true");
        }
        if payload_bool(payload, "includeReport") {
            query_pairs.push("includeReport=true");
        }
        if !query_pairs.is_empty() {
            backend_path.push('?');
            backend_path.push_str(&query_pairs.join("&"));
        }
        return Ok(("GET", backend_path, None));
    }
    if task_type == "bridge.submitRunNote" {
        let run_id = payload_string(payload, "runId").context("runId is required for bridge.submitRunNote")?;
        return Ok((
            "POST",
            format!("/api/researchops/runs/{run_id}/bridge-note"),
            Some(payload.cloned().unwrap_or_else(|| serde_json::json!({}))),
        ));
    }
    if task_type == "bridge.submitNodeRun" {
        let project_id = payload_string(payload, "projectId").context("projectId is required for bridge.submitNodeRun")?;
        let node_id = payload_string(payload, "nodeId").context("nodeId is required for bridge.submitNodeRun")?;
        return Ok((
            "POST",
            format!("/api/researchops/projects/{project_id}/tree/nodes/{node_id}/bridge-run"),
            Some(payload.cloned().unwrap_or_else(|| serde_json::json!({}))),
        ));
    }
    anyhow::bail!("unsupported taskType: {task_type}")
}

#[derive(Debug, Clone)]
struct HttpRequestView {
    method: String,
    path: String,
    body: Option<serde_json::Value>,
}

fn parse_http_request(request: &str) -> Result<HttpRequestView> {
    let mut lines = request.lines();
    let first_line = lines.next().unwrap_or_default();
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let body = request
        .split_once("\r\n\r\n")
        .map(|(_, raw_body)| raw_body.trim())
        .filter(|raw_body| !raw_body.is_empty())
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()
        .context("decode incoming json body")?;
    Ok(HttpRequestView { method, path, body })
}

fn build_http_body(
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
    enable_bridge: bool,
    config: &DaemonConfig,
) -> Result<serde_json::Value> {
    let (route, query) = parse_request_target(path);
    let run_id = query_value(query, "runId").map(str::trim).filter(|value| !value.is_empty());
    let project_id = query_value(query, "projectId").map(str::trim).filter(|value| !value.is_empty());
    let node_id = query_value(query, "nodeId").map(str::trim).filter(|value| !value.is_empty());

    if route == "/bridge-report" {
        let run_id = run_id.context("runId is required for /bridge-report")?;
        return http_request_via_config(config, "GET", &format!("/api/researchops/runs/{run_id}/bridge-report"), None);
    }
    if route == "/context-pack" {
        let run_id = run_id.context("runId is required for /context-pack")?;
        return http_request_via_config(config, "GET", &format!("/api/researchops/runs/{run_id}/context-pack"), None);
    }
    if route == "/node-context" {
        let project_id = project_id.context("projectId is required for /node-context")?;
        let node_id = node_id.context("nodeId is required for /node-context")?;
        let mut backend_path =
            format!("/api/researchops/projects/{project_id}/tree/nodes/{node_id}/bridge-context");
        let mut query_pairs = Vec::new();
        if query_flag(query, "includeContextPack") {
            query_pairs.push("includeContextPack=true");
        }
        if query_flag(query, "includeReport") {
            query_pairs.push("includeReport=true");
        }
        if !query_pairs.is_empty() {
            backend_path.push('?');
            backend_path.push_str(&query_pairs.join("&"));
        }
        return http_request_via_config(config, "GET", &backend_path, None);
    }
    if route == "/bridge-note" && method.eq_ignore_ascii_case("POST") {
        let run_id = run_id.context("runId is required for /bridge-note")?;
        return http_request_via_config(
            config,
            "POST",
            &format!("/api/researchops/runs/{run_id}/bridge-note"),
            body,
        );
    }
    if route == "/node-run" && method.eq_ignore_ascii_case("POST") {
        let project_id = project_id.context("projectId is required for /node-run")?;
        let node_id = node_id.context("nodeId is required for /node-run")?;
        return http_request_via_config(
            config,
            "POST",
            &format!("/api/researchops/projects/{project_id}/tree/nodes/{node_id}/bridge-run"),
            body,
        );
    }
    if route == "/tasks/execute" && method.eq_ignore_ascii_case("POST") {
        let task_type = payload_string(body, "taskType").context("taskType is required for /tasks/execute")?;
        let task_payload = payload_object(body, "payload");
        let (task_method, backend_path, backend_body) = build_task_proxy_request(task_type, task_payload)?;
        return http_request_via_config(config, task_method, &backend_path, backend_body.as_ref());
    }

    match route {
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

fn respond_to_http_connection<T: Read + Write>(stream: &mut T, enable_bridge: bool, config: &DaemonConfig) -> Result<()> {
    let mut buffer = [0_u8; 4096];
    let bytes_read = stream.read(&mut buffer).context("read http request")?;
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let request_view = parse_http_request(&request)?;
    let body = build_http_body(
        &request_view.method,
        &request_view.path,
        request_view.body.as_ref(),
        enable_bridge,
        config,
    )?;
    let (route, _) = parse_request_target(&request_view.path);
    let status_line = if matches!(
        route,
        "/health" | "/runtime" | "/task-catalog" | "/bridge-report" | "/context-pack" | "/node-context" | "/bridge-note" | "/node-run" | "/tasks/execute"
    ) {
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
    serve_one_http_request_with_config(listener, enable_bridge, DaemonConfig::default())
}

pub fn serve_one_http_request_with_config(listener: TcpListener, enable_bridge: bool, config: DaemonConfig) -> Result<()> {
    let (mut stream, _) = listener.accept().context("accept tcp connection")?;
    respond_to_http_connection(&mut stream, enable_bridge, &config)?;
    Ok(())
}

pub fn serve_http_requests(listener: TcpListener, enable_bridge: bool, max_requests: Option<usize>) -> Result<()> {
    serve_http_requests_with_config(listener, enable_bridge, max_requests, DaemonConfig::default())
}

pub fn serve_http_requests_with_config(
    listener: TcpListener,
    enable_bridge: bool,
    max_requests: Option<usize>,
    config: DaemonConfig,
) -> Result<()> {
    let mut handled = 0_usize;
    loop {
        let (mut stream, _) = listener.accept().context("accept tcp connection")?;
        respond_to_http_connection(&mut stream, enable_bridge, &config)?;
        handled += 1;
        if max_requests.is_some_and(|value| handled >= value) {
            break;
        }
    }
    Ok(())
}

pub fn serve_one_unix_request(listener: UnixListener, enable_bridge: bool) -> Result<()> {
    serve_one_unix_request_with_config(listener, enable_bridge, DaemonConfig::default())
}

pub fn serve_one_unix_request_with_config(listener: UnixListener, enable_bridge: bool, config: DaemonConfig) -> Result<()> {
    let (mut stream, _) = listener.accept().context("accept unix connection")?;
    respond_to_http_connection(&mut stream, enable_bridge, &config)?;
    Ok(())
}

pub fn serve_unix_requests(listener: UnixListener, enable_bridge: bool, max_requests: Option<usize>) -> Result<()> {
    serve_unix_requests_with_config(listener, enable_bridge, max_requests, DaemonConfig::default())
}

pub fn serve_unix_requests_with_config(
    listener: UnixListener,
    enable_bridge: bool,
    max_requests: Option<usize>,
    config: DaemonConfig,
) -> Result<()> {
    let mut handled = 0_usize;
    loop {
        let (mut stream, _) = listener.accept().context("accept unix connection")?;
        respond_to_http_connection(&mut stream, enable_bridge, &config)?;
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
