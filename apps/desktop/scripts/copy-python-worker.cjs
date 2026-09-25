const { copyFileSync } = require("node:fs");
const { resolve } = require("node:path");

copyFileSync(
  resolve(__dirname, "../../../packages/analyzer-python/python/analyze.py"),
  resolve(__dirname, "../dist/python-analyze.py"),
);
