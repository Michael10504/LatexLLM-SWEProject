# LaTeXLLM integrated application

One Electron editor connects the local Python AI engine, WS-5 AI panel, cloud
paper summarization/privacy module, authentication/project backend and WS-3
sandboxed LaTeX compiler. Original specifications are preserved; integration
status and requirement boundaries are in `docs/INTEGRATION.md`.

For a presentation walkthrough with sample inputs and expected results, see
[the step-by-step demo guide](docs/DEMO_GUIDE.md).

## Layout

| Folder | Responsibility |
|---|---|
| `apps/desktop/` | Electron main/preload, CodeMirror editor, AI and summary panel, PDF preview |
| `apps/server/` | Authentication, sessions, server role enforcement, stateless PDF relay, Prisma |
| `services/local-ai/` | Local model, GPU/CPU selection, Python worker, CLI, test fixtures/reports |
| `packages/ai-panel/` | WS-5 controller and its original behavior tests |
| `packages/cloud-summary/` | Global Local Only state, gateway, consent, PDF validation, summarization |
| `packages/compile-service/` | Existing Docker sandbox, compile/log/PDF services and tests |
| `qa/ws5/` | Preserved evaluation tooling, including independent-review requirements |
| `docs/requirements/` | Unmodified source SRS/SDD copies |
| `reference/` | Original WS-5 shell and duplicate cloud server for provenance, not build targets |
| `scripts/` | Setup, launch, diagnostics and migrations |

## Prerequisites

- Python **3.11+**.
- Node.js **22.12+**, including npm. Setup also recognizes a provisioned local
  toolchain under `.cache/toolchain/` on this machine.
- For real compilation: Docker Desktop/Engine running. The application uses
  `ltx-sandbox:1`, with the original network/CPU/memory/process/time limits.
- A GPU is optional. NVIDIA telemetry enables automatic partial GPU offloading;
  unknown/insufficient VRAM or an unsupported backend selects CPU. Sufficient
  system RAM is required. Other platforms may need a compiler/backend setup for
  llama-cpp-python; Windows uses the publisher's prebuilt Vulkan wheel.
- If no SQLite prebuilt binary exists for your platform, Electron native rebuild
  requires the platform's C++ build tools (Visual Studio C++ tools on Windows).

## Install once

From the repository root:

```powershell
python scripts/setup.py --download-model
```

This creates `.venv`, installs Python packages through the root
`requirements.txt`, installs the npm workspaces, generates Prisma, applies
migrations without wiping existing data, prepares the Electron SQLite binding,
builds the application and downloads/verifies the public ~2.5 GB GGUF.
Python packages belong in `requirements.txt`; Node/Electron packages belong in
the workspace `package.json`/`package-lock.json`. Do not install JavaScript
packages through pip.

The trained `outline-q4_k_m.gguf` is optional and is not bundled. Put it in
`services/local-ai/` to use that specialist. Without it, the public 4B model runs
the same outline prompt locally. Models, actual GPU settings, databases, provider
keys and generated dependency folders are not committed.

For the real compiler, after starting Docker:

```powershell
docker build -t ltx-sandbox:1 packages/compile-service/docker
```

Alternatively pass `--docker` to setup. Docker Desktop itself must be installed
separately; the setup script does not install system services.

## Run

```powershell
python scripts/run.py
```

This builds and launches the backend and desktop together with the same Node
installation used by setup. With Node 22.12+ already on PATH, `npm start` is the
equivalent root entry point. The default server binds only to 127.0.0.1:3443.
For separate terminals use `python scripts/run.py --server-only` and
`npm run start:desktop` after building.

Register an account, sign in, create/open a project, and edit `main.tex`.
Normal authentication remains enabled in demo mode too. After a successful login,
an OS-encrypted cached session can reopen local projects offline for at most eight
hours. If OS encryption is unavailable, no plaintext session is stored and a new
online login is required. Logout clears the encrypted session.

### Local AI

Select text **in the CodeMirror editor**, choose one of Tasks 1–5, and click
**Run locally**. Empty and >1000-word selections are rejected before inference.
The read-only original/proposal fields do not save or apply results. Cancel
clears partial output and terminates the Python inference process; a subsequent
request starts a fresh worker. Viewers cannot run AI or save project files;
main-process checks enforce this independently of UI controls.

The worker reuses its model between requests and communicates by JSON-lines
stdin/stdout, not an external API. Selected LaTeX never goes to the cloud path.
The 1.5 GB AI admission estimate, <=4096 context, CPU KV cache and CPU fallback
are preserved. Set `LTX_PYTHON` to choose another interpreter, or
`LTX_LOCAL_AI_DIR` to choose a configured local service directory. Match
`gpu_settings.json` to your physical NVIDIA/Vulkan device; the example index is
machine-specific. Memory estimates/samples are not a driver-enforced quota.

Tasks 6–8 remain visible but disabled as Sprint 2 work. The WS-5 controller's
original eight-task contract and compile-log tests are preserved; unsupported
production tasks are never silently sent to the model.

### Cloud paper summaries

The global **Local Only** control is available on the login screen and in the
workspace. It persists per device. Local AI and compilation continue locally.
When enabled it blocks online authentication and cloud requests, including cloud
requests relayed through localhost, and aborts in-flight external operations.
It does not queue them for later replay.

When online and signed in, choose **Choose PDF and summarize**. The application
validates a readable PDF, <=20 MB and <=100 pages. Every transmission and retry
requires a new consent dialog showing filename, size, provider and the third-party
statement. Cancel sends nothing. Summaries are read-only and do not change LaTeX.
PDFs are held in memory; the relay does not write them to disk.

For Gemini, open **Paper summary → Account API settings**, select **Google Gemini**,
enter your API key and an available model ID, and click **Save to my account**.
The default is `gemini-3.8-flash`; you can change it to a model enabled for your key.
Use **Load my settings** to retrieve the configuration without exposing the key,
leave the key blank to keep it on update, or **Remove saved API settings** to delete it.
Settings belong to the signed-in account and persist on this server across restarts.
Local Only must be off to read/save server account settings. Consent is still
required for each PDF transmission. Saving settings does not validate the key or
send a PDF; a live summary requires a valid key, enabled model and provider quota.
See [Google's document API](https://ai.google.dev/gemini-api/docs/generate-content/document-processing).

API keys are AES-256-GCM encrypted in the server database, never returned by the
settings API or stored in renderer localStorage. Set `CREDENTIAL_MASTER_SECRET`
for a managed server deployment. Otherwise a random master key is persisted in
an ignored `<database>.credentials.key` file beside the database. Protect that
file with server filesystem permissions and keep it with database backups;
losing/changing the master key makes saved credentials unreadable.

For a custom relay or server-wide defaults,
`apps/server/.env.example` documents server configuration. Setup copies it to
`.env` only if no configuration exists. A real provider needs:

- `CLOUD_SUMMARY_ENDPOINT`: an **HTTPS** endpoint accepting POST
  `application/pdf` with a bearer provider key and returning `{"summary":"..."}`.
- `CLOUD_SUMMARY_API_KEY`: injected on the **server only**, never in the renderer.
- Optional `CREDENTIAL_MASTER_SECRET`; no reusable default secret/key is bundled.

Configure credentials in the server environment; do not commit them. The default
unconfigured relay reports an error instead of inventing a summary. External
server deployments require trusted TLS certificates; HTTP fallback is allowed
only on loopback for development. Configure `LTX_SERVER_URL` for the desktop if
using a different server URL. External HTTP URLs and redirects are refused.

### Explicit demo mode (no model/GPU/Docker/provider required)

```powershell
python scripts/run.py --stub
```

Local responses and cloud summaries are visibly labelled **DEMO STUB**. The
compile service returns its labelled stub PDF. These outputs are not evidence of
model quality, speed, a real cloud provider, or Docker sandbox operation.
The demo compiler does not inspect source and returns no fabricated diagnostics.
For real local AI/cloud without Docker, use `python scripts/run.py --stub-compile`.
Normal `python scripts/run.py` explicitly disables inherited stub flags. Demo
cloud mode never calls Gemini, even if account API settings are saved: restart
without `--stub` to use the live provider.

## Tests and readiness

```powershell
python scripts/doctor.py              # live dependencies, model and Docker
python scripts/doctor.py --stub       # demo/build readiness
npm run build
npm test                             # component and transport tests; isolated test DB
npm run test:integration              # real HTTP/auth/PDF relay and privacy gates
npm run test:desktop                  # hidden Electron end-to-end smoke
python -m unittest discover -s services/local-ai -p test_requirements.py
python -m unittest discover -s qa/ws5 -p test_evaluate.py
python services/local-ai/test.py      # actual model responses to JSON fixtures
```

Backend tests create separate databases under `.cache/`; they never clear the
normal development database. Desktop smoke tests use an isolated profile,
synthetic PDF and explicit stub adapters. Real model and Docker/provider checks
are reported separately in `docs/VERIFICATION.md`. Historical local-AI acceptance
reports apply only to their stated model/hardware/test scope, not automatically to
the whole integrated app. The original two-reviewer evaluation requirements in
WS-5/cloud scope are preserved independently of local AI's preliminary review.

## Troubleshooting

If the Electron download is interrupted, `python scripts/fetch_electron.py`
resumes official Windows release chunks, verifies the publisher's SHA256 and
installs the executable locally. Retrying the model downloader resumes completed
chunks too. TLS verification remains enabled. On managed networks trust your
organization's CA with the standard Node/Python certificate configuration; setup
recognizes an existing local `.cache/windows-roots.pem` bundle.

Run setup again after changing dependencies. A raw `npm install` can prepare
SQLite for Node rather than Electron; run
`npm run rebuild:native -w @latexllm/desktop` before launching Electron, or use
the setup script.

PDF preview uses the matching PDF.js legacy renderer/worker for Electron 35
compatibility. Local AI runtime status shows the actual model and GPU-layer plan;
first model loading is slower than subsequent requests. Keep the app running
between tasks to reuse the model; cancelling terminates the worker and forces
reload on the next task. Missing Gemini settings open the account settings form
before selecting a PDF.

Cloud summarization allows up to five minutes (300 seconds) per attempt on both
the desktop gateway and server provider request. Local Only still aborts active
cloud operations. This does not change the separate 60-second LaTeX compile limit.
