# zhihu

## 可视化快速部署

1. Fork 本仓库到自己的 GitHub 账号
2. 进入 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. 选择 Continue with GitHub 并选择你的仓库
4. 构建命令留空，部署命令填 `npm run deploy`
5. 打开生成的 Workers 域名

- Workers 默认域名在部分网络环境不可直连。如需自定义域名，到 [Workers 设置](https://dash.cloudflare.com/?to=/:account/workers/services/view/zhihu/production/settings)里添加。

## 接口

所有接口都需要在请求头里带上知乎 Cookie。

### GET `/`

无请求体。根据请求头 Cookie 返回是否已登录。

```json
{ "logged_in": true, "message": "已登录" }
```

### GET `/recommend`

只返回推荐列表，不拉取全文。

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `6` | 条数，1–20 |

```
GET /recommend?limit=6
```

### GET `/recommend/:id`

按推荐条目补全文。`type` 使用 `/recommend` 返回的 `type`（如 `回答`、`问题`、`文章`、`盐选小说`）。结果包含 `segments`、`content`、`html`、`markdown`。

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `type` | 必填 | 条目类型 |

```
GET /recommend/123456789?type=回答
```

### GET `/comments/:answer_id`

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页条数，1–50 |
| `offset` | `""` | 翻页游标，空为第一页 |
| `order_by` | `score` | 排序 |

```
GET /comments/123456789?limit=20&offset=&order_by=score
```

### GET `/child_comments/:comment_id`

Query：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页条数，1–50 |
| `offset` | `""` | 翻页游标 |

```
GET /child_comments/456?limit=20
```

### POST `/decode`

`Content-Type: application/json`

只解盐选。专栏页走页面 + 字体解码。盐选回答 URL 只从该回答自己的元数据里取对应专栏，再走同一套解码。不是盐选则返回 400。

无头浏览器更新了 Cookie 时，响应会多出 `cookie` 字段（以及 `cookie_refreshed: true`）。

```json
{
  "url": "https://www.zhihu.com/market/paid_column/<id>/section/<id>"
}
```

也支持盐选回答：

- `https://www.zhihu.com/question/<id>/answer/<id>`
- `https://www.zhihu.com/answer/<id>`
