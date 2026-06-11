import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const renderDir = join(__dirname, "renders");
const port = Number(process.env.PORT || 4173);
const renderJobs = new Map();
mkdirSync(renderDir, { recursive: true });

const ffmpegCandidates = [
  "ffmpeg",
  join(
    homedir(),
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages",
    "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "ffmpeg-8.1.1-full_build",
    "bin",
    "ffmpeg.exe",
  ),
  join(homedir(), "AppData", "Local", "CapCut", "Apps", "7.5.0.3053", "ffmpeg.exe"),
  join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
];

const ytdlpCandidates = [
  "yt-dlp",
  join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "yt-dlp.exe"),
  join(homedir(), "AppData", "Local", "Packages", "PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0", "LocalCache", "local-packages", "Python312", "Scripts", "yt-dlp.exe"),
  "/usr/local/bin/yt-dlp",
  "/usr/bin/yt-dlp",
];
const ytJobs = new Map();

async function resolveYtDlp() {
  const { access } = await import("node:fs/promises");
  for (const bin of ytdlpCandidates) {
    if (bin === "yt-dlp") {
      // Try PATH lookup
      try {
        await new Promise((resolve, reject) => {
          const p = spawn(process.platform === "win32" ? "where" : "which", ["yt-dlp"]);
          p.on("close", (code) => (code === 0 ? resolve() : reject()));
        });
        return "yt-dlp";
      } catch { continue; }
    }
    try { await access(bin); return bin; } catch { /* next */ }
  }
  return null;
}

function formatCount(n) {
  if (!n) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${n}`;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function ffmpegHeaders() {
  return [
    "Referer: https://www.facebook.com/",
    "Origin: https://www.facebook.com",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  ].join("\r\n");
}

function canRunFfmpeg(candidate) {
  return new Promise((resolve) => {
    if (candidate !== "ffmpeg" && !existsSync(candidate)) {
      resolve(false);
      return;
    }
    const child = spawn(candidate, ["-version"], { windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function resolveFfmpeg() {
  for (const candidate of ffmpegCandidates) {
    if (await canRunFfmpeg(candidate)) return candidate;
  }
  return "";
}

async function checkFfmpeg() {
  return Boolean(await resolveFfmpeg());
}

function safeRenderJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    speed: job.speed || "",
    downloadPath: job.status === "done" ? `/api/render-file?id=${encodeURIComponent(job.id)}` : "",
  };
}

function parseTimeToSeconds(value) {
  const match = String(value).match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function startRender(body) {
  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    return {
      error: "FFmpeg is not installed. Install FFmpeg first, then restart this app.",
      installHint: "Run scripts/install-ffmpeg.ps1 or install Gyan.FFmpeg with winget.",
    };
  }

  const inputUrl = normalizeUrl(body.url || "");
  if (!inputUrl) return { error: "Render source URL is invalid." };

  const type = body.type === "mp3" ? "mp3" : "mp4";
  const width = Number(body.width || 0);
  const duration = Number(body.duration || 0);
  const id = randomUUID();
  const output = join(renderDir, `${id}.${type}`);
  const args = ["-y", "-hide_banner", "-nostdin", "-headers", ffmpegHeaders(), "-i", inputUrl];

  if (type === "mp3") {
    args.push("-vn", "-codec:a", "libmp3lame", "-b:a", "192k", output);
  } else {
    if (width > 0) args.push("-vf", `scale=${width}:-2:flags=fast_bilinear`);
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "fastdecode",
      "-crf",
      "24",
      "-threads",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      output,
    );
  }

  const job = {
    id,
    status: "running",
    progress: 0,
    message: "Rendering...",
    duration,
    speed: "",
    output,
    type,
  };
  renderJobs.set(id, job);

  const ffmpegPath = await resolveFfmpeg();
  const child = spawn(ffmpegPath, args, { windowsHide: true });
  job.child = child;

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    const durationMatch = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
    if (durationMatch && !job.duration) {
      job.duration = parseTimeToSeconds(durationMatch[1]);
    }
    const timeMatch = text.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
    if (timeMatch && job.duration > 0) {
      job.progress = Math.min(99, Math.max(1, Math.round((parseTimeToSeconds(timeMatch[1]) / job.duration) * 100)));
    }
    const speedMatch = text.match(/speed=\s*([^\s]+)/);
    if (speedMatch) job.speed = speedMatch[1];
    job.message = job.speed ? `Rendering... ${job.speed}` : "Rendering...";
  });

  child.on("error", (error) => {
    job.status = "error";
    job.message = error.message;
  });

  child.on("exit", (code) => {
    if (code === 0 && existsSync(output)) {
      job.status = "done";
      job.progress = 100;
      job.message = "Render complete";
    } else {
      job.status = "error";
      job.message = "Render failed. The source link may be expired or blocked by the CDN.";
    }
  });

  return { job: safeRenderJob(job) };
}

function collectBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Source is too large. Please paste a smaller page source."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function fetchPublicPageSource(rawUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      reject(new Error("Invalid URL"));
      return;
    }

    if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) {
      reject(new Error("Only public http/https URLs are allowed"));
      return;
    }

    const client = target.protocol === "https:" ? httpsRequest : httpRequest;
    const isMobileFacebook = target.hostname.toLowerCase() === "m.facebook.com";
    const upstream = client(
      target,
      {
        method: "GET",
        headers: {
          "user-agent": isMobileFacebook
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
          "accept-encoding": "identity",
          "cache-control": "no-cache",
          pragma: "no-cache",
          referer: isMobileFacebook ? "https://m.facebook.com/" : "https://www.facebook.com/",
        },
      },
      (upstreamRes) => {
        if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode || 0) && upstreamRes.headers.location) {
          upstreamRes.resume();
          if (redirects >= 5) {
            reject(new Error("Too many redirects"));
            return;
          }
          fetchPublicPageSource(new URL(upstreamRes.headers.location, target).toString(), redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if ((upstreamRes.statusCode || 500) >= 400) {
          upstreamRes.resume();
          reject(new Error(`Source server returned ${upstreamRes.statusCode || 500}`));
          return;
        }

        let size = 0;
        const limit = 16 * 1024 * 1024;
        const chunks = [];
        upstreamRes.on("data", (chunk) => {
          size += chunk.length;
          if (size > limit) {
            upstreamRes.destroy(new Error("Fetched source is too large"));
            return;
          }
          chunks.push(chunk);
        });
        upstreamRes.on("end", () => {
          const source = Buffer.concat(chunks).toString("utf8");
          if (source.trim().length < 50) {
            reject(new Error("Source page was empty"));
            return;
          }
          resolve({
            source,
            finalUrl: target.toString(),
            contentType: upstreamRes.headers["content-type"] || "",
          });
        });
        upstreamRes.on("error", reject);
      },
    );

    upstream.setTimeout(15000, () => upstream.destroy(new Error("Source fetch timed out")));
    upstream.on("error", reject);
    upstream.end();
  });
}

function isFacebookHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch";
}

function toMobileFacebookUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    if (!isFacebookHost(target.hostname)) return "";
    target.hostname = "m.facebook.com";
    return target.toString();
  } catch {
    return "";
  }
}

function decodeRepeatedly(value) {
  let current = String(value);
  for (let i = 0; i < 5; i += 1) {
    const previous = current;
    current = current
      .replace(/\\u0025/g, "%")
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x2F;/gi, "/");
    try {
      current = decodeURIComponent(current);
    } catch {
      // Some page sources contain partial percent escapes. Keep the best decode.
    }
    if (current === previous) break;
  }
  return current;
}

function inferType(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".mp3") || lower.includes("audio") || lower.includes("mime=audio")) return "audio";
  if (lower.includes(".m3u8")) return "stream";
  return "video";
}

function inferQualityInfo(url, label = "") {
  const text = `${label} ${url}`.toLowerCase();
  const dimensionMatch = text.match(/(?:^|[^0-9])([1-9][0-9]{2,4})x([1-9][0-9]{2,4})(?:[^0-9]|$)/);
  const height = dimensionMatch ? Math.min(Number(dimensionMatch[1]), Number(dimensionMatch[2])) : 0;
  const width = dimensionMatch ? Math.max(Number(dimensionMatch[1]), Number(dimensionMatch[2])) : 0;

  if (text.includes("4k") || text.includes("2160") || height >= 2160) {
    return { quality: "4K", score: 2160, width, height };
  }
  if (text.includes("2k") || text.includes("1440") || height >= 1440) {
    return { quality: "2K", score: 1440, width, height };
  }
  if (text.includes("1080") || text.includes("hd_src") || text.includes("native_hd") || height >= 1080) {
    return { quality: "1080p/HD", score: 1080, width, height };
  }
  if (text.includes("720") || height >= 720) return { quality: "720p", score: 720, width, height };
  if (text.includes("480") || height >= 480) return { quality: "480p", score: 480, width, height };
  if (text.includes("360") || text.includes("sd_src") || height >= 360) {
    return { quality: "360p/SD", score: 360, width, height };
  }
  return { quality: "Unknown", score: 0, width, height };
}

function normalizeUrl(candidate) {
  const decoded = decodeRepeatedly(candidate)
    .replace(/\\n/g, "")
    .replace(/\\/g, "")
    .trim();
  try {
    const url = new URL(decoded);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function htmlDecode(value) {
  return decodeRepeatedly(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function matchMeta(source, names) {
  for (const name of names) {
    const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const contentFirstPattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const propertyMatch = source.match(propertyPattern) || source.match(contentFirstPattern);
    if (propertyMatch?.[1]) return htmlDecode(propertyMatch[1]);
  }
  return "";
}

function formatDuration(value) {
  if (!value) return "";
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return htmlDecode(value);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function cleanTitleCandidate(value) {
  const unicodeDecoded = String(value).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return htmlDecode(unicodeDecoded)
    .replace(/\\n/g, " ")
    .replace(/\\+"/g, '"')
    .replace(/\\(?=[\u0e00-\u0e7f])/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s*ดูเพิ่มเติม\s*$/i, "")
    .replace(/\s*see more\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericTitle(value) {
  const normalized = value.toLowerCase();
  return (
    !value ||
    value.length < 4 ||
    normalized === "facebook video" ||
    normalized === "facebook" ||
    normalized.includes("log in") ||
    normalized.includes("เข้าสู่ระบบ") ||
    normalized.includes("comments") ||
    normalized.includes("notifications")
  );
}

function titleScore(value) {
  const hasThai = /[\u0e00-\u0e7f]/.test(value);
  const hasLessonMarker = /\b(part|ep|episode)\b|ตอน|มือใหม่|เริ่มต้น/i.test(value);
  const lengthScore = Math.min(value.length, 120);
  return (hasThai ? 120 : 0) + (hasLessonMarker ? 80 : 0) + lengthScore;
}

function cleanPostTitleCandidate(value) {
  const unicodeDecoded = String(value).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  const decoded = htmlDecode(unicodeDecoded)
    .replace(/\\n/g, "\n")
    .replace(/\\+"/g, '"')
    .replace(/\\(?=[\u0e00-\u0e7f])/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s*ดูเพิ่มเติม\s*$/i, "")
    .replace(/\s*see more\s*$/i, "")
    .trim();

  const lines = decoded
    .split(/\r?\n|\\n/)
    .map((line) => line.replace(/https?:\/\/\S+/gi, "").replace(/\\+$/g, "").replace(/^\\+/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return (lines.find((line) => !isGenericPostTitle(line)) || lines[0] || decoded).replace(/\s+/g, " ").trim();
}

function isGenericPostTitle(value) {
  const normalized = value.toLowerCase();
  return (
    !value ||
    value.length < 4 ||
    normalized === "facebook video" ||
    normalized === "facebook" ||
    normalized.includes("log in") ||
    normalized.includes("เข้าสู่ระบบ") ||
    normalized.includes("comments") ||
    normalized.includes("notifications") ||
    /^https?:\/\//i.test(value)
  );
}

function postTitleScore(value) {
  const hasThai = /[\u0e00-\u0e7f]/.test(value);
  const startsLikeTitle = /^(part|ep|episode|ตอน)\s*[\wก-๙]/i.test(value);
  const hasLessonMarker = /\b(part|ep|episode)\b|ตอน|มือใหม่|เริ่มต้น/i.test(value);
  const hasUrl = /https?:\/\//i.test(value);
  const lengthScore = Math.min(value.length, 120);
  return (startsLikeTitle ? 180 : 0) + (hasThai ? 120 : 0) + (hasLessonMarker ? 80 : 0) + lengthScore - (hasUrl ? 120 : 0);
}

function scorePostTitle(value) {
  const hasThai = /[\u0e00-\u0e7f]/.test(value);
  const startsLikeLesson = /^(part|ep|episode)\b|^ตอน\s*\d/i.test(value);
  const looksLikeReelCaption = /คลิป|ย้อนหลัง|storyboard|รีล|reel|ครับ|ค่ะ|คะ/i.test(value);
  const hasUrl = /https?:\/\//i.test(value);
  const tooLong = value.length > 160;
  const lengthScore = Math.min(value.length, 120);
  return (
    (startsLikeLesson ? 220 : 0) +
    (looksLikeReelCaption ? 180 : 0) +
    (hasThai ? 120 : 0) +
    lengthScore -
    (hasUrl ? 180 : 0) -
    (tooLong ? 80 : 0)
  );
}

function extractSourceTitle(source) {
  const candidates = [];
  const titleSource = source.replace(/\\"/g, '"');
  const readableTitleSource = titleSource
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\(?=[\u0e00-\u0e7f])/g, "");
  const addCandidate = (value) => {
    const cleaned = cleanPostTitleCandidate(value);
    if (!isGenericPostTitle(cleaned)) candidates.push(cleaned);
  };

  const patterns = [
    /"message"\s*:\s*\{\s*"text"\s*:\s*"([^"]{4,280})"/gi,
    /"title"\s*:\s*\{\s*"text"\s*:\s*"([^"]{4,220})"/gi,
    /"text"\s*:\s*"([^"]{4,220})"\s*,\s*"ranges"\s*:\s*\[/gi,
    /"name"\s*:\s*"([^"]{4,180})"/gi,
  ];

  addCandidate(matchMeta(titleSource, ["og:description", "twitter:description", "description"]));
  for (const pattern of patterns) {
    for (const match of titleSource.matchAll(pattern)) addCandidate(match[1]);
  }
  for (const match of readableTitleSource.matchAll(/((?:Part|EP|Episode|ตอน)\s*[0-9A-Za-zก-๙ .:_-]{2,120})/gi)) {
    addCandidate(match[1]);
  }

  for (const match of readableTitleSource.matchAll(/((?:คลิป|ย้อนหลัง|storyboard|รีล|Reel)[^"<>]{2,140}(?:ครับ|ค่ะ|คะ)?)/gi)) {
    addCandidate(match[1]);
  }

  return [...new Set(candidates)].sort((a, b) => scorePostTitle(b) - scorePostTitle(a))[0] || "";
}

function cleanReadableTitle(value) {
  const unicodeDecoded = String(value).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  const decoded = htmlDecode(unicodeDecoded)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\(?=[\u0e00-\u0e7f])/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s*ดูเพิ่มเติม\s*$/i, "")
    .replace(/\s*see more\s*$/i, "")
    .trim();

  const line = decoded
    .split(/\r?\n|\\n/)
    .map((item) => item.replace(/https?:\/\/\S+/gi, "").replace(/\\+$/g, "").replace(/^\\+/g, "").replace(/\s+/g, " ").trim())
    .find((item) => item.length >= 4 && !isGenericReadableTitle(item));
  return (line || decoded).replace(/\s+/g, " ").trim();
}

function isGenericReadableTitle(value) {
  const normalized = value.toLowerCase();
  return (
    !value ||
    value.length < 4 ||
    normalized === "facebook video" ||
    normalized === "facebook" ||
    normalized.includes("เข้าสู่ระบบ") ||
    normalized.includes("log in") ||
    normalized.includes("comments") ||
    normalized.includes("notifications") ||
    /^https?:\/\//i.test(value)
  );
}

function scoreTitleCandidate(candidate, isReel) {
  const value = candidate.value;
  const hasThai = /[\u0e00-\u0e7f]/.test(value);
  const startsLikeLesson = /^(part|ep|episode)\b|^ตอน\s*\d|^บทที่\s*\d/i.test(value);
  const reelCaption = /คลิป|ย้อนหลัง|storyboard|รีล|reel|ครับ|ค่ะ|คะ/i.test(value);
  const likelyPostCaption = /storyboard|part\s*\d|บทที่\s*\d|อัพเดท|อัพเดต|อัปเดท|อัปเดต|สรุป\s*\d+|ทำเพจ|แปะลิ้งก์|แปะลิงก์|แปะลิ้งค์|แปะลิงค์|สิ่งที่ควรรู้|นายหน้า\s*ai/i.test(value);
  const likelyClipOverlay = /จาก\s*พี่เขา|ชอร์ต|shorts?|reels?|วิดีโอสั้น|สูตร|สวยงาม/i.test(value);
  const hasUrl = /https?:\/\//i.test(value);
  const tooLong = value.length > 140;
  const kindBoost = {
    post: isReel ? 260 : 620,
    message: isReel ? 560 : 360,
    description: isReel ? 460 : 240,
    reel: isReel ? 180 : 160,
    text: 80,
    title: isReel ? -80 : 40,
    name: -80,
  }[candidate.kind] || 0;
  return (
    kindBoost +
    (startsLikeLesson ? 240 : 0) +
    (likelyPostCaption ? 260 : 0) +
    (reelCaption ? 260 : 0) +
    (hasThai ? 120 : 0) +
    Math.min(value.length, 120) -
    (hasUrl ? 180 : 0) -
    (tooLong ? 100 : 0) -
    (likelyClipOverlay ? 320 : 0)
  );
}

function extractBestTitle(source, pageUrl = "") {
  const isReel = /\/reel\/|\/reels\//i.test(pageUrl);
  const titleSource = source.replace(/\\"/g, '"');
  const readableSource = titleSource
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\(?=[\u0e00-\u0e7f])/g, "");
  const candidates = [];
  const add = (kind, value) => {
    const cleaned = cleanReadableTitle(value);
    if (!isGenericReadableTitle(cleaned)) candidates.push({ kind, value: cleaned });
  };

  add("description", matchMeta(titleSource, ["og:description", "twitter:description", "description"]));

  const patterns = [
    ["message", /"message"\s*:\s*\{\s*"text"\s*:\s*"([^"]{4,500})"/gi],
    ["message", /"message"\s*:\s*"([^"]{4,500})"/gi],
    ["title", /"title"\s*:\s*\{\s*"text"\s*:\s*"([^"]{4,260})"/gi],
    ["text", /"text"\s*:\s*"([^"]{4,260})"\s*,\s*"ranges"\s*:\s*\[/gi],
    ["name", /"name"\s*:\s*"([^"]{4,220})"/gi],
  ];

  for (const [kind, pattern] of patterns) {
    for (const match of titleSource.matchAll(pattern)) add(kind, match[1]);
  }

  for (const match of readableSource.matchAll(/(บทที่\s*\d+[^\r\n"<>]{2,160})/gi)) {
    add("post", match[1]);
  }
  for (const match of readableSource.matchAll(/((?:สิ่งที่ควรรู้|นายหน้า\s*AI)[^\r\n"<>]{2,160})/gi)) {
    add("post", match[1]);
  }
  for (const match of readableSource.matchAll(/(\(?\s*(?:อัพเดท|อัพเดต|อัปเดท|อัปเดต)\s*\d{4}\s*\)?[^\r\n"<>]{2,180})/gi)) {
    add("post", match[1]);
  }
  for (const match of readableSource.matchAll(/(สรุป\s*\d+[^\r\n"<>]{0,100}(?:เทคนิค|ทำเพจ|แปะลิ้งก์|แปะลิงก์|แปะลิ้งค์|แปะลิงค์)[^\r\n"<>]{0,120})/gi)) {
    add("post", match[1]);
  }
  for (const match of readableSource.matchAll(/((?:ทำเพจ|แปะลิ้งก์|แปะลิงก์|แปะลิ้งค์|แปะลิงค์)[^\r\n"<>]{0,120})/gi)) {
    add("post", match[1]);
  }
  for (const match of readableSource.matchAll(/((?:Part|EP|Episode|ตอน)\s*[0-9A-Za-zก-๙ .:_-]{2,140})/gi)) {
    add("reel", match[1]);
  }
  for (const match of readableSource.matchAll(/((?:คลิป|ย้อนหลัง|storyboard|รีล|Reel)[^"<>]{2,160}(?:ครับ|ค่ะ|คะ)?)/gi)) {
    add("reel", match[1]);
  }

  const unique = [...new Map(candidates.map((item) => [item.value, item])).values()];
  return unique.sort((a, b) => scoreTitleCandidate(b, isReel) - scoreTitleCandidate(a, isReel))[0]?.value || "";
}

function extractMetadata(source, pageUrl = "") {
  const title =
    extractBestTitle(source, pageUrl) ||
    extractSourceTitle(source) ||
    matchMeta(source, ["og:title", "twitter:title", "title"]) ||
    htmlDecode(source.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "") ||
    "Facebook Video";
  const thumbnail = normalizeUrl(matchMeta(source, ["og:image", "twitter:image", "thumbnail"])) || "";
  const duration = formatDuration(matchMeta(source, ["video:duration", "duration", "og:video:duration"]));

  return { title, thumbnail, duration };
}

function mediaKey(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.toLowerCase();
}

function labelPriority(label) {
  const normalized = label.toLowerCase();
  if (normalized.includes("native hd") || normalized.includes("quality hd") || normalized.includes("hd src")) return 3;
  if (normalized.includes("playable")) return 2;
  if (normalized.includes("sd src")) return 1;
  return 0;
}

function isPrimaryMediaLabel(label) {
  const normalized = label.toLowerCase();
  return (
    normalized.includes("native hd") ||
    normalized.includes("native sd") ||
    normalized.includes("quality hd") ||
    normalized.includes("hd src") ||
    normalized.includes("sd src") ||
    normalized.includes("playable")
  );
}

function facebookExpiry(parsedUrl) {
  const oe = parsedUrl.searchParams.get("oe");
  if (!oe || !/^[0-9a-f]+$/i.test(oe)) return null;

  const seconds = Number.parseInt(oe, 16);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function isFacebookCdn(parsedUrl) {
  return parsedUrl.hostname.includes("fbcdn.net") || parsedUrl.hostname.includes("facebook.com");
}

function facebookUrlHealth(parsedUrl) {
  if (!isFacebookCdn(parsedUrl)) {
    return { temporary: false, usable: true, reason: "" };
  }

  const hasExpiry = parsedUrl.searchParams.has("oe");
  const hasSignature = parsedUrl.searchParams.has("oh") || parsedUrl.searchParams.has("_nc_ohc");

  if (!hasExpiry) {
    return {
      temporary: true,
      usable: false,
      reason: "Skipped as best: Facebook CDN link has no timestamp. Re-copy fresh page source.",
    };
  }

  if (!hasSignature) {
    return {
      temporary: true,
      usable: false,
      reason: "Skipped as best: Facebook CDN link is missing signature parameters.",
    };
  }

  return { temporary: true, usable: true, reason: "" };
}

function makeMediaItem(item, index) {
  const parsed = new URL(item.url);
  const type = inferType(item.url);
  const qualityInfo = inferQualityInfo(item.url, item.label);
  const path = parsed.pathname.toLowerCase();
  const expiresAt = facebookExpiry(parsed);
  const expired = expiresAt ? expiresAt.getTime() <= Date.now() : false;
  const health = facebookUrlHealth(parsed);

  return {
    id: index + 1,
    url: item.url,
    label: item.label.replace(/_/g, " "),
    type,
    quality: qualityInfo.quality,
    qualityScore: qualityInfo.score,
    width: qualityInfo.width,
    height: qualityInfo.height,
    host: parsed.hostname,
    extension: path.includes(".mp3") ? "mp3" : path.includes(".m3u8") ? "m3u8" : "mp4",
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired,
    temporary: health.temporary,
    usable: health.usable && !expired,
    invalidReason: expired ? "Expired temporary link. Re-copy a fresh page source." : health.reason,
    duplicateCount: 1,
    recommended: false,
    note: "",
  };
}

function compareMedia(a, b) {
  const typeScore = (item) => (item.type === "video" ? 2 : item.type === "audio" ? 1 : 0);
  return (
    typeScore(b) - typeScore(a) ||
    Number(b.usable) - Number(a.usable) ||
    Number(a.expired) - Number(b.expired) ||
    labelPriority(b.label) - labelPriority(a.label) ||
    b.qualityScore - a.qualityScore ||
    a.id - b.id
  );
}

function consolidateMedia(items) {
  const grouped = new Map();

  for (const item of items) {
    const key = mediaKey(item.url);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, item);
      continue;
    }

    existing.duplicateCount += 1;
    if (compareMedia(existing, item) > 0) {
      item.duplicateCount = existing.duplicateCount;
      grouped.set(key, item);
    }
  }

  const unique = [...grouped.values()].sort(compareMedia).map((item, index) => ({
    ...item,
    id: index + 1,
  }));

  const primaryVideos = unique.filter((item) => item.type === "video" && item.usable && isPrimaryMediaLabel(item.label));
  const recommended =
    primaryVideos.find((item) => item.qualityScore > 0) ||
    primaryVideos[0] ||
    null;
  if (recommended) {
    recommended.recommended = true;
    recommended.note = recommended.qualityScore
      ? "Recommended: best usable video link"
      : "Recommended: usable video link, but quality could not be detected";
  }

  for (const item of unique) {
    if (!item.note && item.invalidReason) item.note = item.invalidReason;
    if (!item.note && item.duplicateCount > 1) item.note = `Grouped ${item.duplicateCount} duplicate links`;
    if (!item.note && item.label.toLowerCase().includes("direct media")) item.note = "Filtered: page-level media, not trusted as the main video";
    if (!item.note && item.quality === "Unknown") item.note = "Use only if recommended download fails";
    if (!item.note && item.temporary) item.note = "Temporary CDN link. Open or save it soon after analyzing.";
  }

  return unique;
}

function extractMedia(source, pageUrl = "") {
  const decodedSource = decodeRepeatedly(source);
  const found = new Map();

  const labeledPatterns = [
    /"(hd_src|sd_src|browser_native_hd_url|browser_native_sd_url|playable_url|playable_url_quality_hd|dash_manifest)"\s*:\s*"([^"]+)"/gi,
    /(?:hd_src|sd_src|browser_native_hd_url|browser_native_sd_url|playable_url|playable_url_quality_hd)=["']([^"']+)["']/gi,
  ];

  for (const pattern of labeledPatterns) {
    for (const match of decodedSource.matchAll(pattern)) {
      const label = match.length === 3 ? match[1] : "media";
      const raw = match.length === 3 ? match[2] : match[1];
      const url = normalizeUrl(raw);
      if (url) found.set(url, { url, label });
    }
  }

  const directUrlPattern = /https?:\\?\/\\?\/[^"'<>\s]+?(?:\.mp4|\.m3u8|\.mp3)(?:\?[^"'<>\s]*)?/gi;
  for (const match of decodedSource.matchAll(directUrlPattern)) {
    const url = normalizeUrl(match[0]);
    if (url && !found.has(url)) found.set(url, { url, label: "direct media" });
  }

  const items = [...found.values()].map(makeMediaItem);
  return {
    meta: extractMetadata(decodedSource, pageUrl),
    totalFound: items.length,
    items: consolidateMedia(items),
  };
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function proxyDownload(req, res, rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    sendJson(res, 400, { error: "Invalid URL" });
    return;
  }

  if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) {
    sendJson(res, 400, { error: "Only public http/https URLs are allowed" });
    return;
  }

  const client = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = client(
    target,
    {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        accept: "*/*",
        "accept-language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
        referer: "https://www.facebook.com/",
        origin: "https://www.facebook.com",
        range: req.headers.range || "bytes=0-",
      },
    },
    (upstreamRes) => {
      if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode || 0) && upstreamRes.headers.location) {
        upstreamRes.resume();
        proxyDownload(req, res, new URL(upstreamRes.headers.location, target).toString());
        return;
      }

      if ((upstreamRes.statusCode || 500) >= 400) {
        sendJson(res, upstreamRes.statusCode || 502, { error: "The source server did not allow the download" });
        upstreamRes.resume();
        return;
      }

      const extension = target.pathname.toLowerCase().includes(".mp3") ? "mp3" : "mp4";
      const filename = `download-${Date.now()}.${extension}`;
      res.writeHead(200, {
        ...corsHeaders(),
        "content-type": upstreamRes.headers["content-type"] || "application/octet-stream",
        "content-length": upstreamRes.headers["content-length"] || undefined,
        "content-disposition": `attachment; filename="${filename}"`,
      });
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", () => {
    if (!res.headersSent) sendJson(res, 502, { error: "Could not connect to the source URL" });
  });
  req.on("close", () => upstream.destroy());
  upstream.end();
}

function redirectToDownload(res, rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    sendJson(res, 400, { error: "Invalid URL" });
    return;
  }

  if (!["http:", "https:"].includes(target.protocol) || isBlockedHost(target.hostname)) {
    sendJson(res, 400, { error: "Only public http/https URLs are allowed" });
    return;
  }

  res.writeHead(302, { ...corsHeaders(), location: target.toString() });
  res.end();
}

function serveRenderFile(res, id) {
  const job = renderJobs.get(id);
  if (!job || job.status !== "done" || !existsSync(job.output)) {
    sendJson(res, 404, { error: "Rendered file is not ready." });
    return;
  }

  const size = statSync(job.output).size;
  const filename = `render-${id}.${job.type}`;
  res.writeHead(200, {
    ...corsHeaders(),
    "content-type": job.type === "mp3" ? "audio/mpeg" : "video/mp4",
    "content-length": size,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  });
  createReadStream(job.output).pipe(res);
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicDir, decodeURIComponent(requested)));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, {
    ...corsHeaders(),
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
  });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/source") {
      const body = JSON.parse(await collectBody(req, 1024 * 1024));
      const pageUrl = `${body.pageUrl || ""}`.trim();
      if (!pageUrl) {
        sendJson(res, 400, { error: "Please enter a URL first" });
        return;
      }

      try {
        let fetched;
        try {
          fetched = await fetchPublicPageSource(pageUrl);
        } catch (error) {
          const mobileUrl = toMobileFacebookUrl(pageUrl);
          if (!mobileUrl || mobileUrl === pageUrl) throw error;
          fetched = await fetchPublicPageSource(mobileUrl);
        }
        sendJson(res, 200, {
          ok: true,
          source: fetched.source,
          finalUrl: fetched.finalUrl,
          contentType: fetched.contentType,
          fetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        sendJson(res, 502, {
          error: "Could not fetch page source automatically. Please open view-source in your browser and paste it manually.",
          detail: error.message,
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/extract") {
      const body = JSON.parse(await collectBody(req));
      const source = `${body.source || ""}`;
      if (source.trim().length < 50) {
        sendJson(res, 400, { error: "Please paste the page HTML/source first" });
        return;
      }
      sendJson(res, 200, extractMedia(source, `${body.pageUrl || ""}`));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        app: "LumaVault Studio",
        render: Boolean(await resolveFfmpeg()),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/download") {
      redirectToDownload(res, url.searchParams.get("url") || "");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/render") {
      const body = JSON.parse(await collectBody(req, 1024 * 1024));
      const result = await startRender(body);
      if (result.error) {
        sendJson(res, 503, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/render-status") {
      const job = renderJobs.get(url.searchParams.get("id") || "");
      if (!job) {
        sendJson(res, 404, { error: "Render job not found." });
        return;
      }
      sendJson(res, 200, { job: safeRenderJob(job) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/render-file") {
      serveRenderFile(res, url.searchParams.get("id") || "");
      return;
    }

    // ── YouTube: fetch info via yt-dlp ──────────────────────
    if (req.method === "POST" && url.pathname === "/api/yt-info") {
      const body = JSON.parse(await collectBody(req, 1024 * 1024));
      const ytUrl = `${body.url || ""}`.trim();
      if (!ytUrl.startsWith("http")) {
        sendJson(res, 400, { error: "กรุณาใส่ YouTube URL ที่ถูกต้อง" });
        return;
      }
      const ytdlp = await resolveYtDlp();
      if (!ytdlp) {
        sendJson(res, 503, { error: "yt-dlp ไม่ได้ติดตั้งในเซิร์ฟเวอร์นี้ กรุณาติดตั้ง yt-dlp ก่อน (pip install yt-dlp)" });
        return;
      }
      try {
        const info = await new Promise((resolve, reject) => {
          const proc = spawn(ytdlp, ["--dump-json", "--no-playlist", "--no-check-certificate", "--socket-timeout", "30", ytUrl]);
          let out = "";
          let err = "";
          proc.stdout.on("data", (d) => (out += d));
          proc.stderr.on("data", (d) => (err += d));
          proc.on("close", (code) => {
            if (code !== 0) { reject(new Error((err.trim().split("\n").pop() || "yt-dlp failed").slice(-300))); return; }
            try { resolve(JSON.parse(out)); } catch { reject(new Error("Invalid yt-dlp output")); }
          });
        });

        const rawFormats = (info.formats || []).filter((f) => f.url && f.ext !== "mhtml");
        const videoHeights = [...new Set(
          rawFormats.filter((f) => f.vcodec && f.vcodec !== "none" && f.height).map((f) => f.height),
        )];
        const maxH = Math.max(0, ...videoHeights);
        const heightOptions = [2160, 1440, 1080, 720, 480, 360, 240, 144];
        const qualityLabels = { 2160: "4K 2160p", 1440: "2K 1440p", 1080: "Full HD 1080p", 720: "HD 720p", 480: "SD 480p", 360: "360p", 240: "240p", 144: "144p" };
        const formats = heightOptions
          .filter((h) => maxH > 0 && h <= maxH)
          .map((h) => ({ id: `${h}`, quality: qualityLabels[h] || `${h}p`, ext: "mp4", size: null, fps: 0, height: h, type: "mp4" }));

        const bestAudio = rawFormats
          .filter((f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none")
          .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
        formats.push({ id: "audio", quality: `Audio Only${bestAudio?.abr ? ` ${Math.round(bestAudio.abr)}k` : ""}`, ext: "mp3", size: bestAudio?.filesize || null, fps: 0, height: 0, type: "mp3" });

        let contentType = "video";
        if (info.is_live) contentType = "live";
        else if (info.duration && info.duration <= 60 && (info.webpage_url || "").includes("/shorts/")) contentType = "shorts";

        const dur = info.duration || 0;
        const durationStr = dur > 0
          ? `${Math.floor(dur / 3600) > 0 ? `${Math.floor(dur / 3600)}:` : ""}${String(Math.floor((dur % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(dur % 60)).padStart(2, "0")}`
          : "";

        const thumbs = info.thumbnails || [];
        const thumbnail = info.thumbnail || (thumbs.length ? thumbs[thumbs.length - 1].url : "");

        sendJson(res, 200, {
          ok: true,
          meta: {
            title: info.title || "YouTube Video",
            channel: info.channel || info.uploader || "",
            duration: durationStr,
            thumbnail,
            contentType,
            viewCount: formatCount(info.view_count),
            uploadDate: info.upload_date
              ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
              : "",
          },
          formats,
        });
      } catch (error) {
        sendJson(res, 502, { error: error.message || "yt-dlp failed" });
      }
      return;
    }

    // ── YouTube: start download job ──────────────────────────
    if (req.method === "POST" && url.pathname === "/api/yt-render") {
      const body = JSON.parse(await collectBody(req, 1024 * 1024));
      const ytUrl    = `${body.url || ""}`.trim();
      const formatId = `${body.formatId || ""}`.trim();
      const outType  = body.type === "mp3" ? "mp3" : "mp4";
      if (!ytUrl.startsWith("http") || !formatId) {
        sendJson(res, 400, { error: "Missing url or formatId" });
        return;
      }
      const ytdlp = await resolveYtDlp();
      if (!ytdlp) {
        sendJson(res, 503, { error: "yt-dlp ไม่ได้ติดตั้งในเซิร์ฟเวอร์นี้" });
        return;
      }
      const id     = randomUUID();
      const output = join(renderDir, `${id}.${outType}`);
      const job    = { id, status: "running", progress: 0, message: "กำลังเตรียมดาวน์โหลด...", output, type: outType, downloadPath: `/api/yt-file?id=${id}` };
      ytJobs.set(id, job);

      let fmtStr;
      if (outType === "mp3" || formatId === "audio") {
        fmtStr = "bestaudio/best";
      } else {
        const h = parseInt(formatId);
        fmtStr = !isNaN(h)
          ? `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`
          : "bestvideo+bestaudio/best";
      }

      const args = outType === "mp3"
        ? ["-f", fmtStr, "-x", "--audio-format", "mp3", "-o", output, "--no-playlist", "--no-check-certificate", "--socket-timeout", "30", ytUrl]
        : ["-f", fmtStr, "--merge-output-format", "mp4", "-o", output, "--no-playlist", "--no-check-certificate", "--socket-timeout", "30", ytUrl];

      const proc = spawn(ytdlp, args);
      proc.stdout.on("data", (d) => {
        const line = `${d}`;
        const m = line.match(/(\d+\.?\d*)%/);
        if (m) job.progress = Math.min(99, Math.round(Number(m[1])));
        const s = line.match(/at\s+([\d.]+\s*\w+\/s)/i);
        if (s) job.message = `Downloading ${s[1]}`;
      });
      proc.stderr.on("data", (d) => { job.message = `${d}`.trim().slice(-120); });
      proc.on("close", (code) => {
        if (code === 0 && existsSync(output)) { job.status = "done"; job.progress = 100; job.message = "เสร็จสิ้น"; }
        else { job.status = "error"; job.message = job.message || "yt-dlp ล้มเหลว"; }
      });

      sendJson(res, 200, { job: { id: job.id, status: job.status } });
      return;
    }

    // ── YouTube: poll status ─────────────────────────────────
    if (req.method === "GET" && url.pathname === "/api/yt-status") {
      const job = ytJobs.get(url.searchParams.get("id") || "");
      if (!job) { sendJson(res, 404, { error: "Job not found" }); return; }
      sendJson(res, 200, { job: { id: job.id, status: job.status, progress: job.progress, message: job.message, downloadPath: job.status === "done" ? job.downloadPath : undefined } });
      return;
    }

    // ── YouTube: serve downloaded file ───────────────────────
    if (req.method === "GET" && url.pathname === "/api/yt-file") {
      const job = ytJobs.get(url.searchParams.get("id") || "");
      if (!job || job.status !== "done" || !existsSync(job.output)) {
        sendJson(res, 404, { error: "File not ready" });
        return;
      }
      const size = statSync(job.output).size;
      res.writeHead(200, {
        ...corsHeaders(),
        "content-type": job.type === "mp3" ? "audio/mpeg" : "video/mp4",
        "content-length": size,
        "content-disposition": `attachment; filename="youtube-${job.id}.${job.type}"`,
        "cache-control": "no-store",
      });
      createReadStream(job.output).pipe(res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected error" });
  }
});

server.listen(port, () => {
  console.log(`Private Media Downloader is running at http://localhost:${port}`);
});
