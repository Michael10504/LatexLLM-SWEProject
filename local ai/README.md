
# Download the models from that link and put it the same directory

https://drive.google.com/drive/folders/1gXWvok6Q9kjq92JbIqsOSTH7Bi7NIlLC?usp=sharing

# Local academic AI

Qwen3-4B Q4_K_M handles tasks 1, 3 and 4; your fine-tuned Qwen3-1.7B outline GGUF handles task 2:

1. Extract and organize notes from continuous context.
2. Write one coherent academic section outline with actionable writing directions.
3. Rewrite for clarity.
4. Adjust academic tone using impersonal wording.

## Run

From this folder:

```powershell
python local_ai.py
```

Choose 1-4, paste context or selected text, then enter `.end` on a new line. Task 1 reads paragraphs, infers appropriate themes and synthesizes notes from supplied evidence. It no longer clusters prewritten sentences with MiniLM. Task 2 synthesizes related ideas into meaningful headings and instructions about what to write; it does not create one section per sentence.

`prompts.py` contains the internal instructions. These distinguish findings from interpretation, preserve uncertainty/negation, avoid invented evidence, and request concise structured outputs for tasks 1-2. Clarity and tone preserve protected citations, references and math. Tone avoids first-person authorial language, hype and unsupported claims. Source quotations are preserved. A final check rejects first-person tone results outside quotes/protected spans.

Tasks 1, 3 and 4 share Qwen3-4B. Task 2 loads outline-q4_k_m.gguf. Switching between those models closes the previous model before loading the next; switching among 1, 3 and 4 reuses the loaded 4B model. Outline still requires GPU offloading and uses 12 GPU layers by default. MiniLM and the old clarity/tone specialists are not used.

## GPU and cancellation

Default: 12 model layers on GPU, remaining layers and KV cache on CPU. This laptop uses a Vulkan backend; `gpu_settings.json` selects NVIDIA device 1 rather than Intel device 0. That machine-specific file is ignored by Git. Copy/edit `gpu_settings.example.json` when setting up another computer, or omit it to use backend defaults.

```powershell
python local_ai.py --gpu-layers 8
nvidia-smi -l 1
```

Outline requires nonzero GPU offloading and fails clearly if it is unavailable, including when a CPU-only instance was already cached. Other options announce CPU fallback when necessary. Partial offloading does not guarantee the guide's 3 GB GPU ceiling for every input; measure representative workloads. Context defaults to 4096 tokens and output to 1024 (`--context`, `--max-tokens`).

Empty selections and selections over 1,000 whitespace-separated words are rejected before loading. Token capacity can impose a smaller limit. Output streams as an uncommitted preview. Ctrl+C cancels and discards the result; the program never edits a document. Terminal scrollback may retain previously displayed preview text. Invalid/truncated structured output or altered protected spans cause rejection.

## Tests

```powershell
python test_run.py
python test_run.py tests/cases/01_notes.json --report reports/notes.txt
python test_run.py --validate-only --report reports/input_validation.txt
python -m unittest discover -s . -p test_runtime.py
```

All 24 authored cases in `tests/cases/` run by default, using the same model routing as the menu (outline specialist for task 2, 4B for the others). Results and benchmarks are saved to `reports/test_report.txt`. Use `--limit N` to limit records per file, or supply JSON/JSONL files/folders. Report files include source, output, timings, explicit checks, and manual semantic review criteria. See `tests/README.md`.

These synthetic evaluation cases are separate from earlier training and smoke-test data. They cover longer contexts, mixed findings, procedural dependencies, insufficient evidence, connected arguments, numeric/LaTeX preservation and input limits. They are not professionally validated benchmark data. Do not train on them if using them for held-out evaluation.

`ok` means generation and explicit checks succeeded, not that semantic review passed. `quality_failed` identifies a failed acceptance check; inspect the result. Equivalent prose answers are allowed. Illustrative references are guidance, not exact-match targets. The suite includes five rejected-input cases and one validation-only 1,000-word case. Runtime contracts use mocks and require no model dependencies.

## Setup after cloning

Python 3.11 and a compatible GPU driver are recommended. Dependency and model downloads require internet; inference itself stays local.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe download_strong_model.py
.\.venv\Scripts\python.exe local_ai.py
```

Requirements select the official prebuilt Vulkan wheel to avoid CMake compilation. Confirm support in the same Python environment:

```powershell
python -c "import llama_cpp; print(llama_cpp.llama_supports_gpu_offload())"
```

`download_strong_model.py` downloads official weights from https://huggingface.co/Qwen/Qwen3-4B-GGUF , resumes interrupted chunks, verifies the publisher's SHA256, and records provenance in `strong_model_manifest.json`. It is a separate online setup tool and sends no editing input. The application and test runner enable offline flags and block Python socket connections before importing model libraries. No API/server is used. Interactive text is not logged; test runs explicitly save local reports.

## What to push

Push the Python sources, requirements, README, tests, `.gitignore`, model manifest, and example GPU setting. The 2.5 GB GGUF stays on this machine and is ignored by Git, as are reports, caches, virtual environments and actual GPU settings. New clones download the model with the setup command. No model binary is needed in the repository. After cloning, also supply your trained outline-q4_k_m.gguf locally; the downloader retrieves only the public 4B model.

Unused prior models, training datasets, notebooks, installers and old reports were moved outside this folder to `../local_ai_legacy_archive/` for recovery. That archive is excluded by the workspace `.gitignore`; do not add it to your repository.

Scope: the first four tasks only. Tasks 5-8, compile-log handling, and editor selection/apply/undo integration remain outside this terminal implementation.

