# WS-5 AI panel and QA starter

Based on origin/WS2 commit f8be002. This is a tested starter, not a completed milestone or model integration.

## Files

- src/renderer/ai-panel.ts: task list, controller state, abort behavior, fake streaming engine.
- src/renderer/ai-panel-ui.ts: safe DOM rendering and standalone selection fixture.
- src/renderer/ai-panel.css: panel styles matching the existing shell.
- src/renderer/ws5-demo.html: standalone fixture, no login or network calls. This is not the product editor.
- src/renderer/index.html: panel markup added to existing application; login behavior unchanged.
- tests/ws5-panel.test.cjs: controller and source-contract tests, no model dependency.
- qa/evaluate.py: CSV initialization and two-reviewer completeness/score summary, Python standard library only.
- qa/TESTING_REPORT.md and qa/RETROSPECTIVE.md: unfilled templates.

## Build and inspect

At the repository root, use `npm ci`, then `npm run build`.
Run `node --test tests/ws5-panel.test.cjs`.
Run `python -m unittest discover -s qa -p test_evaluate.py` for the evaluation helper tests.
On Windows CMD, open `start "" "dist\renderer\ws5-demo.html"`.
The standalone demo can run in a normal browser. Use `npm start` for the actual Electron app; its existing authentication may require the team's auth server.
Do not edit dist: it is generated. Coordinate the repository's existing tracked-dist convention with Member 2.

In the demo, select text in the source textarea, choose task, press Run. Try Cancel during streaming, retry, check the failure checkbox, empty the selection and try Task 8 with/without a sample compile log.
Only the supplied textarea selection is used for tasks 1-7; Task 8 takes the compile-log fixture.
Output is visibly labelled simulated and staging is read-only. Stub time is NOT NFR-04 evidence.

## Review the important lines

Read ai-panel.ts in this order: tasks, interfaces, Controller.run validation, generation callback, Controller.cancel, catch/finally, StubEngine.
Then read ai-panel-ui.ts: selection capture, repaint, Run/Cancel events.
No save/apply method is supplied to the controller. On cancel, the request version increments so late chunks cannot restore output.

## Real integration handoff

Member 2 supplies a snapshot of the actual editor selection and file revision; do not use window.getSelection across the whole page.
Member 3 supplies the latest parsed compile error for Task 8. This demo does not detect whether a log is error-free.
Member 4 supplies a real Engine implementation through Electron preload/main IPC to the Python runtime: request ID, task ID, text, streamed chunks, completion, error and cancellation acknowledgement.
Freeze agreed task IDs or map them at the boundary; the IDs here are proposed.
Member 5 connects the states to the panel and tests real cancellation. Sending abort alone is not proof the Python worker stopped.
Keep project/file write access out of the staging path. Real engine/editor integration is explicitly disabled in the product panel until wired; the separate demo remains usable.
Do not remove authentication or change contextIsolation/nodeIntegration to make the demo work.

## Quality evaluation

`python qa/evaluate.py init qa/reviews.csv`

Creates 260 blank slots: 30 for each of eight task types plus 20 summaries. These are NOT authored evaluation inputs or completed ratings.
Agree and obtain permitted fixtures with the team; coordinate the 20 papers with Member 6. Each member can run their own feature cases while Member 5 gathers the results.
Fill input path, expected checks, run_type (`real` or `stub`), actual output path, evidence path, and two distinct reviewers' names and ratings.
Use ratings `usable`, `minor_edits`, `unusable` exactly. Open the CSV as UTF-8 if editing in a spreadsheet. Keep headers unchanged.

`python qa/evaluate.py summary qa/reviews.csv`

Blank, incomplete and stub records do not count as reviewed. A group remains INCOMPLETE until it has at least 30 real reviewed cases (20 for summaries). Both reviewers must judge an output usable with at most minor edits for it to pass. A group passes at >=80%; do not average task groups together.
Only evaluate real outputs for NFR-07. Do not put private source material or raw paper outputs on GitHub without team permission.

## Submission

Retain actual test logs/screenshots and model/reference-machine metadata. Complete the report and retrospective from evidence.
Create a separate WS-5 PR from the grammar branch. Tell Member 2 the branch is based on WS2; use WS2 or the team's integration branch as the PR base until its work is merged to main.
