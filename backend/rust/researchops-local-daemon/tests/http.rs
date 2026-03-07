use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use researchops_local_daemon::serve_one_http_request;

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
