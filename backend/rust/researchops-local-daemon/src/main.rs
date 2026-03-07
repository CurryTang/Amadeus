use anyhow::Result;
use researchops_local_daemon::{
    build_task_catalog,
    build_runtime_task_types,
    build_runtime_summary,
    DaemonConfig,
    serve_http_requests_with_config,
    serve_one_http_request_with_config,
    serve_unix_requests_with_config,
    serve_one_unix_request_with_config,
};
use std::net::TcpListener;
use std::os::unix::net::UnixListener;

fn main() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--task-catalog") {
        println!("{}", serde_json::to_string_pretty(&build_task_catalog())?);
        return Ok(());
    }

    let enable_bridge = std::env::var("RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(true);
    let config = DaemonConfig {
        api_base_url: std::env::var("RESEARCHOPS_API_BASE_URL").unwrap_or_default(),
        admin_token: std::env::var("ADMIN_TOKEN").unwrap_or_default(),
    };

    if let Some(listen_addr) = args
        .windows(2)
        .find(|window| window.first().map(|value| value.as_str()) == Some("--serve-once"))
        .and_then(|window| window.get(1))
    {
        let listener = TcpListener::bind(listen_addr)?;
        serve_one_http_request_with_config(listener, enable_bridge, config)?;
        return Ok(());
    }

    if let Some(socket_path) = args
        .windows(2)
        .find(|window| window.first().map(|value| value.as_str()) == Some("--serve-unix-once"))
        .and_then(|window| window.get(1))
    {
        let _ = std::fs::remove_file(socket_path);
        let listener = UnixListener::bind(socket_path)?;
        serve_one_unix_request_with_config(listener, enable_bridge, config)?;
        return Ok(());
    }

    if let Some(listen_addr) = args
        .windows(2)
        .find(|window| window.first().map(|value| value.as_str()) == Some("--serve"))
        .and_then(|window| window.get(1))
    {
        let max_requests = args
            .windows(2)
            .find(|window| window.first().map(|value| value.as_str()) == Some("--max-requests"))
            .and_then(|window| window.get(1))
            .and_then(|value| value.parse::<usize>().ok());
        let listener = TcpListener::bind(listen_addr)?;
        serve_http_requests_with_config(listener, enable_bridge, max_requests, config)?;
        return Ok(());
    }

    if let Some(socket_path) = args
        .windows(2)
        .find(|window| window.first().map(|value| value.as_str()) == Some("--serve-unix"))
        .and_then(|window| window.get(1))
    {
        let max_requests = args
            .windows(2)
            .find(|window| window.first().map(|value| value.as_str()) == Some("--max-requests"))
            .and_then(|window| window.get(1))
            .and_then(|value| value.parse::<usize>().ok());
        let _ = std::fs::remove_file(socket_path);
        let listener = UnixListener::bind(socket_path)?;
        serve_unix_requests_with_config(listener, enable_bridge, max_requests, config)?;
        return Ok(());
    }

    let task_types = build_runtime_task_types(enable_bridge);
    let summary = build_runtime_summary(&task_types);
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
