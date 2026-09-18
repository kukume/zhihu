import puppeteer, { type Page } from "@cloudflare/puppeteer";
import { UA, parseCookieHeader, toCookieHeader } from "./cookies";
import type { CookiePair } from "./cookies";
import { extractBase64Fonts, pickContentFont } from "./fonts";

type PuppeteerCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

function toPuppeteerCookies(header: string): PuppeteerCookie[] {
  return parseCookieHeader(header).map((c) => ({
    name: c.name,
    value: c.value,
    domain: ".zhihu.com",
    path: "/",
  }));
}

function fromPuppeteerCookies(cookies: Array<{ name: string; value: string }>): string {
  const pairs: CookiePair[] = cookies.map((c) => ({ name: c.name, value: c.value }));
  return toCookieHeader(pairs);
}

export type GlyphMapResult = {
  mapping: Record<string, string>;
  meanBest: number;
  tofu: boolean;
  error?: string;
};

async function mapGlyphsOnPage(
  page: Page,
  fontBase64: string,
  chars: string[],
): Promise<GlyphMapResult> {
  const source = `
    (async () => {
      const fontB64 = ${JSON.stringify(fontBase64)};
      const codeChars = ${JSON.stringify(chars)};
      const size = 128;
      const family = "zhihu-obf";
      const refFamily = "NotoSansCJKsc";
      const refUrl = "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";

      async function loadRefFont() {
        const face = new FontFace(refFamily, "url(" + refUrl + ")");
        await face.load();
        document.fonts.add(face);
      }

      const obf = new FontFace(family, "url(data:font/ttf;base64," + fontB64 + ")");
      await obf.load();
      document.fonts.add(obf);
      await loadRefFont();
      await document.fonts.ready;

      function render(ch, fontFamily) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return new Uint8ClampedArray(size * size * 4);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "#000000";
        ctx.font = size + 'px "' + fontFamily + '"';
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
        return ctx.getImageData(0, 0, size, size).data;
      }

      function ink(data) {
        let n = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] < 200) n++;
        return n;
      }

      function ncc(a, b) {
        const n = a.length;
        let mean1 = 0, mean2 = 0;
        const pixels = n / 4;
        for (let i = 0; i < n; i += 4) { mean1 += a[i]; mean2 += b[i]; }
        mean1 /= pixels; mean2 /= pixels;
        let dot = 0, n1 = 0, n2 = 0;
        for (let i = 0; i < n; i += 4) {
          const d1 = a[i] - mean1, d2 = b[i] - mean2;
          dot += d1 * d2; n1 += d1 * d1; n2 += d2 * d2;
        }
        if (n1 === 0 || n2 === 0) return 0;
        return dot / Math.sqrt(n1 * n2);
      }

      function munkres(cost) {
        const n = cost.length;
        const u = Array(n + 1).fill(0);
        const v = Array(n + 1).fill(0);
        const p = Array(n + 1).fill(0);
        const way = Array(n + 1).fill(0);
        for (let i = 1; i <= n; i++) {
          p[0] = i;
          let j0 = 0;
          const minv = Array(n + 1).fill(Infinity);
          const used = Array(n + 1).fill(false);
          do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;
            for (let j = 1; j <= n; j++) {
              if (used[j]) continue;
              const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
              if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
              if (minv[j] < delta) { delta = minv[j]; j1 = j; }
            }
            for (let j = 0; j <= n; j++) {
              if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
              else minv[j] -= delta;
            }
            j0 = j1;
          } while (p[j0] !== 0);
          do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
        }
        const assignment = Array(n).fill(0);
        for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
        return assignment;
      }

      const obfImgs = codeChars.map((ch) => render(ch, family));
      const refImgs = codeChars.map((ch) => render(ch, refFamily));
      const inks = refImgs.map(ink);
      const inkMean = inks.reduce((a, b) => a + b, 0) / (inks.length || 1);
      const inkVar = inks.reduce((a, b) => a + (b - inkMean) * (b - inkMean), 0) / (inks.length || 1);
      const tofu = inkMean < 30 || inkVar < 20;
      if (tofu) {
        return { mapping: {}, meanBest: 0, tofu: true, error: "Reference CJK font did not render (tofu)" };
      }

      const n = codeChars.length;
      const sim = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) sim[i][j] = ncc(obfImgs[i], refImgs[j]);
      }
      const assign = munkres(sim.map((row) => row.map((x) => -x)));
      const mapping = {};
      let bestSum = 0;
      for (let i = 0; i < n; i++) {
        const score = sim[i][assign[i]];
        bestSum += score;
        const src = codeChars[i];
        const tgt = codeChars[assign[i]];
        if (src !== tgt) mapping[src] = tgt;
      }
      return { mapping, meanBest: bestSum / (n || 1), tofu: false };
    })()
  `;
  return (await page.evaluate(source)) as GlyphMapResult;
}

export async function browserFetchPaid(
  env: Env,
  url: string,
  cookieHeader: string,
): Promise<{ html: string; cookie: string; mapped: GlyphMapResult }> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    const cookies = toPuppeteerCookies(cookieHeader);
    if (cookies.length) await page.setCookie(...cookies);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    try {
      await page.waitForNetworkIdle({ timeout: 12000 });
    } catch {
      // Zhihu keeps long-lived connections; ignore.
    }
    await new Promise((r) => setTimeout(r, 1500));

    const html = await page.content();
    const exported = fromPuppeteerCookies(await page.cookies("https://www.zhihu.com"));

    let mapped: GlyphMapResult = { mapping: {}, meanBest: 0, tofu: false };
    const picked = pickContentFont(extractBase64Fonts(html));
    if (picked) {
      mapped = await mapGlyphsOnPage(page, picked.font.base64, picked.chars);
    }

    return { html, cookie: exported || cookieHeader, mapped };
  } finally {
    await browser.close();
  }
}

export async function browserMapGlyphs(
  env: Env,
  fontBase64: string,
  chars: string[],
): Promise<GlyphMapResult> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    return await mapGlyphsOnPage(page, fontBase64, chars);
  } finally {
    await browser.close();
  }
}

export async function browserRefreshCookies(env: Env, cookieHeader: string, url?: string): Promise<string> {
  const target = url || "https://www.zhihu.com/";
  const result = await browserFetchPaid(env, target, cookieHeader);
  return result.cookie;
}
