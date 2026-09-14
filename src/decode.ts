import { browserFetchPaid, browserMapGlyphs, type GlyphMapResult } from "./browser";
import { loadCookieHeader, zhihuHeaders } from "./cookies";
import {
  applyMapping,
  extractBase64Fonts,
  looksLikeChallenge,
  looksLikePaidHtml,
  pickContentFont,
} from "./fonts";
import {
  extractArticleHtml,
  extractTitle,
  htmlToMarkdown,
  htmlToPlain,
  htmlToSegments,
  looksLikeCssDump,
  type Segment,
} from "./html";
import { parseZhihuUrl, targetId, targetTypeLabel, findPaidColumnUrl, isPaidAnswerPayload, type ZhihuTarget } from "./urls";
import { fetchAnswerJson, fetchFullContent, getCookieOrThrow, HttpError } from "./zhihu";

export type DecodeResult = {
  url: string;
  paid_url?: string;
  type: string;
  id: string;
  question_id?: string;
  title: string;
  author: string;
  question_detail?: string;
  segments: Segment[];
  html: string;
  markdown: string;
  content: string;
  text: string;
  text_length: number;
  font_count: number;
  mapping_size: number;
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

function stripLegalFooter(text: string): string {
  return text
    .replace(/备案号:[\s\S]*?(?:禁止转载)?\s*$/u, "")
    .replace(/©\s*本内容版权为知乎及版权方所有[\s\S]*?侵权必究\s*/u, "")
    .trim();
}

function applyGlyphsToHtml(html: string, mapped: GlyphMapResult, warnings: string[]): string {
  if (mapped.tofu) {
    warnings.push(mapped.error || "Reference CJK font failed to render; text left undecoded");
    return html;
  }
  if (Object.keys(mapped.mapping).length) {
    if (mapped.meanBest > 0 && mapped.meanBest < 0.7) {
      warnings.push(`Glyph match score ${mapped.meanBest.toFixed(2)} (Python-style mapping still applied)`);
    }
    return applyMapping(html, mapped.mapping);
  }
  if (html) warnings.push("No usable glyph mapping; text is still font-obfuscated");
  return html;
}

function resultFromHtmlBody(
  target: ZhihuTarget,
  htmlBody: string,
  title: string,
  mapped: GlyphMapResult,
  warnings: string[],
  extras: { font_count: number; cookie_refreshed: boolean; author?: string; question_detail?: string },
): DecodeResult {
  const decodedHtml = applyGlyphsToHtml(htmlBody, mapped, warnings);
  const text = stripLegalFooter(htmlToPlain(decodedHtml));
  if (looksLikeCssDump(text)) {
    warnings.push("Extracted text still looks like CSS; article body selector may have missed");
  }
  if (!text && !htmlToSegments(decodedHtml).length) {
    warnings.push("Article body not found in HTML");
  }
  return {
    url: target.url,
    type: targetTypeLabel(target),
    id: targetId(target),
    question_id: target.kind === "answer" ? target.questionId : undefined,
    title,
    author: extras.author ?? "",
    question_detail: extras.question_detail,
    segments: htmlToSegments(decodedHtml),
    html: decodedHtml,
    markdown: htmlToMarkdown(decodedHtml),
    content: text,
    text,
    text_length: text.length,
    font_count: extras.font_count,
    mapping_size: Object.keys(mapped.mapping).length,
    warnings,
    cookie_refreshed: extras.cookie_refreshed,
  };
}

async function decodeFromHtml(
  env: Env,
  target: ZhihuTarget,
  html: string,
  warnings: string[],
): Promise<DecodeResult> {
  const title = extractTitle(html);
  const fonts = extractBase64Fonts(html);
  const picked = pickContentFont(fonts);
  let mapped: GlyphMapResult = { mapping: {}, meanBest: 0, tofu: false };
  if (picked) {
    try {
      mapped = await browserMapGlyphs(env, picked.font.base64, picked.chars);
    } catch (err) {
      warnings.push(`Glyph mapping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (target.kind === "paid") {
    warnings.push("No content font found in HTML");
  }
  const body = extractArticleHtml(html, targetId(target));
  return resultFromHtmlBody(target, body, title, mapped, warnings, {
    font_count: fonts.length,
    cookie_refreshed: false,
  });
}

async function decodePaidPage(env: Env, target: ZhihuTarget): Promise<DecodeResult> {
  const warnings: string[] = [];
  const cookie = await loadCookieHeader(env);
  if (!cookie) {
    throw new HttpError(401, "未登录");
  }

  const first = await httpFetchHtml(target.url, cookie);
  if (!looksLikeChallenge(first.html, first.status) && looksLikePaidHtml(first.html)) {
    return decodeFromHtml(env, target, first.html, warnings);
  }

  warnings.push(
    `HTTP fetch failed (${first.status}, ${first.html.length} bytes); refreshing cookies via Cloudflare Browser Rendering`,
  );
  const refreshed = await browserFetchPaid(env, target.url, cookie);
  const title = extractTitle(refreshed.html);
  const fonts = extractBase64Fonts(refreshed.html);
  const body = extractArticleHtml(refreshed.html, targetId(target));
  if (!looksLikePaidHtml(refreshed.html)) {
    warnings.push("Browser fetch still did not return paid HTML. Cookie may lack 盐选 access or login expired.");
  }
  return resultFromHtmlBody(target, body, title, refreshed.mapped, warnings, {
    font_count: fonts.length,
    cookie_refreshed: true,
  });
}

function hasUsableBody(detail: {
  plain_text: string;
  segments: Segment[];
}): boolean {
  return Boolean(detail.plain_text.trim()) || detail.segments.some((s) => s.type === "image");
}

async function decodeViaApi(env: Env, target: ZhihuTarget, warnings: string[]): Promise<DecodeResult | null> {
  const cookie = await getCookieOrThrow(env);
  const detail = await fetchFullContent(cookie, {
    type: targetTypeLabel(target),
    id: targetId(target),
  });
  if (!detail || !hasUsableBody(detail)) return null;
  const text = stripLegalFooter(detail.plain_text);
  if (looksLikeCssDump(text)) {
    warnings.push("API content looks like CSS; falling back to HTML decode");
    return null;
  }
  return {
    url: target.url,
    type: detail.type,
    id: targetId(target),
    question_id: target.kind === "answer" ? target.questionId : undefined,
    title: detail.title,
    author: detail.author,
    question_detail: detail.question_detail || undefined,
    segments: detail.segments,
    html: detail.html,
    markdown: detail.markdown,
    content: text,
    text,
    text_length: text.length,
    font_count: 0,
    mapping_size: 0,
    warnings,
    cookie_refreshed: false,
  };
}

async function followPaidColumn(
  env: Env,
  original: ZhihuTarget,
  paidUrl: string,
  warnings: string[],
): Promise<DecodeResult> {
  const paidTarget = parseZhihuUrl(paidUrl);
  if (paidTarget.kind !== "paid") {
    throw new HttpError(500, "Invalid paid column URL");
  }
  warnings.push(`Using linked 盐选专栏 ${paidUrl}`);
  const paid = await decodePaidPage(env, paidTarget);
  return {
    ...paid,
    url: original.url,
    paid_url: paidUrl,
    question_id: original.kind === "answer" ? original.questionId : paid.question_id,
    warnings: [...warnings, ...paid.warnings],
  };
}

async function decodeAnswerLike(env: Env, target: ZhihuTarget, warnings: string[]): Promise<DecodeResult> {
  const cookie = await getCookieOrThrow(env);

  if (target.kind === "answer") {
    const payload = await fetchAnswerJson(cookie, target.id);
    const paidFromApi = payload ? findPaidColumnUrl(JSON.stringify(payload)) : null;
    if (paidFromApi) return followPaidColumn(env, target, paidFromApi, warnings);
    const paidAnswer = isPaidAnswerPayload(payload ?? undefined);

    const page = await httpFetchHtml(target.url, cookie);
    if (!looksLikeChallenge(page.html, page.status)) {
      const paidFromHtml = findPaidColumnUrl(page.html);
      if (paidFromHtml) return followPaidColumn(env, target, paidFromHtml, warnings);
      if (paidAnswer || pickContentFont(extractBase64Fonts(page.html))) {
        return decodeFromHtml(env, target, page.html, warnings);
      }
    }

    if (!paidAnswer) {
      const viaApi = await decodeViaApi(env, target, warnings);
      if (viaApi) return viaApi;
    }
    return decodePaidPage(env, target);
  }

  const page = await httpFetchHtml(target.url, cookie);
  if (!looksLikeChallenge(page.html, page.status)) {
    const paidFromHtml = findPaidColumnUrl(page.html);
    if (paidFromHtml) return followPaidColumn(env, target, paidFromHtml, warnings);
  }

  const viaApi = await decodeViaApi(env, target, warnings);
  if (viaApi) return viaApi;
  return decodePaidPage(env, target);
}

export async function decodeZhihuUrl(env: Env, url: string): Promise<DecodeResult> {
  let target: ZhihuTarget;
  try {
    target = parseZhihuUrl(url);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }
  const warnings: string[] = [];

  if (target.kind === "paid") {
    return decodePaidPage(env, target);
  }

  if (target.kind === "answer" || target.kind === "question" || target.kind === "article") {
    try {
      return await decodeAnswerLike(env, target, warnings);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) throw err;
      warnings.push(`Content API failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return decodePaidPage(env, target);
}
