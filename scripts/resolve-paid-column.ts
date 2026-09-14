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
          next_section_info_url: (live.next_section_info as { url?: string } | undefined)?.url ?? null,
          new_intro_card_url: (live.new_intro_card as { url?: string } | undefined)?.url ?? null,
        },
        null,
        2,
      ),
    );
    if (liveUrl !== EXPECTED) {
      throw new Error(`live kmqa mismatch: ${liveUrl}`);
    }
  } else {
    console.log("live kmqa: no payload");
  }

  try {
    const resolved = await resolvePaidColumnForAnswer(cookie, ANSWER_URL);
    console.log(JSON.stringify(resolved, null, 2));
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
