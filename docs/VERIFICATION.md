# Integrated application verification

Executed on the integration workspace on 30 October 2026, using Windows,
Node 22.14.0, Python 3.11.18 and Electron 35.7.5.

## Automated checks

| Command/check | Result | Evidence and scope |
|---|---|---|
| `npm run build` | PASS | All five active TypeScript workspaces; renderer, sandboxed preload and PDF worker bundles |
| `npm test` | PASS — 191 tests | Compile service 120; cloud/privacy 44; WS-5 controller 12; desktop storage/Python IPC 2; backend 13 |
| `npm run test:integration` | PASS — 1 scenario | Real HTTP server, isolated Prisma database, actual registration/login, valid PDFs, denied consent, fresh consent on retry, 101-page rejection, Local Only and upstream abort |
| `npm run test:desktop` | PASS — 1 end-to-end scenario | Actual hidden Electron app and normal authentication; create/open project; actual CodeMirror selection; Python subprocess streaming; cancellation clears proposal; forged project access rejected; compile bridge; account API settings save/load/removal; native-dialog consent fixtures; read-only cloud output; in-flight privacy abort; local inference in Local Only mode; restart persistence |
| `.venv/Scripts/python.exe -m unittest discover -s services/local-ai -p test_requirements.py` | PASS — 45 tests | Existing local-engine requirements and CPU/GPU policy tests; includes boundary/failure cases; model calls in these unit tests use fixtures/mocks |
| `.venv/Scripts/python.exe -m unittest discover -s qa/ws5 -p test_evaluate.py` | PASS — 3 tests | Preserved quality-evaluation helper behavior |
| `npm run db:migrate` | PASS | Default development database created and migration applied; isolated databases used for tests |
| `python scripts/doctor.py --stub` | PASS | Python, Node, installed dependencies, Electron executable, build and server configuration |
| `git diff --check` | PASS | No tracked whitespace errors; Git reports normal CRLF-to-LF normalization notices |

Total: **243 passing automated tests/scenarios**. They verify the stated
implementation paths; they are not a declaration that every original SRS
requirement is complete.

Desktop automation uses an isolated profile and synthetic PDF, explicit demo
model/compiler/cloud adapters, and software Chromium rendering. The production
renderer CSP remains enforced. Windows restricted child processes could not
start the Chromium renderer reliably; the successful hidden test ran outside
that process sandbox. Application context isolation and Electron renderer
sandboxing remain enabled. Screenshot: `.cache/desktop-smoke/integrated-app.png`.

The restart check restores local projects only if OS encryption can store a
session. If unavailable, it instead checks that authentication is still required;
it never substitutes plaintext credential storage.

## Actual local-model smoke

The public `Qwen3-4B-Q4_K_M.gguf` was downloaded and verified against its
publisher's SHA256. The installed Vulkan `llama-cpp-python` runtime was exercised
through the compiled **Electron-side PythonAiClient**, using the same worker
and model path as the application, without `--stub`:

```text
Task: grammar
Input: The results is preliminary.
Output: The results are preliminary.
stub: false
Stream frames: 6
End-to-end elapsed time, including model startup: 39.005 seconds
```

This checks real IPC-to-model execution, streaming and a nonempty result. It is
one cold process smoke response, not a warm speed benchmark or a 150-word rewrite
measurement. It does not certify NFR-04 or NFR-06. GPU layer decisions use the
existing planner and local hardware configuration; no new claim about measured
GPU memory/performance is made from this test.

## Checks requiring additional services or review

| Item | Current status / next action |
|---|---|
| Real Docker compilation/sandbox | Docker Engine is unavailable here; live doctor reports it missing. Install/start Docker, build `ltx-sandbox:1`, then run the compile service's `test:docker` and `smoke:compile` scripts. Unit and stub compile checks passed. |
| Live cloud summaries | No real provider credentials configured. Save a Gemini key/model under Account API settings, or configure a server-side custom relay as documented in the README. Tests use explicit labelled stub/provider fixtures; no private paper was sent externally. |
| Reference-machine NFR-04/06 | Re-run actual model benchmarks and GPU-memory sampling for the agreed workload/hardware. The 39.005-second smoke is not proof of the earlier 20-second cold-start target. The 1.5 GB admission estimate is not a guaranteed driver memory limit. |
| NFR-07 quality | Run the retained JSON prompt runner and independent-review tooling on the specified data set. This integration does not fabricate two human reviews or change the acceptance threshold. |
| Tasks 6–8 | Preserved as deferred Sprint 2 production work; original controller fixture tests remain available. |
| Sharing/server synchronization/file tree | Existing project/auth/compile contributions retained; no additional features are implied by integration. |

Historical local-AI reports and the source SRS/SDD remain preserved in their
documented folders. See `INTEGRATION.md` for architecture changes and scope
reconciliation; see the root README for install, run and test commands.

## Account API settings and demo diagnostics follow-up (31 October 2026)

- Added authenticated account settings endpoints and a password-field form for
  Gemini (default gemini-3.8-flash) or a custom HTTPS PDF relay. Keys are never
  returned by the settings API; settings updates do not contact the provider.
- AES-256-GCM ciphertext is persisted in the account database. An injected
  CREDENTIAL_MASTER_SECRET or ignored per-database random master-key file permits
  restart persistence. Keep this key secure and back it up with the database.
- New real-HTTP tests pass for authentication, cross-account isolation, encrypted
  storage, successful decryption by a fresh process, update and deletion.
- Mocked provider-transport tests pass for Gemini base64 PDF formatting, key header,
  custom relay, HTTP errors, empty response and forwarded cancellation signal.
  These tests do not use a real Gemini key or claim a successful live API call.
- The updated hidden Electron test passes with settings load/save/delete and key
  field clearing, alongside existing auth/AI/compile/privacy flows.
- Removed fixed sample ERROR/WARNING messages from StubCompileService. Demo mode
  still returns only a labelled sample PDF, and the toolbar explicitly says the
  source was not compiled. Source diagnostics require the real Docker compiler.
- Normal Python launch now disables inherited demo flags; --stub is explicit and
  --stub-compile permits only the compiler fixture while keeping AI/cloud live.
- Full build passed. Component groups passed (191 tests); the backend's PDF test
  hit its 5-second timeout during parallel UI testing and passed on isolated
  rerun. Integration tests: 3 passed. Electron end-to-end: 1 passed. The unchanged
  48 Python tests above are retained from the previous verified baseline.
- Database migration applied without resetting developer data. Docker remains
  unavailable; no live compile or live Gemini claim is made.

## PDF preview, cloud guidance and model speed follow-up (31 October 2026)

- Reproduced the missing preview with the error `a.toHex is not a function` in
  Electron 35. The original desktop test checked compile IPC only, which did
  not expose this renderer compatibility failure.
- Switched the renderer and matching PDF worker to PDF.js's legacy compatibility
  build and disabled eval-based PDF optimization, preserving the application CSP.
- The desktop end-to-end test now clicks the actual Compile toolbar button and
  requires a visible PDF canvas. This test passes, alongside automatic opening
  of account Gemini settings when configuration is missing, and existing flows.
- Missing account/server cloud settings are checked before the PDF picker;
  guidance points to the account API-key form. Explicit non-retryable server
  responses are honored by the cloud adapter.
- Local inference remains Qwen3-4B Q4_K_M with the existing 1.5 GB admission
  budget. A real two-request grammar probe observed 14/37 GPU layers: first text
  at 31.0 seconds cold, 1.0 seconds warm; total durations 32.886 and 3.808 seconds.
  Both outputs: "The results are preliminary." These are short smoke timings,
  not a reference-machine performance acceptance benchmark.
- Runtime status now shows actual model, GPU/CPU allocation, first-text time and
  offloading reason. Warm requests are labelled as preparation rather than model
  loading. Cancellation still terminates the model worker, requiring a cold load
  next time. No VRAM cap was increased and no speed improvement is claimed.

Follow-up checks: full build PASS; 44 cloud/privacy tests PASS; 45 local-engine tests PASS; 3 HTTP/provider integration scenarios PASS; updated Electron end-to-end with visible PDF and cloud configuration guidance PASS. Initial test attempts hit restricted temporary-file/loopback permissions; reruns used workspace temporary paths and the authorized unrestricted test process. No live Gemini request was made without a user key.

Cloud diagnostic follow-up (31 October 2026): replaced the generic account-provider failure with fixed, key-safe messages for HTTP 400/401/403/404/413/429/5xx, TLS certificate failures, DNS and connection failures, invalid JSON and empty output. Server build and all three integration scenarios pass, including mocked status/certificate errors and checks that upstream secret text is never exposed. An unauthenticated HTTPS GET to Gemini returned 403, demonstrating host connectivity only; it does not validate any user key, model, quota or live PDF summary.

Five-minute cloud timeout revision (31 October 2026): desktop and server defaults now 300,000 ms, with matching five-minute messages and documentation. Full build PASS; 44 cloud/privacy tests PASS; focused server timeout regression PASS, asserting the server constant and timeout response text. An initial full backend run passed the cloud timeout case but two unrelated project-role setup hooks exceeded the test harness 5-second limit under load; the focused rerun used a 15-second test-harness timeout. No five-minute live provider wait was performed.
