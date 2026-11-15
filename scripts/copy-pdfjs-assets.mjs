// pdf.js가 한글 등 CJK 폰트(cMap), 표준 폰트, wasm 디코더를 불러올 수 있도록
// node_modules의 자산을 public/pdfjs 로 복사한다. (git 에는 포함하지 않음)
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");
