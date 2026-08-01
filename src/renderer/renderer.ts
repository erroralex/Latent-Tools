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

// GPU Telemetry Poller — sidebar mini-card.
const gpuNameText = document.getElementById("gpu-name-text") as HTMLSpanElement;
const gpuVramText = document.getElementById("gpu-vram-text") as HTMLSpanElement;
const gpuVramBarFill = document.getElementById("gpu-vram-bar-fill") as HTMLDivElement;
const gpuTempText = document.getElementById("gpu-temp-text") as HTMLSpanElement;
const gpuNameText2 = document.getElementById("gpu-name-text-2") as HTMLSpanElement | null;
const gpuVramText2 = document.getElementById("gpu-vram-text-2") as HTMLElement | null;
const gpuTempText2 = document.getElementById("gpu-temp-text-2") as HTMLElement | null;

function getVramColor(pct: number): string {
  if (pct >= 89) return "#ff4d4d"; // Red (>= 89%)
  if (pct >= 70) return "#eab308"; // Orange (70% - 88%)
  return "#22c55e"; // Green (< 70%)
}

function getTempColor(temp: number | null): string {
  if (temp === null) return "var(--color-neutral-400)";
  if (temp >= 80) return "#ff4d4d"; // Red (>= 80°C)
  if (temp >= 65) return "#eab308"; // Orange (65°C - 79°C)
  return "#22c55e"; // Green (< 65°C)
}

async function updateGpuStatus() {
  if (!window.api || !window.api.getGpuStatus) return;
  try {
    const gpu = await window.api.getGpuStatus();
    if (gpu.status === "ok") {
      gpuNameText.textContent = gpu.name;
      if (gpuNameText2) gpuNameText2.textContent = gpu.name;

      const pct = Math.round(gpu.vram_pct);
      const vramLabel = `${gpu.vram_used_gb} / ${gpu.vram_total_gb} GB (${pct}%)`;
      const vramColor = getVramColor(pct);
      gpuVramText.textContent = vramLabel;
      gpuVramText.style.color = vramColor;
      if (gpuVramText2) {
        gpuVramText2.textContent = vramLabel;
        gpuVramText2.style.color = vramColor;
      }
      gpuVramBarFill.style.width = `${Math.min(100, pct)}%`;
      gpuVramBarFill.style.background = vramColor;

      const tempColor = getTempColor(gpu.temperature_c);
      const tempLabel = gpu.temperature_c !== null ? `${gpu.temperature_c}°C` : "N/A";
      gpuTempText.textContent = tempLabel;
      gpuTempText.style.color = tempColor;
      if (gpuTempText2) {
        gpuTempText2.textContent = tempLabel;
        gpuTempText2.style.color = tempColor;
      }
    } else {
      const name = gpu.name || "No CUDA GPU Detected";
      gpuNameText.textContent = name;
      if (gpuNameText2) gpuNameText2.textContent = name;
      gpuVramText.textContent = "0.0 / 0.0 GB (0%)";
      gpuVramText.style.color = "var(--color-neutral-400)";
      if (gpuVramText2) {
        gpuVramText2.textContent = "0.0 / 0.0 GB (0%)";
        gpuVramText2.style.color = "var(--color-neutral-400)";
      }
      gpuVramBarFill.style.width = "0%";
      gpuTempText.textContent = "--°C";
      gpuTempText.style.color = "var(--color-neutral-400)";
      if (gpuTempText2) {
        gpuTempText2.textContent = "--°C";
        gpuTempText2.style.color = "var(--color-neutral-400)";
      }
    }
  } catch {
    gpuNameText.textContent = "GPU Telemetry Offline";
    if (gpuNameText2) gpuNameText2.textContent = "GPU Telemetry Offline";
    gpuVramText.textContent = "0.0 / 0.0 GB (0%)";
    gpuVramText.style.color = "var(--color-neutral-400)";
    if (gpuVramText2) {
      gpuVramText2.textContent = "0.0 / 0.0 GB (0%)";
      gpuVramText2.style.color = "var(--color-neutral-400)";
    }
    gpuVramBarFill.style.width = "0%";
    gpuTempText.textContent = "--°C";
    gpuTempText.style.color = "var(--color-neutral-400)";
    if (gpuTempText2) {
      gpuTempText2.textContent = "--°C";
      gpuTempText2.style.color = "var(--color-neutral-400)";
    }
  }
}

updateGpuStatus();
setInterval(updateGpuStatus, 3000);

// Titlebar controls
const winMin = document.getElementById("win-min") as HTMLButtonElement;
const winMax = document.getElementById("win-max") as HTMLButtonElement;
const winClose = document.getElementById("win-close") as HTMLButtonElement;

winMin.addEventListener("click", () => window.api.minimizeWindow());
winMax.addEventListener("click", () => window.api.maximizeWindow());
winClose.addEventListener("click", () => window.api.closeWindow());

// Sidebar Logo External Link
const sidebarLogoLink = document.getElementById("sidebar-logo-link") as HTMLAnchorElement | null;
if (sidebarLogoLink) {
  sidebarLogoLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.api?.openExternal) {
      void window.api.openExternal("https://github.com/erroralex");
    }
  });
}


// Sidebar nav (single / bulk)
const navSingle = document.getElementById("nav-single") as HTMLButtonElement;
const navBulk = document.getElementById("nav-bulk") as HTMLButtonElement;
const singleView = document.getElementById("single-view") as HTMLElement;
const bulkView = document.getElementById("bulk-view") as HTMLElement;

navSingle.addEventListener("click", () => {
  navSingle.classList.add("active");
  navSingle.classList.add("is-active");
  navBulk.classList.remove("active");
  navBulk.classList.remove("is-active");
  singleView.style.display = "flex";
  bulkView.style.display = "none";
});

navBulk.addEventListener("click", () => {
  navBulk.classList.add("active");
  navBulk.classList.add("is-active");
  navSingle.classList.remove("active");
  navSingle.classList.remove("is-active");
  bulkView.style.display = "flex";
  singleView.style.display = "none";
});

// Generic segmented-control helper: drives .is-active on each option's
// label and shows/hides the associated panel based on which radio is checked.
function wireSegTabs(entries: Array<{ radioId: string; panelId: string }>) {
  const radios = entries.map((e) => document.getElementById(e.radioId) as HTMLInputElement);
  const panels = entries.map((e) => document.getElementById(e.panelId) as HTMLElement);

  function sync() {
    radios.forEach((radio, i) => {
      const label = radio.closest(".seg-opt");
      const panel = panels[i];
      if (radio.checked) {
        label?.classList.add("active");
        label?.classList.add("is-active");
        if (panel) panel.style.display = "flex";
      } else {
        label?.classList.remove("active");
        label?.classList.remove("is-active");
        if (panel) panel.style.display = "none";
      }
    });
  }

  radios.forEach((radio) => radio.addEventListener("change", sync));
  sync();
}

wireSegTabs([
  { radioId: "panel-tab-caption", panelId: "caption-panel" },
  { radioId: "panel-tab-export", panelId: "export-panel" },
]);


// Toggle switches: a real checkbox drives an adjacent visual pill+knob span.
function wireToggle(checkboxId: string, toggleId: string, onChange?: (checked: boolean) => void) {
  const checkbox = document.getElementById(checkboxId) as HTMLInputElement;
  const toggle = document.getElementById(toggleId) as HTMLSpanElement;
  const sync = () => toggle.classList.toggle("is-on", checkbox.checked);
  checkbox.addEventListener("change", () => {
    sync();
    onChange?.(checkbox.checked);
  });
  sync();
}

// Captioning Model Selector
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const modelBrowseBtn = document.getElementById("model-browse-btn") as HTMLButtonElement;
const modelPathText = document.getElementById("model-path-text") as HTMLSpanElement;

let selectedModelId: string = modelSelect.value;
let customModelPath: string | undefined;

modelSelect.addEventListener("change", () => {
  if (modelSelect.value === "__custom__") {
    modelBrowseBtn.style.display = "inline-block";
    selectedModelId = customModelPath ?? "";
    modelPathText.textContent = customModelPath ?? "No folder selected";
  } else {
    modelBrowseBtn.style.display = "none";
    selectedModelId = modelSelect.value;
    modelPathText.textContent = "";
  }
});

modelBrowseBtn.addEventListener("click", async () => {
  const { folderPath } = await window.api.selectFolder();
  if (folderPath) {
    customModelPath = folderPath;
    selectedModelId = folderPath;
    modelPathText.textContent = folderPath;
  }
});

// Bulk Processing State & Elements
const bulkInputBtn = document.getElementById("bulk-input-btn") as HTMLButtonElement;
const bulkInputPath = document.getElementById("bulk-input-path") as HTMLSpanElement;
const bulkInputDropzone = document.getElementById("bulk-input-dropzone") as HTMLDivElement;
const bulkOutputBtn = document.getElementById("bulk-output-btn") as HTMLButtonElement;
const bulkOutputPath = document.getElementById("bulk-output-path") as HTMLSpanElement;
const bulkOutputDropzone = document.getElementById("bulk-output-dropzone") as HTMLDivElement;

const bulkRemoveWatermark = document.getElementById("bulk-remove-watermark") as HTMLInputElement;
const bulkGenerateCaptions = document.getElementById("bulk-generate-captions") as HTMLInputElement;
const bulkPromptContainer = document.getElementById("bulk-prompt-container") as HTMLDivElement;
const bulkSystemPrompt = document.getElementById("bulk-system-prompt") as HTMLTextAreaElement;

wireToggle("bulk-remove-watermark", "bulk-remove-watermark-toggle");
wireToggle("bulk-generate-captions", "bulk-generate-captions-toggle", (checked) => {
  bulkPromptContainer.style.display = checked ? "flex" : "none";
});

const bulkStartBtn = document.getElementById("bulk-start-btn") as HTMLButtonElement;
const bulkCancelBtn = document.getElementById("bulk-cancel-btn") as HTMLButtonElement;

const bulkFormatSelect = document.getElementById("bulk-format-select") as HTMLSelectElement;
const bulkQualityContainer = document.getElementById("bulk-quality-container") as HTMLDivElement;
const bulkQualityRange = document.getElementById("bulk-quality-range") as HTMLInputElement;
const bulkQualityVal = document.getElementById("bulk-quality-val") as HTMLSpanElement;
const bulkLosslessContainer = document.getElementById("bulk-lossless-container") as HTMLDivElement;
const bulkLosslessCheckbox = document.getElementById("bulk-lossless-checkbox") as HTMLInputElement;
const bulkCompressContainer = document.getElementById("bulk-compress-container") as HTMLDivElement;
const bulkCompressSelect = document.getElementById("bulk-compress-select") as HTMLSelectElement;
const bulkFlattenContainer = document.getElementById("bulk-flatten-container") as HTMLDivElement;
const bulkFlattenColor = document.getElementById("bulk-flatten-color") as HTMLInputElement;
const bulkMetadataSelect = document.getElementById("bulk-metadata-select") as HTMLSelectElement;

wireToggle("bulk-lossless-checkbox", "bulk-lossless-toggle");

bulkQualityRange.addEventListener("input", () => {
  bulkQualityVal.textContent = bulkQualityRange.value;
});

function updateBulkExportUi() {
  const fmt = bulkFormatSelect.value;
  bulkQualityContainer.style.display = fmt === "jpeg" || fmt === "webp" ? "flex" : "none";
  bulkLosslessContainer.style.display = fmt === "webp" ? "flex" : "none";
  bulkCompressContainer.style.display = fmt === "png" ? "flex" : "none";
  bulkFlattenContainer.style.display = fmt === "jpeg" ? "flex" : "none";
}

bulkFormatSelect.addEventListener("change", updateBulkExportUi);
updateBulkExportUi();

const progressBarFill = document.getElementById("progress-bar-fill") as HTMLDivElement;
const bulkProgressText = document.getElementById("bulk-progress-text") as HTMLSpanElement;
const bulkLogBox = document.getElementById("bulk-log-box") as HTMLDivElement;
const bulkThumbGrid = document.getElementById("bulk-thumb-grid") as HTMLDivElement;
const bulkThumbCount = document.getElementById("bulk-thumb-count") as HTMLSpanElement;

const MAX_THUMBS = 11;

async function populateThumbGrid(folderPath: string) {
  bulkThumbGrid.textContent = "";
  bulkThumbCount.textContent = "Scanning…";
  try {
    const { files } = await window.api.listImagesInFolder(folderPath);
    bulkThumbCount.textContent = `${files.length} image${files.length === 1 ? "" : "s"} found`;
    const shown = files.slice(0, MAX_THUMBS);
    for (const file of shown) {
      const tile = document.createElement("div");
      tile.className = "thumb-tile";
      const img = document.createElement("img");
      img.src = `file://${folderPath}/${file}`;
      img.alt = file;
      img.loading = "lazy";
      tile.appendChild(img);
      bulkThumbGrid.appendChild(tile);
    }
    const remaining = files.length - shown.length;
    if (remaining > 0) {
      const tile = document.createElement("div");
      tile.className = "thumb-tile";
      const more = document.createElement("div");
      more.className = "thumb-more";
      more.textContent = `+${remaining} more`;
      tile.appendChild(more);
      bulkThumbGrid.appendChild(tile);
    }
  } catch {
    bulkThumbCount.textContent = "Could not read folder";
  }
}

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

async function setInputFolder(folderPath: string) {
  selectedInputFolder = folderPath;
  bulkInputPath.textContent = folderPath;
  appendBulkLog(`Input folder set to: ${folderPath}`);
  updateBulkStartButton();
  await populateThumbGrid(folderPath);
}

function setOutputFolder(folderPath: string) {
  selectedOutputFolder = folderPath;
  bulkOutputPath.textContent = folderPath;
  appendBulkLog(`Output folder set to: ${folderPath}`);
  updateBulkStartButton();
}

bulkInputBtn.addEventListener("click", async () => {
  const { folderPath } = await window.api.selectFolder();
  if (folderPath) await setInputFolder(folderPath);
});

bulkOutputBtn.addEventListener("click", async () => {
  const { folderPath } = await window.api.selectFolder();
  if (folderPath) setOutputFolder(folderPath);
});

function getDroppedPath(file: File): string {
  if (window.api.getPathForFile) {
    try {
      const p = window.api.getPathForFile(file);
      if (p) return p;
    } catch {
      // fallback
    }
  }
  return (file as any).path || "";
}

function wireDropzoneFolder(zone: HTMLDivElement, onFolderSelected: (path: string) => void) {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-dragover");
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file) {
        const folderPath = getDroppedPath(file);
        if (folderPath) {
          onFolderSelected(folderPath);
        }
      }
    }
  });
}

wireDropzoneFolder(bulkInputDropzone, (folderPath) => {
  void setInputFolder(folderPath);
});

wireDropzoneFolder(bulkOutputDropzone, (folderPath) => {
  setOutputFolder(folderPath);
});

bulkStartBtn.addEventListener("click", async () => {
  if (!selectedInputFolder || !selectedOutputFolder || isBulkRunning) return;

  isBulkRunning = true;
  isBulkCancelled = false;
  bulkStartBtn.disabled = true;
  bulkCancelBtn.style.display = "inline-flex";
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
          format: bulkFormatSelect.value,
          quality: parseInt(bulkQualityRange.value, 10),
          lossless: bulkLosslessCheckbox.checked,
          compressLevel: parseInt(bulkCompressSelect.value, 10),
          metadataMode: bulkMetadataSelect.value,
          flattenColor: bulkFlattenColor.value,
          systemPrompt: bulkSystemPrompt.value,
          modelId: selectedModelId || undefined,
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

// Global UI Scale Zooming (Ctrl + Mouse Wheel)
window.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const currentZoom = window.api?.getZoomFactor ? window.api.getZoomFactor() : 1.0;
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      const newZoom = Math.min(Math.max(0.5, Math.round((currentZoom + delta) * 100) / 100), 2.5);
      if (window.api?.setZoomFactor) {
        window.api.setZoomFactor(newZoom);
      }
    }
  },
  { passive: false },
);

// Reset UI Zoom shortcut (Ctrl + 0)
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "0" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    if (window.api?.setZoomFactor) {
      window.api.setZoomFactor(1.0);
    }
  }
});

// Mousewheel Zooming for Image Preview
previewContainer.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      return; // Handled by global UI scale zoom listener
    }
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
  { passive: false },
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
const brushAddBtn = document.getElementById("brush-add-btn") as HTMLInputElement;
const brushEraseBtn = document.getElementById("brush-erase-btn") as HTMLInputElement;
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

wireToggle("lossless-checkbox", "lossless-toggle");

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

// Export presets
type ExportPreset = {
  format: string;
  quality: number;
  lossless: boolean;
  compressLevel: number;
  metadataMode: string;
};

const BUILT_IN_PRESETS: Record<string, ExportPreset> = {
  lora: { format: "jpeg", quality: 92, lossless: false, compressLevel: 6, metadataMode: "strip" },
  archive: { format: "png", quality: 100, lossless: false, compressLevel: 6, metadataMode: "keep" },
  web: { format: "webp", quality: 82, lossless: false, compressLevel: 6, metadataMode: "strip" },
};

const CUSTOM_PRESETS_KEY = "lt-export-presets";

function loadCustomPresets(): Record<string, ExportPreset> {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ExportPreset>) : {};
  } catch {
    return {};
  }
}

function saveCustomPreset(name: string, preset: ExportPreset) {
  const presets = loadCustomPresets();
  presets[name] = preset;
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

function wireExportPresets(
  selectEl: HTMLSelectElement,
  saveBtnEl: HTMLButtonElement,
  fields: {
    format: HTMLSelectElement;
    quality: HTMLInputElement;
    lossless: HTMLInputElement;
    compress: HTMLSelectElement;
    metadata: HTMLSelectElement;
  },
) {
  for (const [name, preset] of Object.entries(loadCustomPresets())) {
    const opt = document.createElement("option");
    opt.value = `custom:${name}`;
    opt.textContent = `${name} (custom)`;
    selectEl.appendChild(opt);
    BUILT_IN_PRESETS[`custom:${name}`] = preset;
  }

  selectEl.addEventListener("change", () => {
    const preset = BUILT_IN_PRESETS[selectEl.value];
    if (!preset) return;
    fields.format.value = preset.format;
    fields.format.dispatchEvent(new Event("change"));
    fields.quality.value = String(preset.quality);
    fields.quality.dispatchEvent(new Event("input"));
    fields.lossless.checked = preset.lossless;
    fields.lossless.dispatchEvent(new Event("change"));
    fields.compress.value = String(preset.compressLevel);
    fields.metadata.value = preset.metadataMode;
  });

  saveBtnEl.addEventListener("click", () => {
    const name = prompt("Preset name?");
    if (!name) return;
    const preset: ExportPreset = {
      format: fields.format.value,
      quality: parseInt(fields.quality.value, 10),
      lossless: fields.lossless.checked,
      compressLevel: parseInt(fields.compress.value, 10),
      metadataMode: fields.metadata.value,
    };
    saveCustomPreset(name, preset);
    BUILT_IN_PRESETS[`custom:${name}`] = preset;
    const opt = document.createElement("option");
    opt.value = `custom:${name}`;
    opt.textContent = `${name} (custom)`;
    selectEl.appendChild(opt);
    selectEl.value = `custom:${name}`;
  });
}

wireExportPresets(
  document.getElementById("export-preset-select") as HTMLSelectElement,
  document.getElementById("export-preset-save-btn") as HTMLButtonElement,
  { format: formatSelect, quality: qualityRange, lossless: losslessCheckbox, compress: compressSelect, metadata: metadataSelect },
);

wireExportPresets(
  document.getElementById("bulk-export-preset-select") as HTMLSelectElement,
  document.getElementById("bulk-export-preset-save-btn") as HTMLButtonElement,
  {
    format: bulkFormatSelect,
    quality: bulkQualityRange,
    lossless: bulkLosslessCheckbox,
    compress: bulkCompressSelect,
    metadata: bulkMetadataSelect,
  },
);

const brushCursor = document.getElementById("brush-cursor") as HTMLDivElement;

function updateBrushCursorSize() {
  // Brush size is defined in CSS px at zoom 1.0 (see drawStroke's radius
  // conversion), so its on-screen footprint scales with the current zoom.
  const diameter = parseInt(brushSize.value, 10) * zoomScale;
  brushCursor.style.width = `${diameter}px`;
  brushCursor.style.height = `${diameter}px`;
}

function updateBrushCursorPosition(e: PointerEvent) {
  const rect = previewContainer.getBoundingClientRect();
  brushCursor.style.left = `${e.clientX - rect.left}px`;
  brushCursor.style.top = `${e.clientY - rect.top}px`;
}

maskCanvas.addEventListener("pointerenter", () => {
  if (maskCanvas.style.display === "none") return;
  updateBrushCursorSize();
  brushCursor.style.display = "block";
});

maskCanvas.addEventListener("pointermove", (e) => {
  updateBrushCursorPosition(e);
  updateBrushCursorSize();
});

maskCanvas.addEventListener("pointerleave", () => {
  brushCursor.style.display = "none";
});

brushSize.addEventListener("input", () => {
  brushSizeVal.textContent = brushSize.value;
  updateBrushCursorSize();
});

function syncBrushModeUi() {
  const addLabel = brushAddBtn.closest(".seg-opt");
  const eraseLabel = brushEraseBtn.closest(".seg-opt");
  if (addLabel) {
    addLabel.classList.toggle("active", brushAddBtn.checked);
    addLabel.classList.toggle("is-active", brushAddBtn.checked);
  }
  if (eraseLabel) {
    eraseLabel.classList.toggle("active", brushEraseBtn.checked);
    eraseLabel.classList.toggle("is-active", brushEraseBtn.checked);
  }
}

brushAddBtn.addEventListener("change", () => {
  if (brushAddBtn.checked) brushMode = "add";
  syncBrushModeUi();
});

brushEraseBtn.addEventListener("change", () => {
  if (brushEraseBtn.checked) brushMode = "erase";
  syncBrushModeUi();
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
  } else {
    // No AI detection has run yet — reset means "back to a blank mask".
    offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    syncVisibleCanvas();
    await exportOffscreenMask();
    saveHistoryState();
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

  // Give the user a blank, paintable mask as soon as the image loads, so
  // manual masking doesn't require running AI detection first.
  preview.addEventListener(
    "load",
    () => {
      offscreenCanvas.width = preview.naturalWidth;
      offscreenCanvas.height = preview.naturalHeight;
      offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      maskCanvas.style.display = "block";
      syncVisibleCanvas();
      clearHistory();
      saveHistoryState();
    },
    { once: true },
  );

  if (previewBase64) {
    preview.src = `data:image/png;base64,${previewBase64}`;
  } else {
    preview.src = URL.createObjectURL(file);
  }
  detectBtn.disabled = false;
  captionBtn.disabled = false;
  exportBtn.disabled = false;
  inpaintBtn.disabled = false;
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
    // The old strokes described the now-removed watermark and are stale for
    // the new image; clear them but keep the canvas visible/interactive so
    // the brush works immediately for touch-up masking.
    offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    syncVisibleCanvas();
    await exportOffscreenMask();
    clearHistory();
    saveHistoryState();
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
    const { caption } = await window.api.captionImage(
      currentImageId,
      systemPromptInput.value,
      selectedModelId || undefined,
    );
    if (caption) {
      captionText.value = caption;
      captionStatus.textContent = "Generated";
    } else {
      captionText.value = "";
      captionStatus.textContent = "Captioning failed or refused";
    }
  } catch {
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
