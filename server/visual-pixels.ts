import { PNG } from 'pngjs';

export function sameVisualPixels(before: Uint8Array, after: Uint8Array): boolean {
  const a = PNG.sync.read(Buffer.from(before));
  const b = PNG.sync.read(Buffer.from(after));
  if (a.width !== b.width || a.height !== b.height) return false;
  // Chromium can round antialiased edges differently by one 8-bit color level.
  // A larger change in even one channel rejects the observation.
  for (let i = 0; i < a.data.length; i++)
    if (Math.abs(a.data[i] - b.data[i]) > 1) return false;
  return true;
}
