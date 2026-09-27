import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {sameVisualPixels} from '../server/visual-pixels';
const encode = (bytes: number[], width = 2) => PNG.sync.write({width,height:1,data:Buffer.from(bytes)} as PNG);
test('visual stability tolerates only one color level of rasterization noise', () => {
  const original = encode([40,50,60,255, 90,100,110,255]);
  assert.equal(sameVisualPixels(new Uint8Array(original),new Uint8Array(original)),true);
  assert.equal(sameVisualPixels(original,encode([41,49,61,255, 90,100,110,255])),true);
  assert.equal(sameVisualPixels(original,encode([42,50,60,255, 90,100,110,255])),false);
  assert.equal(sameVisualPixels(original,encode([40,50,60,255, 0,0,0,255])),false);
  assert.equal(sameVisualPixels(original,encode([40,50,60,255],1)),false);
});
