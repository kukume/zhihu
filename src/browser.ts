import puppeteer from "@cloudflare/puppeteer";
import { UA, parseCookieHeader, toCookieHeader } from "./cookies";
import type { CookiePair } from "./cookies";

type PuppeteerCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

function toPuppeteerCookies(header: string): PuppeteerCookie[] {
  return parseCookieHeader(header).map((c) => ({
    name: c.name,
    value: c.value,
    domain: ".zhihu.com",
    path: "/",
  }));
}

function fromPuppeteerCookies(cookies: Array<{ name: string; value: string }>): string {
  const pairs: CookiePair[] = cookies.map((c) => ({ name: c.name, value: c.value }));
  return toCookieHeader(pairs);
}

export async function browserFetchPaid(
  env: Env,
  url: string,
  cookieHeader: string,
): Promise<{ html: string; cookie: string }> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    const cookies = toPuppeteerCookies(cookieHeader);
    if (cookies.length) await page.setCookie(...cookies);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    try {
      await page.waitForNetworkIdle({ timeout: 12000 });
    } catch {
      // Zhihu keeps long-lived connections; ignore.
    }
    await new Promise((r) => setTimeout(r, 1500));

    const html = await page.content();
    const exported = fromPuppeteerCookies(await page.cookies("https://www.zhihu.com"));
    return { html, cookie: exported || cookieHeader };
  } finally {
    await browser.close();
  }
}

export async function browserRefreshCookies(env: Env, cookieHeader: string, url?: string): Promise<string> {
  const target = url || "https://www.zhihu.com/";
  const result = await browserFetchPaid(env, target, cookieHeader);
  return result.cookie;
}
