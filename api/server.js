const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB, per spec
const TEMP_DIR = path.join(os.tmpdir(), "dvd-screensaver");
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const MAX_TEMP_AGE_MS = 60 * 60 * 1000; // 1 hour

const ALLOWED_FORMATS = new Set(["mp4", "mov", "gif", "mkv", "webm"]);

const CONTENT_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  gif: "image/gif",
  mkv: "video/x-matroska",
  webm: "video/webm",
};

fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.webm`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

function probeHasVideoStream(filePath) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0 && out.trim().startsWith("video")));
  });
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch (_) {
    // already gone / never created — fine
  }
}

async function convert(inputPath, format, outputPath) {
  if (format === "gif") {
    const palettePath = outputPath.replace(/\.gif$/, ".palette.png");
    try {
      await runFfmpeg([
        "-i", inputPath,
        "-vf", "fps=15,scale='min(iw,720)':-1:flags=lanczos,palettegen",
        palettePath,
      ]);
      await runFfmpeg([
        "-i", inputPath,
        "-i", palettePath,
        "-lavfi",
        "fps=15,scale='min(iw,720)':-1:flags=lanczos[x];[x][1:v]paletteuse",
        outputPath,
      ]);
    } finally {
      await safeUnlink(palettePath);
    }
    return;
  }

  if (format === "webm") {
    // Passthrough — the browser already recorded webm, no transcode needed.
    await fsp.copyFile(inputPath, outputPath);
    return;
  }

  const codecArgs = {
    mp4: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
    mov: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
    mkv: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
  }[format];

  await runFfmpeg(["-i", inputPath, ...codecArgs, "-an", outputPath]);
}

const app = express();
app.use(cors());

app.post("/convert", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ error: err.message });
    }

    const file = req.file;
    const format = String(req.body.format || "").toLowerCase();

    if (!file) {
      return res.status(400).json({ error: "Missing 'file' upload." });
    }
    if (!ALLOWED_FORMATS.has(format)) {
      await safeUnlink(file.path);
      return res.status(400).json({ error: `Unsupported format '${format}'.` });
    }

    const hasVideo = await probeHasVideoStream(file.path);
    if (!hasVideo) {
      await safeUnlink(file.path);
      return res.status(400).json({ error: "Uploaded file is not a valid video." });
    }

    const outputPath = path.join(TEMP_DIR, `${path.parse(file.filename).name}-out.${format}`);

    try {
      await convert(file.path, format, outputPath);

      res.setHeader("Content-Type", CONTENT_TYPES[format]);
      res.setHeader("Content-Disposition", `attachment; filename="dvd-screensaver.${format}"`);

      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      stream.on("close", async () => {
        await safeUnlink(file.path);
        await safeUnlink(outputPath);
      });
      stream.on("error", async (streamErr) => {
        console.error("Stream error:", streamErr);
        await safeUnlink(file.path);
        await safeUnlink(outputPath);
        if (!res.headersSent) res.status(500).end();
      });
    } catch (convertErr) {
      console.error("Conversion failed:", convertErr);
      await safeUnlink(file.path);
      await safeUnlink(outputPath);
      if (!res.headersSent) {
        res.status(500).json({ error: "Conversion failed." });
      }
    }
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));

// Safety-net sweep in case a request is interrupted before cleanup runs.
setInterval(async () => {
  try {
    const entries = await fsp.readdir(TEMP_DIR);
    const now = Date.now();
    for (const entry of entries) {
      const entryPath = path.join(TEMP_DIR, entry);
      const stat = await fsp.stat(entryPath).catch(() => null);
      if (stat && now - stat.mtimeMs > MAX_TEMP_AGE_MS) {
        await safeUnlink(entryPath);
      }
    }
  } catch (sweepErr) {
    console.error("Temp sweep failed:", sweepErr);
  }
}, SWEEP_INTERVAL_MS).unref();

app.listen(PORT, () => {
  console.log(`dvd-screensaver api listening on :${PORT}`);
});
