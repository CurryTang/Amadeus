use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::thread;

use researchops_local_daemon::{
    serve_http_requests,
    serve_one_http_request,
    serve_one_http_request_with_config,
    DaemonConfig,
};

#[test]
fn serve_one_http_request_returns_runtime_summary_json() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("listener addr");

    let handle = thread::spawn(move || {
        serve_one_http_request(listener, true).expect("serve one request");
    });

    let mut stream = TcpStream::connect(addr).expect("connect test listener");
    stream
        .write_all(b"GET /runtime HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write request");

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    handle.join().expect("server thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"task_catalog_version\":\"v0\""));
    assert!(response.contains("\"supports_local_bridge_workflow\":true"));
}

#[test]
fn serve_one_http_request_returns_task_catalog_json() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("listener addr");

    let handle = thread::spawn(move || {
        serve_one_http_request(listener, true).expect("serve one request");
    });

    let mut stream = TcpStream::connect(addr).expect("connect test listener");
    stream
        .write_all(b"GET /task-catalog HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write request");

    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    handle.join().expect("server thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"task_type\":\"bridge.submitNodeRun\""));
    assert!(response.contains("\"handler_mode\":\"builtin-http-proxy\""));
}

#[test]
fn serve_http_requests_handles_multiple_requests_before_stopping() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
    let addr = listener.local_addr().expect("listener addr");

    let handle = thread::spawn(move || {
        serve_http_requests(listener, true, Some(2)).expect("serve two requests");
    });

    let mut first = TcpStream::connect(addr).expect("connect first request");
    first
        .write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write first request");
    let mut first_response = String::new();
    first
        .read_to_string(&mut first_response)
        .expect("read first response");

    let mut second = TcpStream::connect(addr).expect("connect second request");
    second
        .write_all(b"GET /runtime HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write second request");
    let mut second_response = String::new();
    second
        .read_to_string(&mut second_response)
        .expect("read second response");

    handle.join().expect("server thread");

    assert!(first_response.starts_with("HTTP/1.1 200 OK"));
    assert!(first_response.contains("\"status\":\"ok\""));
    assert!(second_response.starts_with("HTTP/1.1 200 OK"));
    assert!(second_response.contains("\"task_catalog_version\":\"v0\""));
}

#[test]
fn serve_one_http_request_proxies_bridge_report_from_backend() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend listener");
    let backend_addr = backend_listener.local_addr().expect("backend addr");
    let backend_handle = thread::spawn(move || {
        let (mut stream, _) = backend_listener.accept().expect("accept backend connection");
        let mut request = String::new();
        stream.read_to_string(&mut request).expect("read backend request");
        assert!(request.starts_with("GET /api/researchops/runs/run_123/bridge-report HTTP/1.1"));
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 40\r\nConnection: close\r\n\r\n{\"bridgeVersion\":\"v0\",\"runId\":\"run_123\"}",
            )
            .expect("write backend response");
    });

    let daemon_listener = TcpListener::bind("127.0.0.1:0").expect("bind daemon listener");
    let daemon_addr = daemon_listener.local_addr().expect("daemon addr");
    let daemon_handle = thread::spawn(move || {
        serve_one_http_request_with_config(
            daemon_listener,
            true,
            DaemonConfig {
                api_base_url: format!("http://{}", backend_addr),
                admin_token: String::new(),
            },
        )
        .expect("serve daemon bridge-report request");
    });

    let mut client = TcpStream::connect(daemon_addr).expect("connect daemon");
    client
        .write_all(b"GET /bridge-report?runId=run_123 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write daemon request");
    client.shutdown(Shutdown::Write).expect("shutdown daemon write");
    let mut response = String::new();
    client.read_to_string(&mut response).expect("read daemon response");

    daemon_handle.join().expect("daemon thread");
    backend_handle.join().expect("backend thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"bridgeVersion\":\"v0\""));
    assert!(response.contains("\"runId\":\"run_123\""));
}

#[test]
fn serve_one_http_request_proxies_context_pack_from_backend() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend listener");
    let backend_addr = backend_listener.local_addr().expect("backend addr");
    let backend_handle = thread::spawn(move || {
        let (mut stream, _) = backend_listener.accept().expect("accept backend connection");
        let mut request = String::new();
        stream.read_to_string(&mut request).expect("read backend request");
        assert!(request.starts_with("GET /api/researchops/runs/run_456/context-pack HTTP/1.1"));
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 51\r\nConnection: close\r\n\r\n{\"mode\":\"routed\",\"view\":{\"selectedItems\":2},\"pack\":{}}",
            )
            .expect("write backend response");
    });

    let daemon_listener = TcpListener::bind("127.0.0.1:0").expect("bind daemon listener");
    let daemon_addr = daemon_listener.local_addr().expect("daemon addr");
    let daemon_handle = thread::spawn(move || {
        serve_one_http_request_with_config(
            daemon_listener,
            true,
            DaemonConfig {
                api_base_url: format!("http://{}", backend_addr),
                admin_token: String::new(),
            },
        )
        .expect("serve daemon context-pack request");
    });

    let mut client = TcpStream::connect(daemon_addr).expect("connect daemon");
    client
        .write_all(b"GET /context-pack?runId=run_456 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .expect("write daemon request");
    client.shutdown(Shutdown::Write).expect("shutdown daemon write");
    let mut response = String::new();
    client.read_to_string(&mut response).expect("read daemon response");

    daemon_handle.join().expect("daemon thread");
    backend_handle.join().expect("backend thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"mode\":\"routed\""));
    assert!(response.contains("\"selectedItems\":2"));
}

#[test]
fn serve_one_http_request_proxies_node_bridge_context_from_backend() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend listener");
    let backend_addr = backend_listener.local_addr().expect("backend addr");
    let backend_handle = thread::spawn(move || {
        let (mut stream, _) = backend_listener.accept().expect("accept backend connection");
        let mut request = String::new();
        stream.read_to_string(&mut request).expect("read backend request");
        assert!(
            request.starts_with(
                "GET /api/researchops/projects/proj_1/tree/nodes/node_eval/bridge-context?includeContextPack=true&includeReport=true HTTP/1.1"
            )
        );
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 56\r\nConnection: close\r\n\r\n{\"projectId\":\"proj_1\",\"node\":{\"id\":\"node_eval\"},\"ok\":true}",
            )
            .expect("write backend response");
    });

    let daemon_listener = TcpListener::bind("127.0.0.1:0").expect("bind daemon listener");
    let daemon_addr = daemon_listener.local_addr().expect("daemon addr");
    let daemon_handle = thread::spawn(move || {
        serve_one_http_request_with_config(
            daemon_listener,
            true,
            DaemonConfig {
                api_base_url: format!("http://{}", backend_addr),
                admin_token: String::new(),
            },
        )
        .expect("serve daemon node-context request");
    });

    let mut client = TcpStream::connect(daemon_addr).expect("connect daemon");
    client
        .write_all(
            b"GET /node-context?projectId=proj_1&nodeId=node_eval&includeContextPack=true&includeReport=true HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .expect("write daemon request");
    client.shutdown(Shutdown::Write).expect("shutdown daemon write");
    let mut response = String::new();
    client.read_to_string(&mut response).expect("read daemon response");

    daemon_handle.join().expect("daemon thread");
    backend_handle.join().expect("backend thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"projectId\":\"proj_1\""));
    assert!(response.contains("\"id\":\"node_eval\""));
}

#[test]
fn serve_one_http_request_proxies_bridge_note_post_to_backend() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend listener");
    let backend_addr = backend_listener.local_addr().expect("backend addr");
    let backend_handle = thread::spawn(move || {
        let (mut stream, _) = backend_listener.accept().expect("accept backend connection");
        let mut request = String::new();
        stream.read_to_string(&mut request).expect("read backend request");
        assert!(request.starts_with("POST /api/researchops/runs/run_789/bridge-note HTTP/1.1"));
        assert!(request.contains("Content-Type: application/json"));
        assert!(request.contains("\"title\":\"Note\""));
        assert!(request.contains("\"content\":\"hello from rust\""));
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 47\r\nConnection: close\r\n\r\n{\"ok\":true,\"runId\":\"run_789\",\"artifactId\":\"art_1\"}",
            )
            .expect("write backend response");
    });

    let daemon_listener = TcpListener::bind("127.0.0.1:0").expect("bind daemon listener");
    let daemon_addr = daemon_listener.local_addr().expect("daemon addr");
    let daemon_handle = thread::spawn(move || {
        serve_one_http_request_with_config(
            daemon_listener,
            true,
            DaemonConfig {
                api_base_url: format!("http://{}", backend_addr),
                admin_token: String::new(),
            },
        )
        .expect("serve daemon bridge-note request");
    });

    let mut client = TcpStream::connect(daemon_addr).expect("connect daemon");
    client
        .write_all(
            b"POST /bridge-note?runId=run_789 HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 44\r\nConnection: close\r\n\r\n{\"title\":\"Note\",\"content\":\"hello from rust\"}",
        )
        .expect("write daemon request");
    client.shutdown(Shutdown::Write).expect("shutdown daemon write");
    let mut response = String::new();
    client.read_to_string(&mut response).expect("read daemon response");

    daemon_handle.join().expect("daemon thread");
    backend_handle.join().expect("backend thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"runId\":\"run_789\""));
    assert!(response.contains("\"artifactId\":\"art_1\""));
}

#[test]
fn serve_one_http_request_proxies_bridge_run_post_to_backend() {
    let backend_listener = TcpListener::bind("127.0.0.1:0").expect("bind backend listener");
    let backend_addr = backend_listener.local_addr().expect("backend addr");
    let backend_handle = thread::spawn(move || {
        let (mut stream, _) = backend_listener.accept().expect("accept backend connection");
        let mut request = String::new();
        stream.read_to_string(&mut request).expect("read backend request");
        assert!(request.starts_with("POST /api/researchops/projects/proj_1/tree/nodes/node_eval/bridge-run HTTP/1.1"));
        assert!(request.contains("Content-Type: application/json"));
        assert!(request.contains("\"force\":true"));
        assert!(request.contains("\"localSnapshot\":{\"kind\":\"workspace_patch\"}"));
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 54\r\nConnection: close\r\n\r\n{\"mode\":\"run\",\"run\":{\"id\":\"run_999\"},\"attempt\":{\"id\":\"run_999\"}}",
            )
            .expect("write backend response");
    });

    let daemon_listener = TcpListener::bind("127.0.0.1:0").expect("bind daemon listener");
    let daemon_addr = daemon_listener.local_addr().expect("daemon addr");
    let daemon_handle = thread::spawn(move || {
        serve_one_http_request_with_config(
            daemon_listener,
            true,
            DaemonConfig {
                api_base_url: format!("http://{}", backend_addr),
                admin_token: String::new(),
            },
        )
        .expect("serve daemon node-run request");
    });

    let mut client = TcpStream::connect(daemon_addr).expect("connect daemon");
    client
        .write_all(
            b"POST /node-run?projectId=proj_1&nodeId=node_eval HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 57\r\nConnection: close\r\n\r\n{\"force\":true,\"localSnapshot\":{\"kind\":\"workspace_patch\"}}",
        )
        .expect("write daemon request");
    client.shutdown(Shutdown::Write).expect("shutdown daemon write");
    let mut response = String::new();
    client.read_to_string(&mut response).expect("read daemon response");

    daemon_handle.join().expect("daemon thread");
    backend_handle.join().expect("backend thread");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains("\"mode\":\"run\""));
    assert!(response.contains("\"run_999\""));
}
