# Sprint 1 local AI

## Files to use

- `local_ai.py`: run the program.
- `test_requirements.py`: the requirements acceptance suite.
- `test.py`: run JSON/JSONL case files using the current runtime.
- `test_cases/`: working copies of the six archived JSON case files (32 cases).
- `test_responses.txt`: saved responses and checks from `test.py`.
- `requirements_report.txt`: the single active results report, revised requirements,
  input/output for every quality case, timings, old GPU sweep evidence and source code.
- `runtime/`: prompt templates, VRAM planning and optional service adapters.
- `tools/download_strong_model.py`: online setup helper, not part of inference.
- `_archive/`: preserved earlier scripts, case files and diagnostic reports.

Model GGUFs remain alongside local_ai.py. Do not commit the binaries.

## Run

```powershell
python local_ai.py
```

Choose 1–5; paste selected text; finish with `.end` on its own line.
The five tasks are notes, outline, clarity, academic tone and grammar.
Tasks 6–8 are deferred to Sprint 2. FR-03.6 was removed from the acceptance list;
existing streaming preview and Ctrl+C remain available.
The program proposes output and never writes into a source document.

## Run JSON case files

```powershell
python test.py                          # all 32 cases; writes test_responses.txt
python test.py test_cases/06_grammar.json
python test.py --validate-only          # no model loading
python test.py --case-id grammar-already-correct
python test.py --report my_responses.txt
```

The source code and working JSON files are outside `_archive/`. Archived originals
are preserved as history. You can also pass an archived JSON file or folder explicitly.
Responses are saved after each case, including source text, complete output, timings,
GPU layers, checks and errors. Boundary/validation-only cases do not invoke the model.
Ctrl+C retains completed responses and discards the current partial response.
Each invocation replaces its selected response report. The separate
`requirements_report.txt` is not modified by this runner.

## Requirements suite

```powershell
python test_requirements.py          # 45 unit/component checks, refresh report
python test_requirements.py --all    # plus 20 warm performance runs, 30 prompts/task and CPU checks
python test_requirements.py --report-only
```

The real test set contains 150 short synthetic development prompts: 30 per task.
The script saves after each completed case and resumes unfinished cases on rerun.
It preserves failures in the denominator. Automatic preservation/structure checks
are supplementary to the semantic reviewer ratings in revised NFR-07. The adopted
Sprint 1 wording permits one explicitly labelled AI-assisted preliminary review;
this is not the original two-independent-human-reviewer acceptance. Human review
slots remain available for stronger independent assessment.
After the full run, two independent people can record ratings in the SAME report:

```powershell
python test_requirements.py --reviewer "Reviewer One"
python test_requirements.py --reviewer "Reviewer Two"
```

Each reviewer sees the source and model output, records meaning preservation and
a corrected version. The script computes word edits and checks the 10% boundary.
Ratings persist across report regeneration. Do not record ratings during an active
test run. Reviewer names must identify two different people, not two automated runs.

Runtime checks do not establish acceptance for an editor absent from this project.
FR-03.4 allows local in-process execution; it does not mandate an HTTP server.
Inference uses local GGUFs with Python network sockets blocked. This is runtime
code/path evidence, not an OS-level network sandbox for arbitrary native plugins.

## Automatic offloading

The default reads GGUF tensor sizes and live NVIDIA free VRAM. It chooses the
largest estimated layer count under both a 1.5 GB decimal AI budget (1430 MiB)
and free VRAM minus 256 MiB headroom. Estimates include GPU overhead; KV cache
and remaining layers stay on CPU. GPU initialization failure retries on CPU.
CPU fallback requires sufficient system RAM; it has no GPU speed guarantee.

```powershell
python local_ai.py --gpu-layers 0    # CPU-only, including operation offloading disabled
python local_ai.py --gpu-layers 8    # at most 8 GPU layers, reduced if needed
python local_ai.py --gpu-layers -1   # full GPU if it fits; otherwise partial or CPU
```

The loaded model is reused while memory checks remain valid. Unknown telemetry,
unknown model layout, insufficient memory or an unsupported GPU backend uses CPU.
Current telemetry supports NVIDIA via nvidia-smi. For multiple NVIDIA cards configure
nvidia_uuid and select the SAME physical backend device. The ignored
`gpu_settings.json` selects Vulkan device 1 on this laptop; the example is not a
universal device mapping.

The 2 GB GPU is the target RC capacity; the actual test laptop has a 4 GB GTX 1650.
The 1.5 GB AI budget still applies here. Memory estimates and sampled device deltas
are not a driver-enforced quota and can be affected by other GPU applications.
Maximum layer count also does not necessarily mean maximum speed.

NFR-04 now uses automatic GPU/CPU execution: warm first-token p95 <=15 seconds,
median output generation >=2 tokens/sec, exact 150-word rewrite p95 <=60 seconds,
and cold first token <=30 seconds with loading status. The script performs one
cold/warmup run and 20 measured warm rewrites. It records actual backend token
counts and both wall-stream and native decode rates. Full GPU offload is no longer
a prerequisite; the 1.5 GB budget still applies. Results concern the actual 4 GB
GTX 1650 test laptop, not a physically tested 2 GB GPU.

## Setup after cloning

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe tools/download_strong_model.py
```

Supply the trained outline-q4_k_m.gguf separately. The downloader retrieves the
public Qwen3-4B-Q4_K_M.gguf only; provenance is in strong_model_manifest.json.
Downloads need internet. Inference does not.
