"""Live VRAM admission and conservative GGUF tensor-size estimates; CPU KV cache."""
from dataclasses import asdict, dataclass
import math
from pathlib import Path
import re
import struct
import subprocess

CAP_MIB = 1430  # <= 1,500,000,000 bytes; reserve the rest for the system

RESERVE_MIB = 256
OVERHEAD_MIB = 256

def gpu_memory(uuid=None):
    command = ['nvidia-smi']
    if uuid:
        command += ['-i', uuid]
    command += ['--query-gpu=uuid,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits']
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=2)
        rows = [line.split(',') for line in result.stdout.strip().splitlines()]
        if len(rows) != 1 or len(rows[0]) != 4:
            return None
        identifier, total, used, free = (value.strip() for value in rows[0])
        return {'uuid': identifier, 'total_mib': int(total), 'used_mib': int(used), 'free_mib': int(free)}
    except (OSError, ValueError, subprocess.SubprocessError):
        return None

def free_vram(uuid):
    memory = gpu_memory(uuid)
    return None if memory is None else memory['free_mib']

def permitted_layers(requested, settings):
    # Profile must describe the same backend/device/models/context/batch in use.
    profile = settings.get('verified_vram_profile', {})
    peak = profile.get('peak_mib')
    layers = profile.get('gpu_layers')
    uuid = profile.get('nvidia_uuid')
    if not requested or not isinstance(peak, int) or not 0 < peak <= CAP_MIB:
        return 0
    if not uuid or layers != requested:
        return 0
    available = free_vram(uuid)
    return requested if available is not None and available >= peak + 256 else 0

def tensor_layout(path):
    """Read GGUF v2/v3 offsets without loading weights or importing llama.cpp."""
    path = Path(path)
    with path.open('rb') as stream:
        def number(fmt):
            size = struct.calcsize(fmt); raw = stream.read(size)
            if len(raw) != size: raise ValueError('Truncated GGUF')
            return struct.unpack(fmt, raw)[0]
        def string():
            size = number('<Q')
            if size > 16*1024*1024: raise ValueError('Invalid GGUF string')
            raw = stream.read(size)
            if len(raw) != size: raise ValueError('Truncated GGUF string')
            return raw.decode('utf-8')
        def value(kind, retain=False):
            formats = {0:'<B',1:'<b',2:'<H',3:'<h',4:'<I',5:'<i',6:'<f',7:'<?',10:'<Q',11:'<q',12:'<d'}
            if kind == 8:
                result = string()
            elif kind == 9:
                subtype, count = number('<I'), number('<Q')
                if count > 10_000_000 or subtype == 9: raise ValueError('Invalid GGUF array')
                for _ in range(count): value(subtype)
                result = None
            elif kind in formats:
                result = number(formats[kind])
            else:
                raise ValueError('Unsupported GGUF metadata')
            return result if retain else None
        if stream.read(4) != b'GGUF' or number('<I') not in (2,3):
            raise ValueError('Unsupported GGUF version')
        tensors, metadata_count = number('<Q'), number('<Q')
        if tensors > 100_000 or metadata_count > 100_000: raise ValueError('Invalid GGUF counts')
        alignment = 32
        for _ in range(metadata_count):
            key, kind = string(), number('<I')
            entry = value(kind, key == 'general.alignment')
            if key == 'general.alignment': alignment = entry
        if not isinstance(alignment,int) or not 1 <= alignment <= 65536: raise ValueError('Invalid alignment')
        offsets = []
        for _ in range(tensors):
            name, dimensions = string(), number('<I')
            if not 1 <= dimensions <= 8: raise ValueError('Invalid dimensions')
            for _ in range(dimensions): number('<Q')
            number('<I'); offsets.append((number('<Q'),name))
        start = math.ceil(stream.tell()/alignment)*alignment
        end = path.stat().st_size-start
        offsets.sort(); blocks = {}; output = 0; embedding = 0
        for index,(offset,name) in enumerate(offsets):
            next_offset = offsets[index+1][0] if index+1<len(offsets) else end
            size = next_offset-offset
            if offset < 0 or size < 0 or next_offset>end: raise ValueError('Invalid tensor offset')
            match = re.match(r'blk\.(\d+)\.',name)
            if match:
                block = int(match[1]); blocks[block] = blocks.get(block,0)+size
            elif name.startswith('output.'):
                output += size
            if name == 'token_embd.weight': embedding = size
        if not blocks or set(blocks)!=set(range(len(blocks))): raise ValueError('Unknown layer layout')
        return {'blocks':[blocks[index] for index in range(len(blocks))], 'output_bytes':output or embedding}

def estimate_mib(layout, layers):
    if layers == 0: return 0
    # Include output projection for every GPU plan: Vulkan can offload it first.
    weight_bytes = sum(layout['blocks'][-min(layers,len(layout['blocks'])):])+layout['output_bytes']
    return math.ceil(weight_bytes/(1024*1024))+OVERHEAD_MIB

@dataclass
class OffloadPlan:
    gpu_layers: int = 0
    total_layers: int = 0
    estimated_mib: int = 0
    available_budget_mib: int = 0
    reason: str = 'CPU fallback'
    uuid: str | None = None
    baseline_used_mib: int = 0
    total_vram_mib: int = 0
    free_vram_mib: int = 0
    def as_dict(self): return asdict(self)

def choose_offload(path, requested=None, settings=None, supported=True):
    settings = settings or {}; plan = OffloadPlan()
    if requested is not None and (not isinstance(requested,int) or requested < -1):
        raise ValueError('GPU layers must be -1 (full), 0 (CPU), or a positive maximum')
    if requested == 0 or not supported:
        plan.reason = 'CPU requested' if requested == 0 else 'GPU backend unavailable'
        return plan
    memory = gpu_memory(settings.get('nvidia_uuid'))
    if memory is None:
        plan.reason = 'VRAM telemetry unavailable or device ambiguous'; return plan
    plan.uuid = memory['uuid']; plan.baseline_used_mib = memory['used_mib']
    plan.total_vram_mib = memory.get('total_mib',0)
    plan.free_vram_mib = memory['free_mib']
    budget = min(CAP_MIB,memory['free_mib']-RESERVE_MIB)
    plan.available_budget_mib = max(0,budget)
    try:
        layout = tensor_layout(path)
    except (OSError,ValueError,UnicodeError,struct.error):
        plan.reason = 'Model tensor sizes unavailable'; return plan
    plan.total_layers = len(layout['blocks'])+1
    maximum = plan.total_layers if requested in (None,-1) else min(requested,plan.total_layers)
    for layers in range(maximum,0,-1):
        estimate = estimate_mib(layout,layers)
        if estimate <= budget:
            plan.gpu_layers = layers; plan.estimated_mib = estimate
            plan.reason = 'Largest estimated fit within free VRAM and 1.5 GB cap'; return plan
    plan.reason = 'Insufficient free VRAM for even one GPU layer'
    return plan
