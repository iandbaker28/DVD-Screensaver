// Canvas rendering: background (solid color or image, with filters),
// logo draw (with color-cycle filter), motion-blur trail, and CRT
// scanline/vignette/glow overlay. Everything here draws directly onto
// the recorded canvas so all of this (or its absence) is reflected in
// exported video too.

const CRT_GLOW_DURATION_MS = 350;

// Motion blur is rendered on a separate transparent trail layer so the
// fade doesn't tint a solid-color background or repeatedly darken a
// background image — each frame the trail layer is composited fresh on
// top of a fully-redrawn background.
let trailCanvas = null;
let trailCtx = null;

function ensureTrailLayer(w, h) {
  if (!trailCanvas) {
    trailCanvas = document.createElement("canvas");
    trailCtx = trailCanvas.getContext("2d");
  }
  if (trailCanvas.width !== w || trailCanvas.height !== h) {
    trailCanvas.width = w;
    trailCanvas.height = h;
  }
  return trailCtx;
}

// Fraction of the trail's alpha erased each frame. 0 = instant clear
// (crisp, no trail). Higher motionBlur values erase less per frame,
// leaving a longer-lived afterimage.
function trailEraseAlpha(motionBlur) {
  if (motionBlur <= 0) return 1;
  return 1 / (motionBlur + 1);
}

function backgroundFilterString(bg) {
  const img = bg.image;
  const parts = [];
  if (img.blur > 0) parts.push(`blur(${img.blur}px)`);
  parts.push(`hue-rotate(${img.hue}deg)`);
  parts.push(`brightness(${img.brightness}%)`);
  parts.push(`saturate(${img.saturation}%)`);
  return parts.join(" ");
}

function drawBackground(ctx, w, h, bg) {
  if (bg.mode === "image" && bg.image.img) {
    const img = bg.image;
    // Overscan the cover-fit draw so a blur radius doesn't sample the
    // canvas edge into a faded/transparent boundary.
    const pad = img.blur * 2;
    const iw = img.img.naturalWidth;
    const ih = img.img.naturalHeight;
    const scale = Math.max((w + pad * 2) / iw, (h + pad * 2) / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const drawX = (w - drawW) / 2;
    const drawY = (h - drawH) / 2;

    ctx.save();
    ctx.filter = backgroundFilterString(bg);
    ctx.drawImage(img.img, drawX, drawY, drawW, drawH);
    ctx.restore();
  } else {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawLogo(ctx, logo, colorCycle) {
  if (!logo.ready || !logo.img || !logo.box) return;

  let filter = "none";
  if (colorCycle.enabled) {
    const hue = (colorCycle.hue + (colorCycle.autoHue ? logo.autoHue : 0)) % 360;
    filter = `hue-rotate(${hue}deg) brightness(${colorCycle.brightness}%) saturate(${colorCycle.saturation}%)`;
  }
  ctx.filter = filter;

  const drawX = logo.position.x - logo.box.offsetX;
  const drawY = logo.position.y - logo.box.offsetY;
  ctx.drawImage(logo.img, drawX, drawY, logo.box.fullWidth, logo.box.fullHeight);
  ctx.filter = "none";
}

function drawScanlinesAndVignette(ctx, w, h) {
  ctx.save();

  // Scanlines
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  const lineSpacing = 3;
  for (let y = 0; y < h; y += lineSpacing) {
    ctx.fillRect(0, y, w, 1);
  }

  // Vignette
  const grad = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.25,
    w / 2, h / 2, Math.max(w, h) * 0.72
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

function drawCornerGlow(ctx, w, h, intensity) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalAlpha = intensity;
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  grad.addColorStop(0, "rgba(255, 255, 255, 0)");
  grad.addColorStop(0.7, "rgba(255, 106, 61, 0)");
  grad.addColorStop(1, "rgba(255, 106, 61, 0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// `flash` is { startTime } in performance.now() ms, or null.
function renderFrame(ctx, w, h, logos, settings, flash, now) {
  const tCtx = ensureTrailLayer(w, h);

  ctx.globalAlpha = 1;
  ctx.filter = "none";
  drawBackground(ctx, w, h, settings.background);

  const eraseAlpha = trailEraseAlpha(settings.motionBlur);
  if (eraseAlpha >= 1) {
    tCtx.clearRect(0, 0, w, h);
  } else {
    tCtx.save();
    tCtx.globalCompositeOperation = "destination-out";
    tCtx.fillStyle = `rgba(0, 0, 0, ${eraseAlpha})`;
    tCtx.fillRect(0, 0, w, h);
    tCtx.restore();
  }

  for (const logo of logos) {
    drawLogo(tCtx, logo, settings.colorCycle);
  }

  ctx.drawImage(trailCanvas, 0, 0);

  if (settings.crtEnabled) {
    drawScanlinesAndVignette(ctx, w, h);
    if (flash) {
      const elapsed = now - flash.startTime;
      const intensity = Math.max(0, 1 - elapsed / CRT_GLOW_DURATION_MS);
      drawCornerGlow(ctx, w, h, intensity * 0.8);
    }
  }
}
