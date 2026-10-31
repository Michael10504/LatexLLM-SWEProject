"""Install workspace dependencies without changing machine-wide installations."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]


def node_tools():
    local_node = ROOT/'.cache/toolchain/node_modules/node-win-x64/bin/node.exe'
    local_npm = ROOT/'.cache/toolchain/node_modules/npm/bin/npm-cli.js'
    if local_node.exists() and local_npm.exists():
        return str(local_node), [str(local_node), str(local_npm)]
    node = shutil.which('node')
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not node or not npm:
        raise RuntimeError('Install Node.js 22.12+ (including npm) first.')
    return node, [npm]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-python', action='store_true')
    parser.add_argument('--skip-npm', action='store_true')
    parser.add_argument('--download-model', action='store_true', help='Download/verify the public GGUF (~2.5 GB)')
    parser.add_argument('--docker', action='store_true', help='Build the real TeX sandbox image; Docker must already be running')
    args = parser.parse_args()
    environment = os.environ.copy()
    certificate = ROOT/'.cache/windows-roots.pem'
    if certificate.exists():
        environment.setdefault('NODE_EXTRA_CA_CERTS', str(certificate))
        environment.setdefault('PIP_CERT', str(certificate))
        environment.setdefault('SSL_CERT_FILE', str(certificate))
    environment['PIP_CACHE_DIR'] = str(ROOT/'.cache/pip')
    environment['npm_config_cache'] = str(ROOT/'.cache/npm')
    environment['ELECTRON_CACHE'] = str(ROOT/'.cache/electron')
    environment['electron_config_cache'] = str(ROOT/'.cache/electron')
    def run(command):
        print('Running:', ' '.join(map(str, command)), flush=True)
        subprocess.run(command, cwd=ROOT, env=environment, check=True)
    if sys.version_info < (3, 11):
        raise RuntimeError('Python 3.11+ is required.')
    python = ROOT/'.venv'/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not args.skip_python:
        if not python.exists(): venv.EnvBuilder(with_pip=True).create(ROOT/'.venv')
        run([str(python), '-m', 'pip', 'install', '-r', str(ROOT/'requirements.txt')])
    node, npm = node_tools()
    version = subprocess.check_output([node, '--version'], text=True).strip().lstrip('v')
    if tuple(map(int, version.split('.')[:2])) < (22, 12):
        raise RuntimeError('Node.js 22.12+ is required; detected '+version)
    environment['PATH'] = str(Path(node).parent)+os.pathsep+environment.get('PATH','')
    env_file = ROOT/'apps/server/.env'
    if not env_file.exists(): shutil.copyfile(ROOT/'apps/server/.env.example', env_file)
    if not args.skip_npm:
        run(npm+['install'])
        run(npm+['run', 'db:generate'])
        run(npm+['run', 'db:migrate'])
        run(npm+['run', 'rebuild:native', '-w', '@latexllm/desktop'])
        run(npm+['run', 'build'])
    if args.download_model:
        run([str(python if python.exists() else Path(sys.executable)), str(ROOT/'services/local-ai/tools/download_strong_model.py')])
    if args.docker:
        run(['docker', 'build', '-t', 'ltx-sandbox:1', str(ROOT/'packages/compile-service/docker')])
    print('Requested setup steps complete. Run python scripts/doctor.py to check readiness. Cloud credentials are configured separately on the server.')


if __name__ == '__main__': main()
