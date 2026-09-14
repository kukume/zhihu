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
  extractAnswerEntity,
  extractArticleHtml,
  extractTitle,
  htmlToMarkdown,
  htmlToPlain,
  htmlToSegments,
  looksLikeCssDump,
  type Segment,
} from "./html";
import { resolvePaidColumnUrlFromMeta } from "./catalog";
import {
  assertSafeZhihuUrl,
  isPaidAnswerPayload,
  paidColumnRefFromAnswerMeta,
  parseZhihuUrl,
  targetId,
  targetTypeLabel,
  type ZhihuTarget,
} from "./urls";
import { fetchAnswerJson, fetchPaidColumnCatalog, getCookieOrThrow, HttpError } from "./zhihu";

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
  let current = assertSafeZhihuUrl(url);
  for (let i = 0; i < 5; i++) {
    const resp = await fetch(current, {
      headers: zhihuHeaders(cookie, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"),
      redirect: "manual",
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("Location");
      if (!location) throw new HttpError(502, "Invalid redirect");
      try {
        current = assertSafeZhihuUrl(new URL(location, current).toString());
      } catch {
        throw new HttpError(502, "Invalid redirect");
      }
      continue;
    }
    const html = await resp.text();
    return { status: resp.status, html };
  }
  throw new HttpError(502, "Too many redirects");
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
  if (target.kind !== "paid") {
    throw new HttpError(400, "不是盐选内容");
  }
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

async function followPaidColumn(
  env: Env,
  original: ZhihuTarget,
  paidUrl: string,
  warnings: string[],
): Promise<DecodeResult> {
  const paidTarget = parseZhihuUrl(paidUrl);
  if (paidTarget.kind !== "paid") {
    throw new HttpError(400, "未找到对应盐选专栏");
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

async function resolvePaidColumnUrl(cookie: string, target: Extract<ZhihuTarget, { kind: "answer" }>): Promise<string | null> {
  const payload = await fetchAnswerJson(cookie, target.id);
  if (!payload || !isPaidAnswerPayload(payload)) {
    throw new HttpError(400, "不是盐选内容");
  }
  const ref = paidColumnRefFromAnswerMeta(payload);
  const paidInfo =
    payload.paid_info && typeof payload.paid_info === "object" && !Array.isArray(payload.paid_info)
      ? Object.keys(payload.paid_info as Record<string, unknown>)
      : [];
  console.log(
    `paid-column answer=${target.id} keys=${Object.keys(payload).join(",")} paid_info=${paidInfo.join(",")} ref=${JSON.stringify(ref)}`,
  );
  const fetchCatalog = (columnId: string) => fetchPaidColumnCatalog(columnId, cookie);
  const fromApi = await resolvePaidColumnUrlFromMeta(payload, {
    answerId: target.id,
    title: String(((payload.question as { title?: unknown }) ?? {}).title ?? ""),
    fetchCatalog,
  });
  if (fromApi) return fromApi;

  const page = await httpFetchHtml(target.url, cookie);
  if (looksLikeChallenge(page.html, page.status)) return null;
  const entity = extractAnswerEntity(page.html, target.id);
  return resolvePaidColumnUrlFromMeta(entity, {
    answerId: target.id,
    fetchCatalog,
  });
}

export async function decodeZhihuUrl(env: Env, url: string): Promise<DecodeResult> {
  let target: ZhihuTarget;
  try {
    target = parseZhihuUrl(url);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Invalid URL");
  }

  if (target.kind === "paid") {
    return decodePaidPage(env, target);
  }

  if (target.kind === "answer") {
    const cookie = await getCookieOrThrow(env);
    const paidUrl = await resolvePaidColumnUrl(cookie, target);
    if (!paidUrl) throw new HttpError(400, "未找到对应盐选专栏");
    return followPaidColumn(env, target, paidUrl, []);
  }

  throw new HttpError(400, "不是盐选内容");
}
