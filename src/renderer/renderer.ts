// Sidecar Status Listener
const sidecarStatusPill = document.getElementById("sidecar-status-pill") as HTMLDivElement;
const sidecarStatusText = document.getElementById("sidecar-status-text") as HTMLSpanElement;

if (window.api && window.api.onSidecarStateChange) {
  window.api.onSidecarStateChange((state: string) => {
    sidecarStatusPill.className = "status-pill";
    if (state === "ready" || state === "online") {
      sidecarStatusPill.classList.add("status-online");
      sidecarStatusText.textContent = "GPU Sidecar: Online";
    } else if (state === "starting" || state === "restarting") {
      sidecarStatusPill.classList.add("status-starting");
      sidecarStatusText.textContent = `GPU Sidecar: ${state.charAt(0).toUpperCase() + state.slice(1)}...`;
    } else {
      sidecarStatusPill.classList.add("status-offline");
      sidecarStatusText.textContent = `GPU Sidecar: ${state.charAt(0).toUpperCase() + state.slice(1)}`;
    }
  });
}

// Titlebar controls
const winMin = document.getElementById("win-min") as HTMLButtonElement;
const winMax = document.getElementById("win-max") as HTMLButtonElement;
const winClose = document.getElementById("win-close") as HTMLButtonElement;

winMin.addEventListener("click", () => window.api.minimizeWindow());
winMax.addEventListener("click", () => window.api.maximizeWindow());
winClose.addEventListener("click", () => window.api.closeWindow());


// Mode Switcher Tabs
const tabSingle = document.getElementById("tab-single") as HTMLButtonElement;
const tabBulk = document.getElementById("tab-bulk") as HTMLButtonElement;
const singleView = document.getElementById("single-view") as HTMLDivElement;
const bulkView = document.getElementById("bulk-view") as HTMLDivElement;

tabSingle.addEventListener("click", () => {
  tabSingle.classList.add("active");
  tabBulk.classList.remove("active");
  singleView.style.display = "flex";
  bulkView.style.display = "none";
});

tabBulk.addEventListener("click", () => {
  tabBulk.classList.add("active");
  tabSingle.classList.remove("active");
  bulkView.style.display = "flex";
  singleView.style.display = "none";
});

// Bulk Processing State & Elements
const bulkInputBtn = document.getElementById("bulk-input-btn") as HTMLButtonElement;
const bulkInputPath = document.getElementById("bulk-input-path") as HTMLSpanElement;
const bulkOutputBtn = document.getElementById("bulk-output-btn") as HTMLButtonElement;
const bulkOutputPath = document.getElementById("bulk-output-path") as HTMLSpanElement;

const bulkRemoveWatermark = document.getElementById("bulk-remove-watermark") as HTMLInputElement;
const bulkGenerateCaptions = document.getElementById("bulk-generate-captions") as HTMLInputElement;
const bulkPromptContainer = document.getElementById("bulk-prompt-container") as HTMLDivElement;
const bulkSystemPrompt = document.getElementById("bulk-system-prompt") as HTMLTextAreaElement;

bulkGenerateCaptions.addEventListener("change", () => {
  bulkPromptContainer.style.display = bulkGenerateCaptions.checked ? "block" : "none";
});

const bulkStartBtn = document.getElementById("bulk-start-btn") as HTMLButtonElement;
const bulkCancelBtn = document.getElementById("bulk-cancel-btn") as HTMLButtonElement;


const progressBarFill = document.getElementById("progress-bar-fill") as HTMLDivElement;
const bulkProgressText = document.getElementById("bulk-progress-text") as HTMLSpanElement;
const bulkLogBox = document.getElementById("bulk-log-box") as HTMLDivElement;

let selectedInputFolder: string | undefined;
let selectedOutputFolder: string | undefined;
let isBulkRunning = false;
let isBulkCancelled = false;

function updateBulkStartButton() {
  bulkStartBtn.disabled = !(selectedInputFolder && selectedOutputFolder && !isBulkRunning);
}

function appendBulkLog(msg: string) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  bulkLogBox.appendChild(line);
  bulkLogBox.scrollTop = bulkLogBox.scrollHeight;
}

bulkInputBtn.addEventListener("click", async () => {
  const { folderPath } = await window.api.selectFolder();
  if (folderPath) {
    selectedInputFolder = folderPath;
    bulkInputPath.textContent = folderPath;
    appendBulkLog(`Input folder set to: ${folderPath}`);
    updateBulkStartButton();
  }
});

bulkOutputBtn.addEventListener("click", async () => {
  const { folderPath } = await window.api.selectFolder();
  if (folderPath) {
    selectedOutputFolder = folderPath;
    bulkOutputPath.textContent = folderPath;
    appendBulkLog(`Output folder set to: ${folderPath}`);
    updateBulkStartButton();
  }
});

bulkStartBtn.addEventListener("click", async () => {
  if (!selectedInputFolder || !selectedOutputFolder || isBulkRunning) return;

  isBulkRunning = true;
  isBulkCancelled = false;
  bulkStartBtn.disabled = true;
  bulkCancelBtn.style.display = "inline-block";
  bulkLogBox.innerHTML = "";
  progressBarFill.style.width = "0%";

  try {
    appendBulkLog("Scanning input folder for images...");
    const { files } = await window.api.listImagesInFolder(selectedInputFolder);

    if (files.length === 0) {
      appendBulkLog("No supported image files (.png, .jpg, .webp) found in input folder.");
      bulkProgressText.textContent = "No images found.";
      return;
    }

    appendBulkLog(`Found ${files.length} images. Starting batch processing...`);
    let processedCount = 0;

    for (const file of files) {
      if (isBulkCancelled) {
        appendBulkLog("Bulk processing cancelled by user.");
        bulkProgressText.textContent = `Cancelled at ${processedCount}/${files.length}`;
        break;
      }

      const inputPath = `${selectedInputFolder}/${file}`;
      bulkProgressText.textContent = `Processing (${processedCount + 1}/${files.length}): ${file}`;
      appendBulkLog(`Processing: ${file}...`);

      try {
        await window.api.processBulkItem({
          inputPath,
          outputFolder: selectedOutputFolder,
          autoRemoveWatermark: bulkRemoveWatermark.checked,
          generateCaption: bulkGenerateCaptions.checked,
          format: formatSelect.value,
          quality: parseInt(qualityRange.value, 10),
          lossless: losslessCheckbox.checked,
          compressLevel: parseInt(compressSelect.value, 10),
          metadataMode: metadataSelect.value,
          flattenColor: flattenColor.value,
          systemPrompt: bulkSystemPrompt.value,
        });

        processedCount++;
        const pct = Math.round((processedCount / files.length) * 100);
        progressBarFill.style.width = `${pct}%`;
        appendBulkLog(`Done: ${file}`);
      } catch (err) {
        appendBulkLog(`ERROR processing ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!isBulkCancelled) {
      appendBulkLog(`Batch processing complete! ${processedCount}/${files.length} images exported successfully.`);
      bulkProgressText.textContent = `Complete: ${processedCount}/${files.length} images processed`;
    }
  } finally {
    isBulkRunning = false;
    bulkCancelBtn.style.display = "none";
    updateBulkStartButton();
  }
});

bulkCancelBtn.addEventListener("click", () => {
  isBulkCancelled = true;
  appendBulkLog("Cancelling after current item...");
});

// Pan & Zoom Controls
const previewContainer = document.getElementById("preview-container") as HTMLDivElement;
const previewWrapper = document.getElementById("preview-wrapper") as HTMLDivElement;
const resetZoomBtn = document.getElementById("reset-zoom-btn") as HTMLButtonElement;
const zoomVal = document.getElementById("zoom-val") as HTMLSpanElement;

let zoomScale = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let spacePressed = false;

function updatePreviewTransform() {
  previewWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  zoomVal.textContent = `${Math.round(zoomScale * 100)}%`;
}

function resetZoomAndPan() {
  zoomScale = 1.0;
  panX = 0;
  panY = 0;
  updatePreviewTransform();
}

resetZoomBtn.addEventListener("click", resetZoomAndPan);
previewContainer.addEventListener("dblclick", resetZoomAndPan);

// Mousewheel Zooming
previewContainer.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    e.preventDefault();
    const rect = previewContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY < 0 ? 1.15 : 0.87;
    const newScale = Math.min(Math.max(0.5, zoomScale * delta), 5.0);

    panX = mouseX - (mouseX - panX) * (newScale / zoomScale);
    panY = mouseY - (mouseY - panY) * (newScale / zoomScale);
    zoomScale = newScale;

    updatePreviewTransform();
  },
  { passive: false }
);

// Pan Drag Controls
window.addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    !spacePressed &&
    document.activeElement?.tagName !== "TEXTAREA" &&
    document.activeElement?.tagName !== "INPUT"
  ) {
    spacePressed = true;
    previewContainer.style.cursor = "grab";
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spacePressed = false;
    previewContainer.style.cursor = "default";
  }
});

previewContainer.addEventListener("pointerdown", (e: PointerEvent) => {
  if (e.button === 1 || e.button === 2 || spacePressed) {
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    previewContainer.style.cursor = "grabbing";
    previewContainer.setPointerCapture(e.pointerId);
  }
});

previewContainer.addEventListener("pointermove", (e: PointerEvent) => {
  if (isPanning) {
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    updatePreviewTransform();
  }
});

const stopPan = (e: PointerEvent) => {
  if (isPanning) {
    isPanning = false;
    previewContainer.style.cursor = spacePressed ? "grab" : "default";
    try {
      previewContainer.releasePointerCapture(e.pointerId);
    } catch {}
  }
};

previewContainer.addEventListener("pointerup", stopPan);
previewContainer.addEventListener("pointercancel", stopPan);
previewContainer.addEventListener("contextmenu", (e) => e.preventDefault());

// Single Image Editor State
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
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const redoBtn = document.getElementById("redo-btn") as HTMLButtonElement;
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


const undoStack: ImageData[] = [];
const redoStack: ImageData[] = [];
const MAX_HISTORY = 30;

function updateHistoryButtons() {
  undoBtn.disabled = undoStack.length <= 1;
  redoBtn.disabled = redoStack.length === 0;
}

function saveHistoryState() {
  if (offscreenCanvas.width === 0 || offscreenCanvas.height === 0) return;
  const state = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  undoStack.push(state);
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack.length = 0;
  updateHistoryButtons();
}

function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  updateHistoryButtons();
}

async function performUndo() {
  if (undoStack.length <= 1) return;
  const currentState = undoStack.pop()!;
  redoStack.push(currentState);
  const previousState = undoStack[undoStack.length - 1]!;
  offscreenCtx.putImageData(previousState, 0, 0);
  syncVisibleCanvas();
  await exportOffscreenMask();
  updateHistoryButtons();
}

async function performRedo() {
  if (redoStack.length === 0) return;
  const nextState = redoStack.pop()!;
  undoStack.push(nextState);
  offscreenCtx.putImageData(nextState, 0, 0);
  syncVisibleCanvas();
  await exportOffscreenMask();
  updateHistoryButtons();
}

undoBtn.addEventListener("click", performUndo);
redoBtn.addEventListener("click", performRedo);

window.addEventListener("keydown", async (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "z" || e.key === "Z") {
      if (e.shiftKey) {
        e.preventDefault();
        await performRedo();
      } else {
        e.preventDefault();
        await performUndo();
      }
    } else if (e.key === "y" || e.key === "Y") {
      e.preventDefault();
      await performRedo();
    }
  }
});

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
      
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const tempCtx = tempCanvas.getContext("2d")!;
      tempCtx.drawImage(img, 0, 0);
      const imgData = tempCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
      const data = imgData.data;

      const offscreenData = offscreenCtx.createImageData(img.naturalWidth, img.naturalHeight);
      const offData = offscreenData.data;
      for (let i = 0; i < data.length; i += 4) {
        const val = data[i] ?? 0;
        if (val > 128) {
          offData[i] = 255;
          offData[i + 1] = 255;
          offData[i + 2] = 255;
          offData[i + 3] = 255;
        } else {
          offData[i] = 0;
          offData[i + 1] = 0;
          offData[i + 2] = 0;
          offData[i + 3] = 0;
        }
      }
      offscreenCtx.putImageData(offscreenData, 0, 0);
      syncVisibleCanvas();
      maskCanvas.style.display = "block";
      clearHistory();
      saveHistoryState();
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
  const width = offscreenCanvas.width;
  const height = offscreenCanvas.height;
  if (width === 0 || height === 0) return "";

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d")!;

  const srcData = offscreenCtx.getImageData(0, 0, width, height);
  const dstData = tempCtx.createImageData(width, height);

  for (let i = 0; i < srcData.data.length; i += 4) {
    const alpha = srcData.data[i + 3] ?? 0;
    if (alpha > 128) {
      dstData.data[i] = 255;
      dstData.data[i + 1] = 255;
      dstData.data[i + 2] = 255;
      dstData.data[i + 3] = 255;
    } else {
      dstData.data[i] = 0;
      dstData.data[i + 1] = 0;
      dstData.data[i + 2] = 0;
      dstData.data[i + 3] = 255;
    }
  }

  tempCtx.putImageData(dstData, 0, 0);

  const dataUrl = tempCanvas.toDataURL("image/png");
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
  saveHistoryState();
};

maskCanvas.addEventListener("pointerup", endDrawing);
maskCanvas.addEventListener("pointercancel", endDrawing);

clearMaskBtn.addEventListener("click", async () => {
  offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
  syncVisibleCanvas();
  await exportOffscreenMask();
  saveHistoryState();
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
  resetZoomAndPan();
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

const systemPromptInput = document.getElementById("system-prompt-input") as HTMLTextAreaElement;

captionBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  captionBtn.disabled = true;
  captionStatus.innerHTML = '<span class="spinner"></span> Generating caption...';
  try {
    const { caption } = await window.api.captionImage(currentImageId, systemPromptInput.value);
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



