"""Launch the integrated app using the same Node/npm toolchain as setup."""
import argparse
import os
import subprocess
from pathlib import Path
from setup import ROOT, node_tools

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stub',action='store_true',help='Explicit demo AI, compile and cloud adapters; normal auth still applies')
    parser.add_argument('--stub-compile',action='store_true',help='Use only the demo compiler; keep local AI and cloud live')
    parser.add_argument('--server-only',action='store_true')
    args=parser.parse_args()
    node,npm=node_tools()
    environment=os.environ.copy()
    environment['PATH']=str(Path(node).parent)+os.pathsep+environment.get('PATH','')
    environment['npm_config_cache']=str(ROOT/'.cache/npm')
    environment['npm_config_update_notifier']='false'
    environment['npm_config_offline']='true'
    certificate=ROOT/'.cache/windows-roots.pem'
    if certificate.exists(): environment.setdefault('NODE_EXTRA_CA_CERTS',str(certificate))
    if not args.stub:
        environment.update(LTX_STUB_AI='0', LTX_STUB_COMPILE='0', CLOUD_SUMMARY_STUB='0')
        environment.pop('LTX_CLOUD_PROVIDER_NAME', None)
    if args.stub:
        environment.update(LTX_STUB_AI='1',LTX_STUB_COMPILE='1',CLOUD_SUMMARY_STUB='1',
                           LTX_CLOUD_PROVIDER_NAME='DEMO cloud relay (no third-party call)')
    if args.stub_compile:
        environment['LTX_STUB_COMPILE']='1'
    command=npm+(['run','start:server'] if args.server_only else ['start'])
    try: return subprocess.call(command,cwd=ROOT,env=environment)
    except KeyboardInterrupt: return 130

if __name__=='__main__': raise SystemExit(main())
