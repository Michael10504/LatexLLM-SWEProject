# Presentation walkthrough

Follow the core walkthrough first, then choose the additional restriction demos.
Each expected result is an observation to check during the presentation, not an
automatic claim that the feature passed on the presentation machine.

## Before the presentation

1. Open PowerShell in the repository root.
2. Run `python scripts/doctor.py`.
3. For actual compilation, start Docker Desktop and run:

   ```powershell
   docker build -t ltx-sandbox:1 packages/compile-service/docker
   ```

4. Generate the synthetic demo inputs:

   ```powershell
   python scripts/create_demo_fixtures.py
   ```

   They are saved in `.cache/demo/`. Open the text/TeX files in Notepad and copy
   their contents into the app; there is no file-import/tree UI in this scope.
5. Close old app instances and launch the real application:

   ```powershell
   Remove-Item Env:LTX_STUB_AI -ErrorAction SilentlyContinue
   Remove-Item Env:LTX_STUB_COMPILE -ErrorAction SilentlyContinue
   Remove-Item Env:CLOUD_SUMMARY_STUB -ErrorAction SilentlyContinue
   python scripts/run.py
   ```

6. Check that the compile panel says **Docker sandbox** and the AI panel does
   not say **DEMO**. These labels identify the mode; they do not prove performance.
7. Use only a paper you are authorized to upload. For real Gemini summaries, sign
   in, open **Paper summary → Account API settings**, select Google Gemini, enter
   your key/model ID and click **Save to my account**. Use normal launch without
   `--stub`. The form reports if demo cloud mode is still active. A custom relay
   or server-wide provider can alternatively be configured through the README.

If Docker/model/provider dependencies are unavailable, use
`python scripts/run.py --stub` for a UI rehearsal. State explicitly that responses
and PDF are fixtures. The stub compiler does not examine the LaTeX, so **do not
use it to demonstrate real error detection, real PDF content or sandbox limits**.
The stub model echoes the selection; it does not demonstrate task quality.

## Core walkthrough (about 10–15 minutes, plus model loading)

### 1. Register and log in

1. Uncheck **Local Only** before online authentication. This setting persists,
   so it may still be checked from an earlier run.
2. If you need an account, click **Need an account? Register**.
3. Enter a new username of 3–32 characters and a unique demonstration password
   of 8–64 characters that is not common. Do not show a real password.
4. Click **Create Account**. The UI registers and then explicitly logs in.
   For an existing account, use **Sign In**.
5. Expected: **Your Projects** opens and the status bar identifies the user.

Say: “The backend checks the credentials; the renderer does not hold the bearer token.”

### 2. Create and open a project

1. Enter `Doctor Demo` in **Create New Project** and click **Create**.
2. Click the project name/info area, not **Delete**.
3. Expected: `main.tex` opens; the status bar shows the project and OWNER role.
4. Click inside the editor, press Ctrl+A, and paste `.cache/demo/valid.tex`.
5. Expected: editable LaTeX with syntax highlighting. Edits auto-save after
   about 1.5 seconds; Compile also flushes a pending save.

### 3. Compile valid LaTeX

1. Click **Compile**, or press Ctrl+Enter with the editor focused.
2. Expected: running status/timer, enabled compilation **Cancel**, then success
   and a PDF headed “LaTeXLLM Demonstration.” Scroll the preview if necessary.
3. Point out that the PDF corresponds to the source, rather than “Stub PDF.”

Say: “Compilation runs locally in the Docker sandbox.”

### 4. Run all five local AI tasks

For each row, select only the indicated prose **inside the source editor**, pick
the task and click **Run locally**. Wait for completion before the next request.

| Task | Suggested selection from valid.tex | What to inspect |
|---|---|---|
| Organize notes | The three Dataset/Baseline/Proposed/Limitation sentences under Notes | Organized facts; no invented measurements |
| Write a section outline | Introduction and notes prose | An outline grounded in the selected material |
| Rewrite for clarity | Introduction prose | Clearer phrasing; meaning and numbers preserved |
| Adjust academic tone | “We ran three experiments and we think the method is really good.” | Formal, impersonal wording |
| Check grammar | “The results is preliminary. This study examine local academic editing.” | Subject/verb agreement corrected |

1. Observe loading/generating status and streamed output. A cold model may take
   noticeably longer; do not promise an unmeasured response time.
2. Show **Original selection** and **Suggestion — document unchanged**.
3. Try typing in the suggestion: it is read-only.
4. Show that the source still contains the original mistakes. AI does not apply
   changes automatically. Quality must be judged on the actual generated text.
5. Point out that Tasks 6–8 are visible but disabled as Sprint 2 work.

### 5. Cancel local AI

1. Select a longer paragraph, choose **Rewrite for clarity**, and run it.
2. While loading/generating, click **Cancel in the AI panel**.
3. Expected: staged output is discarded and source remains unchanged.
4. Run a short task again to show recovery. Cancelling kills the worker, so its
   next request must reload the model.

### 6. Local Only guard

1. While signed in, check **Local Only** in the top bar.
2. Expected: blocked-external-requests status; **Choose PDF and summarize** is disabled.
3. Run a short local grammar task. Expected: it still works.
4. Compile valid.tex. Expected: local compilation still works.
5. Close and reopen the app. Expected: Local Only is still checked.
6. If OS-encrypted session restoration is available, reopen the local project.
   Otherwise the app requires online login: uncheck Local Only to sign in.

Say: “The guard also blocks online authentication and cloud traffic sent through
a localhost relay. It does not queue blocked requests for later transmission.”

### 7. Compile LaTeX with an error

Requires the **real Docker compiler** and a previous successful build.

1. Replace the source with `.cache/demo/error.tex`.
2. Click **Compile**.
3. Expected: failed status and an undefined-control-sequence error in the log.
4. Expand the compile log and click the error entry with a file/line.
5. Expected: the editor navigates to the reported source location.
6. Show that the last successful PDF remains visible with an **Outdated** banner.
7. Replace `\unknowncommand{Introduction}` with `\section{Introduction}` and compile.
8. Expected: success and the outdated warning clears.

### 8. Cancel compilation

1. Paste `.cache/demo/cancel.tex` into the editor. It deliberately loops; use it
   only with the sandboxed compiler.
2. Click **Compile**, wait until it is running, then promptly click **Cancel in
   the compile toolbar**. This is separate from the AI Cancel button.
3. Expected: cancelled status; editor remains responsive; last successful PDF
   remains with an outdated/cancelled message. Cancellation does not undo edits.
4. Restore valid.tex and compile successfully to prove recovery.
5. Optional timeout demo: run cancel.tex without cancelling and wait for the
   configured 60-second compile limit. Expect TIMEOUT, then restore valid.tex.

### 9. Empty selection and 1,000-word limit

1. Restore valid.tex. Click once in the editor so no text is selected.
2. Click **Run locally**. Expected: select-text message; no inference/loading.
3. Paste `.cache/demo/1001-words.txt` into the editor and select exactly that text.
4. Check the panel says **1001 words selected**, then click **Run locally**.
5. Expected: smaller-selection/1,000-word-limit message before inference;
   the document is unchanged by the rejected task.
6. Optional exact boundary: paste/select `1000-words.txt`. Expected: the word-count
   gate accepts it. Cancel once loading begins; repetitive input is not a quality
   demo and other context/runtime limits can still reject generation.
7. Restore valid.tex. Focus the editor before Ctrl+A so you select editor text,
   rather than the webpage or an output field.

## Additional feature and restriction demos

### 10. Cloud consent and read-only summary

1. Uncheck Local Only and stay signed in.
2. Click **Choose PDF and summarize**; choose a permitted paper <=20 MB/100 pages.
3. Show the consent dialog: filename, size, provider and third-party disclosure.
4. Click **Cancel**. Expected: nothing is uploaded.
5. Choose the paper again and click **Send**. Expected: progress, then read-only
   summary without any LaTeX source change, if a live provider is configured.
6. On a retryable provider failure, select **Retry**. Expected: a new consent
   dialog before the next transmission. Retry does not reuse old consent.
7. If using explicit demo cloud mode, say the returned summary is a labelled
   fixture, not a real paper summary. The generated blank PDFs are for validation
   tests only; they are not suitable inputs for summary quality.

### 11. Cloud validation restrictions

Repeat the PDF picker with these generated files. Leave Local Only off.

| Input | Expected |
|---|---|
| `invalid.pdf` | Invalid/unreadable PDF error before consent/upload |
| `over-20mb.pdf` | Size rejection before upload |
| `101-pages.pdf` | Page-count rejection before consent/upload |
| `100-pages.pdf` | Page-count validation accepts it; cancel at consent |
| Cancel the file picker | No consent or upload |

### 12. Abort an active cloud request

1. Start an authorized summary and consent while Local Only is off.
2. While its progress is visible, enable Local Only.
3. Expected: external request aborted; no late summary from that request appears.
4. Turn Local Only off. Expected: the request does not restart automatically.
5. A very fast provider may finish before the toggle; that does not demonstrate
   in-flight cancellation. The integration tests provide a deterministic delayed
   provider fixture for this case.

### 13. Authentication restrictions

Use a separate disposable account for lockout; do this at the end.

| Steps | Expected |
|---|---|
| Register with 2-character username | Rejected; username must be 3–32 characters |
| Register with 7-character password | Rejected; password must be >=8 characters |
| Register with a known common password, e.g. `password` | Common-password rejection |
| Register the same username twice | Duplicate rejected |
| Sign in with wrong username or password | Same generic invalid-credentials message |
| Fail login 5 times for the disposable account within 15 minutes | Account locked for 15 minutes; correct password does not bypass the lock |
| Enable Local Only before login and try Sign In | Online authentication blocked |

The backend also enforces the 64-character password maximum and eight-hour idle
session expiry. Show automated boundary tests rather than waiting eight hours.

### 14. Project and persistence restrictions

1. On the project list, try an empty project name, then a >100-character name.
   Expected: rejected. Create a valid name, then repeat it: duplicate rejected.
2. Edit valid.tex and wait >1.5 seconds. Close/reopen, sign in if needed, reopen
   the project. Expected: saved source persists.
3. To show deletion safely, create a separate disposable project, return to the
   list by logout/login, click **Delete**, and cancel the confirmation first.
   Expected: project remains. Confirm deletion only for the disposable project.
4. OWNER/EDITOR/VIEWER policies, allowed file extensions, 500-file/100 MB limits,
   path traversal and sandbox security are best shown through automated evidence.
   The UI has no role-sharing/file-upload controls for manufacturing those cases.
   Do not claim a role-switching demo exists.

### 15. Local runtime failure (optional separate launch)

1. Finish the normal walkthrough and close the app.
2. In PowerShell set a deliberately unavailable interpreter and relaunch:

   ```powershell
   $env:LTX_PYTHON = 'Z:\missing-demo-python.exe'
   python scripts/run.py
   ```

3. Sign in, open a project, select prose and run local AI.
4. Expected: clear runtime error, discarded partial output, unchanged source and
   responsive editor. This demonstrates unavailability, not actual GPU OOM.
5. Close the app, clear the override and relaunch normally:

   ```powershell
   Remove-Item Env:LTX_PYTHON -ErrorAction SilentlyContinue
   python scripts/run.py
   ```

## Automated evidence to show after the walkthrough

With the supported Node version on PATH, run from the repository root:

```powershell
npm test
npm run test:integration
npm run test:desktop
python -m unittest discover -s services/local-ai -p test_requirements.py
python -m unittest discover -s qa/ws5 -p test_evaluate.py
```

The desktop smoke uses labelled fixtures and isolated profiles; it proves UI/
transport behavior, not live provider/model quality. Consult VERIFICATION.md for
the executed 243-test baseline and real-model smoke evidence. CPU/GPU allocation,
peak VRAM, NFR speed and two-reviewer quality acceptance require their separate
measurements; a visual demonstration cannot establish those thresholds.

Suggested final statement: “We demonstrated the integrated Sprint 1 flow and its
validation/privacy controls. Tasks 6–8 remain deferred. These are the live checks
we observed, and these are the separate automated and performance/quality results.”
