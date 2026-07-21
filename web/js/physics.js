// Delta-time bounce physics + corner-hit detection + optional
// logo-on-logo collision.

const MAX_DT_SECONDS = 0.05; // clamp huge jumps (tab backgrounded, etc.)
const AUTO_HUE_STEP_PER_BOUNCE = 25;

// Reflects a 1D move of `d` from `p0` into [0, max] using a triangle-
// wave fold, handling any overshoot magnitude (not just small overshoot
// past one wall) in a single step instead of clamping the excess away.
// `flipped` is true iff an odd number of wall bounces occurred, i.e.
// the direction sign for this axis should invert.
function reflect1D(p0, d, max) {
  if (max <= 0) return { position: 0, flipped: false };
  const period = 2 * max;
  let t = (p0 + d) % period;
  if (t < 0) t += period;
  return t <= max ? { position: t, flipped: false } : { position: period - t, flipped: true };
}

// Advances one logo by dt seconds and resolves wall collisions.
// Returns true if this frame's wall collision was a genuine corner hit
// (simultaneous X and Y resolution within the same frame's movement).
function stepLogoPhysics(logo, dt, canvasWidth, canvasHeight) {
  if (!logo.ready || !logo.box) return false;

  const maxX = Math.max(0, canvasWidth - logo.box.width);
  const maxY = Math.max(0, canvasHeight - logo.box.height);

  const rx = reflect1D(logo.position.x, logo.dir.x * logo.speed * dt, maxX);
  const ry = reflect1D(logo.position.y, logo.dir.y * logo.speed * dt, maxY);

  logo.position.x = rx.position;
  logo.position.y = ry.position;
  if (rx.flipped) logo.dir.x = -logo.dir.x;
  if (ry.flipped) logo.dir.y = -logo.dir.y;

  if (rx.flipped || ry.flipped) {
    logo.autoHue = (logo.autoHue + AUTO_HUE_STEP_PER_BOUNCE) % 360;
  }

  if (rx.flipped && ry.flipped) {
    logo.cornerHits++;
    return true;
  }
  return false;
}

// Simple, visually-plausible elastic collision between logo bounding
// boxes: on overlap, both logos deflect apart along the axis of least
// penetration and are separated so they don't stay stuck together.
function resolveLogoCollisions(logos) {
  for (let i = 0; i < logos.length; i++) {
    const a = logos[i];
    if (!a.ready || !a.box) continue;
    for (let j = i + 1; j < logos.length; j++) {
      const b = logos[j];
      if (!b.ready || !b.box) continue;

      const ax1 = a.position.x, ay1 = a.position.y;
      const ax2 = ax1 + a.box.width, ay2 = ay1 + a.box.height;
      const bx1 = b.position.x, by1 = b.position.y;
      const bx2 = bx1 + b.box.width, by2 = by1 + b.box.height;

      const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1);
      const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1);
      if (overlapX <= 0 || overlapY <= 0) continue;

      const aCenterX = ax1 + a.box.width / 2;
      const bCenterX = bx1 + b.box.width / 2;
      const aCenterY = ay1 + a.box.height / 2;
      const bCenterY = by1 + b.box.height / 2;

      if (overlapX < overlapY) {
        const push = overlapX / 2 + 0.01;
        if (aCenterX < bCenterX) {
          a.position.x -= push;
          b.position.x += push;
          a.dir.x = -Math.abs(a.dir.x);
          b.dir.x = Math.abs(b.dir.x);
        } else {
          a.position.x += push;
          b.position.x -= push;
          a.dir.x = Math.abs(a.dir.x);
          b.dir.x = -Math.abs(b.dir.x);
        }
      } else {
        const push = overlapY / 2 + 0.01;
        if (aCenterY < bCenterY) {
          a.position.y -= push;
          b.position.y += push;
          a.dir.y = -Math.abs(a.dir.y);
          b.dir.y = Math.abs(b.dir.y);
        } else {
          a.position.y += push;
          b.position.y -= push;
          a.dir.y = Math.abs(a.dir.y);
          b.dir.y = -Math.abs(b.dir.y);
        }
      }
    }
  }
}

// Steps every logo by dt and returns whether any logo recorded a
// genuine corner hit this frame (used to trigger the glow/flash pulse).
function stepAllPhysics(logos, dt, canvasWidth, canvasHeight, collisionEnabled) {
  let cornerHit = false;
  for (const logo of logos) {
    if (stepLogoPhysics(logo, dt, canvasWidth, canvasHeight)) {
      cornerHit = true;
    }
  }
  if (collisionEnabled && logos.length > 1) {
    resolveLogoCollisions(logos);
  }
  return cornerHit;
}
