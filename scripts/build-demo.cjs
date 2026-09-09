const fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "..");
fs.mkdirSync(path.join(root, "demo"), { recursive: true });
fs.copyFileSync(path.join(root, "Code.gs"), path.join(root, "demo/parser.js"));
