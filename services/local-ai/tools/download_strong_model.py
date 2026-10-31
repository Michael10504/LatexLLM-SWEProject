"""Explicit online setup only: download the official model; never sends user text."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Qwen/Qwen3-4B-GGUF'
NAME = 'Qwen3-4B-Q4_K_M.gguf'

def main():
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{REPO}?blobs=true', timeout=60) as r:
        info = json.load(r)
    item = next(s for s in info['siblings'] if s['rfilename'] == NAME)
    size, expected = item['lfs']['size'], item['lfs']['sha256']
    revision = info['sha']
    target = ROOT / NAME
    if target.exists() and target.stat().st_size == size:
        with target.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        if digest == expected:
            print('Existing model checksum verified.')
            return
    chunk_size = 64 * 1024 * 1024
    url = f'https://huggingface.co/{REPO}/resolve/{revision}/{NAME}'
    count = (size + chunk_size - 1) // chunk_size
    def download(index):
        start, end = index * chunk_size, min(size, (index+1)*chunk_size)-1
        dest = ROOT / f'{NAME}.chunk{index:03d}'
        if dest.exists() and dest.stat().st_size == end-start+1:
            return dest
        for attempt in range(4):
            try:
                existing = dest.stat().st_size if dest.exists() else 0
                if existing == end-start+1:
                    return dest
                offset = start + existing
                request = urllib.request.Request(url + f'?chunk={index}&offset={offset}', headers={'Range': f'bytes={offset}-{end}'})
                with urllib.request.urlopen(request, timeout=120) as response:
                    if response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-{end}/'):
                        raise ValueError('Server did not honor byte range.')
                    with dest.open('ab') as f:
                        while data := response.read(1024*1024):
                            f.write(data)
                if dest.stat().st_size != end-start+1:
                    raise ValueError('Incomplete chunk.')
                print(f'Completed chunk {index+1}/{count}', flush=True)
                return dest
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2*(attempt+1))
    with ThreadPoolExecutor(max_workers=8) as pool:
        chunks = list(pool.map(download, range(count)))
    temporary = ROOT / f'{NAME}.verified-download'
    digest = hashlib.sha256()
    with temporary.open('wb') as out:
        for chunk in chunks:
            with chunk.open('rb') as source:
                while data := source.read(8*1024*1024):
                    out.write(data)
                    digest.update(data)
    if temporary.stat().st_size != size or digest.hexdigest() != expected:
        raise ValueError('Checksum mismatch; refusing to activate download.')
    temporary.replace(target)
    (ROOT / 'strong_model_manifest.json').write_text(json.dumps({
        'repo': REPO, 'revision': revision, 'filename': NAME,
        'size': size, 'sha256': expected, 'verified': True}, indent=2), encoding='utf-8')
    # Remove only the exact temporary chunk files produced for this download.
    for chunk in chunks:
        chunk.unlink()
    print(f'Checksum verified. Ready: {target}', flush=True)

if __name__ == '__main__':
    main()
