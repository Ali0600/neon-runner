import { describe, it, expect } from 'vitest';
import { computeUpdateRanges } from '../src/particles/ringRanges.js';

describe('computeUpdateRanges', () => {
  it('returns a single range when the write does not wrap', () => {
    expect(computeUpdateRanges(10, 5, 100, 4)).toEqual([{ start: 40, count: 20 }]);
  });

  it('splits into two ranges when the write wraps past the end', () => {
    // head 98, 5 items, capacity 100 -> 2 at the end, 3 at the start.
    expect(computeUpdateRanges(98, 5, 100, 4)).toEqual([
      { start: 392, count: 8 },
      { start: 0, count: 12 },
    ]);
  });

  it('stays a single range when the write ends exactly at the boundary', () => {
    expect(computeUpdateRanges(95, 5, 100, 4)).toEqual([{ start: 380, count: 20 }]);
  });

  it('covers the whole buffer once when the write is at least capacity', () => {
    expect(computeUpdateRanges(37, 100, 100, 4)).toEqual([{ start: 0, count: 400 }]);
    expect(computeUpdateRanges(37, 250, 100, 4)).toEqual([{ start: 0, count: 400 }]);
  });

  it('emits nothing for an empty write', () => {
    expect(computeUpdateRanges(10, 0, 100, 4)).toEqual([]);
  });

  it('normalizes a head that has run past capacity', () => {
    expect(computeUpdateRanges(103, 2, 100, 1)).toEqual([{ start: 3, count: 2 }]);
  });

  it('scales offsets by itemSize', () => {
    expect(computeUpdateRanges(4, 2, 100, 1)).toEqual([{ start: 4, count: 2 }]);
    expect(computeUpdateRanges(4, 2, 100, 3)).toEqual([{ start: 12, count: 6 }]);
  });

  it('never reports a range past the end of the buffer', () => {
    const capacity = 64;
    const itemSize = 4;
    for (let head = 0; head < capacity; head++) {
      for (const n of [1, 7, 31, 63]) {
        for (const r of computeUpdateRanges(head, n, capacity, itemSize)) {
          expect(r.start).toBeGreaterThanOrEqual(0);
          expect(r.start + r.count).toBeLessThanOrEqual(capacity * itemSize);
        }
      }
    }
  });
});
