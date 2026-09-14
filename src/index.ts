import { hasLogin, loadCookieHeader, parseCookieHeader } from "./cookies";
import { decodeZhihuUrl } from "./decode";
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
        const recs = await fetchRecommendations(cookie, limit);
        return json({ count: recs.length, data: recs });
      }

      const recommendItemMatch = path.match(/^\/recommend\/([^/]+)$/);
      if (recommendItemMatch) {
        const cookie = await getCookieOrThrow(env);
        const id = recommendItemMatch[1];
        const type = (url.searchParams.get("type") ?? "").trim();
        if (!type) return json({ error: "Missing 'type' query parameter" }, 400);
        const detail = await fetchFullContent(cookie, { type, id });
        if (!detail) return json({ error: "Content not found" }, 404);
        const entry: Record<string, unknown> = {
          type: detail.type,
          id,
          title: detail.title,
          author: detail.author,
          content_length: detail.plain_text.length,
          segments: detail.segments,
          content: detail.plain_text,
          html: detail.html,
          markdown: detail.markdown,
        };
        if (detail.question_detail) entry.question_detail = detail.question_detail;
        return json(entry);
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
        const result = await decodeZhihuUrl(env, target);
        return json(result);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
