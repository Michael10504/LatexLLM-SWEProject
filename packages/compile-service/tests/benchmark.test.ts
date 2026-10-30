import { nearestRank, png } from '../scripts/benchmark';

describe('Step 13 benchmark helpers', () => {
  it('nearest-rank p95 of 20 runs is the 19th smallest (E1)', () => {
    const runs = Array.from({ length: 20 }, (_, i) => (i + 1) * 100).reverse();
    expect(nearestRank(runs, 95)).toBe(1900);
    expect(nearestRank(runs, 50)).toBe(1000);
    expect(nearestRank([7], 95)).toBe(7);
  });
  it('writes a valid PNG header', () => {
    const img = png(2, 2, () => [255, 0, 0]);
    expect([...img.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(img.subarray(12, 16).toString('ascii')).toBe('IHDR');
  });
});
