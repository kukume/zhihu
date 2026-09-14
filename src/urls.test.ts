import assert from "node:assert/strict";
import { test } from "node:test";
import { findPaidColumnUrl, isPaidAnswerPayload, parseZhihuUrl, targetId, targetTypeLabel } from "./urls";

test("parses question/answer URLs", () => {
  const target = parseZhihuUrl(
    "https://www.zhihu.com/question/459329916/answer/2077838700549857848",
  );
  assert.equal(target.kind, "answer");
  if (target.kind !== "answer") return;
  assert.equal(target.questionId, "459329916");
  assert.equal(target.id, "2077838700549857848");
  assert.equal(targetTypeLabel(target), "回答");
  assert.equal(targetId(target), "2077838700549857848");
});

test("strips query strings and trailing slashes", () => {
  const target = parseZhihuUrl(
    "https://www.zhihu.com/question/459329916/answer/2077838700549857848/?utm_source=share",
  );
  assert.equal(target.kind, "answer");
  if (target.kind !== "answer") return;
  assert.equal(target.id, "2077838700549857848");
});

test("parses question, article, and paid column URLs", () => {
  const question = parseZhihuUrl("https://www.zhihu.com/question/459329916");
  assert.equal(question.kind, "question");
  assert.equal(targetTypeLabel(question), "问题");

  const article = parseZhihuUrl("https://zhuanlan.zhihu.com/p/123456");
  assert.equal(article.kind, "article");
  assert.equal(targetTypeLabel(article), "文章");

  const paid = parseZhihuUrl(
    "https://www.zhihu.com/market/paid_column/1662117749412466688/section/1667546462182576128",
  );
  assert.equal(paid.kind, "paid");
  assert.equal(targetTypeLabel(paid), "盐选专栏");
});

test("parses /answer/:id short links", () => {
  const target = parseZhihuUrl("https://zhihu.com/answer/2077838700549857848");
  assert.equal(target.kind, "answer");
  if (target.kind !== "answer") return;
  assert.equal(target.id, "2077838700549857848");
  assert.equal(target.questionId, undefined);
});

test("finds paid_column URLs inside HTML or JSON", () => {
  const url = findPaidColumnUrl(
    JSON.stringify({
      answer_type: "paid",
      extra: {
        url: "https://www.zhihu.com/market/paid_column/2040529716919198562/section/2038594889668110014",
      },
    }),
  );
  assert.equal(
    url,
    "https://www.zhihu.com/market/paid_column/2040529716919198562/section/2038594889668110014",
  );
  assert.equal(
    findPaidColumnUrl('<a href="/market/paid_column/1/section/2">盐选</a>'),
    "https://www.zhihu.com/market/paid_column/1/section/2",
  );
  assert.equal(isPaidAnswerPayload({ answer_type: "paid" }), true);
  assert.equal(isPaidAnswerPayload({ answer_type: "normal" }), false);
});

test("rejects invalid URLs", () => {
  assert.throws(() => parseZhihuUrl("not a url"), /Invalid URL/);
});
