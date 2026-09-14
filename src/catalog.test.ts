import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogSections, paidColumnUrlFromCatalog, resolvePaidColumnUrlFromMeta } from "./catalog";
import { fetchPaidColumnCatalog } from "./zhihu";

const COLUMN_ID = "2040529716919198562";
const SECTION_ID = "2038594889668110014";
const ANSWER_ID = "2077838700549857848";
const PAID_URL = `https://www.zhihu.com/market/paid_column/${COLUMN_ID}/section/${SECTION_ID}`;

const LIVE_CATALOG_ONE_SECTION = {
  paging: { has_next: false, totals: 1, is_end: true },
  data: [
    {
      is_first: true,
      id: SECTION_ID,
      title: "消失在滑梯里的公主",
      section_cell: {
        url: `https://www.zhihu.com/market/manuscript?business_id=${COLUMN_ID}&track_id=${SECTION_ID}&sku_type=paid_column`,
        type: "article",
        id: SECTION_ID,
      },
    },
  ],
  extra: {
    title: "消失在滑梯里的公主",
    url: `https://www.zhihu.com/xen/market/remix/paid_column/${COLUMN_ID}`,
    type: "paid_column",
  },
};

test("single-section catalog maps to the market section URL", () => {
  assert.equal(paidColumnUrlFromCatalog(COLUMN_ID, LIVE_CATALOG_ONE_SECTION), PAID_URL);
  assert.equal(catalogSections(LIVE_CATALOG_ONE_SECTION)[0]?.id, SECTION_ID);
});

test("multi-section catalog does not guess the first chapter", () => {
  const catalog = {
    data: [
      { id: "11", title: "第一章", is_first: true },
      { id: "22", title: "第二章", is_first: false },
    ],
  };
  assert.equal(paidColumnUrlFromCatalog("10", catalog), null);
  assert.equal(
    paidColumnUrlFromCatalog("10", catalog, { title: "第二章" }),
    "https://www.zhihu.com/market/paid_column/10/section/22",
  );
});

test("xen extra.url plus catalog resolves the reported Q&A column", async () => {
  const payload = {
    id: ANSWER_ID,
    answer_type: "paid",
    extra: { url: `https://www.zhihu.com/xen/market/remix/paid_column/${COLUMN_ID}` },
    content: '<p>see <a href="https://www.zhihu.com/market/paid_column/1/section/2">盐选</a></p>',
  };
  const url = await resolvePaidColumnUrlFromMeta(payload, {
    answerId: ANSWER_ID,
    fetchCatalog: async () => LIVE_CATALOG_ONE_SECTION,
  });
  assert.equal(url, PAID_URL);
});

test("sku_id plus catalog resolves the same column", async () => {
  const url = await resolvePaidColumnUrlFromMeta(
    {
      id: ANSWER_ID,
      answer_type: "paid",
      paid_info: { sku_id: COLUMN_ID },
    },
    {
      answerId: ANSWER_ID,
      fetchCatalog: async () => LIVE_CATALOG_ONE_SECTION,
    },
  );
  assert.equal(url, PAID_URL);
});

test("live catalog for the reported column returns the known section", async () => {
  const catalog = await fetchPaidColumnCatalog(COLUMN_ID);
  assert.ok(catalog, "catalog request failed");
  const url = paidColumnUrlFromCatalog(COLUMN_ID, catalog);
  assert.equal(url, PAID_URL);
  const live = await resolvePaidColumnUrlFromMeta(
    {
      id: ANSWER_ID,
      answer_type: "paid",
      extra: { url: `https://www.zhihu.com/xen/market/remix/paid_column/${COLUMN_ID}` },
    },
    {
      answerId: ANSWER_ID,
      fetchCatalog: (columnId) => fetchPaidColumnCatalog(columnId),
    },
  );
  assert.equal(live, PAID_URL);
});
