const form = document.querySelector("#extractForm");
const pageUrl = document.querySelector("#pageUrl");
const sourceUrl = document.querySelector("#sourceUrl");
const source = document.querySelector("#source");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const resultPanel = document.querySelector("#resultPanel");
const videoCard = document.querySelector("#videoCard");
const clearBtn = document.querySelector("#clearBtn");
const copySourceUrl = document.querySelector("#copySourceUrl");
const downloadMore = document.querySelector("#downloadMore");
const tabs = [...document.querySelectorAll(".tab")];

let lastPayload = null;
let activeTab = "mp4";

function setStatus(text) {
  statusEl.textContent = text;
}

function updateSourceUrl() {
  const value = pageUrl.value.trim();
  sourceUrl.value = value ? `view-source:${value}` : "";
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

function bestRenderSource(items) {
  return usableVideos(items).sort((a, b) => itemWidth(b) - itemWidth(a))[0] || null;
}

function findDirectQuality(items, target) {
  const videos = usableVideos(items);
  if (target === 720) {
    return (
      videos.find((item) => item.qualityScore === 720 || itemWidth(item) === 1280) ||
      videos.find((item) => item.quality.includes("720"))
    );
  }

  return (
    videos.find((item) => item.qualityScore === 360 || itemWidth(item) === 640) ||
    videos.find((item) => item.quality.includes("360"))
  );
}

function directRow(label, item) {
  return {
    type: item ? "direct" : "missing",
    quality: label,
    render: "เลขที่",
    url: item?.url || "",
    note: item?.expiresAt ? `ลิงก์ชั่วคราว หมดอายุประมาณ ${new Date(item.expiresAt).toLocaleString()}` : "",
  };
}

function renderRow(label, width, sourceItem, outputType = "mp4") {
  return {
    type: "render",
    quality: label,
    render: "ใช่",
    sourceUrl: sourceItem?.url || "",
    width,
    outputType,
    note: sourceItem ? "Render ด้วย FFmpeg จากไฟล์ต้นฉบับที่พบ" : "ไม่มีลิงก์ต้นฉบับที่ใช้ Render ได้",
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
        render: "เลขที่",
        url: audio.url,
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

  videoCard.replaceChildren();

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (image) {
    const img = document.createElement("img");
    img.src = image;
    img.alt = title;
    thumb.append(img);
  } else {
    thumb.textContent = "▶";
  }

  const copy = document.createElement("div");
  copy.className = "video-copy";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const time = document.createElement("span");
  time.textContent = duration || "ไม่พบระยะเวลา";
  copy.append(heading, time);
  videoCard.append(thumb, copy);
}

async function pollRender(jobId, button, note, progressBar) {
  const response = await fetch(`/api/render-status?id=${encodeURIComponent(jobId)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Render status failed");

  const job = payload.job;
  if (job.status === "done") {
    const link = document.createElement("a");
    link.className = "download";
    link.href = job.downloadPath;
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
  note.textContent = job.speed ? `Rendering... ${job.speed}` : job.message;
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
    note.textContent = "ไม่มีลิงก์ต้นฉบับที่ใช้ Render ได้";
    return;
  }

  button.disabled = true;
  button.textContent = "0%";
  note.textContent = "กำลังส่งงานให้ FFmpeg...";
  progressBar.hidden = false;
  progressBar.classList.remove("error");
  progressBar.querySelector("span").style.width = "2%";

  const response = await fetch("/api/render", {
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
      note.textContent = "ไม่พบลิงก์ตรงคุณภาพนี้จาก source";
      actionCell.append(disabled);
    }

    actionCell.append(progress);
    actionCell.append(note);
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
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageUrl: pageUrl.value.trim(),
        source: source.value,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Analyze failed");
    render(payload);
    setStatus((payload.items || []).some(isClientUsable) ? "พบลิงก์" : "ไม่พบลิงก์ที่ใช้ได้");
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

clearBtn.addEventListener("click", () => {
  pageUrl.value = "";
  source.value = "";
  updateSourceUrl();
  resultPanel.hidden = true;
  setStatus("พร้อมใช้งาน");
});

downloadMore.addEventListener("click", () => {
  source.value = "";
  resultPanel.hidden = true;
  source.focus();
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    if (lastPayload) renderRows(lastPayload);
  });
});

updateSourceUrl();
