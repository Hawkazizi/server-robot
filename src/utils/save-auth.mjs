// save-auth.mjs
import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable", // your real Chrome
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("➡️ Go to https://accounts.google.com and log in");
  await page.goto("https://accounts.google.com");

  // Wait until user is logged in and on Google homepage
  console.log(
    "✅ After logging in, go to https://gemini.google.com/app and wait for the chat box",
  );
  console.log("⏸️ Then press Enter here...");
  process.stdin.setEncoding("utf8");
  process.stdin.once("data", async () => {
    // Save authenticated state
    await context.storageState({ path: "./auth.json" });
    console.log("🔐 Saved session to auth.json");
    await browser.close();
    process.exit(0);
  });
})();
