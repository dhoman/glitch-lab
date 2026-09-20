// Port of glitchByteArray in the site's bundled glitch-canvas Web Worker.
// Keep the same JPEG header scan, byte positions, and integer truncation.
function glitchBytes(jpeg, { amount, iterations, seed }) {
  const bytes = Buffer.from(jpeg);
  let header = 417;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 255 && bytes[i + 1] === 218) {
      header = i + 2;
      break;
    }
  }
  const length = bytes.length - header - 4;
  for (let i = 0; i < iterations; i++) {
    const start = (length / iterations * i) | 0;
    let offset = (start + (((length / iterations * (i + 1)) | 0) - start) * seed / 100) | 0;
    if (offset > length) offset = length;
    bytes[~~(header + offset)] = ~~(256 * amount / 100);
  }
  return bytes;
}

module.exports = { glitchBytes };
