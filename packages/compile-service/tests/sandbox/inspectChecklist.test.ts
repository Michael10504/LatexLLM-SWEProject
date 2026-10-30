import { checklistMarkdown, evaluateContainer, toBytes } from '../../src/sandbox/inspectChecklist';

/** What `docker inspect` returns for a container started with the fixed command (trimmed). */
const good = {
  Config: { User: '1000:1000', Image: 'ltx-sandbox:1', Labels: { app: 'ltx-sandbox', 'ltx.dir': 'D:/p' } },
  HostConfig: {
    NetworkMode: 'none', NanoCpus: 2e9, Memory: 2147483648, MemorySwap: 2147483648, PidsLimit: 256, ReadonlyRootfs: true,
    CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Privileged: false,
    Tmpfs: { '/build': 'rw,size=500m,mode=1777', '/tmp': 'rw,size=64m,mode=1777' },
  },
  Mounts: [{ Type: 'bind', Destination: '/work', RW: false }],
};
const probes = { shellEscape: 'f\n', uid: '1000\n', netInterfaces: 'lo\n' };

describe('Step 14 inspect checklist', () => {
  it('passes every check for a container started with the fixed command', () => {
    const items = evaluateContainer(good, probes);
    expect(items).toHaveLength(18);
    expect(items.filter((i) => !i.pass)).toEqual([]);
  });

  it.each([
    ['network', { HostConfig: { ...good.HostConfig, NetworkMode: 'bridge' } }],
    ['memory', { HostConfig: { ...good.HostConfig, Memory: 4 * 1024 ** 3 } }],
    ['swap', { HostConfig: { ...good.HostConfig, MemorySwap: -1 } }],
    ['rootfs', { HostConfig: { ...good.HostConfig, ReadonlyRootfs: false } }],
    ['capdrop', { HostConfig: { ...good.HostConfig, CapDrop: null } }],
    ['build-tmpfs', { HostConfig: { ...good.HostConfig, Tmpfs: { '/build': 'rw,size=5g' } } }],
    ['work-ro', { Mounts: [{ Type: 'bind', Destination: '/work', RW: true }] }],
    ['user', { Config: { ...good.Config, User: '' } }],
  ])('flags a wrong %s', (id, patch) => {
    const items = evaluateContainer({ ...good, ...patch }, probes);
    expect(items.find((i) => i.id === id)?.pass).toBe(false);
  });

  it('flags shell escape on, root uid and a network interface from the probes', () => {
    const items = evaluateContainer(good, { shellEscape: 'p', uid: '0', netInterfaces: 'eth0\nlo' });
    expect(items.filter((i) => !i.pass).map((i) => i.id).sort()).toEqual(['net-probe', 'shell-escape', 'uid-probe']);
  });

  it('accepts no-new-privileges:true and converts sizes', () => {
    const items = evaluateContainer({ ...good, HostConfig: { ...good.HostConfig, SecurityOpt: ['no-new-privileges:true'] } }, probes);
    expect(items.find((i) => i.id === 'nonewpriv')?.pass).toBe(true);
    expect(toBytes('2g')).toBe(2147483648);
    expect(toBytes('500m')).toBe(524288000);
  });

  it('renders a markdown table', () => {
    const md = checklistMarkdown(evaluateContainer(good, probes));
    expect(md.split('\n')).toHaveLength(20);
    expect(md).toContain('| network | FR-02.4 | No network | NetworkMode = none | none | PASS |');
  });
});
