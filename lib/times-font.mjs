import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FONT_DIRS = [
  "/usr/share/fonts/truetype/msttcorefonts",
  "/usr/share/fonts/truetype/liberation",
  "/usr/share/fonts/truetype/liberation2",
];

const FACE_FILES = [
  { weight: 400, style: "normal", names: ["Times_New_Roman.ttf", "TimesNewRoman.ttf", "LiberationSerif-Regular.ttf"] },
  { weight: 700, style: "normal", names: ["Times_New_Roman_Bold.ttf", "TimesNewRomanBold.ttf", "LiberationSerif-Bold.ttf"] },
  { weight: 400, style: "italic", names: ["Times_New_Roman_Italic.ttf", "TimesNewRomanItalic.ttf", "LiberationSerif-Italic.ttf"] },
  { weight: 700, style: "italic", names: ["Times_New_Roman_Bold_Italic.ttf", "TimesNewRomanBoldItalic.ttf", "LiberationSerif-BoldItalic.ttf"] },
];

let cached = "";

function findFont(names) {
  for (const dir of FONT_DIRS) {
    for (const name of names) {
      const path = join(dir, name);
      if (existsSync(path)) return path;
    }
  }
  return "";
}

export function timesFontCss() {
  if (cached) return cached;
  const rules = [];
  for (const face of FACE_FILES) {
    const path = findFont(face.names);
    if (!path) continue;
    const b64 = readFileSync(path).toString("base64");
    rules.push(`@font-face{font-family:"Times New Roman";src:url(data:font/ttf;base64,${b64}) format("truetype");font-weight:${face.weight};font-style:${face.style};font-display:block;}`);
  }
  cached = rules.join("");
  return cached;
}
