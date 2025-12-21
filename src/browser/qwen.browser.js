import { chromium } from "playwright";
import fs from "fs";

const USER_DATA_DIR = "/home/hawk/.chrome-automation-qwen";
const DOWNLOAD_DIR = "/home/hawk/qwen-videos";
const QWEN_URL = "https://chat.qwen.ai/";

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/* ---------------------------------- */
/* ✅ directoy HELPERS */
/* ---------------------------------- */

function getCategoryDir(category) {
  const safeCategory = category
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");

  if (!safeCategory) {
    throw new Error("Invalid category name");
  }

  const dir = `${DOWNLOAD_DIR}/${safeCategory}`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created category folder → ${dir}`);
  }

  return dir;
}
function random8Digit() {
  return Math.floor(10000000 + Math.random() * 90000000);
}

/* ---------------------------------- */
/* ✅ AUTH HELPERS */
/* ---------------------------------- */

async function isLoggedIn(page) {
  return page.evaluate(() => {
    return !document.querySelector("button.header-right-auth-button");
  });
}

async function login(page, email, password) {
  console.log(`🔐 Logging in as ${email}`);

  await page.click("button.header-right-auth-button");
  await page.waitForSelector("input[name='email']", { timeout: 0 });
  await page.waitForSelector("input[name='password']", { timeout: 0 });

  await page.fill("input[name='email']", email);
  await page.fill("input[name='password']", password);
  await page.keyboard.press("Enter");

  await page.waitForFunction(
    () => !document.querySelector("button.header-right-auth-button"),
    { timeout: 0 },
  );

  console.log("✅ Login successful");
}

async function logout(page) {
  console.log("🚪 Logging out...");

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForSelector("button.user-menu-btn", { timeout: 0 });
  await page.click("button.user-menu-btn");
  await page.waitForSelector("li[data-menu-id$='logout']", { timeout: 0 });
  await page.click("li[data-menu-id$='logout']");
  await page.waitForSelector("button.header-right-auth-button", { timeout: 0 });

  console.log("✅ Logged out successfully");
}

async function downloadQwenVideoFromDOM(page, prompt, categoryDir) {
  console.log("⬇️ Downloading video from DOM <video> tag");

  const videoUrl = await page.evaluate(() => {
    const video = document.querySelector("video");
    if (!video) return null;

    return video.currentSrc || video.querySelector("source")?.src || null;
  });

  if (!videoUrl) {
    throw new Error("Video URL not found in DOM");
  }

  const response = await page.request.get(videoUrl);
  if (!response.ok()) {
    throw new Error(`Failed to fetch video: ${response.status()}`);
  }

  const buffer = await response.body();
  if (buffer.length < 500_000) {
    throw new Error("Downloaded video is too small");
  }

  const safePrompt = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_")
    .slice(0, 60);

  const rand = random8Digit();
  const filePath = `${categoryDir}/${rand}-${safePrompt}.mp4`;
  fs.writeFileSync(filePath, buffer);

  console.log(`💾 Saved video → ${filePath}`);
  return { filePath, videoUrl };
}

/* ---------------------------------- */
/* ✅ ERROR DETECTION */
/* ---------------------------------- */

async function hasDailyLimitError(page) {
  return page.evaluate(() => {
    const alert = document.querySelector(".qwen-alert");
    if (!alert) return false;

    const text = alert.innerText.toLowerCase();
    return (
      text.includes("daily usage limit") ||
      text.includes("reached the daily") ||
      text.includes("please wait") ||
      text.includes("too many requests") ||
      text.includes("issue connecting") ||
      text.includes("try again")
    );
  });
}

/* ---------------------------------- */
/* ✅ VIDEO MODE AND SIZE  */
/* ---------------------------------- */

async function ensureVideoMode(page) {
  console.log("🎬 Ensuring Video Generation mode...");

  // Wait for chat input (this is the real readiness signal)
  await page.waitForSelector("textarea", { timeout: 0 });

  // Give React time to hydrate suggestions
  await page.waitForTimeout(1500);

  // Try clicking Video Generation if it exists
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(".chat-prompt-suggest-button"),
    );

    const videoBtn = buttons.find((b) =>
      b.innerText.toLowerCase().includes("video"),
    );

    if (!videoBtn) return false;

    videoBtn.click();
    return true;
  });

  if (clicked) {
    console.log("✅ Video Generation mode enforced");
    await page.waitForTimeout(1000);
  } else {
    // IMPORTANT: do NOT fail — Qwen often keeps last mode active
    console.log("⚠️ Video button not present — assuming mode already active");
  }
}
async function ensureVideoSizeRatio(page, ratio = "9:16") {
  console.log(`📐 Ensuring video ratio: ${ratio}`);

  // Wait for size selector to exist (it appears near the chat input action bar)
  const sizeBtn = page
    .locator(".chat-input-feature-btn.size-selector-btn")
    .first();
  await sizeBtn.waitFor({ state: "visible", timeout: 60000 });

  // If already set (button shows current ratio), do nothing
  const already = await page.evaluate((desired) => {
    const btn = document.querySelector(
      ".chat-input-feature-btn.size-selector-btn",
    );
    if (!btn) return false;
    const txt = btn.innerText?.replace(/\s+/g, "").trim();
    return txt?.includes(desired.replace(/\s+/g, ""));
  }, ratio);

  if (already) {
    console.log(`✅ Ratio already set to ${ratio}`);
    return;
  }

  // Open dropdown
  await sizeBtn.click();
  await page.waitForTimeout(300);

  // Click the dropdown item by its title text (most stable)
  const clicked = await page.evaluate((desired) => {
    const menu = document.querySelector("ul.ant-dropdown-menu[role='menu']");
    if (!menu) return false;

    const items = Array.from(
      menu.querySelectorAll("li.ant-dropdown-menu-item"),
    );
    const target = items.find((li) => {
      const t = li
        .querySelector(".ant-dropdown-menu-title-content")
        ?.textContent?.trim();
      return t === desired;
    });

    if (!target) return false;

    target.click();
    return true;
  }, ratio);

  if (!clicked) {
    // Fallback: sometimes menu is rendered elsewhere; search globally
    const clickedFallback = await page.evaluate((desired) => {
      const items = Array.from(
        document.querySelectorAll("li.ant-dropdown-menu-item"),
      );
      const target = items.find((li) => {
        const t = li
          .querySelector(".ant-dropdown-menu-title-content")
          ?.textContent?.trim();
        return t === desired;
      });
      if (!target) return false;
      target.click();
      return true;
    }, ratio);

    if (!clickedFallback) {
      console.log(`⚠️ Could not find ratio option: ${ratio}`);
      return;
    }
  }

  // Small settle time for UI to update
  await page.waitForTimeout(400);

  // Verify it changed (soft check)
  const ok = await page.evaluate((desired) => {
    const btn = document.querySelector(
      ".chat-input-feature-btn.size-selector-btn",
    );
    if (!btn) return false;
    const txt = btn.innerText?.replace(/\s+/g, "").trim();
    return txt?.includes(desired.replace(/\s+/g, ""));
  }, ratio);

  if (ok) {
    console.log(`✅ Ratio set to ${ratio}`);
  } else {
    console.log(
      `⚠️ Ratio click done, but UI didn't confirm (continuing anyway)`,
    );
  }
}

/* ---------------------------------- */
/* ✅ WAIT FOR GENERATION (FIXED) */
/* ---------------------------------- */

async function waitUntilQwenGenerationDone(page) {
  console.log("⏳ Waiting for Qwen generation or error...");

  await page.waitForFunction(
    () => {
      // ❌ error / rate limit
      if (document.querySelector(".qwen-alert")) return true;

      const skeleton = document.querySelector(".qwen-media-skeleton");
      const video = document.querySelector("video");

      // ✅ finished: skeleton gone AND real video present
      if (!skeleton && video && (video.currentSrc || video.src)) {
        return true;
      }

      return false;
    },
    { timeout: 0 },
  );

  console.log("✅ Generation finished or aborted");
}

/* ---------------------------------- */
/* ✅ NETWORK VIDEO CAPTURE */
/* ---------------------------------- */

async function waitAndSaveVideoFromNetwork(page, timeout = 15000) {
  return Promise.race([
    new Promise((resolve) => {
      const handler = async (response) => {
        try {
          const headers = response.headers();
          if (!headers["content-type"]?.includes("video/mp4")) return;

          const buffer = await response.body();
          if (buffer.length < 500_000) return;

          const filePath = `${DOWNLOAD_DIR}/${Date.now()}-qwen.mp4`;
          fs.writeFileSync(filePath, buffer);

          page.off("response", handler);
          resolve(filePath);
        } catch {}
      };
      page.on("response", handler);
    }),

    new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
  ]);
}

/* ---------------------------------- */
/* ✅ CLICK LAST VIDEO ⋯  → DOWNLOAD */
/* ---------------------------------- */
async function clickLastVideoMenuAndDownload(page) {
  console.log("⬇️ Clicking download on last generated video...");

  // 1️⃣ Click ⋯ of the LAST action-control bar
  const clickedDots = await page.evaluate(() => {
    const actionBars = Array.from(
      document.querySelectorAll(".qwen-chat-package-comp-new-action-control"),
    );

    if (!actionBars.length) return false;

    const lastBar = actionBars[actionBars.length - 1];

    const useEl = lastBar.querySelector(
      'use[xlink\\:href="#icon-line-more-01"]',
    );
    if (!useEl) return false;

    // Click the container (NOT the use element)
    useEl
      .closest(".qwen-chat-package-comp-new-action-control-container")
      ?.click();

    return true;
  });

  if (!clickedDots) {
    console.log("⚠️ Three-dots button not found");
    return;
  }

  // 2️⃣ Wait for dropdown
  await page.waitForTimeout(500);

  // 3️⃣ Click Download
  const clickedDownload = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("li, button, div"));

    const downloadBtn = items.find((el) =>
      el.innerText?.toLowerCase().includes("download"),
    );

    if (!downloadBtn) return false;

    downloadBtn.click();
    return true;
  });

  if (clickedDownload) {
    console.log("✅ Download clicked");
  } else {
    console.log("⚠️ Download option not found");
  }
}

/* ---------------------------------- */
/* ✅ MAIN BATCH FUNCTION */
/* ---------------------------------- */

export async function generateVideoViaQwenBrowserBatch({
  prompts,
  accounts,
  category,
}) {
  if (!category || typeof category !== "string") {
    throw new Error("category is required");
  }

  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error("prompts must be a non-empty array");
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("accounts must be a non-empty array");
  }

  const results = [];
  let accountIndex = 0;

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable",
    acceptDownloads: true,
    downloadsPath: DOWNLOAD_DIR,
    slowMo: 40,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const page = await context.newPage();
  page.setDefaultTimeout(0);

  console.log("🌐 Opening Qwen...");
  await page.goto(QWEN_URL, { waitUntil: "domcontentloaded" });

  if (!(await isLoggedIn(page))) {
    await login(
      page,
      accounts[accountIndex].email,
      accounts[accountIndex].password,
    );
  }

  await page.waitForSelector("textarea", { timeout: 0 });
  await page.waitForSelector(".chat-prompt-suggest-button", { timeout: 0 });
  await ensureVideoMode(page);
  await ensureVideoSizeRatio(page, "9:16");
  for (let i = 0; i < prompts.length; ) {
    console.log(`🎯 Processing ${i + 1}/${prompts.length}`);

    /* ✅ ENFORCE LOGIN EVERY TIME */
    if (!(await isLoggedIn(page))) {
      console.log("🔐 Session expired — logging back in");

      await login(
        page,
        accounts[accountIndex].email,
        accounts[accountIndex].password,
      );

      await page.waitForSelector("textarea", { timeout: 0 });
      await ensureVideoMode(page);
    }

    await page.fill("textarea", "");
    await page.keyboard.type(prompts[i], { delay: 25 });
    await page.keyboard.press("Enter");

    await sleep(1500);

    if (await hasDailyLimitError(page)) {
      console.log("🚫 Daily limit hit — switching account");

      accountIndex++;
      if (accountIndex >= accounts.length) {
        throw new Error("All accounts exhausted");
      }

      await logout(page);
      await login(
        page,
        accounts[accountIndex].email,
        accounts[accountIndex].password,
      );

      await ensureVideoMode(page);
      continue;
    }

    await waitUntilQwenGenerationDone(page);

    if (await hasDailyLimitError(page)) {
      accountIndex++;
      if (accountIndex >= accounts.length) {
        throw new Error("All accounts exhausted");
      }

      await logout(page);
      await login(
        page,
        accounts[accountIndex].email,
        accounts[accountIndex].password,
      );

      await ensureVideoMode(page);
      continue;
    }
    const categoryDir = getCategoryDir(category);

    const { filePath, videoUrl } = await downloadQwenVideoFromDOM(
      page,
      prompts[i],
      categoryDir,
    );

    results.push({
      index: i,
      prompt: prompts[i],
      videoUrl,
      downloadedPath: filePath,
    });

    i++;
    await sleep(2000);
  }

  await context.close();
  return results;
}
