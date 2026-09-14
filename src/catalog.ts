import { paidColumnRefFromAnswerMeta, paidColumnUrlFromIds } from "./urls";

export type CatalogSection = {
  id: string;
  title: string;
  isFirst: boolean;
  raw: Record<string, unknown>;
};

function catalogItemId(item: Record<string, unknown>): string | null {
  const direct = item.id;
  if (typeof direct === "string" && /^\d+$/.test(direct)) return direct;
  const cell = item.section_cell;
  if (cell && typeof cell === "object" && !Array.isArray(cell)) {
    const cellId = (cell as { id?: unknown }).id;
    if (typeof cellId === "string" && /^\d+$/.test(cellId)) return cellId;
  }
  return null;
}

export function catalogSections(catalog: unknown): CatalogSection[] {
  if (!catalog || typeof catalog !== "object") return [];
  const data = (catalog as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const sections: CatalogSection[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const id = catalogItemId(rec);
    if (!id) continue;
    sections.push({
      id,
      title: typeof rec.title === "string" ? rec.title : "",
      isFirst: rec.is_first === true,
      raw: rec,
    });
  }
  return sections;
}

export function paidColumnUrlFromCatalog(
  columnId: string,
  catalog: unknown,
  opts?: { answerId?: string; title?: string },
): string | null {
  if (!/^\d+$/.test(columnId)) return null;
  const sections = catalogSections(catalog);
  if (!sections.length) return null;

  if (opts?.answerId) {
    const hits = sections.filter((section) => JSON.stringify(section.raw).includes(opts.answerId!));
    if (hits.length === 1) return paidColumnUrlFromIds(columnId, hits[0].id);
  }

  if (sections.length === 1) return paidColumnUrlFromIds(columnId, sections[0].id);

  if (opts?.title) {
    const title = opts.title;
    const hits = sections.filter((section) => section.title && (title.includes(section.title) || section.title.includes(title)));
    if (hits.length === 1) return paidColumnUrlFromIds(columnId, hits[0].id);
  }

  return null;
}

export async function resolvePaidColumnUrlFromMeta(
  data: Record<string, unknown> | null | undefined,
  opts: {
    answerId?: string;
    title?: string;
    fetchCatalog: (columnId: string) => Promise<unknown>;
  },
): Promise<string | null> {
  const ref = paidColumnRefFromAnswerMeta(data);
  if (!ref) return null;
  if (ref.sectionId) return paidColumnUrlFromIds(ref.columnId, ref.sectionId);
  const catalog = await opts.fetchCatalog(ref.columnId);
  const question =
    data?.question && typeof data.question === "object" && !Array.isArray(data.question)
      ? (data.question as Record<string, unknown>)
      : null;
  const extra =
    data?.extra && typeof data.extra === "object" && !Array.isArray(data.extra)
      ? (data.extra as Record<string, unknown>)
      : null;
  const title =
    opts.title ||
    (typeof extra?.title === "string" ? extra.title : "") ||
    (typeof question?.title === "string" ? question.title : "");
  return paidColumnUrlFromCatalog(ref.columnId, catalog, { answerId: opts.answerId, title });
}
