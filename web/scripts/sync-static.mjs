import { cp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptsDirectory, "..");
const projectDirectory = path.resolve(webDirectory, "..");
const buildDirectory = path.join(webDirectory, "dist");

// Nginx serves the repository root (/srv/www/projects/$project). Keep only
// generated static entries mirrored there; source and firmware are untouched.
const generatedNames = new Set([
  "assets",
  "index.html",
  "icon.svg",
  "manifest.webmanifest",
  "registerSW.js",
  "sw.js"
]);

for (const entry of await readdir(buildDirectory)) {
  if (entry === "assets" || entry.startsWith("workbox-")) generatedNames.add(entry);
}

for (const entry of generatedNames) {
  await rm(path.join(projectDirectory, entry), { recursive: true, force: true });
}

for (const entry of await readdir(buildDirectory)) {
  if (!generatedNames.has(entry)) continue;
  await cp(path.join(buildDirectory, entry), path.join(projectDirectory, entry), { recursive: true });
}

console.log(`Synchronized ${buildDirectory} -> ${projectDirectory}`);
