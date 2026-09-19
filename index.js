"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const distEntry = path.join(__dirname, "dist", "index.js");

if (!fs.existsSync(distEntry)) {
  try {
    execSync("npx tsc", { stdio: "inherit", cwd: __dirname });
  } catch {
    console.error(
      "Missing dist/index.js. On Render set Build Command to: npm install && npm run build"
    );
    process.exit(1);
  }
}

if (!fs.existsSync(distEntry)) {
  console.error(
    "Missing dist/index.js. On Render set Build Command to: npm install && npm run build"
  );
  process.exit(1);
}

require(distEntry);
