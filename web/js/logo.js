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
    // Non-null only when this logo's direction was chosen for "perfect
    // loop" mode: { p, q, signX, signY, L }. See perfectLoopPeriodSeconds.
    perfectLoop: null,
    // Set by applyGuaranteedCornerHit: the fraction of the loop (0.5-0.8)
    // this logo's guaranteed corner hit is targeted at.
    cornerHitFraction: null,
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

// A bouncing logo's path is a billiard trajectory in a maxX x maxY box.
// Unfolding the reflections into a straight line on an infinite grid
// shows the path exactly closes (returns to the same position *and*
// direction) iff dy/dx is a rational multiple of maxY/maxX. Picking the
// direction as (q*maxX, p*maxY) for small coprime integers p,q
// guarantees that, with exact period T = 2*L/speed where
// L = sqrt((q*maxX)^2 + (p*maxY)^2) — independent of starting position.
const PERFECT_LOOP_MAX_INT = 6;

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function perfectLoopCandidates(maxX, maxY) {
  const candidates = [];
  for (let q = 1; q <= PERFECT_LOOP_MAX_INT; q++) {
    for (let p = 1; p <= PERFECT_LOOP_MAX_INT; p++) {
      if (gcd(p, q) !== 1) continue;
      const angleDeg = (Math.atan2(p * maxY, q * maxX) * 180) / Math.PI;
      if (angleDeg < 10 || angleDeg > 80) continue; // avoid near-axis paths
      candidates.push({ p, q });
    }
  }
  return candidates.length ? candidates : [{ p: 1, q: 1 }];
}

// (Re)derives direction + travel length from a logo's chosen (p, q)
// against the *current* travel bounds, preserving quadrant sign. Called
// at seed-init time and again whenever size/aspect-ratio changes the
// bounds, so an in-progress perfect loop stays exact after a resize.
function applyPerfectLoopDirection(logo, maxX, maxY) {
  const { p, q, signX, signY } = logo.perfectLoop;
  const L = Math.sqrt((q * maxX) ** 2 + (p * maxY) ** 2);
  logo.perfectLoop.L = L;
  logo.dir = { x: (signX * q * maxX) / L, y: (signY * p * maxY) / L };
}

// Exact time (seconds) for `logo` to return to its precise starting
// position and direction at the given speed. Null if this logo isn't in
// perfect-loop mode (or has no valid direction yet).
function perfectLoopPeriodSeconds(logo, speed) {
  if (!logo.perfectLoop || !speed) return null;
  return (2 * logo.perfectLoop.L) / speed;
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
// without touching its direction or reseeding. If the logo is in
// perfect-loop mode, also re-derives its direction/length against the
// new bounds (same p/q pair, same quadrant) so the loop stays exact.
function clampLogoPosition(logo, canvasWidth, canvasHeight) {
  if (!logo.box) return;
  const maxX = Math.max(0, canvasWidth - logo.box.width);
  const maxY = Math.max(0, canvasHeight - logo.box.height);
  logo.position.x = Math.min(Math.max(logo.position.x, 0), maxX);
  logo.position.y = Math.min(Math.max(logo.position.y, 0), maxY);
  if (logo.perfectLoop && maxX > 0 && maxY > 0) {
    applyPerfectLoopDirection(logo, maxX, maxY);
  }
}

// Resets position/direction/counters from the logo's seed. This is the
// "seed's initial state" referenced throughout the spec (loop reset,
// manual reset, aspect ratio change). When `perfectLoop` is true, the
// direction is chosen so the bounce path exactly closes instead of a
// fully free-angle pick — see perfectLoopPeriodSeconds.
function initLogoSeedState(logo, canvasWidth, canvasHeight, perfectLoop) {
  if (!logo.box) return;
  const rng = createRng(logo.seed);
  const maxX = Math.max(0, canvasWidth - logo.box.width);
  const maxY = Math.max(0, canvasHeight - logo.box.height);
  logo.position = { x: rng() * maxX, y: rng() * maxY };

  if (perfectLoop && maxX > 0 && maxY > 0) {
    const candidates = perfectLoopCandidates(maxX, maxY);
    const { p, q } = candidates[Math.floor(rng() * candidates.length)];
    const signX = rng() < 0.5 ? -1 : 1;
    const signY = rng() < 0.5 ? -1 : 1;
    logo.perfectLoop = { p, q, signX, signY, L: 0 };
    applyPerfectLoopDirection(logo, maxX, maxY);
  } else {
    const angle = pickSeedAngleRadians(rng);
    logo.dir = { x: Math.cos(angle), y: Math.sin(angle) };
    logo.perfectLoop = null;
  }

  logo.cornerHits = 0;
  logo.autoHue = 0;
}

// The guaranteed corner hit lands at a per-seed randomized fraction of
// the loop's total duration within this range, rather than always at
// a fixed point — otherwise it'd hit at literally the same instant
// every single loop, which reads as robotic rather than natural.
const GUARANTEED_CORNER_HIT_MIN_FRACTION = 0.5;
const GUARANTEED_CORNER_HIT_MAX_FRACTION = 0.8;

// Overwrites `logo.position` so that, given its *already-finalized*
// direction and speed, it lands exactly on a corner at a seed-chosen
// point between 50-80% of loopDurationSeconds. Uses the same
// unfolded-billiard-line idea as perfect loop: the unfolded position at
// time t is start + dir*speed*t, which folds onto a real corner exactly
// when both components are integer multiples of the box dimensions.
// Solving backward for `start` (position is otherwise free — corner
// hits don't care where the path began) always has a valid in-bounds
// solution, and doesn't disturb perfect-loop periodicity, which only
// depends on direction, not starting position.
function applyGuaranteedCornerHit(logo, loopDurationSeconds, canvasWidth, canvasHeight) {
  if (!logo.box || !logo.speed || !loopDurationSeconds || loopDurationSeconds <= 0) return;
  const maxX = Math.max(0, canvasWidth - logo.box.width);
  const maxY = Math.max(0, canvasHeight - logo.box.height);
  if (maxX <= 0 || maxY <= 0) return; // no travel room, no corner to hit

  // Independent RNG stream (seed + salt) so this doesn't reorder the
  // direction/position draws already made from the logo's plain seed.
  const rng = createRng(logo.seed + "|corner");
  const fraction =
    GUARANTEED_CORNER_HIT_MIN_FRACTION +
    rng() * (GUARANTEED_CORNER_HIT_MAX_FRACTION - GUARANTEED_CORNER_HIT_MIN_FRACTION);
  logo.cornerHitFraction = fraction;
  const tc = fraction * loopDurationSeconds;
  const totalDx = logo.dir.x * logo.speed * tc;
  const totalDy = logo.dir.y * logo.speed * tc;

  const m = Math.ceil(totalDx / maxX);
  const n = Math.ceil(totalDy / maxY);

  logo.position = { x: m * maxX - totalDx, y: n * maxY - totalDy };
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
