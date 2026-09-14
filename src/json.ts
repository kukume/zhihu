/** Quote 15+ digit integers so snowflake IDs are not rounded by JSON.parse. */
export function parseZhihuJson(text: string): unknown {
  const quoted = text.replace(/([\[:,]\s*)(-?\d{15,})(\s*[,\}\]])/g, '$1"$2"$3');
  return JSON.parse(quoted);
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

