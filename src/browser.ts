import puppeteer, { type Page } from "@cloudflare/puppeteer";
import { UA, parseCookieHeader, saveCookieHeader, toCookieHeader } from "./cookies";
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

async function mapGlyphsOnPage(
  page: Page,
  fontBase64: string,
  chars: string[],
): Promise<Record<string, string>> {
  const mapping = (await page.evaluate(
    `async (fontB64, codeChars) => {
      const size = 64;
      const family = "zhihu-obf";
      const face = new FontFace(family, "url(data:font/ttf;base64," + fontB64 + ")");
      await face.load();
      document.fonts.add(face);
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
        ctx.font = '48px "' + fontFamily + '"';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ch, size / 2, size / 2 + 2);
        return ctx.getImageData(0, 0, size, size).data;
      }

      function ncc(a, b) {
        const n = a.length;
        let mean1 = 0;
        let mean2 = 0;
        const pixels = n / 4;
        for (let i = 0; i < n; i += 4) {
          mean1 += a[i];
          mean2 += b[i];
        }
        mean1 /= pixels;
        mean2 /= pixels;
        let dot = 0;
        let n1 = 0;
        let n2 = 0;
        for (let i = 0; i < n; i += 4) {
          const d1 = a[i] - mean1;
          const d2 = b[i] - mean2;
          dot += d1 * d2;
          n1 += d1 * d1;
          n2 += d2 * d2;
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
              if (cur < minv[j]) {
                minv[j] = cur;
                way[j] = j0;
              }
              if (minv[j] < delta) {
                delta = minv[j];
                j1 = j;
              }
            }
            for (let j = 0; j <= n; j++) {
              if (used[j]) {
                u[p[j]] += delta;
                v[j] -= delta;
              } else {
                minv[j] -= delta;
              }
            }
            j0 = j1;
          } while (p[j0] !== 0);
          do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
          } while (j0);
        }
        const assignment = Array(n).fill(0);
        for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
        return assignment;
      }

      const refFamily = '"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
      const obfImgs = codeChars.map((ch) => render(ch, family));
      const refImgs = codeChars.map((ch) => render(ch, refFamily));
      const n = codeChars.length;
      const sim = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) sim[i][j] = ncc(obfImgs[i], refImgs[j]);
      }
      const cost = sim.map((row) => row.map((x) => -x));
      const assign = munkres(cost);
      const mapping = {};
      for (let i = 0; i < n; i++) {
        const src = codeChars[i];
        const tgt = codeChars[assign[i]];
        if (src !== tgt) mapping[src] = tgt;
      }
      return mapping;
    }`,
    fontBase64,
    chars,
  )) as Record<string, string>;
  return mapping;
}

export async function browserFetchPaid(
  env: Env,
  url: string,
  cookieHeader: string,
): Promise<{ html: string; cookie: string; mapping: Record<string, string> }> {
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
    if (exported) await saveCookieHeader(env, exported);

    let mapping: Record<string, string> = {};
    const picked = pickContentFont(extractBase64Fonts(html));
    if (picked) {
      mapping = await mapGlyphsOnPage(page, picked.font.base64, picked.chars);
    }

    return { html, cookie: exported || cookieHeader, mapping };
  } finally {
    await browser.close();
  }
}

export async function browserMapGlyphs(
  env: Env,
  fontBase64: string,
  chars: string[],
): Promise<Record<string, string>> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400&display=swap">
      </head><body></body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    try {
      await page.waitForFunction('document.fonts.status === "loaded"', { timeout: 10000 });
    } catch {
      // Continue with fallback system fonts.
    }
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
