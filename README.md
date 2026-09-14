# 接口

Cookie 存在 KV，键名：`zhihu_cookie`  
值为一行 Cookie 头：`z_c0=...; __zse_ck=...`

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

```json
{
  "url": "https://www.zhihu.com/market/paid_column/<id>/section/<id>"
}
```
