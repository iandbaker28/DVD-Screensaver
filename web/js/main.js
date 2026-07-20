// App orchestration: state, UI wiring, animation loop.

const ASPECTS = {
  "16:9": [1280, 720],
  "4:3": [960, 720],
  "21:9": [1680, 720],
  "1:1": [720, 720],
  "9:16": [720, 1280],
};

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

const app = {
  logos: [],
  settings: {
    aspectRatio: "16:9",
    loopLength: 8,
    motionBlur: 0,
    crtEnabled: true,
    collisionEnabled: false,
    colorCycle: { enabled: false, hue: 0, brightness: 100, saturation: 100, autoHue: false },
  },
  playing: false,
  elapsed: 0,
  lastFrameTime: null,
  flash: null,
  exporting: false,
};

function canvasSize() {
  return ASPECTS[app.settings.aspectRatio];
}

function applyCanvasSize() {
  const [w, h] = canvasSize();
  canvas.width = w;
  canvas.height = h;
}

function resetAllToSeed() {
  const [w, h] = canvasSize();
  for (const logo of app.logos) initLogoSeedState(logo, w, h);
  app.elapsed = 0;
  app.flash = null;
  updateCornerHitDisplay();
}

function updateCornerHitDisplay() {
  const total = app.logos.reduce((sum, l) => sum + l.cornerHits, 0);
  document.getElementById("cornerHitCount").textContent = String(total);
}

function readyLogos() {
  return app.logos.filter((l) => l.ready);
}

function refreshTransportEnabled() {
  const hasReady = readyLogos().length > 0;
  document.getElementById("btnPlay").disabled = !hasReady || app.exporting;
  document.getElementById("btnPause").disabled = !hasReady || app.exporting;
  document.getElementById("btnReset").disabled = !hasReady || app.exporting;
  document.getElementById("btnExport").disabled = !hasReady || app.exporting;
  document.getElementById("btnAddLogo").disabled = !app.logos[0]?.ready || app.exporting;
}

// ---------- animation loop ----------

function tick(now) {
  if (app.lastFrameTime == null) app.lastFrameTime = now;
  let dt = (now - app.lastFrameTime) / 1000;
  app.lastFrameTime = now;
  dt = Math.min(dt, MAX_DT_SECONDS);

  if (app.playing) {
    app.elapsed += dt;
    if (app.elapsed >= app.settings.loopLength) {
      resetAllToSeed();
    } else {
      const [w, h] = canvasSize();
      const cornerHit = stepAllPhysics(readyLogos(), dt, w, h, app.settings.collisionEnabled);
      if (cornerHit) {
        app.flash = { startTime: now };
        updateCornerHitDisplay();
      }
    }
  }

  if (app.flash && now - app.flash.startTime > CRT_GLOW_DURATION_MS) {
    app.flash = null;
  }

  const [w, h] = canvasSize();
  renderFrame(ctx, w, h, readyLogos(), app.settings, app.flash, now);

  requestAnimationFrame(tick);
}

// ---------- logo cards ----------

const logoListEl = document.getElementById("logoList");
const logoCardTemplate = document.getElementById("logoCardTemplate");

function dimsText(logo) {
  if (!logo.bbox) return "";
  return `${logo.bbox.fullWidth}×${logo.bbox.fullHeight} full · ${logo.bbox.width}×${logo.bbox.height} opaque`;
}

function setupDropZone(zoneEl, inputEl, onFile) {
  zoneEl.addEventListener("click", () => inputEl.click());
  inputEl.addEventListener("change", () => {
    if (inputEl.files[0]) onFile(inputEl.files[0]);
  });
  ["dragenter", "dragover"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.remove("drag-over");
    })
  );
  zoneEl.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type === "image/png") onFile(file);
  });
}

async function handleLogoFile(logo, file, cardEl) {
  await loadLogoImage(logo, file);
  const [w, h] = canvasSize();
  initLogoSeedState(logo, w, h);
  if (cardEl) {
    cardEl.querySelector('[data-role="filename"]').textContent = file.name;
    cardEl.querySelector('[data-role="dims"]').textContent = dimsText(logo);
  }
  if (logo === app.logos[0]) {
    document.getElementById("uploadOverlay").hidden = true;
  }
  refreshTransportEnabled();
}

function renderLogoCard(logo, index) {
  const frag = logoCardTemplate.content.cloneNode(true);
  const card = frag.querySelector(".logo-card");
  card.dataset.logoId = logo.id;
  card.querySelector(".logo-card-name").textContent = `LOGO ${index + 1}`;

  const removeBtn = card.querySelector(".btn-remove");
  if (index === 0) {
    removeBtn.remove();
  } else {
    removeBtn.addEventListener("click", () => removeLogo(logo.id));
  }

  const dropZone = card.querySelector('[data-role="drop"]');
  const fileInput = card.querySelector('[data-role="file-input"]');
  setupDropZone(dropZone, fileInput, (file) => handleLogoFile(logo, file, card));

  const sizeInput = card.querySelector('[data-role="size"]');
  const sizeVal = card.querySelector('[data-role="sizeVal"]');
  sizeInput.value = logo.sizePercent;
  sizeVal.textContent = logo.sizePercent;
  sizeInput.addEventListener("input", () => {
    logo.sizePercent = Number(sizeInput.value);
    sizeVal.textContent = logo.sizePercent;
    recomputeLogoBox(logo);
    const [w, h] = canvasSize();
    clampLogoPosition(logo, w, h);
  });

  const speedInput = card.querySelector('[data-role="speed"]');
  const speedVal = card.querySelector('[data-role="speedVal"]');
  speedInput.value = logo.speed;
  speedVal.textContent = logo.speed;
  speedInput.addEventListener("input", () => {
    logo.speed = Number(speedInput.value);
    speedVal.textContent = logo.speed;
  });

  const seedInput = card.querySelector('[data-role="seed"]');
  seedInput.value = logo.seed;
  seedInput.addEventListener("change", () => {
    logo.seed = seedInput.value || "0";
    if (logo.ready) {
      const [w, h] = canvasSize();
      initLogoSeedState(logo, w, h);
      updateCornerHitDisplay();
    }
  });

  card.querySelector('[data-role="randomize"]').addEventListener("click", () => {
    const newSeed = String(Date.now() ^ Math.floor(Math.random() * 1e9));
    logo.seed = newSeed;
    seedInput.value = newSeed;
    if (logo.ready) {
      const [w, h] = canvasSize();
      initLogoSeedState(logo, w, h);
      updateCornerHitDisplay();
    }
  });

  logoListEl.appendChild(frag);
}

function addLogo() {
  const logo = createLogo();
  app.logos.push(logo);
  renderLogoCard(logo, app.logos.length - 1);
  refreshTransportEnabled();
  return logo;
}

function removeLogo(id) {
  const idx = app.logos.findIndex((l) => l.id === id);
  if (idx <= 0) return; // never remove the primary logo
  app.logos.splice(idx, 1);
  const cardEl = logoListEl.querySelector(`[data-logo-id="${id}"]`);
  if (cardEl) cardEl.remove();
  refreshTransportEnabled();
  updateCornerHitDisplay();
}

// ---------- global controls ----------

document.getElementById("btnAddLogo").addEventListener("click", addLogo);

document.getElementById("aspectRatio").addEventListener("change", (e) => {
  app.settings.aspectRatio = e.target.value;
  applyCanvasSize();
  resetAllToSeed();
});

const loopLengthInput = document.getElementById("loopLength");
loopLengthInput.addEventListener("input", () => {
  app.settings.loopLength = Number(loopLengthInput.value);
  document.getElementById("loopLengthVal").textContent = app.settings.loopLength;
});

document.getElementById("collisionToggle").addEventListener("change", (e) => {
  app.settings.collisionEnabled = e.target.checked;
});

const motionBlurInput = document.getElementById("motionBlur");
motionBlurInput.addEventListener("input", () => {
  app.settings.motionBlur = Number(motionBlurInput.value);
  document.getElementById("motionBlurVal").textContent = app.settings.motionBlur;
});

document.getElementById("crtToggle").addEventListener("change", (e) => {
  app.settings.crtEnabled = e.target.checked;
});

// color cycling
const cc = app.settings.colorCycle;
document.getElementById("colorCycleToggle").addEventListener("change", (e) => {
  cc.enabled = e.target.checked;
});
document.getElementById("autoHueToggle").addEventListener("change", (e) => {
  cc.autoHue = e.target.checked;
});
const hueInput = document.getElementById("hueRotate");
hueInput.addEventListener("input", () => {
  cc.hue = Number(hueInput.value);
  document.getElementById("hueRotateVal").textContent = cc.hue;
});
const brightnessInput = document.getElementById("brightness");
brightnessInput.addEventListener("input", () => {
  cc.brightness = Number(brightnessInput.value);
  document.getElementById("brightnessVal").textContent = cc.brightness;
});
const saturationInput = document.getElementById("saturation");
saturationInput.addEventListener("input", () => {
  cc.saturation = Number(saturationInput.value);
  document.getElementById("saturationVal").textContent = cc.saturation;
});

// ---------- transport ----------

document.getElementById("btnPlay").addEventListener("click", () => {
  app.playing = true;
});
document.getElementById("btnPause").addEventListener("click", () => {
  app.playing = false;
});
document.getElementById("btnReset").addEventListener("click", () => {
  resetAllToSeed();
});

document.getElementById("btnFullscreen").addEventListener("click", () => {
  const tv = document.getElementById("tv");
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (tv.requestFullscreen) {
    tv.requestFullscreen();
  }
});

// ---------- export ----------

const btnExport = document.getElementById("btnExport");
const exportStatusEl = document.getElementById("exportStatus");
const recIndicator = document.getElementById("recIndicator");

btnExport.addEventListener("click", async () => {
  if (app.exporting) return;
  app.exporting = true;
  const wasPlaying = app.playing;
  refreshTransportEnabled();

  resetAllToSeed();
  app.playing = true;
  recIndicator.hidden = false;

  const format = document.getElementById("exportFormat").value;

  try {
    await runExportPipeline({
      canvas,
      durationSeconds: app.settings.loopLength,
      format,
      apiBaseUrl: window.DVD_CONFIG.apiBaseUrl,
      onStatus: (text) => {
        exportStatusEl.textContent = text;
        if (text === "converting...") recIndicator.hidden = true;
      },
    });
    exportStatusEl.textContent = "export complete";
  } catch (err) {
    console.error(err);
    exportStatusEl.textContent = `error: ${err.message}`;
  } finally {
    recIndicator.hidden = true;
    app.exporting = false;
    app.playing = wasPlaying;
    refreshTransportEnabled();
    setTimeout(() => {
      exportStatusEl.textContent = "";
    }, 6000);
  }
});

// ---------- primary (logo 0) upload overlay ----------

setupDropZone(
  document.getElementById("dropZone"),
  document.getElementById("fileInput"),
  (file) => {
    const primary = app.logos[0];
    handleLogoFile(primary, file, logoListEl.querySelector(`[data-logo-id="${primary.id}"]`));
  }
);

// ---------- init ----------

applyCanvasSize();
addLogo();
refreshTransportEnabled();
requestAnimationFrame(tick);
