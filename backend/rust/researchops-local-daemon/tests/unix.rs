use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use researchops_local_daemon::{serve_one_unix_request, serve_one_unix_request_with_config, DaemonConfig};

fn unique_socket_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("researchops-local-daemon-{nanos}.sock"))
}

#[test]
fn serve_one_unix_request_returns_runtime_summary_json() {
    let socket_path = unique_socket_path();
    let listener = UnixListener::bind(&socket_path).expect("bind unix listener");

    let handle = thread::spawn({
        move || {
            serve_one_unix_request(listener, true).expect("serve unix request");
        }
    });

    let mut stream = UnixStream::connect(&socket_path).expect("connect unix socket");
    stream
        .write_all(b"GET /runtime HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write request");

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    handle.join().expect("server thread");

    fs::remove_file(&socket_path).expect("cleanup socket path");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"supports_local_bridge_workflow\":true"));
}

#[test]
fn serve_one_unix_request_executes_bridge_fetch_run_report_task() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend listener");
    let backend_addr = backend_listener.local_addr().expect("backend addr");
    let backend_handle = thread::spawn(move || {
        let (mut stream, _) = backend_listener.accept().expect("accept backend connection");
        let mut request = String::new();
        stream.read_to_string(&mut request).expect("read backend request");
        assert!(request.starts_with("GET /api/researchops/runs/run_unix/bridge-report HTTP/1.1"));
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 46\r\nConnection: close\r\n\r\n{\"bridgeVersion\":\"v0\",\"runId\":\"run_unix\",\"ok\":true}",
            )
            .expect("write backend response");
    });

    let socket_path = unique_socket_path();
    let listener = UnixListener::bind(&socket_path).expect("bind unix listener");

    let handle = thread::spawn({
        move || {
            serve_one_unix_request_with_config(
                listener,
                true,
                DaemonConfig {
                    api_base_url: format!("http://{}", backend_addr),
                    admin_token: String::new(),
                },
            )
            .expect("serve unix task request");
        }
    });

    let mut stream = UnixStream::connect(&socket_path).expect("connect unix socket");
    stream
        .write_all(
            b"POST /tasks/execute HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 67\r\nConnection: close\r\n\r\n{\"taskType\":\"bridge.fetchRunReport\",\"payload\":{\"runId\":\"run_unix\"}}",
        )
        .expect("write request");

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    handle.join().expect("server thread");
    backend_handle.join().expect("backend thread");

    fs::remove_file(&socket_path).expect("cleanup socket path");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"runId\":\"run_unix\""));
}
