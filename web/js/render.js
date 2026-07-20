// Canvas rendering: logo draw (with color-cycle filter), motion-blur
// trail, and CRT scanline/vignette/glow overlay. Everything here draws
// directly onto the recorded canvas so CRT effects (or their absence)
// are reflected in exported video too.

const CRT_GLOW_DURATION_MS = 350;

function motionBlurAlpha(motionBlur) {
  // 0 = fully opaque clear each frame (crisp, no trail).
  // 1-5 = increasingly translucent clear, leaving longer ghost trails.
  if (motionBlur <= 0) return 1;
  return 1 / (motionBlur + 1);
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
  const alpha = motionBlurAlpha(settings.motionBlur);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#05060a";
  if (alpha >= 1) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  for (const logo of logos) {
    drawLogo(ctx, logo, settings.colorCycle);
  }

  if (settings.crtEnabled) {
    drawScanlinesAndVignette(ctx, w, h);
    if (flash) {
      const elapsed = now - flash.startTime;
      const intensity = Math.max(0, 1 - elapsed / CRT_GLOW_DURATION_MS);
      drawCornerGlow(ctx, w, h, intensity * 0.8);
    }
  }
}
