# Acceptance suite

Run `python test_run.py` from the application folder. All **32 cases** run: 4 note extraction, 4 outline, 5 clarity, 5 academic tone, 5 grammar, and 9 input-boundary cases. Results and timings go to `reports/test_report.txt`, which is ignored by Git.

Notes inputs are continuous contextual passages, not arrays of prewritten notes. They require synthesis of themes across sentences, preservation of quantified observations and limitations, and distinction between reported evidence and unimplemented proposals. Outline inputs describe a real writing purpose and require one coherent plan with actionable writing directions. Sparse context must not produce invented methods or results.

Clarity/tone cases include connected paragraphs, confounding, mixed evidence, negation, quantitative qualifiers, first-person removal, exact citations/math and already adequate prose. Each case has human-review criteria describing what must be retained and what must not be inferred. Some contain illustrative reference wording, not unique gold answers.

Automatic checks measure JSON structure, concise note counts, distinct themes/headings, required literals/concepts, rewriting when needed, first-person avoidance, and actionable outline directions. These are partial diagnostics. Passing them does not prove factual fidelity, complete coverage, good synthesis or semantic equivalence. `quality_failed` should remain visible when a model misses a constraint; do not adjust expectations merely to improve its score.

The seven invalid inputs must be rejected before inference. Two exactly-1,000-word cases are validation-only boundaries; they do not test model token capacity. The other 23 cases invoke the model. These cases are newly authored synthetic fixtures, not reviewed research benchmarks. Keep them out of training to preserve held-out status. Edit the JSON files directly; obsolete clustering fixtures and their generator are archived outside the application.

Examples:

```powershell
python test_run.py tests/cases/02_outline.json --report reports/outlines.txt
python test_run.py --validate-only --report reports/validation.txt
python test_run.py --limit 1 --report reports/smoke.txt
```

For a targeted regression run, use a case ID, for example:

```powershell
python test_run.py --case-id outline-context-with-contrasts --report reports/grounding.txt
```

The transport-box case specifically rejects calling boxes "lost" when the source only says they were not returned and their eventual status is unknown. This is an evidential distinction, not a formatting preference. The direction checker accepts valid verbs such as "Interpret" and "Distinguish" as well as "Describe" and "Discuss".

## Task 5 grammar extension

`06_grammar.json` follows the same request format as tasks 1-4: `id`, `task_id`, `text`, `review`, `checks`, and optional illustrative `reference`. Five synthetic held-out passages cover connected paragraphs and spelling, quantified limitations, negation, exact LaTeX preservation, and already correct prose. Correct only grammar; do not rewrite for clarity or tone. Review all outputs manually after the explicit checks. References are examples, not exact-match targets.

Three grammar-specific cases are appended to `05_boundaries.json`; the six existing records are unchanged. No separate boundary runner is needed.

```powershell
python test_run.py tests/cases/06_grammar.json --report reports/grammar.txt
python test_run.py tests/cases/05_boundaries.json --case-id empty-grammar --case-id grammar-over-1000-words --case-id grammar-exactly-1000-words --validate-only --report reports/grammar_boundaries.txt
```

The shared test runner and runtime test file are restored unchanged from the local-ai branch. That runtime suite still assumes a four-task menu and mocks all paths as present in two GPU tests; it needs a coordinated shared-suite update before a full five-task unit suite can pass. This extension does not hide those failures. The existing timing report records first output chunk and words/second, not proven token throughput or GPU memory. Five grammar fixtures are a pilot, not the full NFR-07 evaluation set.
