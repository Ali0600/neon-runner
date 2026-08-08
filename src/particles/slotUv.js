// Mapping between a particle's ring-buffer slot and its texel in the GPGPU
// state textures. Pure so the arithmetic can be pinned by tests — an off-by-half
// here writes a spawn into the wrong texel, which shows up as particles
// flickering at random positions rather than as an error.

/**
 * Texel-centre UV for a slot, in [0,1].
 */
export function slotToUv(index, width, height) {
  const i = ((index % (width * height)) + width * height) % (width * height);
  const col = i % width;
  const row = Math.floor(i / width);
  return [(col + 0.5) / width, (row + 0.5) / height];
}

/**
 * Texel-centre NDC for a slot, in [-1,1]. Used to render a 1-pixel point
 * exactly onto that texel when injecting spawn data.
 */
export function slotToNdc(index, width, height) {
  const [u, v] = slotToUv(index, width, height);
  return [u * 2 - 1, v * 2 - 1];
}
