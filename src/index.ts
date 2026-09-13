import { hasLogin, loadCookieHeader, parseCookieHeader } from "./cookies";
import { decodePaidPage } from "./decode";
import {
  fetchChildComments,
  fetchComments,
  fetchFullContent,
  fetchRecommendations,
  getCookieOrThrow,
  HttpError,
} from "./zhihu";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: CORS });
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  const message = err instanceof Error ? err.message : String(err);
  return json({ error: message }, 500);
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/") {
        const cookie = await loadCookieHeader(env);
        const logged_in = hasLogin(parseCookieHeader(cookie));
        return json({
          logged_in,
          message: logged_in ? "已登录" : "未登录",
        });
      }

      if (path === "/recommend") {
        const cookie = await getCookieOrThrow(env);
        const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 6) || 6));
        const full = ["1", "true", "yes"].includes(url.searchParams.get("full") ?? "");
        const recs = await fetchRecommendations(cookie, limit);
        const data = [];
        for (const r of recs) {
          const entry: Record<string, unknown> = {
            type: r.type,
            id: r.id,
            title: r.title ?? "",
            author: r.author ?? "",
            url: r.url ?? "",
            created_time: r.created_time,
            updated_time: r.updated_time,
            voteup: r.voteup,
            comments: r.comments,
          };
          const detail = await fetchFullContent(cookie, r);
          if (detail) {
            entry.content_length = detail.plain_text.length;
            entry.segments = detail.segments;
            if (detail.question_detail) entry.question_detail = detail.question_detail;
            if (full) {
              entry.content = detail.plain_text;
              entry.html = detail.html;
              entry.markdown = detail.markdown;
            } else {
              entry.preview = detail.plain_text.slice(0, 300);
            }
          } else {
            entry.segments = [];
            entry.content_length = 0;
            entry[full ? "content" : "preview"] = null;
          }
          data.push(entry);
        }
        return json({ count: data.length, data });
      }

      const commentsMatch = path.match(/^\/comments\/([^/]+)$/);
      if (commentsMatch) {
        const cookie = await getCookieOrThrow(env);
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
        const offset = url.searchParams.get("offset") ?? "";
        const orderBy = url.searchParams.get("order_by") ?? "score";
        const { comments, paging } = await fetchComments(
          cookie,
          commentsMatch[1],
          limit,
          offset,
          orderBy,
        );
        return json({
          answer_id: commentsMatch[1],
          count: comments.length,
          data: comments,
          paging,
        });
      }

      const childMatch = path.match(/^\/child_comments\/([^/]+)$/);
      if (childMatch) {
        const cookie = await getCookieOrThrow(env);
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
        const offset = url.searchParams.get("offset") ?? "";
        const { comments, paging } = await fetchChildComments(cookie, childMatch[1], limit, offset);
        return json({
          comment_id: childMatch[1],
          count: comments.length,
          data: comments,
          paging,
        });
      }

      if (path === "/decode" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { url?: string };
        const target = (body.url ?? "").trim();
        if (!target) return json({ error: "Missing 'url' in JSON body" }, 400);
        if (!target.includes("zhihu.com")) return json({ error: "Not a zhihu.com URL" }, 400);
        const result = await decodePaidPage(env, target);
        return json(result);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
