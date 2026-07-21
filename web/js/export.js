// Recording (canvas -> webm via MediaRecorder) + upload to the `api`
// conversion service + triggering the browser download.

const EXPORT_FPS = 30;

function pickRecorderMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

// Records exactly `durationSeconds` of the canvas, starting immediately.
// Caller is responsible for having reset animation state to the seed's
// initial state before calling this, so the recorded clip matches what
// a fresh loop preview looks like.
function recordCanvasClip(canvas, durationSeconds) {
  return new Promise((resolve, reject) => {
    if (!window.MediaRecorder) {
      reject(new Error("MediaRecorder is not supported in this browser."));
      return;
    }
    const stream = canvas.captureStream(EXPORT_FPS);
    const mimeType = pickRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => reject(e.error || new Error("Recording failed"));
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationSeconds * 1000);
  });
}

function filenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? match[1] : fallback;
}

async function convertOnServer(apiBaseUrl, webmBlob, format) {
  const formData = new FormData();
  formData.append("file", webmBlob, "capture.webm");
  formData.append("format", format);

  const res = await fetch(`${apiBaseUrl}/convert`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch (_) {}
    throw new Error(`Conversion failed (${res.status}): ${detail || res.statusText}`);
  }

  const blob = await res.blob();
  const filename = filenameFromDisposition(
    res.headers.get("Content-Disposition"),
    `dvd-screensaver.${format}`
  );
  return { blob, filename };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Full export pipeline. `onStatus(text)` receives short human-readable
// progress messages for the UI.
async function runExportPipeline({ canvas, durationSeconds, format, apiBaseUrl, onStatus }) {
  onStatus("recording...");
  const webmBlob = await recordCanvasClip(canvas, durationSeconds);

  if (format === "webm") {
    onStatus("done");
    triggerDownload(webmBlob, "dvd-screensaver.webm");
    return;
  }

  onStatus("converting...");
  const { blob, filename } = await convertOnServer(apiBaseUrl, webmBlob, format);
  onStatus("done");
  triggerDownload(blob, filename);
}
