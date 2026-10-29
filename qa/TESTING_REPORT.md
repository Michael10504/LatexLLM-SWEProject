# Milestone 2 formal testing report

Status: TEMPLATE. Replace blanks with observed results; never report a stub run as real model evidence.

## Scope and environment

Record team, date, commit, Windows version, Node/Python versions, reference-machine CPU/RAM/GPU, model revision, quantization, context, GPU layers and whether the run uses a stub or real engine.

## Requirement traceability and execution record

| Test | Requirement | Steps | Expected | Actual | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| UI-01 | FR-03.1 UI | Inspect task selector | Exactly eight task types | All eight task options appeared in the selector. | PASS — stub UI | |
| UI-02 | FR-03.1 UI | Select source, run any stub task | Running, streamed preview, completed state | Selected text appeared as input. Simulated output streamed, then the status changed to Completed. | PASS — stub UI | |
| UI-03 | FR-03.6 UI | Cancel while running | Abort signal, partial output cleared, late output ignored | Cancel displayed Cancelled and cleared the partial output. Backend cancellation and late-output handling were not independently verified in this manual test. | PARTIAL — manual stub test | |
| UI-04 | FR-04.4 | Compare source before/after success, error and cancel | No source changes, staging cannot be edited | The source remained unchanged after success, failure and cancellation. The suggestion field could not be edited. | PASS — stub UI | |
| UI-05 | NFR-04 progress | Run task and inspect progress | Indeterminate progress while running, no fake percentage | A progress indicator appeared during execution without a percentage. Real-model speed was not measured. | PASS — progress UI only | |
| UI-06 | FR-03.2 integration | Run without selecting text | Clear message and no engine call | The message “Please select text first.” appeared. Engine call count was not independently verified in this manual test. | PARTIAL — manual stub test | |
| UI-07 | FR-03.5 integration | Select 1000 and 1001 words | 1000 accepted, 1001 rejected | A 1,000-word selection started execution. A 1,001-word selection was rejected before execution. | PASS — stub UI | |
| UI-08 | Failure handling | Simulate model failure | Error state, no partial output, can retry | Simulated failure displayed an error and left the suggestion empty. Retrying after disabling simulated failure succeeded. | PASS — stub UI | |
| UI-09 | Task 8 UI | Supply log without selection; then empty log | Log route used; missing log rejected | An empty log was rejected. A supplied log was used as input without requiring a text selection and produced simulated output. | PASS — stub UI | |
| INT-01 | Integration | Replace stub with real IPC/model bridge | Input, streaming, errors and abort cross process boundary | | BLOCKED | |
| PERF-01 | NFR-04 | At least 20 real reference-machine runs | First token p95 <=3 s, tokens/s median >=20; 150-word rewrite p95 <=15 s | | BLOCKED | |
| QUAL-01 | NFR-07 | 30 real prompts per task and 20 real papers, two reviewers | >=80% usable with minor edits by both reviewers in EACH group | | NOT RUN | |

Controller tests are supplementary evidence, not proof of browser behavior or IPC cancellation.
The stub Task 8 demo does not parse the first compiler error or verify repaired LaTeX.

## Automated checks

Run `npm run build` and `node --test tests/ws5-panel.test.cjs` at the repository root.
Record the command, commit, actual output and any failures here.

## Evaluation protocol

Use permitted inputs kept separate from training data. Define expected checks before looking at model output.
Store case inputs, outputs and evidence locally in an agreed test-data location. Ask each reviewer to rate independently.
Allowed ratings: `usable` (no material edit), `minor_edits` (small corrections only), `unusable` (substantial correction, wrong facts, unsafe LaTeX changes or failed output).
An example passes only when BOTH reviewers choose usable/minor_edits. A disagreement is not a pass.
Calculate each task and summary group separately. Incomplete cases remain incomplete; stub rows do not count.
Use a fixed policy for execution failures and document it; do not quietly omit failures from the case set.
The CSV helper checks record completeness and arithmetic, not correctness of evidence.

## Defects and limitations

| ID | Trigger | Expected | Actual | Severity | Owner | State | Retest evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Known starter limitations: real editor/model bridge pending; cancellation tested only against stub/controlled engines; no accept/reject or diff application; real NFR quality and speed measurements pending.

## Results and conclusion

Summarize actual passed/failed/blocked counts, unresolved defects and what has/has not been demonstrated. Do not replace pending measurements with estimates.
