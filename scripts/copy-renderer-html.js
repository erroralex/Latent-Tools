const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "renderer");
const destDir = path.join(__dirname, "..", "dist", "renderer");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(path.join(srcDir, "index.html"), path.join(destDir, "index.html"));
fs.cpSync(path.join(srcDir, "styles"), path.join(destDir, "styles"), { recursive: true });
if (fs.existsSync(path.join(srcDir, "assets"))) {
  fs.cpSync(path.join(srcDir, "assets"), path.join(destDir, "assets"), { recursive: true });
}

