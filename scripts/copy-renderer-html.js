const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "renderer");
const destDir = path.join(__dirname, "..", "dist", "renderer");
const rootDir = path.join(__dirname, "..");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(path.join(srcDir, "index.html"), path.join(destDir, "index.html"));
fs.cpSync(path.join(srcDir, "styles"), path.join(destDir, "styles"), { recursive: true });
if (fs.existsSync(path.join(srcDir, "assets"))) {
  fs.cpSync(path.join(srcDir, "assets"), path.join(destDir, "assets"), { recursive: true });
}

// The renderer has no bundler and loads scripts directly via <script> tags, so the
// `lucide` npm package (an ESM/CJS package) can't be `require`d/`import`ed at runtime
// in the browser context. Ship its prebuilt UMD bundle (exposes `window.lucide`)
// alongside the renderer instead.
const lucideUmdSrc = path.join(rootDir, "node_modules", "lucide", "dist", "umd", "lucide.min.js");
if (fs.existsSync(lucideUmdSrc)) {
  fs.copyFileSync(lucideUmdSrc, path.join(destDir, "lucide.min.js"));
}

