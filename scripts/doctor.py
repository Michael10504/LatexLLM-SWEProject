"""Read-only checks for the integrated application and optional live services."""
import argparse
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
from setup import ROOT, node_tools


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stub',action='store_true',help='Do not require model weights or a running Docker daemon')
    args=parser.parse_args()
    failures=[]
    def check(name,good,detail):
        print(f'{"OK" if good else "MISSING"}: {name}: {detail}')
        if not good: failures.append(name)
    check('Python',sys.version_info>=(3,11),sys.version.split()[0])
    try:
        node,_=node_tools(); version=subprocess.check_output([node,'--version'],text=True).strip()
        check('Node',tuple(map(int,version.lstrip('v').split('.')[:2]))>=(22,12),version)
    except Exception as exc: check('Node',False,str(exc))
    check('npm dependencies',(ROOT/'node_modules').is_dir(),'run python scripts/setup.py')
    electron=ROOT/'node_modules/electron/dist'/('electron.exe' if sys.platform=='win32' else 'Electron.app/Contents/MacOS/Electron' if sys.platform=='darwin' else 'electron')
    check('Electron executable',electron.is_file(),'run setup; interrupted Windows downloads can use python scripts/fetch_electron.py')
    check('desktop build',(ROOT/'apps/desktop/dist/main/main.js').is_file(),'run npm run build')
    check('server config',(ROOT/'apps/server/.env').is_file(),'copy apps/server/.env.example to .env')
    if not args.stub:
        python=ROOT/'.venv'/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
        interpreter=str(python) if python.exists() else sys.executable
        result=subprocess.run([interpreter,'-c','import importlib.util; raise SystemExit(0 if importlib.util.find_spec("llama_cpp") else 1)'],capture_output=True)
        check('llama-cpp-python',result.returncode==0,'pip install -r requirements.txt in the selected Python environment')
        check('public model',(ROOT/'services/local-ai/Qwen3-4B-Q4_K_M.gguf').is_file(),'python scripts/setup.py --download-model')
        docker=shutil.which('docker')
        try:
            result=subprocess.run([docker or 'docker','info','--format','{{.ServerVersion}}'],capture_output=True,text=True,timeout=10)
            check('Docker engine',result.returncode==0,result.stdout.strip() or 'start Docker Desktop')
        except (OSError,subprocess.TimeoutExpired): check('Docker engine',False,'install/start Docker Desktop or use start:stub')
    print('Cloud provider: save a Gemini key in Account API settings, or configure a server-side HTTPS relay; no key is bundled.')
    return 1 if failures else 0


if __name__=='__main__': raise SystemExit(main())
