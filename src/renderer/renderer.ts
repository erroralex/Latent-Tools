let currentImageId: string | undefined;
let currentMaskBase64: string | undefined;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const detectBtn = document.getElementById("detect-btn") as HTMLButtonElement;
const inpaintBtn = document.getElementById("inpaint-btn") as HTMLButtonElement;
const captionBtn = document.getElementById("caption-btn") as HTMLButtonElement;
const exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
const preview = document.getElementById("preview") as HTMLImageElement;
const captionText = document.getElementById("caption-text") as HTMLTextAreaElement;
const captionStatus = document.getElementById("caption-status") as HTMLSpanElement;

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

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { imageId, previewBase64 } = await window.api.importImage(buffer);
  currentImageId = imageId;
  if (previewBase64) {
    preview.src = `data:image/png;base64,${previewBase64}`;
  } else {
    preview.src = URL.createObjectURL(file);
  }
  detectBtn.disabled = false;
  captionBtn.disabled = false;
  exportBtn.disabled = false;
  captionText.value = "";
  captionStatus.textContent = "";
});

detectBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  const { maskBase64 } = await window.api.detect(currentImageId);
  currentMaskBase64 = maskBase64;
  inpaintBtn.disabled = false;
});

inpaintBtn.addEventListener("click", async () => {
  if (currentImageId === undefined || currentMaskBase64 === undefined) return;
  const { resultBase64 } = await window.api.inpaint(currentImageId, currentMaskBase64);
  preview.src = `data:image/png;base64,${resultBase64}`;
});

captionBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  captionBtn.disabled = true;
  captionStatus.textContent = "Generating caption...";
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


