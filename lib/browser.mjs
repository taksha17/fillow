import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { PATHS } from "./paths.mjs";
import { resolvePlaywrightBrowsersPath } from "./playwright-path.mjs";

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const STEALTH_INIT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
`;

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function jitter(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export async function launchBrowser(cfg) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath();
  const launchOpts = {
    headless: cfg.runtime.headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
    slowMo: cfg.runtime.slow_mo_ms || 0,
  };
  let browser;
  try {
    browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
  } catch {
    browser = await chromium.launch(launchOpts);
  }
  const contextOpts = {
    viewport: { width: 1440, height: 960 },
    userAgent: UA,
    locale: "en-US",
    timezoneId: "America/Chicago",
    colorScheme: "light",
  };
  if (cfg.runtime.use_mygreenhouse && existsSync(PATHS.mghSession)) {
    contextOpts.storageState = PATHS.mghSession;
  }
  const context = await browser.newContext(contextOpts);
  await context.addInitScript(STEALTH_INIT);
  return { browser, context };
}

export async function humanFill(loc, value, { humanize = true } = {}) {
  const text = String(value || "").slice(0, 3500);
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
  } catch {
    // ignore
  }
  try {
    await loc.click({ timeout: 2000 });
  } catch {
    // ignore
  }
  try {
    await loc.fill("");
  } catch {
    // ignore
  }
  if (!text) return;
  // Long answers: fill() — pressSequentially times out on multi-paragraph Ashby/Lever textareas.
  if (!humanize || text.length > 220) {
    await loc.fill(text);
    return;
  }
  const delay = text.length < 60 ? 55 : 28;
  try {
    await loc.pressSequentially(text, { delay: delay + jitter(0, 18), timeout: 20000 });
  } catch {
    await loc.fill(text);
  }
  await sleep(220 + jitter(0, 180));
}

export async function fillIfPresent(root, selector, value, opts) {
  const loc = root.locator(selector).first();
  if ((await loc.count()) === 0) return false;
  try {
    await humanFill(loc, value, opts);
    return true;
  } catch {
    return false;
  }
}

export async function inputHasValue(root, selector) {
  try {
    const loc = root.locator(selector).first();
    if ((await loc.count()) === 0) return false;
    return Boolean((await loc.inputValue({ timeout: 500 })).trim());
  } catch {
    return false;
  }
}

export async function dismissCookies(page) {
  for (const sel of [
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "button:has-text('Accept')",
    "button:has-text('Agree')",
    "#onetrust-accept-btn-handler",
  ]) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) && (await loc.isVisible({ timeout: 600 }))) {
        await loc.click({ timeout: 1000 });
        await sleep(300);
        return;
      }
    } catch {
      // next selector
    }
  }
}

export async function preSubmitHumanize(page, seconds = 4) {
  const dwell = seconds * (0.5 + Math.random());
  const steps = Math.max(2, Math.floor(dwell / 2));
  for (let i = 0; i < steps; i += 1) {
    try {
      await page.mouse.move(jitter(200, 1200), jitter(150, 800), { steps: 8 });
      await page.mouse.wheel(0, (Math.random() < 0.5 ? -1 : 1) * jitter(60, 240));
    } catch {
      // ignore
    }
    await sleep((dwell * 1000) / steps);
  }
}

export async function clickSubmit(root, page, { pauseSeconds = 4 } = {}) {
  await preSubmitHumanize(page, pauseSeconds);
  const selectors = [
    "button:has-text('Submit application')",
    "button:has-text('Submit Application')",
    "button[type='submit']:has-text('Submit')",
    "button:has-text('Submit')",
  ];
  const skip = new Set(["accept", "deny non-essential", "search", "role overview", "application", "apply now"]);
  for (const selector of selectors) {
    const loc = root.locator(selector).first();
    try {
      if ((await loc.count()) === 0) continue;
      const text = ((await loc.innerText({ timeout: 1000 })) || "").trim().toLowerCase();
      if (skip.has(text)) continue;
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
      await loc.click({ timeout: 5000 });
      return true;
    } catch {
      try {
        await loc.click({ timeout: 5000, force: true });
        return true;
      } catch {
        // next
      }
    }
  }
  return false;
}

export function phoneDigits(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

export function confirmationText(visible) {
  const v = String(visible || "").toLowerCase();
  return [
    "thank you for applying",
    "thanks for taking the time to apply",
    "application submitted",
    "successfully submitted",
    "application was successfully submitted",
    "has been submitted",
    "thanks for applying",
    "we received your application",
    "we received",
    "thank you",
  ].some((x) => v.includes(x));
}

export function spamFlagged(visible) {
  const v = String(visible || "").toLowerCase();
  return v.includes("possible spam") || v.includes("flagged as possible spam");
}
