"""Resumable official Electron download for interrupted/proxied installations.

Verifies the publisher's SHA256 before extracting inside node_modules/electron.
Normal installations can use Electron's own npm install script instead.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import ssl
import sys
import time
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    if sys.platform!='win32': raise RuntimeError('Use the standard Electron npm installer on non-Windows systems.')
    version=json.loads((ROOT/'node_modules/electron/package.json').read_text())['version']
    filename=f'electron-v{version}-win32-x64.zip'
    base=f'https://github.com/electron/electron/releases/download/v{version}/'
    certificate=ROOT/'.cache/windows-roots.pem'
    context=ssl.create_default_context(cafile=str(certificate) if certificate.exists() else None)
    def open_url(url,headers=None):
        return urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}),context=context,timeout=60)
    with open_url(base+'SHASUMS256.txt') as response:
        checksums=response.read().decode()
    match=re.search(r'^([a-f0-9]{64})\s+\*?'+re.escape(filename)+r'\s*$',checksums,re.M)
    if not match: raise RuntimeError('Official checksum not found')
    with open_url(f'https://api.github.com/repos/electron/electron/releases/tags/v{version}',{'User-Agent':'LatexLLM-setup'}) as response:
        release=json.load(response)
    total=next(asset['size'] for asset in release['assets'] if asset['name']==filename)
    folder=ROOT/'.cache/electron-resume'; folder.mkdir(parents=True,exist_ok=True)
    archive=folder/filename
    block=4*1024*1024
    count=(total+block-1)//block
    def download(index):
        first=index*block; last=min(total,(index+1)*block)-1
        target=folder/f'{filename}.part{index:03d}'
        for attempt in range(6):
            existing=target.stat().st_size if target.exists() else 0
            if existing==last-first+1: return target
            if existing>last-first+1: raise RuntimeError('Oversized download chunk')
            try:
                with open_url(base+filename+f'?part={index}&attempt={attempt}',{'Range':f'bytes={first+existing}-{last}'}) as response:
                    if response.status!=206: raise RuntimeError('Server did not honor the requested byte range')
                    with target.open('ab') as stream:
                        while content:=response.read(256*1024): stream.write(content)
                if target.stat().st_size!=last-first+1: raise RuntimeError('Incomplete download chunk')
                print(f'Electron chunk {index+1}/{count}',flush=True); return target
            except Exception:
                if attempt==5: raise
                time.sleep(min(10,attempt+1))
    with ThreadPoolExecutor(max_workers=4) as pool: parts=list(pool.map(download,range(count)))
    digest=hashlib.sha256()
    with archive.open('wb') as output:
        for part in parts:
            with part.open('rb') as stream:
                while content:=stream.read(1024*1024): output.write(content); digest.update(content)
    if archive.stat().st_size!=total or digest.hexdigest()!=match[1]: raise RuntimeError('Electron checksum mismatch; refusing installation')
    destination=(ROOT/'node_modules/electron/dist').resolve()
    destination.relative_to(ROOT)
    destination.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            (destination/member.filename).resolve().relative_to(destination)
        package.extractall(destination)
    (ROOT/'node_modules/electron/path.txt').write_text('electron.exe',encoding='utf-8')
    print('Official Electron SHA256 verified; executable ready.',flush=True)

if __name__=='__main__': main()
