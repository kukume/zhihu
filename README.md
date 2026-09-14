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

只解盐选。专栏页走页面 + 字体解码。盐选回答 URL 只从该回答自己的元数据里取对应专栏，再走同一套解码。不是盐选则返回 400。

```json
{
  "url": "https://www.zhihu.com/market/paid_column/<id>/section/<id>"
}
```

也支持盐选回答：

- `https://www.zhihu.com/question/<id>/answer/<id>`
- `https://www.zhihu.com/answer/<id>`
