//! Optional listener transport for machines that block Rust test executables
//! from accepting TCP. Requests still traverse production reqwest and the exact
//! same Axum fixture router; no OAuth handlers or assertions are replaced.

use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};

use axum::{
    body::{to_bytes, Body},
    extract::Request,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tower::ServiceExt;

pub(super) struct NodeHttp {
    pub origin: String,
    child: Child,
    reader: Option<thread::JoinHandle<()>>,
}

impl NodeHttp {
    pub fn start(router: Router) -> Self {
        let executable = std::env::var_os("OAUTH_TEST_NODE").expect("OAUTH_TEST_NODE is set");
        assert!(
            Path::new(&executable).is_absolute(),
            "OAUTH_TEST_NODE must be an absolute executable path"
        );
        let mut command = Command::new(executable);
        command
            .args(["--input-type=module", "-e", include_str!("node-http.mjs")])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn().expect("start isolated Node HTTP fixture");
        let input = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let (ready, startup) = mpsc::channel();
        let runtime = tokio::runtime::Handle::current();
        let reader = thread::spawn(move || {
            let mut event = String::new();
            output
                .read_line(&mut event)
                .expect("Node fixture ready event");
            let event: Value = serde_json::from_str(&event).expect("Node fixture JSON ready event");
            ready
                .send(
                    event["origin"]
                        .as_str()
                        .expect("Node fixture origin")
                        .to_owned(),
                )
                .unwrap();
            for line in output.lines() {
                let event: Value = serde_json::from_str(&line.expect("Node fixture output"))
                    .expect("Node fixture request");
                let router = router.clone();
                let input = input.clone();
                runtime.spawn(async move {
                    let mut request = Request::builder()
                        .method(event["method"].as_str().unwrap())
                        .uri(event["url"].as_str().unwrap());
                    for pair in event["headers"].as_array().unwrap().chunks_exact(2) {
                        request =
                            request.header(pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
                    }
                    let body = STANDARD.decode(event["body"].as_str().unwrap()).unwrap();
                    let response = router
                        .oneshot(request.body(Body::from(body)).unwrap())
                        .await
                        .unwrap();
                    let (parts, body) = response.into_parts();
                    let bytes = to_bytes(body, 1024 * 1024).await.unwrap();
                    let headers: Vec<_> = parts
                        .headers
                        .iter()
                        .map(|(key, value)| {
                            (key.as_str().to_owned(), value.to_str().unwrap().to_owned())
                        })
                        .collect();
                    let reply = json!({ "id": event["id"], "status": parts.status.as_u16(),
                        "headers": headers, "body": STANDARD.encode(bytes) });
                    let mut writer = input.lock().unwrap();
                    if serde_json::to_writer(&mut *writer, &reply).is_ok() {
                        let _ = writer.write_all(b"\n");
                        let _ = writer.flush();
                    }
                });
            }
        });
        let mut fixture = Self {
            origin: String::new(),
            child,
            reader: Some(reader),
        };
        fixture.origin = startup
            .recv_timeout(Duration::from_secs(5))
            .expect("Node HTTP fixture startup timed out");
        assert!(fixture.origin.starts_with("http://127.0.0.1:"));
        fixture
    }
}

impl Drop for NodeHttp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}
