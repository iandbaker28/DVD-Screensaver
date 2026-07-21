// Logo state factory + size/seed (re)initialization helpers.

let __logoIdCounter = 0;

function createLogo() {
  return {
    id: `logo-${++__logoIdCounter}`,
    fileName: null,
    img: null,
    bbox: null, // raw opaque bounding box at native resolution
    box: null, // scaled draw dimensions, derived from bbox + sizePercent
    sizePercent: 100,
    speed: 200, // px/sec scalar
    seed: String(Math.floor(Math.random() * 1e9)),
    position: { x: 0, y: 0 },
    dir: { x: 1, y: 1 },
    cornerHits: 0,
    autoHue: 0,
    ready: false,
  };
}

// Bias angle picks away from ~10deg of the four axis-aligned directions.
function pickSeedAngleRadians(rng) {
  const ranges = [
    [10, 80],
    [100, 170],
    [190, 260],
    [280, 350],
  ];
  const r = ranges[Math.floor(rng() * ranges.length)];
  const deg = r[0] + rng() * (r[1] - r[0]);
  return (deg * Math.PI) / 180;
}

// Recomputes `box` (scaled draw geometry) from `bbox` + sizePercent.
// Must be called whenever the image loads or the size slider changes.
function recomputeLogoBox(logo) {
  if (!logo.bbox) return;
  const scale = logo.sizePercent / 100;
  logo.box = {
    width: logo.bbox.width * scale,
    height: logo.bbox.height * scale,
    fullWidth: logo.bbox.fullWidth * scale,
    fullHeight: logo.bbox.fullHeight * scale,
    offsetX: logo.bbox.minX * scale,
    offsetY: logo.bbox.minY * scale,
    scale,
  };
}

// Keeps the logo fully on-screen after a size/aspect-ratio change,
// without touching its direction or reseeding.
function clampLogoPosition(logo, canvasWidth, canvasHeight) {
  if (!logo.box) return;
  const maxX = Math.max(0, canvasWidth - logo.box.width);
  const maxY = Math.max(0, canvasHeight - logo.box.height);
  logo.position.x = Math.min(Math.max(logo.position.x, 0), maxX);
  logo.position.y = Math.min(Math.max(logo.position.y, 0), maxY);
}

// Resets position/direction/counters from the logo's seed. This is the
// "seed's initial state" referenced throughout the spec (loop reset,
// manual reset, aspect ratio change).
function initLogoSeedState(logo, canvasWidth, canvasHeight) {
  if (!logo.box) return;
  const rng = createRng(logo.seed);
  const maxX = Math.max(0, canvasWidth - logo.box.width);
  const maxY = Math.max(0, canvasHeight - logo.box.height);
  logo.position = { x: rng() * maxX, y: rng() * maxY };
  const angle = pickSeedAngleRadians(rng);
  logo.dir = { x: Math.cos(angle), y: Math.sin(angle) };
  logo.cornerHits = 0;
  logo.autoHue = 0;
}

async function loadLogoImage(logo, file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    logo.img = img;
    logo.fileName = file.name;
    logo.bbox = computeOpaqueBoundingBox(img);
    recomputeLogoBox(logo);
    logo.ready = true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
