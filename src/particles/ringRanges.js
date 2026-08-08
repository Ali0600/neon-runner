/**
 * Compute the BufferAttribute update ranges for `count` items written into a
 * ring buffer of `capacity` items starting at `head`.
 *
 * Ranges are in COMPONENT offsets (item index * itemSize), which is what
 * THREE.BufferAttribute.addUpdateRange expects — not item indices.
 *
 * Returns one range normally, two when the write wraps past the end.
 */
export function computeUpdateRanges(head, count, capacity, itemSize) {
  if (count <= 0 || capacity <= 0) return [];

  // A write larger than the buffer overwrites everything; one full range is
  // both correct and cheaper than emitting several wrapped ones.
  if (count >= capacity) {
    return [{ start: 0, count: capacity * itemSize }];
  }

  const start = head % capacity;
  const first = Math.min(count, capacity - start);
  const ranges = [{ start: start * itemSize, count: first * itemSize }];

  const rest = count - first;
  if (rest > 0) ranges.push({ start: 0, count: rest * itemSize });

  return ranges;
}
