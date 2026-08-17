import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDir = process.argv[2];
if (!outputDir) throw new Error("Pass the output directory");

const [css, script] = await Promise.all([
  readFile(path.join(outputDir, "lingua-app.css"), "utf8"),
  readFile(path.join(outputDir, "lingua-app.js"), "utf8"),
]);

const html = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Lingua — словарь</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..24,400,0,0&icon_names=add,arrow_forward,brand_awareness,calendar_month,delete,download,edit,keyboard_arrow_down,search,skip_next&display=block">
    <style>${css}</style>
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script>${script}</script>
  </body>
</html>`;

await writeFile(path.join(outputDir, "lingua-variant-4.html"), html);
