// Opaque bounding-box detection: scans the alpha channel of an image so
// physics collide with the visible artwork, not the full (possibly
// padded) PNG canvas.

const ALPHA_THRESHOLD = 10;

function computeOpaqueBoundingBox(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.drawImage(img, 0, 0, w, h);

  const { data } = octx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4;
    for (let x = 0; x < w; x++) {
      const alpha = data[rowOffset + x * 4 + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fully transparent image (or nothing above threshold): fall back to
  // full bounds rather than producing an inverted/empty box.
  if (maxX < 0) {
    minX = 0;
    minY = 0;
    maxX = w - 1;
    maxY = h - 1;
  }

  return {
    fullWidth: w,
    fullHeight: h,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
