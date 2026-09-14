import { zhihuHeaders } from "./cookies";
import { assertSafeZhihuUrl, paidColumnUrlFromPaidContent, parseZhihuUrl, type ZhihuTarget } from "./urls";
import { fetchAnswerPaidContent, HttpError } from "./zhihu";

export type PaidColumnResolve = {
  paidUrl: string;
  answerId: string;
  questionId?: string;
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
    return { paidUrl: target.url, answerId: target.sectionId };
  }
  if (target.kind !== "answer") {
    throw new HttpError(400, "不是盐选内容");
  }

  const paidContent = await fetchAnswerPaidContent(cookie, target.id);
  const paidUrl = paidColumnUrlFromPaidContent(paidContent);
  if (!paidUrl) {
    throw new HttpError(400, paidContent ? "未找到对应盐选专栏" : "不是盐选内容", {
      answerId: target.id,
      keys: paidContent ? Object.keys(paidContent) : [],
    });
  }
  console.log(`paid-column answer=${target.id} kmqa=${paidUrl}`);
  return {
    paidUrl,
    answerId: target.id,
    questionId: target.questionId,
  };
}
