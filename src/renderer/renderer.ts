let currentImageId: string | undefined;
let currentMaskBase64: string | undefined;
let originalDetectedMaskBase64: string | undefined;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const detectBtn = document.getElementById("detect-btn") as HTMLButtonElement;
const inpaintBtn = document.getElementById("inpaint-btn") as HTMLButtonElement;
const captionBtn = document.getElementById("caption-btn") as HTMLButtonElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const preview = document.getElementById("preview") as HTMLImageElement;
const captionText = document.getElementById("caption-text") as HTMLTextAreaElement;
const captionStatus = document.getElementById("caption-status") as HTMLSpanElement;

const maskCanvas = document.getElementById("mask-canvas") as HTMLCanvasElement;
const brushAddBtn = document.getElementById("brush-add-btn") as HTMLButtonElement;
const brushEraseBtn = document.getElementById("brush-erase-btn") as HTMLButtonElement;
const brushSize = document.getElementById("brush-size") as HTMLInputElement;
const brushSizeVal = document.getElementById("brush-size-val") as HTMLSpanElement;
const clearMaskBtn = document.getElementById("clear-mask-btn") as HTMLButtonElement;
const resetMaskBtn = document.getElementById("reset-mask-btn") as HTMLButtonElement;

const formatSelect = document.getElementById("format-select") as HTMLSelectElement;
const qualityContainer = document.getElementById("quality-container") as HTMLDivElement;
const qualityRange = document.getElementById("quality-range") as HTMLInputElement;
const qualityVal = document.getElementById("quality-val") as HTMLSpanElement;
const losslessContainer = document.getElementById("lossless-container") as HTMLDivElement;
const losslessCheckbox = document.getElementById("lossless-checkbox") as HTMLInputElement;
const compressContainer = document.getElementById("compress-container") as HTMLDivElement;
const compressSelect = document.getElementById("compress-select") as HTMLSelectElement;
const flattenContainer = document.getElementById("flatten-container") as HTMLDivElement;
const flattenColor = document.getElementById("flatten-color") as HTMLInputElement;
const metadataSelect = document.getElementById("metadata-select") as HTMLSelectElement;

let brushMode: "add" | "erase" = "add";
let isDrawing = false;
let lastX = 0;
let lastY = 0;

const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d")!;
const visibleCtx = maskCanvas.getContext("2d")!;

function updateExportUi() {
  const format = formatSelect.value;
  if (format === "png") {
    compressContainer.style.display = "flex";
    qualityContainer.style.display = "none";
    losslessContainer.style.display = "none";
    flattenContainer.style.display = "none";
  } else if (format === "jpeg") {
    compressContainer.style.display = "none";
    qualityContainer.style.display = "flex";
    losslessContainer.style.display = "none";
    flattenContainer.style.display = "flex";
  } else if (format === "webp") {
    compressContainer.style.display = "none";
    qualityContainer.style.display = "flex";
    losslessContainer.style.display = "flex";
    flattenContainer.style.display = "none";
  }
}

formatSelect.addEventListener("change", updateExportUi);
qualityRange.addEventListener("input", () => {
  qualityVal.textContent = qualityRange.value;
});
losslessCheckbox.addEventListener("change", () => {
  qualityRange.disabled = losslessCheckbox.checked;
});

brushSize.addEventListener("input", () => {
  brushSizeVal.textContent = brushSize.value;
});

brushAddBtn.addEventListener("click", () => {
  brushMode = "add";
  brushAddBtn.style.borderColor = "var(--accent-color)";
  brushEraseBtn.style.borderColor = "transparent";
});

brushEraseBtn.addEventListener("click", () => {
  brushMode = "erase";
  brushEraseBtn.style.borderColor = "var(--accent-color)";
  brushAddBtn.style.borderColor = "transparent";
});

function syncVisibleCanvas() {
  if (offscreenCanvas.width === 0 || offscreenCanvas.height === 0) return;
  maskCanvas.width = preview.clientWidth;
  maskCanvas.height = preview.clientHeight;
  visibleCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  visibleCtx.save();
  visibleCtx.drawImage(offscreenCanvas, 0, 0, maskCanvas.width, maskCanvas.height);
  visibleCtx.globalCompositeOperation = "source-in";
  visibleCtx.fillStyle = "rgba(255, 0, 0, 0.5)";
  visibleCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  visibleCtx.restore();
}

function loadMaskToOffscreen(base64Png: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      offscreenCanvas.width = img.naturalWidth;
      offscreenCanvas.height = img.naturalHeight;
      offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      offscreenCtx.drawImage(img, 0, 0);
      syncVisibleCanvas();
      maskCanvas.style.display = "block";
      resolve();
    };
    img.src = `data:image/png;base64,${base64Png}`;
  });
}

function getOffscreenCoords(e: PointerEvent): { x: number; y: number } {
  const rect = maskCanvas.getBoundingClientRect();
  const scaleX = offscreenCanvas.width / rect.width;
  const scaleY = offscreenCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function drawStroke(x1: number, y1: number, x2: number, y2: number) {
  const radius = (parseInt(brushSize.value, 10) / 2) * (offscreenCanvas.width / maskCanvas.clientWidth);
  offscreenCtx.save();
  offscreenCtx.lineCap = "round";
  offscreenCtx.lineJoin = "round";
  offscreenCtx.lineWidth = radius * 2;

  if (brushMode === "add") {
    offscreenCtx.globalCompositeOperation = "source-over";
    offscreenCtx.strokeStyle = "#FFFFFF";
    offscreenCtx.fillStyle = "#FFFFFF";
  } else {
    offscreenCtx.globalCompositeOperation = "destination-out";
  }

  offscreenCtx.beginPath();
  offscreenCtx.moveTo(x1, y1);
  offscreenCtx.lineTo(x2, y2);
  offscreenCtx.stroke();
  offscreenCtx.beginPath();
  offscreenCtx.arc(x2, y2, radius, 0, Math.PI * 2);
  offscreenCtx.fill();
  offscreenCtx.restore();
}

async function exportOffscreenMask(): Promise<string> {
  const dataUrl = offscreenCanvas.toDataURL("image/png");
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  currentMaskBase64 = base64;
  if (currentImageId) {
    await window.api.updateMask(currentImageId, base64);
  }
  return base64;
}

maskCanvas.addEventListener("pointerdown", (e) => {
  if (offscreenCanvas.width === 0) return;
  isDrawing = true;
  maskCanvas.setPointerCapture(e.pointerId);
  const coords = getOffscreenCoords(e);
  lastX = coords.x;
  lastY = coords.y;
  drawStroke(lastX, lastY, lastX, lastY);
  syncVisibleCanvas();
});

maskCanvas.addEventListener("pointermove", (e) => {
  if (!isDrawing) return;
  const coords = getOffscreenCoords(e);
  drawStroke(lastX, lastY, coords.x, coords.y);
  lastX = coords.x;
  lastY = coords.y;
  syncVisibleCanvas();
});

const endDrawing = async (e: PointerEvent) => {
  if (!isDrawing) return;
  isDrawing = false;
  try {
    maskCanvas.releasePointerCapture(e.pointerId);
  } catch {}
  await exportOffscreenMask();
};

maskCanvas.addEventListener("pointerup", endDrawing);
maskCanvas.addEventListener("pointercancel", endDrawing);

clearMaskBtn.addEventListener("click", async () => {
  offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  syncVisibleCanvas();
  await exportOffscreenMask();
});

resetMaskBtn.addEventListener("click", async () => {
  if (originalDetectedMaskBase64) {
    await loadMaskToOffscreen(originalDetectedMaskBase64);
    await exportOffscreenMask();
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { imageId, previewBase64 } = await window.api.importImage(buffer);
  currentImageId = imageId;
  currentMaskBase64 = undefined;
  originalDetectedMaskBase64 = undefined;
  maskCanvas.style.display = "none";
  offscreenCanvas.width = 0;
  offscreenCanvas.height = 0;

  if (previewBase64) {
    preview.src = `data:image/png;base64,${previewBase64}`;
  } else {
    preview.src = URL.createObjectURL(file);
  }
  detectBtn.disabled = false;
  captionBtn.disabled = false;
  exportBtn.disabled = false;
  inpaintBtn.disabled = true;
  captionText.value = "";
  captionStatus.textContent = "";
});

preview.addEventListener("load", () => {
  syncVisibleCanvas();
});
window.addEventListener("resize", () => {
  syncVisibleCanvas();
});

detectBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  detectBtn.disabled = true;
  detectBtn.innerHTML = '<span class="spinner"></span> Detecting...';
  try {
    const { maskBase64 } = await window.api.detect(currentImageId);
    currentMaskBase64 = maskBase64;
    originalDetectedMaskBase64 = maskBase64;
    await loadMaskToOffscreen(maskBase64);
    inpaintBtn.disabled = false;
  } finally {
    detectBtn.disabled = false;
    detectBtn.textContent = "Detect Watermark";
  }
});

inpaintBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  inpaintBtn.disabled = true;
  inpaintBtn.innerHTML = '<span class="spinner"></span> Removing...';
  try {
    const { resultBase64 } = await window.api.inpaint(currentImageId, currentMaskBase64);
    preview.src = `data:image/png;base64,${resultBase64}`;
    maskCanvas.style.display = "none";
  } finally {
    inpaintBtn.disabled = false;
    inpaintBtn.textContent = "Remove Watermark";
  }
});

captionBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  captionBtn.disabled = true;
  captionStatus.innerHTML = '<span class="spinner"></span> Generating caption...';
  try {
    const { caption } = await window.api.captionImage(currentImageId);
    if (caption) {
      captionText.value = caption;
      captionStatus.textContent = "Generated";
    } else {
      captionText.value = "";
      captionStatus.textContent = "Captioning failed or refused";
    }
  } catch (err) {
    captionStatus.textContent = "Captioning error";
  } finally {
    captionBtn.disabled = false;
  }
});


exportBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  await window.api.exportImage(currentImageId, {
    format: formatSelect.value,
    quality: parseInt(qualityRange.value, 10),
    lossless: losslessCheckbox.checked,
    compressLevel: parseInt(compressSelect.value, 10),
    metadataMode: metadataSelect.value,
    flattenColor: flattenColor.value,
    caption: captionText.value,
  });
});

updateExportUi();



