# WS-3 final test run (2026-10-30)

Run on Shahd's PC with the team setup: Windows 11, Node 22.23.4, Electron 45.0.0, better-sqlite3 13.0.3
(built with VS Build Tools 2022), pdfjs-dist 5.4.624, Docker Desktop 29.9.2 (4 CPUs / 4 GB), image `ltx-sandbox:1`.
Branch `ws3/compile-sandbox` with the WS2 shell merged.

| # | Check | Command | Result |
| --- | --- | --- | --- |
| T1 | Versions | `node -v`, package versions, `docker version` | As above |
| T2 | Type check: shell + WS-3 compile panel | `npx tsc --noEmit`, `npx tsc -p tsconfig.ws3.json` | Both exit 0 |
| T3 | better-sqlite3 loads inside Electron 45 | `ELECTRON_RUN_AS_NODE=1 electron <check script>` | `better-sqlite3 OK in Electron 45.0.0 sqlite 3.53.4` |
| T4 | Unit tests | `npm test` | 120 / 120 passed, 10 suites |
| T5 | Docker integration tests IT-01..IT-12 | `npm run test:docker` | 12 / 12 passed |
| T6 | Compile smoke (real Docker) | `npm run smoke:compile` | 10 / 10 checks passed |
| T7 | Sandbox inspect checklist (Step 14) | `npm run checklist` | 18 / 18 passed (`docs/step14-inspect-checklist.md`) |

NFR-03 benchmark (2026-10-29, same PC, `npm run benchmark`): warm p95 4.42 s over 20 runs, cold start + build max
8.20 s over 10 runs (`docs/benchmarks/nfr03-2026-10-29-16-50.md`). The official run on the Reference Configuration
is still to do.

App check (2026-10-29, Electron 40 local pin, same WS-3 code): all six demo flows passed in the running app
(compile shows PDF, click error jumps to line, Outdated banner, 60 s timeout, second compile cancels the first,
shell escape blocked).

Note: an earlier run on 2026-10-29 22:27, right after the Build Tools install while the PC was heavily loaded, had
8 of 12 integration tests fail with "No such container"; the rerun above on an idle PC passed 12 / 12 with no code
change in between.
