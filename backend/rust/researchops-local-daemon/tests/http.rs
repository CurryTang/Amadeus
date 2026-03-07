use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

use researchops_local_daemon::{serve_http_requests, serve_one_http_request};

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
