# Acceptance suite

Run `python test_run.py` from the application folder. All **24 cases** run: 4 note extraction, 4 outline, 5 clarity, 5 academic tone, and 6 input-boundary cases. Results and timings go to `reports/test_report.txt`, which is ignored by Git.

Notes inputs are continuous contextual passages, not arrays of prewritten notes. They require synthesis of themes across sentences, preservation of quantified observations and limitations, and distinction between reported evidence and unimplemented proposals. Outline inputs describe a real writing purpose and require one coherent plan with actionable writing directions. Sparse context must not produce invented methods or results.

Clarity/tone cases include connected paragraphs, confounding, mixed evidence, negation, quantitative qualifiers, first-person removal, exact citations/math and already adequate prose. Each case has human-review criteria describing what must be retained and what must not be inferred. Some contain illustrative reference wording, not unique gold answers.

Automatic checks measure JSON structure, concise note counts, distinct themes/headings, required literals/concepts, rewriting when needed, first-person avoidance, and actionable outline directions. These are partial diagnostics. Passing them does not prove factual fidelity, complete coverage, good synthesis or semantic equivalence. `quality_failed` should remain visible when a model misses a constraint; do not adjust expectations merely to improve its score.

The five invalid inputs must be rejected before inference. Exactly 1,000 words is a validation-only boundary case; it does not test model token capacity. The other 18 cases invoke the model. These cases are newly authored synthetic fixtures, not reviewed research benchmarks. Keep them out of training to preserve held-out status. Edit the JSON files directly; obsolete clustering fixtures and their generator are archived outside the application.

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
