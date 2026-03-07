use std::fs;
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use researchops_local_daemon::serve_one_unix_request;

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
