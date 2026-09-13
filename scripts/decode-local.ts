import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { applyMapping, extractBase64Fonts, pickContentFont } from "../src/fonts";
import { hungarianAssign, mappingFromAssignment, ncc, REF_FONT_URL, RENDER_SIZE } from "../src/glyph";
import { extractArticleText, extractTitle } from "../src/html";

const here = process.cwd();
const PAGE_URL =
  process.argv[2] ??
  "https://www.zhihu.com/market/paid_column/1662117749412466688/section/1667546462182576128";
const COOKIE_PATH =
  process.argv[3] ?? "C:\\Users\\kuku\\Downloads\\zhihu0\\cookie.txt";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function ensureNoto(): Promise<string> {
  const dir = join(here, "fonts");
  const local = join(dir, "NotoSansCJKsc-Regular.otf");
  const fromPython = "C:\\Users\\kuku\\Downloads\\zhihu0\\NotoSansCJKsc-Regular.otf";
  if (existsSync(local) && readFileSync(local).byteLength > 1_000_000) return local;
  mkdirSync(dir, { recursive: true });
  if (existsSync(fromPython) && readFileSync(fromPython).byteLength > 1_000_000) {
    writeFileSync(local, readFileSync(fromPython));
    return local;
  }
  console.log("Downloading NotoSansCJKsc-Regular.otf (same file as Python)...");
  const resp = await fetch(REF_FONT_URL, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Noto download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength < 1_000_000) throw new Error(`Noto download too small: ${buf.byteLength}`);
  writeFileSync(local, buf);
  console.log(`saved ${local} (${buf.byteLength} bytes)`);
  return local;
}

function renderGlyph(fontName: string, ch: string, size = RENDER_SIZE): Float32Array {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  ctx.font = `${size}px "${fontName}"`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(ch);
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (w > 0 && h > 0) {
    const x = Math.floor((size - w) / 2) + m.actualBoundingBoxLeft;
    const y = Math.floor((size - h) / 2) + m.actualBoundingBoxAscent;
    ctx.fillText(ch, x, y);
  }
  const { data } = ctx.getImageData(0, 0, size, size);
  const out = new Float32Array(size * size);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) out[p] = data[i];
  return out;
}

function buildMapping(fontBase64: string, chars: string[]): Record<string, string> {
  const tmp = join(process.env.TEMP || ".", `zhihu-obf-${Date.now()}.ttf`);
  writeFileSync(tmp, Buffer.from(fontBase64, "base64"));
  GlobalFonts.registerFromPath(tmp, "zhihu-obf");

  const obf = chars.map((ch) => renderGlyph("zhihu-obf", ch));
  const ref = chars.map((ch) => renderGlyph("zhihu-ref", ch));
  const n = chars.length;
  const sim = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sim[i][j] = ncc(obf[i], ref[j]);
  }
  return mappingFromAssignment(chars, hungarianAssign(sim));
}

async function main() {
  const cookie = readFileSync(COOKIE_PATH, "utf8").trim();
  const noto = await ensureNoto();
  GlobalFonts.registerFromPath(noto, "zhihu-ref");
  console.log(`ref=${noto}`);

  const resp = await fetch(PAGE_URL, {
    headers: {
      "User-Agent": UA,
      Cookie: cookie,
      Referer: "https://www.zhihu.com/",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    redirect: "follow",
  });
  const html = await resp.text();
  console.log(`status=${resp.status} html=${html.length}`);

  const title = extractTitle(html);
  const fonts = extractBase64Fonts(html);
  const picked = pickContentFont(fonts);
  console.log(`title=${title || "(empty)"} fonts=${fonts.length} cmap=${picked?.chars.length ?? 0}`);

  let text = extractArticleText(html);
  console.log(`extracted=${text.length}`);
  if (picked) {
    const mapping = buildMapping(picked.font.base64, picked.chars);
    console.log(`mapping=${Object.keys(mapping).length}`);
    text = applyMapping(text, mapping);
  }
  text = text
    .replace(/备案号:[\s\S]*?(?:禁止转载)?\s*$/u, "")
    .replace(/©\s*本内容版权为知乎及版权方所有[\s\S]*?侵权必究\s*/u, "")
    .trim();
  const preview = [...text].slice(0, 200).join("");
  console.log("---PREVIEW---");
  console.log(preview);
  console.log("---END---");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
