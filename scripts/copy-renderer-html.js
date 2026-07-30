const fs = require("fs");
const path = require("path");

const srcFile = path.join(__dirname, "..", "src", "renderer", "index.html");
const destDir = path.join(__dirname, "..", "dist", "renderer");
const destFile = path.join(destDir, "index.html");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(srcFile, destFile);
