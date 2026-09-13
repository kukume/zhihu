import { browserFetchPaid, browserMapGlyphs } from "./browser";
import { loadCookieHeader, zhihuHeaders } from "./cookies";
import {
  applyMapping,
  extractBase64Fonts,
  looksLikeChallenge,
  looksLikePaidHtml,
  pickContentFont,
} from "./fonts";
import { extractArticleText, extractTitle } from "./html";

export type DecodeResult = {
  title: string;
  font_count: number;
  mapping_size: number;
  text_length: number;
  text: string;
  warnings: string[];
  cookie_refreshed: boolean;
};

async function httpFetchHtml(url: string, cookie: string): Promise<{ status: number; html: string }> {
  const resp = await fetch(url, {
    headers: zhihuHeaders(cookie, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"),
    redirect: "follow",
  });
  const html = await resp.text();
  return { status: resp.status, html };
}

async function decodeFromHtml(
  env: Env,
  html: string,
  warnings: string[],
): Promise<DecodeResult> {
  const title = extractTitle(html);
  const fonts = extractBase64Fonts(html);
  const picked = pickContentFont(fonts);
  let mapping: Record<string, string> = {};
  if (picked) {
    try {
      mapping = await browserMapGlyphs(env, picked.font.base64, picked.chars);
    } catch (err) {
      warnings.push(`Glyph mapping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push("No content font found in HTML");
  }

  let text = extractArticleText(html);
  if (Object.keys(mapping).length) text = applyMapping(text, mapping);
  text = text
    .replace(/备案号:[\s\S]*?(?:禁止转载)?\s*$/u, "")
    .replace(/©\s*本内容版权为知乎及版权方所有[\s\S]*?侵权必究\s*/u, "")
    .trim();

  return {
    title,
    font_count: fonts.length,
    mapping_size: Object.keys(mapping).length,
    text_length: text.length,
    text,
    warnings,
    cookie_refreshed: false,
  };
}

export async function decodePaidPage(env: Env, url: string): Promise<DecodeResult> {
  const warnings: string[] = [];
  let cookie = await loadCookieHeader(env);
  if (!cookie) {
    throw new Error("No cookies. PUT /cookies with a Zhihu Cookie header first.");
  }

  const first = await httpFetchHtml(url, cookie);
  if (!looksLikeChallenge(first.html, first.status) && looksLikePaidHtml(first.html)) {
    return decodeFromHtml(env, first.html, warnings);
  }

  warnings.push(
    `HTTP fetch failed (${first.status}, ${first.html.length} bytes); refreshing cookies via Cloudflare Browser Rendering`,
  );
  const refreshed = await browserFetchPaid(env, url, cookie);
  const title = extractTitle(refreshed.html);
  const fonts = extractBase64Fonts(refreshed.html);
  let text = extractArticleText(refreshed.html);
  if (Object.keys(refreshed.mapping).length) {
    text = applyMapping(text, refreshed.mapping);
  } else {
    warnings.push("No content font found in HTML");
  }
  text = text
    .replace(/备案号:[\s\S]*?(?:禁止转载)?\s*$/u, "")
    .replace(/©\s*本内容版权为知乎及版权方所有[\s\S]*?侵权必究\s*/u, "")
    .trim();
  if (!looksLikePaidHtml(refreshed.html)) {
    warnings.push("Browser fetch still did not return paid HTML. Cookie may lack 盐选 access or login expired.");
  }
  return {
    title,
    font_count: fonts.length,
    mapping_size: Object.keys(refreshed.mapping).length,
    text_length: text.length,
    text,
    warnings,
    cookie_refreshed: true,
  };
}
