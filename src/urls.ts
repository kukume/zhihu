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
const SKIP_META_KEYS = new Set([
  "content",
  "excerpt",
  "excerpt_new",
  "author",
  "question",
  "editable_content",
  "html",
  "text",
  "detail",
]);
const COLUMN_ID_KEYS = ["column_id", "paid_column_id", "columnId", "sku_id", "business_id", "skuId"];
const SECTION_ID_KEYS = ["section_id", "paid_section_id", "sectionId", "track_id"];

export type PaidColumnRef = {
  columnId: string;
  sectionId?: string;
};

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

export function paidColumnRefFromString(value: string): PaidColumnRef | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim(), "https://www.zhihu.com");
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!isZhihuPageHost(parsed.hostname)) return null;
  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  const withSection = path.match(/^\/market\/paid_column\/(\d+)\/section\/(\d+)$/);
  if (withSection) return { columnId: withSection[1], sectionId: withSection[2] };

  const columnOnly = path.match(/^\/market\/paid_column\/(\d+)$/);
  if (columnOnly) return { columnId: columnOnly[1] };

  const xen = path.match(/^\/xen\/market\/remix\/paid_column\/(\d+)$/);
  if (xen) return { columnId: xen[1] };

  if (path === "/market/manuscript") {
    const business = parsed.searchParams.get("business_id") ?? "";
    const track = parsed.searchParams.get("track_id") ?? "";
    if (/^\d+$/.test(business) && /^\d+$/.test(track)) {
      return { columnId: business, sectionId: track };
    }
    if (/^\d+$/.test(business)) return { columnId: business };
  }
  return null;
}

function pickId(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    // Snowflake IDs do not fit in JS numbers; only accept decimal strings or safe integers.
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return value;
  }
  return null;
}

function betterRef(a: PaidColumnRef | null, b: PaidColumnRef | null): PaidColumnRef | null {
  if (!a) return b;
  if (!b) return a;
  if (a.sectionId && !b.sectionId) return a;
  if (b.sectionId && !a.sectionId) return b;
  return a;
}

function usableColumnId(id: string | null, answerId?: string | null, questionId?: string | null): string | null {
  if (!id) return null;
  if (id === answerId || id === questionId) return null;
  return id;
}

function refFromMetaObject(
  obj: Record<string, unknown>,
  answerId?: string | null,
  questionId?: string | null,
): PaidColumnRef | null {
  let best: PaidColumnRef | null = null;
  for (const key of URL_META_KEYS) {
    const value = obj[key];
    if (typeof value === "string") best = betterRef(best, paidColumnRefFromString(value));
  }
  const columnId = usableColumnId(pickId(obj, COLUMN_ID_KEYS), answerId, questionId);
  const sectionId = pickId(obj, SECTION_ID_KEYS);
  if (columnId) {
    best = betterRef(best, sectionId && sectionId !== answerId ? { columnId, sectionId } : { columnId });
  }
  const column = obj.column;
  const section = obj.section;
  if (column && typeof column === "object" && section && typeof section === "object" && !Array.isArray(column) && !Array.isArray(section)) {
    const nestedColumn = usableColumnId(
      pickId(column as Record<string, unknown>, ["id", "column_id"]),
      answerId,
      questionId,
    );
    const nestedSection = pickId(section as Record<string, unknown>, ["id", "section_id"]);
    if (nestedColumn && nestedSection) best = betterRef(best, { columnId: nestedColumn, sectionId: nestedSection });
  }
  return best;
}

function walkMeta(
  node: unknown,
  depth: number,
  seen: Set<unknown>,
  answerId?: string | null,
  questionId?: string | null,
): PaidColumnRef | null {
  if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return null;
  seen.add(node);
  if (Array.isArray(node)) {
    let best: PaidColumnRef | null = null;
    for (const item of node) best = betterRef(best, walkMeta(item, depth + 1, seen, answerId, questionId));
    return best;
  }
  const rec = node as Record<string, unknown>;
  let best = refFromMetaObject(rec, answerId, questionId);
  for (const [key, value] of Object.entries(rec)) {
    if (SKIP_META_KEYS.has(key)) continue;
    if (typeof value === "string") best = betterRef(best, paidColumnRefFromString(value));
    else best = betterRef(best, walkMeta(value, depth + 1, seen, answerId, questionId));
  }
  return best;
}

export function paidColumnRefFromAnswerMeta(data: Record<string, unknown> | null | undefined): PaidColumnRef | null {
  if (!data) return null;
  const answerId = pickId(data, ["id"]);
  const question =
    data.question && typeof data.question === "object" && !Array.isArray(data.question)
      ? (data.question as Record<string, unknown>)
      : null;
  const questionId = question ? pickId(question, ["id"]) : null;
  return walkMeta(data, 0, new Set(), answerId, questionId);
}

export function paidColumnUrlFromAnswerMeta(data: Record<string, unknown> | null | undefined): string | null {
  const ref = paidColumnRefFromAnswerMeta(data);
  if (!ref?.sectionId) return null;
  return paidColumnUrlFromIds(ref.columnId, ref.sectionId);
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
