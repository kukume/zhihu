# Zhihu API on Cloudflare Workers

把原 Python 服务迁到 Cloudflare Workers：推荐 / 评论走 HTTP，盐选解码先带 KV 里的 cookie 请求；失败则用 **Cloudflare Browser Rendering** 打开页面，导出 cookie 并覆盖保存后再解码。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/status` | 是否已有登录 cookie |
| PUT | `/cookies` | `{"cookie":"z_c0=...; __zse_ck=..."}` 写入 KV |
| POST | `/cookies/refresh` | 强制用无头浏览器刷新并覆盖 cookie |
| POST | `/logout` | 删除 KV 中的 cookie |
| GET | `/recommend?limit=6&full=1` | 推荐列表 |
| GET | `/comments/<answer_id>` | 评论 |
| GET | `/child_comments/<comment_id>` | 子评论 |
| POST | `/decode` | 盐选解码 `{"url":"https://www.zhihu.com/market/paid_column/..."}` |

## 本地

```bash
cd C:\Users\kuku\VisualStudioProject\zhihu
npm install
copy .dev.vars.example .dev.vars
```

在 `.dev.vars` 可以留空。启动后把 cookie 写入 KV（PowerShell）：

```powershell
$cookie = (Get-Content C:\Users\kuku\Downloads\zhihu0\cookie.txt -Raw).Trim()
Invoke-RestMethod -Method Put http://127.0.0.1:8787/cookies -ContentType application/json -Body (@{ cookie = $cookie } | ConvertTo-Json)
```

```bash
npx wrangler types
npx wrangler dev
```

首次部署前创建 KV（若 `wrangler deploy` 未自动建）：

```bash
npx wrangler kv namespace create ZHIHU_KV
```

把返回的 id 填进 `wrangler.jsonc` 的 `kv_namespaces`。

需要 [Browser Rendering](https://developers.cloudflare.com/browser-run/) 和 Workers Paid（无头浏览器不是免费功能）。

## 部署

```bash
npx wrangler deploy
```

部署后写入 cookie：

```bash
curl -X PUT https://<worker>/cookies -H "content-type: application/json" -d "{\"cookie\":\"...\"}"
```

## 盐选流程

1. 用 KV cookie 直接 `fetch` 专栏页
2. 若 403 / zse-ck 挑战页：启动 Cloudflare 无头浏览器，注入现有 cookie，打开该 URL
3. 把浏览器里的 cookie（含新的 `__zse_ck`）写回 KV，覆盖旧值
4. 抽出 `@font-face`，在无头浏览器里用画布比对字形，还原正文

HTTP 成功拿到页面时，仍会短暂启动一次无头浏览器做字形比对（只加载字体，不再访问知乎）。只有 cookie 失效时才会打开知乎页面并覆盖 KV 里的 cookie。

无头浏览器需要 Cloudflare 账号：`npx wrangler login`，以及账户开通 [Browser Rendering](https://developers.cloudflare.com/browser-run/)。
