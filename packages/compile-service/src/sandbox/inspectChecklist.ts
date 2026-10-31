import type { SandboxConfig } from '../types';
import { DEFAULT_SANDBOX_CONFIG } from '../types';

/**
 * Step 14: prove from `docker inspect` (and three in-container probes) that every FR-02.4 / NFR-08
 * limit is really applied to a running sandbox container. Pure evaluation, so it is unit-tested
 * without Docker; scripts/inspect-checklist.ts and the Step 12 tests feed it real data.
 */
export interface CheckItem {
  id: string;
  requirement: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/** Output of the three probes run inside the container. */
export interface ProbeResults {
  /** `kpsewhich -var-value=shell_escape` */
  shellEscape: string;
  /** `id -u` */
  uid: string;
  /** `ls /sys/class/net` */
  netInterfaces: string;
}

/** Docker size strings ("2g", "500m") to bytes, for comparing with inspect output. */
export function toBytes(size: string): number {
  const m = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i.exec(size.trim());
  if (!m) throw new Error(`Bad size: ${size}`);
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase() as '' | 'k' | 'm' | 'g'];
  return Math.round(Number(m[1]) * mult);
}

// Minimal shape of `docker inspect <container>` output that we read.
interface InspectJson {
  Config?: { User?: string; Image?: string; Labels?: Record<string, string> };
  HostConfig?: {
    NetworkMode?: string;
    NanoCpus?: number;
    Memory?: number;
    MemorySwap?: number;
    PidsLimit?: number | null;
    ReadonlyRootfs?: boolean;
    CapDrop?: string[] | null;
    SecurityOpt?: string[] | null;
    Tmpfs?: Record<string, string> | null;
    Privileged?: boolean;
  };
  Mounts?: { Destination?: string; RW?: boolean; Type?: string }[];
}

export function evaluateContainer(inspect: InspectJson, probes: ProbeResults, cfg: SandboxConfig = DEFAULT_SANDBOX_CONFIG): CheckItem[] {
  const hc = inspect.HostConfig ?? {};
  const work = (inspect.Mounts ?? []).find((m) => m.Destination === '/work');
  const tmpfs = hc.Tmpfs ?? {};
  const [labelKey, labelValue] = cfg.label.split('=');
  const items: CheckItem[] = [];
  const add = (id: string, requirement: string, label: string, expected: string, actual: unknown, pass: boolean) =>
    items.push({ id, requirement, label, expected, actual: String(actual ?? '(missing)'), pass });

  add('network', 'FR-02.4', 'No network', 'NetworkMode = none', hc.NetworkMode, hc.NetworkMode === 'none');
  add('net-probe', 'FR-02.4', 'Only loopback inside the container', 'lo', probes.netInterfaces.trim().split(/\s+/).join(' '), probes.netInterfaces.trim() === 'lo');
  add('cpus', 'FR-02.4', 'CPU limit', `${cfg.cpus} CPUs (NanoCpus ${cfg.cpus * 1e9})`, hc.NanoCpus, hc.NanoCpus === cfg.cpus * 1e9);
  add('memory', 'FR-02.4', 'Memory limit', `${cfg.memory} (${toBytes(cfg.memory)} bytes)`, hc.Memory, hc.Memory === toBytes(cfg.memory));
  add('swap', 'FR-02.4', 'No extra swap (memory-swap = memory)', `${toBytes(cfg.memory)} bytes`, hc.MemorySwap, hc.MemorySwap === toBytes(cfg.memory));
  add('pids', 'NFR-08', 'Process limit', String(cfg.pidsLimit), hc.PidsLimit, hc.PidsLimit === cfg.pidsLimit);
  add('rootfs', 'NFR-08', 'Read-only root filesystem', 'true', hc.ReadonlyRootfs, hc.ReadonlyRootfs === true);
  add('capdrop', 'NFR-08', 'All Linux capabilities dropped', 'ALL', (hc.CapDrop ?? []).join(','), (hc.CapDrop ?? []).map((c) => c.toUpperCase()).includes('ALL'));
  add('nonewpriv', 'NFR-08', 'no-new-privileges', 'no-new-privileges', (hc.SecurityOpt ?? []).join(','), (hc.SecurityOpt ?? []).some((o) => /^no-new-privileges(:true)?$/.test(o)));
  add('privileged', 'NFR-08', 'Not privileged', 'false', hc.Privileged ?? false, hc.Privileged !== true);
  add('user', 'NFR-08', 'Runs as non-root', cfg.user, inspect.Config?.User, inspect.Config?.User === cfg.user);
  add('uid-probe', 'NFR-08', 'Process uid inside the container', cfg.user.split(':')[0], probes.uid.trim(), probes.uid.trim() === cfg.user.split(':')[0]);
  add('work-ro', 'FR-02.4', 'Project mounted read-only at /work', 'bind, RW=false', work ? `${work.Type}, RW=${work.RW}` : '(no /work mount)', !!work && work.RW === false);
  const build = tmpfs['/build'] ?? '';
  add('build-tmpfs', 'FR-02.4', '/build is a 500 MB tmpfs', `size=${cfg.buildTmpfs}`, build || '(none)', new RegExp(`(^|,)size=${cfg.buildTmpfs}(,|$)`).test(build));
  const tmp = tmpfs['/tmp'] ?? '';
  add('tmp-tmpfs', 'FR-02.4', '/tmp is a small tmpfs', `size=${cfg.tmpTmpfs}`, tmp || '(none)', new RegExp(`(^|,)size=${cfg.tmpTmpfs}(,|$)`).test(tmp));
  add('shell-escape', 'FR-02.4', 'Shell escape off in texmf.cnf', 'f', probes.shellEscape.trim(), probes.shellEscape.trim() === 'f');
  add('image', 'A3', 'Pinned sandbox image', cfg.image, inspect.Config?.Image, inspect.Config?.Image === cfg.image);
  add('label', 'B5', 'Orphan-cleanup label', cfg.label, inspect.Config?.Labels?.[labelKey], inspect.Config?.Labels?.[labelKey] === labelValue);
  return items;
}

/** Markdown table of the results (for docs/ and for Member 5's test table). */
export function checklistMarkdown(items: CheckItem[]): string {
  const rows = items.map((i) => `| ${i.id} | ${i.requirement} | ${i.label} | ${i.expected} | ${i.actual.replace(/\|/g, '\\|')} | ${i.pass ? 'PASS' : '**FAIL**'} |`);
  return ['| ID | Req. | Check | Expected | Actual | Result |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
}

/** Run the checklist against a running container (used by scripts/inspect-checklist.ts and Step 12). */
export async function checkRunningContainer(
  runner: { inspectJson(name: string): Promise<Record<string, unknown>>; exec(name: string, cmd: string[]): Promise<{ stdout: Buffer }> },
  name: string,
  cfg: SandboxConfig = DEFAULT_SANDBOX_CONFIG,
): Promise<CheckItem[]> {
  const inspect = (await runner.inspectJson(name)) as InspectJson;
  const out = async (cmd: string[]) => (await runner.exec(name, cmd)).stdout.toString('utf8');
  const probes: ProbeResults = {
    shellEscape: await out(['kpsewhich', '-var-value=shell_escape']),
    uid: await out(['id', '-u']),
    netInterfaces: await out(['ls', '/sys/class/net']),
  };
  return evaluateContainer(inspect, probes, cfg);
}
