import { paidColumnUrlFromCatalog, resolvePaidColumnUrlFromMeta } from "./catalog";
import { zhihuHeaders } from "./cookies";
import { looksLikeChallenge } from "./fonts";
import { extractAnswerEntity } from "./html";
import {
  assertSafeZhihuUrl,
  isPaidAnswerPayload,
  paidColumnUrlFromPaidContent,
  parseZhihuUrl,
  type ZhihuTarget,
} from "./urls";
import {
  candidateColumnIdsFromAnswer,
  fetchAnswerPaidContent,
  fetchAnswerPayload,
  fetchPaidColumnCatalog,
  HttpError,
} from "./zhihu";

export type PaidColumnResolve = {
  paidUrl: string;
  answerId: string;
  questionId?: string;
  payloadKeys: string[];
  candidates: string[];
  extras: unknown;
  biz_ext: unknown;
  source: string;
};

export async function httpFetchHtml(url: string, cookie: string): Promise<{ status: number; html: string }> {
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

export async function resolvePaidColumnForAnswer(cookie: string, url: string): Promise<PaidColumnResolve> {
  let target: ZhihuTarget;
  try {
    target = parseZhihuUrl(url);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Invalid URL");
  }
  if (target.kind === "paid") {
    return {
      paidUrl: target.url,
      answerId: target.sectionId,
      payloadKeys: [],
      candidates: [],
      extras: null,
      biz_ext: null,
      source: "url",
    };
  }
  if (target.kind !== "answer") {
    throw new HttpError(400, "不是盐选内容");
  }
  return resolvePaidColumnUrl(cookie, target);
}

async function resolvePaidColumnUrl(
  cookie: string,
  target: Extract<ZhihuTarget, { kind: "answer" }>,
): Promise<PaidColumnResolve> {
  const paidContent = await fetchAnswerPaidContent(cookie, target.id);
  const fromPaidContent = paidColumnUrlFromPaidContent(paidContent);
  if (fromPaidContent) {
    console.log(`paid-column answer=${target.id} kmqa=${fromPaidContent}`);
    return {
      paidUrl: fromPaidContent,
      answerId: target.id,
      questionId: target.questionId,
      payloadKeys: paidContent ? Object.keys(paidContent) : [],
      candidates: [],
      extras: null,
      biz_ext: null,
      source: "kmqa_paid_content",
    };
  }

  const fetched = await fetchAnswerPayload(cookie, target.id, target.questionId);
  const payload = fetched?.data ?? null;
  if (!payload || !isPaidAnswerPayload(payload)) {
    throw new HttpError(400, "不是盐选内容", {
      payload_keys: payload ? Object.keys(payload) : [],
    });
  }
  const fetchCatalog = (columnId: string) => fetchPaidColumnCatalog(columnId, cookie);
  const title = String(((payload.question as { title?: unknown }) ?? {}).title ?? "");
  const fromApi = await resolvePaidColumnUrlFromMeta(payload, {
    answerId: target.id,
    title,
    fetchCatalog,
  });
  const questionId = String(((payload.question as { id?: unknown }) ?? {}).id ?? target.questionId ?? "");
  const candidates = candidateColumnIdsFromAnswer(fetched?.raw ?? "", [target.id, questionId]);
  const debug = {
    answerId: target.id,
    questionId: questionId || undefined,
    payloadKeys: Object.keys(payload),
    candidates,
    extras: payload.extras ?? null,
    biz_ext: payload.biz_ext ?? null,
    source: "answer_meta",
  };
  console.log(
    `paid-column answer=${target.id} keys=${debug.payloadKeys.join(",")} extras=${JSON.stringify(debug.extras)} biz_ext=${JSON.stringify(debug.biz_ext)} candidates=${candidates.join(",")}`,
  );

  const finish = (paidUrl: string, source: string): PaidColumnResolve => ({ paidUrl, ...debug, source });

  if (fromApi) return finish(fromApi, "answer_meta");

  for (const columnId of candidates.slice(0, 8)) {
    const catalog = await fetchCatalog(columnId);
    const paidUrl = paidColumnUrlFromCatalog(columnId, catalog, { answerId: target.id, title });
    if (paidUrl) return finish(paidUrl, "catalog");
  }

  const page = await httpFetchHtml(target.url, cookie);
  if (!looksLikeChallenge(page.html, page.status)) {
    const entity = extractAnswerEntity(page.html, target.id);
    const fromHtml = await resolvePaidColumnUrlFromMeta(entity, {
      answerId: target.id,
      fetchCatalog,
    });
    if (fromHtml) return finish(fromHtml, "html");
  }
  throw new HttpError(400, "未找到对应盐选专栏", debug);
}
