import { describe, it, expect } from 'vitest';
import { slotToUv, slotToNdc } from '../src/particles/slotUv.js';

const W = 256;
const H = 256;

describe('slotToUv', () => {
  it('maps slot 0 to the centre of the first texel', () => {
    expect(slotToUv(0, W, H)).toEqual([0.5 / 256, 0.5 / 256]);
  });

  it('maps the last slot to the centre of the last texel', () => {
    expect(slotToUv(W * H - 1, W, H)).toEqual([255.5 / 256, 255.5 / 256]);
  });

  it('advances along a row then wraps to the next', () => {
    expect(slotToUv(1, W, H)).toEqual([1.5 / 256, 0.5 / 256]);
    expect(slotToUv(W, W, H)).toEqual([0.5 / 256, 1.5 / 256]);
    expect(slotToUv(W + 3, W, H)).toEqual([3.5 / 256, 1.5 / 256]);
  });

  it('wraps indices past capacity back to the start', () => {
    expect(slotToUv(W * H, W, H)).toEqual(slotToUv(0, W, H));
    expect(slotToUv(W * H + 7, W, H)).toEqual(slotToUv(7, W, H));
  });

  it('handles negative indices without producing a negative texel', () => {
    const [u, v] = slotToUv(-1, W, H);
    expect(u).toBeGreaterThan(0);
    expect(v).toBeGreaterThan(0);
    expect(slotToUv(-1, W, H)).toEqual(slotToUv(W * H - 1, W, H));
  });

  it('never lands on a texel edge', () => {
    // A UV exactly on a boundary is ambiguous between two texels under
    // NearestFilter, which is how spawn data ends up in the wrong slot.
    for (const i of [0, 1, 255, 256, 1000, 65535]) {
      for (const c of slotToUv(i, W, H)) {
        expect((c * 256) % 1).toBeCloseTo(0.5, 12);
      }
    }
  });

  it('is unique per slot across the whole buffer', () => {
    const seen = new Set();
    for (let i = 0; i < W * H; i++) seen.add(slotToUv(i, W, H).join(','));
    expect(seen.size).toBe(W * H);
  });
});

describe('slotToNdc', () => {
  it('places slot 0 just inside the bottom-left corner', () => {
    const [x, y] = slotToNdc(0, W, H);
    expect(x).toBeCloseTo(0.5 / 256 * 2 - 1, 12);
    expect(y).toBeCloseTo(0.5 / 256 * 2 - 1, 12);
    expect(x).toBeGreaterThan(-1);
    expect(y).toBeGreaterThan(-1);
  });

  it('places the last slot just inside the top-right corner', () => {
    const [x, y] = slotToNdc(W * H - 1, W, H);
    expect(x).toBeLessThan(1);
    expect(y).toBeLessThan(1);
    expect(x).toBeCloseTo(255.5 / 256 * 2 - 1, 12);
  });

  it('keeps every slot strictly inside the clip volume', () => {
    for (let i = 0; i < W * H; i += 97) {
      for (const c of slotToNdc(i, W, H)) {
        expect(c).toBeGreaterThan(-1);
        expect(c).toBeLessThan(1);
      }
    }
  });
});
