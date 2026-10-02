import { cp, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = fileURLToPath(
  import.meta.resolve("pdfjs-dist/package.json"),
);
const pdf = JSON.parse(await readFile(packagePath, "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(pdf.version))
  throw new Error("Invalid PDF.js asset version");
const destination = fileURLToPath(
  new URL(`../public/pdfjs/${pdf.version}/`, import.meta.url),
);
await mkdir(destination, { recursive: true });
for (const name of ["cmaps", "wasm", "standard_fonts", "iccs", "LICENSE"])
  await cp(join(dirname(packagePath), name), join(destination, name), {
    recursive: true,
  });
const exportAssets = fileURLToPath(
  new URL("../public/export-assets/v1/", import.meta.url),
);
const pretendardPath = dirname(
  fileURLToPath(import.meta.resolve("pretendard/package.json")),
);
await mkdir(exportAssets, { recursive: true });
await cp(
  join(pretendardPath, "dist/public/static/alternative/Pretendard-Regular.ttf"),
  join(exportAssets, "Pretendard-Regular.ttf"),
);
await cp(
  fileURLToPath(
    new URL("../src/fonts/Pretendard-LICENSE.txt", import.meta.url),
  ),
  join(exportAssets, "Pretendard-LICENSE.txt"),
);
