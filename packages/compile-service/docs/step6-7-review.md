# WS-3 Steps 6 and 7: CompileService and LogParser

- **Date:** 2026-10-25
- **Status:** written and unit-tested (83 tests, Docker faked); real-Docker check is `npm run smoke:compile`.

## Step 6: `DockerCompileService` (`src/compile/DockerCompileService.ts`)

Implements the published `CompileService` interface on top of `SandboxRunner`.

| Situation | Status | `log` | `pdfPath` |
|---|---|---|---|
| latexmk exit 0 and `/build/main.pdf` copied | SUCCESS | parsed log | new `lastGood.pdf` |
| exit 0 but no PDF | FAILED | "no PDF was produced" + parsed log | last good PDF, if any |
| any other non-zero exit (C5) | FAILED | parsed log (+ generic error if none parsed) | last good PDF, if any |
| exit 137 with no timer or cancel (C6) | FAILED | "sandbox resource limit" + parsed log | last good PDF, if any |
| 60 s timer fired | TIMEOUT | "stopped after 60 s" + parsed log | last good PDF, if any |
| newer compile for the same project, or `cancel()` | CANCELLED | `[]` | last good PDF, if any |
| Docker missing / daemon down / image missing | SANDBOX_UNAVAILABLE | one error | last good PDF, if any |
| `main.tex` missing or unsupported path (C11) | FAILED | one error | last good PDF, if any |
| container vanished twice in one compile | SANDBOX_UNAVAILABLE | one error | last good PDF, if any |

How jobs work:
- Every compile gets an increasing job id. Starting a compile stops the project's running job first and **waits until its TeX is killed**, so the old job's `pkill` can never hit the new latexmk.
- After every `await`, a job that has been replaced returns CANCELLED and does not write `lastGood.pdf` or the latest log (stale results are dropped).
- `getLatestLog()` only changes on non-cancelled results of the current job.
- `lastGood.pdf` lives at `<cacheDir>/<container name>/lastGood.pdf` and is written via a temp file + rename.
- If the container disappears (`ContainerGoneError`), the compile recreates it and retries once.

Extra public methods (not in the published interface, used in Steps 8 and 10): `getLastGoodPdf(projectId)`, `lastGoodPath(projectId)`.

## Step 7: `parseLatexLog` (`src/log/LogParser.ts`)

- `file:line: message` errors (`-file-line-error`), with `/work/` and `./` stripped; non-project files (`/build/...`, `/usr/...`) stay non-clickable.
- `! ...` errors without a location; `! Emergency stop.` gets the `*** (job aborted, ...)` reason.
- LaTeX / package / class / font warnings, including continuation lines; `on input line N` gives the line, and the file is the innermost open project file (tracked from `(file` / `)` in the log). Warnings without a line or project file are not clickable (D2).
- Overfull / underfull boxes as warnings; "No pages of output." as a warning; "Output written ..." and "Fatal error ..." as INFO.
- UTF-8 with replacement characters, CRLF-safe, de-duplicated, capped at 500 entries (D3). When over the cap, errors are kept first and the last entry says how many were dropped.

Fixture logs (`fixtures/logs/`):
1. `undefined-command.log`: real sandbox log from Step 4 (TeX Live 2026).
2. `subfile-error.log`: error inside `chapters/intro.tex`.
3. `missing-package.log`: `\usepackage{doesnotexist}`.
4. `undefined-refs.log`: undefined references and citation, one inside a subfile.
5. `warnings.log`: multi-line package warning and overfull box.
6. `no-end.log`: missing `\end{document}`.

Logs 2–6 were produced by real pdfTeX with the sandbox's exact latexmk flags, on TeX Live 2023 (not the sandbox image); `/build` paths were normalised to match the sandbox.

## New decisions / assumptions (for Member 6)

- **C13:** The 60 s limit covers only the latexmk run; container start-up is not counted (cold start has its own NFR-03 target).
- **C14:** Non-SUCCESS results return the last good PDF as `pdfPath`, so the preview can keep it with an "Outdated" banner. The UI decides "outdated" from `status !== 'SUCCESS'`.
- **C15:** A new compile waits for the previous job's TeX to be killed before starting.
- **C16:** A vanished container is recreated once per compile; a second loss is SANDBOX_UNAVAILABLE.
- **D5:** Warnings are only clickable when the parser can tell they came from a project file.
- **D6:** When over 500 entries, errors are kept before warnings and info.
