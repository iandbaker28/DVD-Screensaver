# DVD Screensaver Maker — Build Spec

## Overview

A self-hosted web app that recreates the classic bouncing-logo screensaver
using a user-uploaded PNG, with adjustable physics, visual effects, and
video export in multiple formats. Ships as a Docker Compose stack.

Aesthetic direction: retro CRT/VHS — dark charcoal panel chrome, a "TV
screen" viewport with scanlines/vignette (toggleable), monospace/pixel
type. Not a generic dark-mode dashboard.

---

## Architecture

Two services behind Docker Compose:

1. **`web`** — static frontend (plain HTML/CSS/JS, no framework required;
   React/Vite is fine if preferred, but no SSR needed). Served by nginx or
   a minimal Node static server. All animation, physics, and canvas
   rendering happens client-side.
2. **`api`** — small backend (Node/Express or Python/FastAPI, whichever
   fits the ffmpeg tooling best) whose only job is: accept a video file
   upload + target format, run ffmpeg, return the converted file. No
   database, no auth, no persistence beyond the request lifecycle (temp
   files cleaned up after response or on a TTL).

Communication: frontend records a `.webm` locally via `MediaRecorder`,
then POSTs it to the `api` service's conversion endpoint, receives back
the requested format, and triggers a browser download. Nothing is stored
long-term server-side.

```
docker-compose.yml
├── web/     (frontend, port 8383 → 80)
└── api/     (ffmpeg conversion service, internal port only, proxied or
              exposed on its own port, e.g. 8384)
```

`web` should reverse-proxy or directly call `api`'s endpoint — either is
fine, but CORS must be handled if calling directly cross-port.

---

## Core mechanics

### Opaque bounding-box detection

On PNG upload, don't trust `naturalWidth`/`naturalHeight` alone — PNGs
frequently have transparent padding around the visible artwork, which
would throw off where the logo visually appears to touch the screen edge.

Algorithm:
1. Draw the uploaded image to an offscreen canvas at native resolution.
2. Read pixel data via `getImageData`.
3. Scan the alpha channel; find `minX, minY, maxX, maxY` where alpha > ~10
   (small threshold to ignore near-invisible antialiasing fringes).
4. That box (`width = maxX - minX + 1`, etc.) is the collision boundary,
   not the full canvas.
5. If the image has no transparency at all, the box is just the full
   image bounds — this path should fall out naturally from the same scan
   rather than needing a special case.

This bounding box must be **recomputed whenever the size slider changes**,
since scaling changes both the box dimensions and the offset between the
box and the full image (needed to position the full image correctly when
drawing, since the box may not start at (0,0) of the source image).

### Bounce physics

- Track position as the **top-left of the opaque bounding box** in canvas
  coordinates, not the full image's position.
- Each frame: `position += velocity * speed * dt` (see frame-rate
  independence below).
- Collision check against canvas bounds (`0` to `canvasWidth - boxWidth`,
  same for height):
  - Hit left or right wall → invert **horizontal** velocity component only.
  - Hit top or bottom wall → invert **vertical** velocity component only.
  - This is the whole trick for "no bounce left when coming from left" —
    plain axis-aligned reflection already guarantees it, don't overthink it.
- **Corner hit** = both an X and a Y collision resolve in the same frame.
  Track a running counter, and fire a visual pulse (respects the CRT/glow
  toggle) when it happens. Given discrete per-frame stepping, use the
  frame's movement delta as tolerance so a true corner isn't missed due to
  stepping past it.
- Speed is a **single scalar** control (magnitude only) — direction comes
  from the seed, not from independent X/Y speed dials. This is a
  deliberate choice to keep the classic single-speed DVD feel; don't add
  vector speed controls.
- No gravity, drift, damping, or acceleration. Constant velocity between
  bounces, full stop — that's the classic behavior and it's intentional
  that it's *not* being made more "realistic."

### Frame-rate independence

Physics must be **delta-time based**, not frame-based:
`position += direction * speedPxPerSecond * dt`, where `dt` is the actual
elapsed time since the last frame (clamp to something like 50ms max to
avoid huge jumps after a tab goes background/foreground). This ensures the
same seed produces the same *path shape* regardless of the display's
refresh rate, though exact frame-for-frame determinism across wildly
different frame rates isn't required — path fidelity is what matters.

### Seeded randomness

- Use a small seeded PRNG (e.g. mulberry32) seeded from a
  string/number the user can see and edit in a text field.
- Seed determines: starting position within the canvas, and starting
  direction/angle. It should avoid picking angles too close to
  perfectly horizontal/vertical (boring, looks broken) — bias away from
  angles within roughly ~10° of the four axis-aligned directions.
- A "randomize" button generates a new seed (e.g. current timestamp or
  random int) and re-seeds.
- Given a fixed seed, size, and aspect ratio, the path should be
  reproducible run to run.

### Loop length

Single control, dual purpose:
- **On-screen preview**: when elapsed time reaches the loop length, reset
  to the seed's initial state (position/direction/all counters) and
  continue — this makes the on-screen animation a seamless repeating loop
  rather than an ever-diverging path.
- **Export**: the recorded/exported clip is exactly one loop-length's
  worth of animation, starting from the seed's initial state, so what's
  exported matches what's previewed.

---

## Controls / UI

- **Upload**: click-to-browse and drag-and-drop, PNG only. Show filename,
  full dimensions, and detected opaque bounding-box dimensions once loaded.
- **Logo size**: slider, percentage-based, rescales the bounding box (and
  therefore where it hits edges/corners) live.
- **Speed**: slider, px/sec scalar magnitude.
- **Loop length**: slider, seconds, drives both preview loop reset and
  export duration.
- **Seed**: text/number input + randomize button.
- **Aspect ratio**: dropdown of common presets (e.g. 16:9, 4:3, 21:9, 1:1,
  9:16) that changes the canvas/screen dimensions. Changing this should
  re-run the seed initialization since available bounds changed.
- **Color cycling**: toggle, plus three sliders (hue rotate, brightness,
  saturation) applied as a CSS/canvas filter to the logo on render. When
  off, logo renders as-uploaded. Consider whether hue should auto-shift
  per-bounce (closer to the "real" DVD effect) or stay as a static
  user-set tint — implementer's call, but default to a static tint
  controlled by the sliders since that's what was asked for; per-bounce
  auto-cycling can be a bonus if trivial to add on top.
- **Multiple logos**: ability to add more than one bouncing logo (each
  gets its own upload, independent size/speed/seed). Off by default —
  single logo is the common case. Not required to support mixed
  image-per-logo if that's a heavy lift, but each logo does need its own
  physics state at minimum.
- **Logo-on-logo collision**: toggle, only meaningful when 2+ logos are
  active. When on, logos should bounce off each other (simple elastic
  collision using their bounding boxes is fine — this doesn't need to be
  physically rigorous, just visually plausible) instead of passing
  through.
- **Motion blur / afterimage**: slider, 0–5, representing how many prior
  frames' worth of afterimage trail to render behind the logo (e.g. via
  drawing previous positions at decreasing opacity, or a
  semi-transparent clear-rect trick instead of a full clear each frame).
  0 = off/crisp, as now.
- **CRT effect toggle**: on/off switch for the scanline overlay,
  vignette, and glow/flash effects. When off, the screen should render
  clean with no overlay — useful since some of these effects (esp.
  scanlines) can visibly degrade a recorded/exported clip's clarity, and
  users may want a clean export.
- **Background**: color picker for a solid screen background (default a
  dark charcoal to match the CRT aesthetic), plus an optional background
  image upload (any common raster format, not limited to PNG) that
  covers the screen behind the logo(s) when present. When an image is
  set, sliders for blur, hue rotate, brightness, and saturation apply as
  filters to it (same filter mechanism as logo color cycling); a
  "remove image" control reverts to the solid color. Background
  rendering must not interact badly with the motion-blur trail — the
  afterimage should fade to reveal the current background each frame,
  not progressively tint/darken a colorful background over time.
- **Play / Pause / Reset to seed**
- **Export**: format dropdown (mp4, mov, gif, mkv, webm at minimum) +
  export button. Triggers record → upload to `api` → conversion →
  download, with a clear in-progress state (the existing REC indicator
  concept is fine to keep).
- **Fullscreen** toggle for the screen viewport.

---

## Backend conversion service (`api`)

- Single endpoint, e.g. `POST /convert`
  - Accepts: multipart upload of the recorded `.webm` blob + a `format`
    field (`mp4` | `mov` | `gif` | `mkv` | `webm` passthrough, etc).
  - Runs `ffmpeg` to transcode to the requested format. For `gif`,
    generate a proper palette first (`palettegen`/`paletteuse`) rather
    than a naive direct conversion, or output quality will be poor.
  - Returns the converted file as the response body with correct
    `Content-Type` and `Content-Disposition` for download.
  - Cleans up temp files after the response completes (or via a periodic
    sweep — either is fine, just don't let temp files accumulate
    indefinitely).
- No auth, no rate limiting required for a homelab/single-user context,
  but do validate the uploaded file is actually a video and cap upload
  size sensibly (e.g. reject anything absurd like >500MB) to avoid
  choking the container on a mistaken upload.
- Runs in a container with `ffmpeg` installed (`ffmpeg` apt/apk package
  or a base image that already bundles it).

---

## Docker Compose

```yaml
services:
  web:
    build: ./web
    ports:
      - "8383:80"
    depends_on:
      - api
    restart: unless-stopped

  api:
    build: ./api
    ports:
      - "8384:3000"   # adjust to whatever internal port the service uses
    restart: unless-stopped
```

Frontend should call the api service by a configurable base URL (env var
baked in at build time, or a runtime-configurable JS constant) so it's
not hardcoded to `localhost` — this needs to work when reverse-proxied
under a domain too.

---

## Explicitly out of scope

- Vector (independent X/Y) speed controls
- Gravity, drift, acceleration, damping
- Preset save/load system
- Multi-monitor support or OS-level screensaver packaging (.scr, xscreensaver, etc.)
- Auth, user accounts, persistence/history of past exports
- Audio track generation

---

## Acceptance checks

- Uploading a PNG with a large transparent margin bounces off the
  *visible* logo edges, not the padded canvas edges.
- Changing size mid-playback doesn't let the logo clip off-screen or
  teleport oddly — bounds recompute and clamp correctly.
- Same seed + same size + same aspect ratio + same speed reproduces the
  same path on repeated runs.
- Loop resets seamlessly at the configured loop length with no visible
  jump/stutter.
- Corner-hit counter only increments on genuine simultaneous X+Y
  collisions, not on every bounce.
- Export produces a file in the selected format that plays correctly and
  matches the on-screen preview's path and duration.
- Toggling CRT effects off removes scanline/vignette/glow rendering
  entirely, including from exported video.
- With 2 logos and collision enabled, they visibly deflect off each
  other rather than overlapping/passing through.
