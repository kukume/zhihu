# 接口

Cookie 存在 KV，键名：`zhihu_cookie`  
值为一行 Cookie 头：`z_c0=...; __zse_ck=...`

不要把 Cookie 发到聊天、Issue 或 PR 里。Agent 也不会去读 KV 里的明文。需要测试时，Worker 自己从 KV 取 Cookie；本地写入：

```bash
npx wrangler kv key put zhihu_cookie --binding ZHIHU_KV --remote --path cookie.txt
```

`cookie.txt` 已在 `.gitignore`。Dashboard 的 KV 编辑器也可以改这个键。改完后看 `GET /` 的 `logged_in` 即可，接口不会回传 Cookie。

## GET `/`

无请求体。返回是否已登录。

```json
{ "logged_in": true, "message": "已登录" }
```

## GET `/recommend`

只返回推荐列表，不拉取全文。

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `6` | 条数，1–20 |

```
GET /recommend?limit=6
```

## GET `/recommend/:id`

按推荐条目补全文。`type` 使用 `/recommend` 返回的 `type`（如 `回答`、`问题`、`文章`、`盐选小说`）。结果包含 `segments`、`content`、`html`、`markdown`。

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `type` | 必填 | 条目类型 |

```
GET /recommend/123456789?type=回答
```

## GET `/comments/:answer_id`

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页条数，1–50 |
| `offset` | `""` | 翻页游标，空为第一页 |
| `order_by` | `score` | 排序 |

```
GET /comments/123456789?limit=20&offset=&order_by=score
```

## GET `/child_comments/:comment_id`

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页条数，1–50 |
| `offset` | `""` | 翻页游标 |

```
GET /child_comments/456?limit=20
```

## POST `/decode`

`Content-Type: application/json`

盐选专栏页走页面 + 字体解码（这条链路保持原样）。问答 / 文章 URL 如果能解析到对应的 `paid_column/.../section/...`，会转到同一套专栏解码，避免把问答页里的 CSS 抽进正文，也避免内容 API 只返回节选。

普通回答 / 问题 / 文章没有专栏链接时，走内容 API，返回 `html`（仅 RichText）以及 `text` / `markdown` / `segments`。

```json
{
  "url": "https://www.zhihu.com/question/459329916/answer/2077838700549857848"
}
```

也支持：

- `https://www.zhihu.com/question/<id>`
- `https://www.zhihu.com/answer/<id>`
- `https://zhuanlan.zhihu.com/p/<id>`
- `https://www.zhihu.com/market/paid_column/<id>/section/<id>`
