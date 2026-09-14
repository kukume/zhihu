/** Quote 15+ digit integers so snowflake IDs are not rounded by JSON.parse. */
export function parseZhihuJson(text: string): unknown {
  const quoted = quoteSnowflakeNumbers(text);
  try {
    return JSON.parse(quoted);
  } catch {
    // Quoting must never turn valid JSON into a 500. Fall back even if snowflakes round.
    return JSON.parse(text);
  }
}

/** Only rewrite numbers outside JSON strings. Content HTML often contains `[19-digit-id]`. */
export function quoteSnowflakeNumbers(text: string): string {
  let out = "";
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; ) {
    const ch = text[i] ?? "";
    if (inStr) {
      out += ch;
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        i++;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "-") i++;
      const digitStart = i;
      while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i++;
      const digits = text.slice(digitStart, i);
      const next = text[i] ?? "";
      if (digits.length >= 15 && next !== "." && next !== "e" && next !== "E") {
        out += `"${text.slice(start, i)}"`;
        continue;
      }
      out += text.slice(start, i);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function sliceBalanced(raw: string, start: number, open: string, close: string): string {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw.slice(start);
}

function jsonValueAfterKey(raw: string, key: string): string | null {
  const needle = `"${key}"`;
  let from = 0;
  while (from < raw.length) {
    const idx = raw.indexOf(needle, from);
    if (idx < 0) return null;
    let i = idx + needle.length;
    while (i < raw.length && /\s/.test(raw[i] ?? "")) i++;
    if (raw[i] !== ":") {
      from = idx + 1;
      continue;
    }
    i++;
    while (i < raw.length && /\s/.test(raw[i] ?? "")) i++;
    const ch = raw[i];
    if (ch === "{") return sliceBalanced(raw, i, "{", "}");
    if (ch === "[") return sliceBalanced(raw, i, "[", "]");
    if (ch === '"') {
      const rest = raw.slice(i);
      const m = rest.match(/^"(?:\\.|[^"\\])*"/);
      return m?.[0] ?? null;
    }
    const m = raw.slice(i).match(/^-?\d+/);
    return m?.[0] ?? null;
  }
  return null;
}

/** Read 16+ digit IDs from named JSON bags in the raw body, before JSON.parse rounding. */
export function snowflakeIdsFromNamedBags(raw: string, keys: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const snippet = jsonValueAfterKey(raw, key);
    if (!snippet) continue;
    for (const match of snippet.matchAll(/\d{16,}/g)) {
      const id = match[0];
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

