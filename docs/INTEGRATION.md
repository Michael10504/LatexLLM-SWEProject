# Integration architecture and requirement boundaries

The root application combines all four contributions without rewriting their
original specifications to make tests pass.

| Contribution | Active code | Preserved sources |
|---|---|---|
| Local AI | services/local-ai; private Python JSON-lines worker | Existing CLI, test fixtures, historical report and GPU settings example |
| WS-5 UI/QA | packages/ai-panel; desktop assistant panel | reference/ws5-ai-ui-qa; qa/ws5 |
| Cloud summary | packages/cloud-summary; apps/server | reference/cloud-summary-server |
| Auth/projects/editor/compiler | apps/server; apps/desktop; packages/compile-service | docs/requirements; docs/legacy-run-guide.md |

Only apps/server runs as the shared authentication/Prisma/cloud backend. The
duplicate reference server and original WS-5 shell are provenance, not build
targets. Active JavaScript packages share a root npm workspace/lockfile; Python
uses the root requirements.txt.

## Runtime connections

1. The renderer reads the CodeMirror selection through a narrow preload API.
   Electron main validates ownership, role, task, selection and request size.
2. Python keeps the model loaded between requests and streams JSON-lines over
   private stdin/stdout. It has no HTTP listener or cloud fallback. Cancellation
   kills inference, discards staged output and leaves source unchanged.
3. The WS-5 controller displays read-only original/proposal fields. There is no
   implicit apply/save action for AI responses.
4. Cloud uses a separate native PDF picker, PDF validation and fresh consent.
   The shared gateway enforces persisted Local Only state for online auth,
   account settings and cloud requests, including localhost relays. The relay
   validates PDFs again, keeps them in memory, and aborts upstream on disconnect.
5. The original compile/PDF panel resolves project access in Electron main and
   uses the existing local Docker sandbox independently of cloud/model state.

## Scope reconciliation

| Area | Integrated behavior and limits |
|---|---|
| FR-03.1/03.2 | Production Tasks 1-5 only, as agreed for Sprint 1. Tasks 6-8 visible but disabled and labelled Sprint 2. Eight-task controller fixture tests do not prove production inference for deferred tasks. |
| FR-03.3 | Original compile-log controller tests preserved. Production fix-LaTeX inference deferred with Task 8. |
| FR-03.4 | Private process IPC replaces the earlier port-8080 HTTP adapter proposal; local execution/privacy remains. |
| FR-03.5 | Empty and >1,000-word selections rejected before inference by controller, Electron main and Python. |
| FR-03.6/03.7 | Streaming, cancellation and failure discard retained. AI never saves source changes. |
| NFR-04/06 | Existing CPU/GPU planner, <=4096 context and 1.5 GB AI admission estimate retained. Estimates are not driver-enforced caps; integration tests do not certify reference-machine speed or peak VRAM. |
| NFR-07 | Prompt runner and independent-review tools preserved. Fixtures and preliminary AI review cannot replace two required human reviewers. |
| Cloud | Persisted Local Only, per-attempt consent, size/page validation, read-only output and server credential storage retained. Missing live configuration returns an error. |
| Projects | Main-process ownership checks; VIEWER cannot save/run AI. Existing backend role tests retained. No new sharing, server synchronization or file-tree UI implied. |

The optional private outline specialist is preferred when available; otherwise
the verified public Qwen3-4B-Q4_K_M model handles the outline prompt locally.
No model/provider key is committed.

Successful online login may be cached with OS-backed encryption for at most
eight hours. No plaintext fallback is stored if OS encryption is unavailable.
Logout clears the cached session.

## Account API settings and explicit demo mode

Signed-in users can enter a Gemini key under Paper summary / Account API
settings. The password field holds it only until the save attempt finishes.
The server persists AES-256-GCM ciphertext for the authenticated account and
returns configuration without the key. A server secret or ignored per-database
master-key file enables restart persistence; protect and back up that key.
Gemini receives inline PDF data only after consent. Custom HTTPS relays remain
supported. Local Only blocks account API requests as well.

Normal Python launch disables inherited stub flags. --stub explicitly enables
fixture adapters; --stub-compile enables only the compiler fixture. Demo cloud
never calls Gemini even when an account key is saved. The demo compiler returns
a labelled sample PDF and no fabricated source diagnostics. Real LaTeX errors
require Docker compilation.

See VERIFICATION.md for executed checks and remaining live-service checks, and
the root README for installation and usage.

Cloud timeout revision (31 October 2026, explicit user request): per-attempt cloud summarization timeout increased from 60 seconds to 300 seconds on both desktop gateway and server provider requests. Original SRS copies remain preserved; this paragraph records the runtime requirement change. Retry still requires fresh consent, and Local Only still aborts in-flight external work.
