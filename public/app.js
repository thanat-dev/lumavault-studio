const form = document.querySelector("#extractForm");
const pageUrl = document.querySelector("#pageUrl");
const sourceUrl = document.querySelector("#sourceUrl");
const source = document.querySelector("#source");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const resultPanel = document.querySelector("#resultPanel");
const videoCard = document.querySelector("#videoCard");
const copySourceUrl = document.querySelector("#copySourceUrl");
const fetchSourceButton = document.querySelector("#fetchSource");
const tabs = [...document.querySelectorAll(".tab")];

let lastPayload = null;
let activeTab = "mp4";

const productionApiOrigin = "https://nash1372-lumavault-studio.hf.space";

function apiUrl(path) {
  const isStaticPages = location.hostname.endsWith("github.io");
  return `${isStaticPages ? productionApiOrigin : ""}${path}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateSourceUrl() {
  const value = pageUrl.value.trim();
  sourceUrl.value = value ? `view-source:${value}` : "";
}

async function fetchSourceFromUrl({ silent = false } = {}) {
  updateSourceUrl();
  const value = pageUrl.value.trim();
  if (!value) {
    if (!silent) setStatus("กรุณาใส่ URL ก่อน");
    throw new Error("กรุณาใส่ URL ก่อน");
  }

  if (fetchSourceButton) {
    fetchSourceButton.disabled = true;
    fetchSourceButton.textContent = "กำลังดึง";
  }
  if (!silent) setStatus("กำลังดึง Source");

  try {
    const response = await fetch(apiUrl("/api/source"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageUrl: value }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Fetch source failed");
    source.value = payload.source || "";
    if (!silent) setStatus("ดึง Source อัตโนมัติแล้ว");
    return source.value;
  } catch (error) {
    if (!silent) setStatus("ดึง Source อัตโนมัติไม่ได้");
    throw error;
  } finally {
    if (fetchSourceButton) {
      fetchSourceButton.disabled = false;
      fetchSourceButton.textContent = "ดึง Source";
    }
  }
}

function isClientUsable(item) {
  if (!item.usable) return false;
  if (item.expired) return false;
  if (item.temporary && !item.expiresAt) return false;
  return true;
}

function durationSeconds(value) {
  const match = String(value || "").match(/(?:(\d+):)?(\d+):(\d+)/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function itemWidth(item) {
  if (item.width) return item.width;
  if (item.qualityScore >= 2160) return 3840;
  if (item.qualityScore >= 1440) return 2560;
  if (item.qualityScore >= 1080) return 1920;
  if (item.qualityScore >= 720) return 1280;
  if (item.qualityScore >= 360) return 640;
  return item.qualityScore || 0;
}

function usableVideos(items) {
  return items.filter((item) => item.type === "video" && item.extension === "mp4" && isClientUsable(item));
}

function isPrimaryVideoLabel(item) {
  const label = String(item.label || "").toLowerCase();
  return (
    label.includes("native hd") ||
    label.includes("native sd") ||
    label.includes("quality hd") ||
    label.includes("hd src") ||
    label.includes("sd src") ||
    label.includes("playable")
  );
}

function primaryVideos(items) {
  return usableVideos(items).filter(isPrimaryVideoLabel);
}

function clientLabelPriority(item) {
  const label = String(item.label || "").toLowerCase();
  if (item.recommended) return 100;
  if (label.includes("native hd") || label.includes("quality hd") || label.includes("hd src")) return 80;
  if (label.includes("playable")) return 70;
  if (label.includes("native sd") || label.includes("sd src")) return 60;
  if (label.includes("direct media")) return 10;
  return 20;
}

function mediaConfidence(item) {
  return (
    clientLabelPriority(item) * 1000000 +
    (item.duplicateCount || 1) * 10000 +
    itemWidth(item)
  );
}

function rankedVideos(items) {
  return primaryVideos(items).sort((a, b) => mediaConfidence(b) - mediaConfidence(a));
}

function fallbackVideos(items) {
  return usableVideos(items).sort((a, b) => itemWidth(b) - itemWidth(a));
}

function mainVideoSource(items) {
  return rankedVideos(items)[0] || null;
}

function bestRenderSource(items) {
  return mainVideoSource(items) || fallbackVideos(items)[0] || null;
}

function bestPreviewSource(items) {
  const videos = rankedVideos(items);
  const main = mainVideoSource(items);
  if (main && (main.recommended || clientLabelPriority(main) >= 60)) return main;

  return (
    videos.find((item) => item.qualityScore === 720 || itemWidth(item) === 1280) ||
    videos.find((item) => item.qualityScore === 360 || itemWidth(item) === 640) ||
    bestRenderSource(items)
  );
}

function findDirectQuality(items, target) {
  const videos = rankedVideos(items);
  const fallback = fallbackVideos(items);
  if (target === 720) {
    return (
      videos.find((item) => item.qualityScore === 720 || itemWidth(item) === 1280) ||
      videos.find((item) => item.quality.includes("720")) ||
      fallback.find((item) => item.qualityScore === 720 || itemWidth(item) === 1280) ||
      fallback.find((item) => item.quality.includes("720")) ||
      fallback[0]
    );
  }

  return (
    videos.find((item) => item.qualityScore === 360 || itemWidth(item) === 640) ||
    videos.find((item) => item.quality.includes("360")) ||
    fallback.find((item) => item.qualityScore === 360 || itemWidth(item) === 640) ||
    fallback.find((item) => item.quality.includes("360")) ||
    fallback[0]
  );
}

function primaryVideoStats(items) {
  const allVideos = usableVideos(items);
  const trustedVideos = primaryVideos(items);
  return {
    allVideos: allVideos.length,
    trustedVideos: trustedVideos.length,
    hasTrusted: trustedVideos.length > 0,
  };
}

function createCardButton(label, disabled, onClick) {
  const button = document.createElement("button");
  button.className = "card-action";
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function directRow(label, item) {
  const fallback = item && !isPrimaryVideoLabel(item);
  return {
    type: item ? "direct" : "missing",
    quality: label,
    render: fallback ? "Fallback" : "ลิงก์ตรง",
    url: item?.url || "",
    status: item ? (fallback ? "พร้อมดาวน์โหลดจากตัวอย่าง" : "พร้อมดาวน์โหลด") : "ไม่มีลิงก์ตรง",
    note: item
      ? (fallback ? "ใช้ไฟล์เดียวกับตัวอย่าง เพราะไม่พบลิงก์ตรงคุณภาพนี้" : (item.expiresAt ? `หมดอายุประมาณ ${new Date(item.expiresAt).toLocaleString()}` : ""))
      : "",
  };
}

function renderRow(label, width, sourceItem, outputType = "mp4") {
  return {
    type: "render",
    quality: label,
    render: "Render",
    sourceUrl: sourceItem?.url || "",
    width,
    outputType,
    status: sourceItem ? "พร้อม Render" : "Render ไม่พร้อม",
    note: sourceItem
      ? (isPrimaryVideoLabel(sourceItem) ? "ใช้ FFmpeg จากไฟล์หลักที่พบ" : "ใช้ไฟล์วิดีโอที่พบเป็น fallback สำหรับ Render")
      : "ไม่พบไฟล์ต้นฉบับสำหรับ Render",
  };
}

function buildMp4Rows(items) {
  const sourceItem = bestRenderSource(items);
  return [
    directRow("720p (HD)", findDirectQuality(items, 720)),
    directRow("360p (SD)", findDirectQuality(items, 360)),
    renderRow("1920p", 1920, sourceItem),
    renderRow("1280p", 1280, sourceItem),
    renderRow("960p", 960, sourceItem),
    renderRow("640p", 640, sourceItem),
  ];
}

function buildMp3Rows(items) {
  const audio = items.find((item) => item.type === "audio" && isClientUsable(item));
  if (audio) {
    return [
      {
        type: "direct",
        quality: "MP3",
        render: "ลิงก์ตรง",
        url: audio.url,
        status: "พร้อมดาวน์โหลด",
        note: "",
      },
    ];
  }

  return [renderRow("MP3", 0, bestRenderSource(items), "mp3")];
}

function renderVideoCard(payload) {
  const meta = payload.meta || {};
  const title = meta.title || "Facebook Video";
  const duration = meta.duration || "";
  const image = meta.thumbnail || "";
  const items = payload.items || [];
  const preview = bestPreviewSource(items);
  const sourceItem = bestRenderSource(items);
  const stats = primaryVideoStats(items);

  videoCard.replaceChildren();

  const previewBox = document.createElement("div");
  previewBox.className = "preview-box";

  if (preview?.url) {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.src = preview.url;
    if (image) video.poster = image;
    video.addEventListener("error", () => {
      previewBox.classList.add("preview-fallback");
      if (image) {
        const img = document.createElement("img");
        img.src = image;
        img.alt = title;
        previewBox.replaceChildren(img);
      } else {
        previewBox.textContent = "▶";
      }
    });
    previewBox.append(video);
  } else if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = title;
    previewBox.append(img);
  } else {
    previewBox.classList.add("preview-fallback");
    previewBox.textContent = "▶";
  }

  const copy = document.createElement("div");
  copy.className = "video-copy";
  const heading = document.createElement("strong");
  heading.textContent = title;

  const metaLine = document.createElement("div");
  metaLine.className = "video-meta";
  const durationChip = document.createElement("span");
  durationChip.textContent = duration || "ไม่พบระยะเวลา";
  const qualityChip = document.createElement("span");
  qualityChip.textContent = preview?.quality ? `ตัวอย่าง ${preview.quality}` : "ไม่มีตัวอย่าง";
  const trustedChip = document.createElement("span");
  trustedChip.textContent = stats.hasTrusted ? `วิดีโอหลัก ${stats.trustedVideos} ไฟล์` : "ซ่อนคลิปแทรกแล้ว";
  metaLine.append(durationChip, qualityChip, trustedChip);

  const insight = document.createElement("small");
  insight.textContent = sourceItem
    ? `${isPrimaryVideoLabel(sourceItem) ? "เลือกไฟล์หลัก" : "ใช้ fallback สำหรับ preview/render"} จาก ${sourceItem.label} • พบวิดีโอทั้งหมด ${stats.allVideos} ไฟล์`
    : "ยังไม่พบลิงก์วิดีโอหลักที่เชื่อถือได้จาก source นี้";

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    createCardButton("ดูตัวอย่าง", !preview?.url, () => previewBox.querySelector("video")?.play()),
    createCardButton("ขยายภาพ", !preview?.url && !image, () => previewBox.requestFullscreen?.()),
    createCardButton("เปิดไฟล์หลัก", !sourceItem?.url, () => window.open(sourceItem.url, "_blank", "noopener")),
    createCardButton("คัดลอกลิงก์", !sourceItem?.url, async () => {
      await navigator.clipboard.writeText(sourceItem.url);
      setStatus("คัดลอกลิงก์วิดีโอหลักแล้ว");
    }),
    createCardButton("MP4", false, () => {
      activeTab = "mp4";
      tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === activeTab));
      renderRows(payload);
    }),
    createCardButton("MP3", false, () => {
      activeTab = "mp3";
      tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === activeTab));
      renderRows(payload);
    }),
  );

  copy.append(heading, metaLine, insight, actions);
  videoCard.append(previewBox, copy);
}
async function pollRender(jobId, button, note, progressBar) {
  const response = await fetch(apiUrl(`/api/render-status?id=${encodeURIComponent(jobId)}`));
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Render status failed");

  const job = payload.job;
  if (job.status === "done") {
    const link = document.createElement("a");
    link.className = "download";
    link.href = apiUrl(job.downloadPath);
    link.textContent = "ดาวน์โหลด";
    button.replaceWith(link);
    note.textContent = "Render เสร็จแล้ว";
    progressBar.hidden = false;
    progressBar.querySelector("span").style.width = "100%";
    return;
  }

  if (job.status === "error") {
    button.disabled = false;
    button.textContent = "Render";
    note.textContent = job.message;
    progressBar.classList.add("error");
    return;
  }

  const percent = job.progress || 1;
  button.textContent = `${percent}%`;
  note.textContent = job.speed ? `Rendering ${job.speed}` : job.message;
  progressBar.hidden = false;
  progressBar.querySelector("span").style.width = `${percent}%`;
  setTimeout(() => {
    pollRender(jobId, button, note, progressBar).catch((error) => {
      button.disabled = false;
      button.textContent = "Render";
      note.textContent = error.message;
      progressBar.classList.add("error");
    });
  }, 1200);
}

async function startRender(row, button, note, progressBar) {
  if (!row.sourceUrl) {
    note.textContent = "ไม่พบไฟล์ต้นฉบับสำหรับ Render";
    return;
  }

  button.disabled = true;
  button.textContent = "0%";
  note.textContent = "กำลังส่งงานให้ FFmpeg";
  progressBar.hidden = false;
  progressBar.classList.remove("error");
  progressBar.querySelector("span").style.width = "2%";

  const response = await fetch(apiUrl("/api/render"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: row.sourceUrl,
      type: row.outputType,
      width: row.width,
      duration: durationSeconds(lastPayload?.meta?.duration),
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    button.disabled = false;
    button.textContent = "Render";
    note.textContent = payload.error || "Render failed";
    progressBar.classList.add("error");
    return;
  }

  await pollRender(payload.job.id, button, note, progressBar);
}

function renderRows(payload) {
  const rows = activeTab === "mp4" ? buildMp4Rows(payload.items || []) : buildMp3Rows(payload.items || []);
  resultsEl.replaceChildren();

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = `download-row ${row.type}`;

    const quality = document.createElement("strong");
    quality.textContent = row.quality;

    const render = document.createElement("span");
    render.textContent = row.render;

    const actionCell = document.createElement("div");
    actionCell.className = "action-cell";

    const note = document.createElement("small");
    note.textContent = row.note || "";

    const status = document.createElement("span");
    status.className = `row-status ${row.type}`;
    status.textContent = row.status || "";

    const progress = document.createElement("div");
    progress.className = "render-progress";
    progress.hidden = true;
    const progressFill = document.createElement("span");
    progress.append(progressFill);

    if (row.type === "direct") {
      const link = document.createElement("a");
      link.className = "download";
      link.href = row.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "ดาวน์โหลด";
      actionCell.append(link);
    } else if (row.type === "render") {
      const button = document.createElement("button");
      button.className = "download render";
      button.type = "button";
      button.textContent = "Render";
      button.disabled = !row.sourceUrl;
      button.addEventListener("click", () => {
        startRender(row, button, note, progress).catch((error) => {
          button.disabled = false;
          button.textContent = "Render";
          note.textContent = error.message;
          progress.classList.add("error");
        });
      });
      actionCell.append(button);
    } else {
      const disabled = document.createElement("button");
      disabled.className = "download disabled";
      disabled.type = "button";
      disabled.disabled = true;
      disabled.textContent = "ไม่พบ";
      note.textContent = "ไม่พบลิงก์ตรงคุณภาพนี้";
      actionCell.append(disabled);
    }

    actionCell.append(status, progress, note);
    item.append(quality, render, actionCell);
    resultsEl.append(item);
  }
}

function render(payload) {
  lastPayload = payload;
  resultPanel.hidden = false;
  renderVideoCard(payload);
  renderRows(payload);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  setStatus("กำลังวิเคราะห์");

  try {
    let sourceValue = source.value;
    let autoSourceUsed = false;
    if (sourceValue.trim().length < 50 && pageUrl.value.trim()) {
      try {
        sourceValue = await fetchSourceFromUrl({ silent: true });
        autoSourceUsed = true;
        setStatus("ดึง Source แล้ว กำลังวิเคราะห์");
      } catch {
        throw new Error("ดึง Source อัตโนมัติไม่ได้ สำหรับวิดีโอส่วนตัวให้เปิด view-source แล้ววาง source เอง");
      }
    }

    const response = await fetch(apiUrl("/api/extract"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageUrl: pageUrl.value.trim(),
        source: sourceValue,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Analyze failed");
    if (autoSourceUsed && !(payload.items || []).length) {
      throw new Error("ดึง Source จากลิงก์ได้ แต่ Facebook ไม่ส่งลิงก์วิดีโอให้ server ต้องวาง view-source จากเบราว์เซอร์ที่ล็อกอินแล้ว");
    }
    render(payload);
    setStatus((payload.items || []).some(isClientUsable) ? "พบไฟล์ที่ใช้งานได้" : "ไม่พบไฟล์ที่ดาวน์โหลดได้");
  } catch (error) {
    resultPanel.hidden = false;
    videoCard.replaceChildren();
    resultsEl.innerHTML = `<div class="table-empty">${error.message}</div>`;
    setStatus("เกิดข้อผิดพลาด");
  } finally {
    submit.disabled = false;
  }
});

pageUrl.addEventListener("input", updateSourceUrl);

copySourceUrl.addEventListener("click", async () => {
  updateSourceUrl();
  await navigator.clipboard.writeText(sourceUrl.value);
  setStatus("คัดลอกแล้ว");
});

fetchSourceButton?.addEventListener("click", async () => {
  try {
    await fetchSourceFromUrl();
  } catch (error) {
    resultPanel.hidden = false;
    videoCard.replaceChildren();
    resultsEl.innerHTML = `<div class="table-empty">${error.message}<br>ถ้าเป็นคลิปส่วนตัว ให้เปิด view-source จากเบราว์เซอร์ที่ล็อกอินแล้ววาง Source เอง</div>`;
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    if (lastPayload) renderRows(lastPayload);
  });
});

updateSourceUrl();

