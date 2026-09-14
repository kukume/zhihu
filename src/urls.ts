export type ZhihuTarget =
  | { kind: "answer"; id: string; questionId?: string; url: string }
  | { kind: "question"; id: string; url: string }
  | { kind: "article"; id: string; url: string }
  | { kind: "paid"; columnId: string; sectionId: string; url: string }
  | { kind: "unknown"; url: string };

const ID = "([0-9]+)";

export function parseZhihuUrl(raw: string): ZhihuTarget {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const url = parsed.toString();

  if (host !== "zhihu.com" && host !== "zhuanlan.zhihu.com") {
    return { kind: "unknown", url };
  }

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

const PAID_COLUMN_RE = /(?:https?:\/\/(?:www\.)?zhihu\.com)?\/market\/paid_column\/(\d+)\/section\/(\d+)/;

export function findPaidColumnUrl(text: string): string | null {
  const match = text.match(PAID_COLUMN_RE);
  if (!match) return null;
  return `https://www.zhihu.com/market/paid_column/${match[1]}/section/${match[2]}`;
}

export function isPaidAnswerPayload(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (String(data.answer_type ?? "") === "paid") return true;
  const label = data.label_info;
  if (label && typeof label === "object" && String((label as { type?: unknown }).type ?? "") === "paid") {
    return true;
  }
  return Boolean(findPaidColumnUrl(JSON.stringify(data)));
}
