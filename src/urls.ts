export type ZhihuTarget =
  | { kind: "answer"; id: string; questionId?: string; url: string }
  | { kind: "question"; id: string; url: string }
  | { kind: "article"; id: string; url: string }
  | { kind: "paid"; columnId: string; sectionId: string; url: string }
  | { kind: "unknown"; url: string };

const ID = "([0-9]+)";
const PAGE_HOSTS = new Set(["www.zhihu.com", "zhihu.com", "zhuanlan.zhihu.com"]);
const URL_META_KEYS = new Set([
  "url",
  "share_url",
  "section_url",
  "column_url",
  "paid_url",
  "target_url",
  "href",
  "link",
  "canonical_url",
]);
const META_BAG_KEYS = [
  "paid_info",
  "extra",
  "thumbnail_info",
  "attachment",
  "label_info",
  "paid_column",
  "section",
  "column",
  "sku",
  "commercial_info",
];

export function isZhihuPageHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostname.toLowerCase());
}

export function assertSafeZhihuUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }
  if (!isZhihuPageHost(parsed.hostname)) {
    throw new Error("Not a zhihu.com URL");
  }
  parsed.hash = "";
  return parsed.toString();
}

export function parseZhihuUrl(raw: string): ZhihuTarget {
  const url = assertSafeZhihuUrl(raw);
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  const paid = path.match(new RegExp(`^/market/paid_column/${ID}/section/${ID}$`));
  if (paid) {
    return { kind: "paid", columnId: paid[1], sectionId: paid[2], url };
  }

  const answer = path.match(new RegExp(`^/question/${ID}/answer/${ID}$`));
  if (answer) {
    return { kind: "answer", questionId: answer[1], id: answer[2], url };
  }

  const answerOnly = path.match(new RegExp(`^/answer/${ID}$`));
  if (answerOnly) {
    return { kind: "answer", id: answerOnly[1], url };
  }

  const question = path.match(new RegExp(`^/question/${ID}$`));
  if (question) {
    return { kind: "question", id: question[1], url };
  }

  const article = path.match(/^\/p\/([0-9]+)$/);
  if (article) {
    return { kind: "article", id: article[1], url };
  }

  return { kind: "unknown", url };
}

export function targetTypeLabel(target: ZhihuTarget): string {
  switch (target.kind) {
    case "answer":
      return "回答";
    case "question":
      return "问题";
    case "article":
      return "文章";
    case "paid":
      return "盐选专栏";
    default:
      return "未知";
  }
}

export function targetId(target: ZhihuTarget): string {
  switch (target.kind) {
    case "answer":
    case "question":
    case "article":
      return target.id;
    case "paid":
      return target.sectionId;
    default:
      return "";
  }
}

export function paidColumnUrlFromIds(columnId: string, sectionId: string): string {
  return `https://www.zhihu.com/market/paid_column/${columnId}/section/${sectionId}`;
}

function paidColumnUrlFromString(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim(), "https://www.zhihu.com");
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!isZhihuPageHost(parsed.hostname)) return null;
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const match = path.match(/^\/market\/paid_column\/(\d+)\/section\/(\d+)$/);
  if (!match) return null;
  return paidColumnUrlFromIds(match[1], match[2]);
}

function pickId(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return value;
  }
  return null;
}

function urlFromMetaObject(obj: Record<string, unknown>): string | null {
  for (const key of URL_META_KEYS) {
    const value = obj[key];
    if (typeof value === "string") {
      const found = paidColumnUrlFromString(value);
      if (found) return found;
    }
  }
  const columnId = pickId(obj, ["column_id", "paid_column_id", "columnId"]);
  const sectionId = pickId(obj, ["section_id", "paid_section_id", "sectionId"]);
  if (columnId && sectionId) return paidColumnUrlFromIds(columnId, sectionId);
  return null;
}

export function paidColumnUrlFromAnswerMeta(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const direct = urlFromMetaObject(data);
  if (direct) return direct;
  for (const key of META_BAG_KEYS) {
    const child = data[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const found = urlFromMetaObject(child as Record<string, unknown>);
    if (found) return found;
    const nested = child as Record<string, unknown>;
    const column = nested.column;
    const section = nested.section;
    if (column && typeof column === "object" && section && typeof section === "object") {
      const columnId = pickId(column as Record<string, unknown>, ["id", "column_id"]);
      const sectionId = pickId(section as Record<string, unknown>, ["id", "section_id"]);
      if (columnId && sectionId) return paidColumnUrlFromIds(columnId, sectionId);
    }
  }
  return null;
}

export function isPaidAnswerPayload(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (String(data.answer_type ?? "") === "paid") return true;
  const label = data.label_info;
  if (label && typeof label === "object" && String((label as { type?: unknown }).type ?? "") === "paid") {
    return true;
  }
  return false;
}
