// src/browser/gemini.browser.js
import { chromium } from "playwright";

export async function generateVideoViaGeminiBrowser(prompt) {
  const userDataDir = "/home/hawk/.chrome-automation";

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable",
    slowMo: 70,
    viewport: { width: 1280, height: 800 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  // ✅ ALWAYS create a new page
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  console.log("🌐 Navigating to Gemini...");

  await page.goto("https://gemini.google.com/app", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  // ✅ Gemini does heavy client routing — wait for UI, not URL
  console.log("⏳ Waiting for Gemini input...");
  await page.waitForFunction(
    () => {
      const el = document.querySelector('div[contenteditable="true"]');
      return el && el.offsetHeight > 0;
    },
    { timeout: 90000 },
  );

  const inputSelector = 'div[contenteditable="true"]';

  console.log("✍️ Typing prompt...");
  await page.click(inputSelector);
  await page.keyboard.type(prompt, { delay: 20 });
  await page.keyboard.press("Enter");

  console.log("🎬 Waiting for video...");
  await page.waitForFunction(
    () => {
      return [...document.querySelectorAll("video")].some(
        (v) => v.src && v.src.startsWith("http"),
      );
    },
    { timeout: 300000 },
  );

  const videoUrl = await page.evaluate(() => {
    return (
      [...document.querySelectorAll("video")].find((v) =>
        v.src?.startsWith("http"),
      )?.src || null
    );
  });

  if (!videoUrl) {
    throw new Error("Video URL not found");
  }

  console.log("✅ Gemini video generated:");
  console.log(videoUrl);

  await context.close();
  return videoUrl;
}
