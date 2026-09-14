import { existsSync, readFileSync } from "node:fs";
import { parseZhihuJson } from "../src/json";
import { resolvePaidColumnForAnswer } from "../src/paid-column";
import { paidColumnUrlFromPaidContent } from "../src/urls";
import { fetchAnswerPaidContent, HttpError } from "../src/zhihu";

const ANSWER_URL =
  process.argv[2] ?? "https://www.zhihu.com/question/459329916/answer/2077838700549857848";
const COOKIE_PATH = process.argv[3] ?? "cookie.txt";
const ANSWER_ID = "2077838700549857848";
const COLUMN_ID = "2040529716919198562";
const SECTION_ID = "2038594889668110014";
const EXPECTED = `https://www.zhihu.com/market/paid_column/${COLUMN_ID}/section/${SECTION_ID}`;

function loadCookie(): string {
  const envCookie = process.env.ZHIHU_COOKIE?.trim() ?? "";
  if (envCookie) return envCookie;
  if (existsSync(COOKIE_PATH)) return readFileSync(COOKIE_PATH, "utf8").trim();
  return "";
}

function selfCheckParser(): void {
  const sku = COLUMN_ID;
  const body = `{"content":"see [${sku}] here","paid_info":{"sku_id":${sku}},"id":${ANSWER_ID}}`;
  const parsed = parseZhihuJson(body) as {
    content: string;
    paid_info: { sku_id: string };
    id: string;
  };
  if (!parsed.content.includes(`[${sku}]`)) {
    throw new Error(`parser ate content: ${parsed.content}`);
  }
  if (parsed.paid_info.sku_id !== sku) {
    throw new Error(`parser missed sku_id: ${JSON.stringify(parsed.paid_info)}`);
  }
  if (parsed.id !== ANSWER_ID) {
    throw new Error(`parser missed answer id: ${parsed.id}`);
  }
  const cited = `{"content":"cite [${ANSWER_ID}]"}`;
  const citedParsed = parseZhihuJson(cited) as { content: string };
  if (citedParsed.content !== `cite [${ANSWER_ID}]`) {
    throw new Error(`parser broke cited id: ${citedParsed.content}`);
  }
  console.log("parser ok");
}

function selfCheckPaidContent(): void {
  const fromUrl = paidColumnUrlFromPaidContent({
    next_section_info: { url: EXPECTED },
    new_intro_card: { url: EXPECTED },
  });
  if (fromUrl !== EXPECTED) throw new Error(`url fields mismatch: ${fromUrl}`);

  const fromIds = paidColumnUrlFromPaidContent({
    id: "2040529717112076092",
    shelves_info: { sku_id: "2040529717112076092", business_id: COLUMN_ID, property_type: "paid_column" },
    za_info: { id: COLUMN_ID, type: "PaidColumn", token: COLUMN_ID },
    goods_card: { body: { content_id: COLUMN_ID, content_type: "Paid_Column" } },
    progress_info: { unit_id: SECTION_ID, type: "paid_column" },
  });
  if (fromIds !== EXPECTED) throw new Error(`id fields mismatch: ${fromIds}`);
  console.log(`paid_content extract ok: ${EXPECTED}`);
}

async function main() {
  selfCheckParser();
  selfCheckPaidContent();

  const cookie = loadCookie();
  const live = await fetchAnswerPaidContent(cookie, ANSWER_ID);
  const liveUrl = paidColumnUrlFromPaidContent(live);
  if (live) {
    console.log(
      JSON.stringify(
        {
          live: true,
          paidUrl: liveUrl,
          keys: Object.keys(live),
          next_section_info: live.next_section_info ?? null,
          new_intro_card: live.new_intro_card ?? null,
          progress_info: live.progress_info ?? null,
          za_info: live.za_info ?? null,
          shelves_info: live.shelves_info ?? null,
        },
        null,
        2,
      ),
    );
    if (liveUrl !== EXPECTED) {
      throw new Error(`live kmqa mismatch: ${liveUrl}`);
    }
  } else {
    console.log("live kmqa: no payload (need z_c0 cookie)");
  }

  if (!cookie) {
    console.log("no cookie; skip resolvePaidColumnForAnswer");
    return;
  }

  try {
    const resolved = await resolvePaidColumnForAnswer(cookie, ANSWER_URL);
    console.log(
      JSON.stringify(
        {
          paidUrl: resolved.paidUrl,
          source: resolved.source,
          answerId: resolved.answerId,
          questionId: resolved.questionId,
          payloadKeys: resolved.payloadKeys,
        },
        null,
        2,
      ),
    );
    if (resolved.paidUrl !== EXPECTED) {
      throw new Error(`resolve mismatch: ${resolved.paidUrl}`);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      console.log(JSON.stringify({ error: err.message, debug: err.details ?? null }, null, 2));
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
