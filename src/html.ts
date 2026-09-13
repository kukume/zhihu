export function htmlToPlain(html: string): string {
  let text = html.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div|h\d|li|blockquote|figcaption)\s*>/gi, "\n\n");
  text = text.replace(/<(?:p|div|h\d|li|blockquote)\b[^>]*>/gi, "\n");
  text = text.replace(/<hr\b[^>]*\/?>/gi, "\n---\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text).trim();
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return text.replace(/^\n+|\n+$/g, "");
}

export function htmlToMarkdown(html: string): string {
  let text = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "");
  for (let i = 6; i >= 1; i--) {
    const re = new RegExp(`<h${i}\\b[^>]*>([\\s\\S]*?)</h${i}>`, "gi");
    text = text.replace(re, `${"#".repeat(i)} $1\n`);
  }
  text = text.replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**");
  text = text.replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, "*$1*");
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = attrs.match(/href=["']([^"']+)["']/i);
    const linkText = inner.replace(/<[^>]+>/g, "").trim();
    if (!linkText) return "";
    if (href?.[1]?.startsWith("http")) return `[${linkText}](${href[1]})`;
    return linkText;
  });
  text = text.replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const src = extractImgSrc(tag);
    const alt = tag.match(/alt=["']([^"']*)["']/i)?.[1] ?? "image";
    return src ? `![${alt}](${src})\n` : "";
  });
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const body = htmlToPlain(inner)
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `> ${l}`)
      .join("\n");
    return `\n${body}\n`;
  });
  text = text.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => htmlToPlain(x[1]));
    return `\n${items.filter(Boolean).map((item) => `- ${item}`).join("\n")}\n`;
  });
  text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => htmlToPlain(x[1]));
    return `\n${items
      .filter(Boolean)
      .map((item, i) => `${i + 1}. ${item}`)
      .join("\n")}\n`;
  });
  text = text.replace(/<hr\b[^>]*\/?>/gi, "\n---\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p\s*>/gi, "\n\n");
  text = text.replace(/<\/div\s*>/gi, "\n");
  text = text.replace(/<(?:p|div)\b[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return text.replace(/^\n+|\n+$/g, "");
}

export type Segment = { type: "text"; content: string } | { type: "image"; src: string };

export function htmlToSegments(html: string): Segment[] {
  const parts = html.split(/(<img\b[^>]*\/?>|<figure\b[^>]*>[\s\S]*?<\/figure>)/gi);
  const segments: Segment[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const img = part.match(/<img\b[^>]*\/?>/i);
    if (img) {
      const src = extractImgSrc(img[0]);
      if (src) segments.push({ type: "image", src });
      continue;
    }
    const content = htmlToPlain(part);
    if (content) segments.push({ type: "text", content });
  }
  return segments;
}

export function extractImgSrc(tag: string): string | null {
  for (const attr of ["data-actualsrc", "data-original", "src"]) {
    const m = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
    if (m) return m[1];
  }
  return null;
}

function sliceBalancedDiv(html: string, start: number): string {
  const openEnd = html.indexOf(">", start);
  if (openEnd < 0) return "";
  let depth = 1;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = openEnd + 1;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html))) {
    const token = tag[0];
    if (/^<\/div/i.test(token)) depth--;
    else if (!/\/\s*>$/.test(token)) depth++;
    if (depth === 0) return html.slice(openEnd + 1, tag.index);
  }
  return html.slice(openEnd + 1);
}

function isArticleClass(attrs: string): boolean {
  const cls = attrs.match(/class\s*=\s*["']([^"']+)["']/i)?.[1] ?? attrs;
  return (
    (cls.includes("RichText") && cls.includes("richText")) ||
    cls.includes("CopyrightRichText") ||
    cls.includes("RichContent-inner")
  );
}

function extractFromArticleDivs(html: string): string {
  let best = "";
  const openRe = /<div\b([^>]*)>/gi;
  let open: RegExpExecArray | null;
  while ((open = openRe.exec(html))) {
    if (!isArticleClass(open[1] ?? "")) continue;
    const inner = sliceBalancedDiv(html, open.index);
    const text = htmlToPlain(inner);
    if (text.length > best.length) best = text;
  }
  return best;
}

export function extractArticleText(html: string): string {
  let best = extractFromArticleDivs(html);
  if (best.length > 80) return best;

  const initial = html.match(/id="js-initialData"[^>]*>([\s\S]*?)<\/script>/i);
  if (initial?.[1]) {
    const decoded = initial[1]
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\"/g, '"');
    const nested = extractFromArticleDivs(decoded);
    if (nested.length > best.length) best = nested;
  }
  return best;
}

export function extractTitle(html: string): string {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return m[1]
    .trim()
    .replace(/\s*[-–—|]\s*知乎.*$/u, "")
    .replace(/\s*[-–—|]\s*Zhihu.*$/i, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCharCode(parseInt(n, 16)));
}
