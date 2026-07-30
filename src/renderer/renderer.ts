let currentImageId: string | undefined;
let currentMaskBase64: string | undefined;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const detectBtn = document.getElementById("detect-btn") as HTMLButtonElement;
const inpaintBtn = document.getElementById("inpaint-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const preview = document.getElementById("preview") as HTMLImageElement;

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { imageId } = await window.api.importImage(buffer);
  currentImageId = imageId;
  preview.src = URL.createObjectURL(file);
  detectBtn.disabled = false;
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
  saveBtn.disabled = false;
});

saveBtn.addEventListener("click", async () => {
  if (currentImageId === undefined) return;
  await window.api.save(currentImageId);
});
