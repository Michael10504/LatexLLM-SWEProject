# WS-3 Step 4: Manual Sandbox Test Results

- **Date:** 2026-10-24
- **Tester:** Shahd (Member 3, WS-3)
- **Machine:** <!-- fill in: Windows version, CPU, RAM (this is NOT the Reference Machine) -->
- **Docker Desktop:** WSL2 backend, 4 CPUs / 6 GB (from `.wslconfig`)
- **Image:** `ltx-sandbox:1` built from `texlive/texlive@sha256:e8148b126545105c4aeeaa212f8a7bd02d05b500351372881055e1e59ae67d33` (TeX Live 2026, latexmk 4.88, pdfTeX 1.40.29)

## Results

| # | Test | Requirement | Expected | Actual | Result |
|---|---|---|---|---|---|
| 4.1 | Cold start of warm container (`docker run -d ...`) | NFR-03 (≤ 20 s) | Container `Up` in ≤ 20 s | 9.70 s | PASS |
| 4.2 | `\include{chapters/intro}` without mirrored folders | FR-02.1 | First pdflatex pass fails: cannot write `chapters/intro.aux` | First pass failed with `I can't write on file 'chapters/intro.aux'`; latexmk 4.88 then created `/build/chapters/` itself and reran successfully (3 pages, 72,937 bytes) | PASS (with extra pass) |
| 4.3 | Compile `basic/` | FR-02.1 | Exit 0, PDF produced | Exit 0; `main.pdf` 3 pages, 75,784 bytes; bibliography, include and figure correct; copied out with `docker exec cat` (75,784 bytes) | PASS |
| 4.4 | Warm forced build (`-g`) | NFR-03 (indicative only) | A few seconds | Run 1: 8.33 s; Run 2: 3.19 s | PASS (see note) |
| 4.5 | Write to `/work` | FR-02.4 | `Read-only file system` | `touch: cannot touch '/work/hack.txt': Read-only file system` | PASS |
| 4.5 | Network access | FR-02.4 | `NO-NETWORK` | `NO-NETWORK` | PASS |
| 4.5 | Runs as uid 1000 | NFR-08 | `1000` | `1000` (user `texlive`) | PASS |
| 4.5 | Write 600 MB to `/build` | FR-02.4 (500 MB) | `No space left on device` | Stopped at 524,169,216 bytes (500 MiB): `No space left on device` | PASS |
| 4.6 | Compile `error/` | FR-02.2 | Exit ≠ 0; `./main.tex:5: Undefined control sequence.` | Exit 12; log line 46: `./main.tex:5: Undefined control sequence.` | PASS |
| 4.7 | `pkill -KILL -f "latexmk\|pdflatex"` on infinite loop | FR-02.5, FR-02.6 | TeX stops; only `sleep infinity` left; container still `Up` | Before: latexmk, sh, pdflatex (99% CPU, 18 s). After: only `sleep infinity`. Container still `Up` | PASS |
| 4.7 | Ctrl+C on host during loop | FR-02.5 (negative check) | pdflatex keeps running in container | Not run | NOT RUN |
| 4.8 | Compile `shell-escape/` | FR-02.4, NFR-08 | `BLOCKED`; log shows `runsystem(...)...disabled` | `BLOCKED`; log: `runsystem(touch /tmp/pwned)...disabled.` (first attempt was invalid because `$FX` was empty, see C10) | PASS |

**Note on 4.4:** only 2 runs were taken and they differ a lot (8.33 s vs 3.19 s). The first run likely included one-time cache work. This machine is not the Reference Machine; the formal NFR-03 measurement (20 runs, 5,000-word / 10-figure document, p95 ≤ 10 s) happens in Step 13.

## Findings and design decisions

| ID | Finding | Decision |
|---|---|---|
| C5 | A build with errors still writes a partial PDF (`error/`: exit 12, but `main.pdf` 1 page, 13,401 bytes was written). | Any non-zero exit code is FAILED; the partial PDF is ignored and the last good PDF stays on screen. |
| C8 | pdflatex cannot create subfolders in the output directory, so `\include{chapters/x}` fails on the first pass. latexmk 4.88 recovers by creating the folder and rerunning, but that costs an extra pdflatex pass. | `SandboxRunner` mirrors the project's subfolders into `/build` before each compile (`find . -type d -exec mkdir -p /build/{} \;`), which avoids the failed pass and doesn't depend on latexmk's recovery. |
| C9 | `docker cp` cannot read files on a tmpfs mount ("Could not find the file /build/main.pdf"). | `SandboxRunner.copyOut()` streams files with `docker exec <container> cat <file>` and collects stdout as a binary Buffer. |
| C10 | If the project path is wrong, Docker silently mounts an empty folder; latexmk then reports "Could not find file 'main.tex'", and security checks give false passes (seen in the first 4.8 attempt). | `SandboxRunner` checks that `main.tex` exists on the host before starting the container and returns a clear error otherwise. |
| — | uid 1000 already exists in the base image as user `texlive`. | Reuse it; the Dockerfile only creates a user when uid 1000 is missing. |
| — | The container clock is UTC (Cairo is UTC+3). | Use a `jobId` counter, not file timestamps, to decide which result is current. |
| — | latexmk skips work when nothing changed ("All targets are up-to-date"). | Benchmarks use `-g` to force a full rebuild. |

## Evidence files
- `fixtures/logs/undefined-command.log`: real log from test 4.6, used as a LogParser fixture in Step 7.
