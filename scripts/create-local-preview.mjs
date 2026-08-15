import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const clientDir = path.join(root, "dist", "client");
const cssDir = path.join(clientDir, "_next", "static", "css");
const outputPath = path.join(root, "dist", "index.html");

const workerModule = await import(path.join(root, "dist", "server", "index.js"));
const response = await workerModule.default.fetch(
  new Request("http://local-preview/", {
    headers: { accept: "text/html" },
  }),
  {},
  { waitUntil() {}, passThroughOnException() {} },
);

if (!response.ok) {
  throw new Error(`Не удалось получить страницу: ${response.status}`);
}

let html = await response.text();
const cssFiles = (await readdir(cssDir)).filter((file) => file.endsWith(".css"));
let css = "";

for (const file of cssFiles) {
  css += `\n${await readFile(path.join(cssDir, file), "utf8")}`;
}

const fontUrlPattern = /url\((['"]?)(\/?_next\/static\/_vinext_fonts\/[^)'"\s]+)\1\)/g;
const fontUrls = [...css.matchAll(fontUrlPattern)].map((match) => match[2]);

for (const fontUrl of new Set(fontUrls)) {
  const fontPath = path.join(clientDir, fontUrl.replace(/^\//, ""));
  const fontData = await readFile(fontPath);
  const dataUrl = `data:font/woff2;base64,${fontData.toString("base64")}`;
  css = css.split(fontUrl).join(dataUrl);
}

html = html
  .replace(/<link[^>]+href="\/?_next\/static\/css\/[^"]+"[^>]*>/g, "")
  .replace(/<link[^>]+rel="modulepreload"[^>]*>/g, "")
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace("</head>", `<style>${css}</style></head>`)
  .replace(
    '<details class="dictionary-switcher">',
    '<details class="dictionary-switcher" open>',
  );

await writeFile(outputPath, html, "utf8");
console.log(outputPath);
