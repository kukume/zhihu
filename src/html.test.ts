import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractArticleHtml,
  extractArticleText,
  htmlToPlain,
  looksLikeCssDump,
  stripDocumentNoise,
} from "./html";

const answerPage = `<!doctype html>
<html>
<head>
<title>如何看待某某 - 知乎</title>
<style>
.RichText { color: red; }
.css-abc { font-size: 14px; }
.css-def { margin: 0; }
.css-ghi { padding: 8px; }
.css-jkl { display: block; }
.css-mno { line-height: 1.6; }
.css-pqr { background: #fff; }
.css-stu { border: 0; }
@font-face { font-family: 'icon'; src: url("data:font/ttf;base64,AAAA"); }
</style>
</head>
<body>
<div class="App">
  <span class="RichText ztext CopyrightRichText-richText css-abc">
    <p>正文第一段，讲的是问题本身。</p>
    <p>正文第二段，带一点补充说明。</p>
  </span>
</div>
<script id="js-initialData" type="text/json">{"initialState":{"entities":{"answers":{"2077838700549857848":{"id":"2077838700549857848","content":"<p>JSON正文，不该被样式盖住。</p>"}}}}}</script>
</body>
</html>`;

test("htmlToPlain drops style and script text", () => {
  const text = htmlToPlain(answerPage);
  assert.match(text, /正文第一段/);
  assert.doesNotMatch(text, /font-size/);
  assert.doesNotMatch(text, /css-abc/);
  assert.doesNotMatch(text, /JSON正文/);
});

test("extractArticleText reads js-initialData answer HTML, not CSS", () => {
  const text = extractArticleText(answerPage, "2077838700549857848");
  assert.match(text, /JSON正文，不该被样式盖住/);
  assert.doesNotMatch(text, /font-size/);
  assert.equal(looksLikeCssDump(text), false);
});

test("extractArticleHtml can read js-initialData content", () => {
  const html = `<html><head></head><body>
  <style>.foo { color: red }</style>
  <script id="js-initialData" type="text/json">{"entities":{"answers":{"1":{"id":"1","content":"<p>只有 JSON 里有正文</p>"}}}}</script>
  </body></html>`;
  const body = extractArticleHtml(html, "1");
  assert.match(body, /只有 JSON 里有正文/);
  assert.doesNotMatch(htmlToPlain(body), /color: red/);
});

test("css-in-js strings in initialData are not treated as the article", () => {
  const css = ".css-aa{font-size:14px}.css-bb{color:red}.css-cc{margin:0}.css-dd{padding:1px}.css-ee{display:block}.css-ff{line-height:1}.css-gg{background:#fff}.css-hh{border:0}";
  const html = `<script id="js-initialData" type="text/json">${JSON.stringify({
    css,
    entities: { answers: { "9": { id: "9", content: "<p>真正的回答</p>" } } },
  })}</script>`;
  const text = extractArticleText(html, "9");
  assert.equal(text, "真正的回答");
  assert.equal(looksLikeCssDump(text), false);
});

test("stripDocumentNoise removes css blocks", () => {
  const stripped = stripDocumentNoise("<style>.a{color:red}</style><p>hi</p>");
  assert.equal(stripped, "<p>hi</p>");
});

test("paid-like RichText wins over JSON when it is long and not CSS", () => {
  const body = `<p>${"盐选正文".repeat(40)}</p>`;
  const html = `<div class="RichText ztext CopyrightRichText-richText">${body}</div>
  <script id="js-initialData" type="text/json">${JSON.stringify({
    entities: { answers: { "1": { id: "1", content: "<p>节选</p>" } } },
  })}</script>`;
  const text = extractArticleText(html, "1");
  assert.match(text, /盐选正文/);
  assert.doesNotMatch(text, /节选/);
});
