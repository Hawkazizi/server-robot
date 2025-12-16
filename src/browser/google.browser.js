import { chromium } from "playwright";
import fs from "fs";

const USER_DATA_DIR_FLOW = "/home/hawk/.chrome-automation-flow";
const FLOW_URL = "https://labs.google/fx/tools/flow";

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function resetToHome(page) {
  console.log("🔄 Resetting Flow to home state...");
  await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("button:has-text('New project')", {
    timeout: 60000,
  });

  await sleep(3000);
}

/* ---------------------------------- */
/* ✅ AUTH HELPERS (for Google sign-in) */
/* ---------------------------------- */

async function waitForLoginIfNeeded(page) {
  // If "Sign in" exists, user is not logged in (most reliable for this simplified flow)
  const signInBtn = page.locator("button:has-text('Sign in')");
  if (await signInBtn.count()) {
    console.log(
      "🛑 Not logged in. Waiting for authorization (login manually)...",
    );
    // Wait until Sign in disappears OR download/player UI appears
    await page.waitForFunction(
      () => {
        const hasSignIn = Array.from(document.querySelectorAll("button")).some(
          (b) => /sign\s*in/i.test(b.textContent || ""),
        );
        if (!hasSignIn) return true;

        // alternative: user avatar exists
        const hasAvatar =
          document.querySelector("button img") ||
          document.querySelector("img[alt*='Account']") ||
          document.querySelector("button[aria-label*='Account']");
        return Boolean(hasAvatar);
      },
      { timeout: 0 },
    );

    console.log("✅ Authorization detected. Starting prompts...");
  } else {
    console.log("✅ Already logged in.");
  }
}

/// download helper

async function downloadVideoFromSrc(page, videoSrc, DOWNLOAD_DIR, index) {
  console.log("⬇️ Downloading video via src...");

  const buffer = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    return Array.from(new Uint8Array(arrayBuffer));
  }, videoSrc);

  const filePath = `${DOWNLOAD_DIR}/${index}-${Date.now()}.mp4`;
  fs.writeFileSync(filePath, Buffer.from(buffer));

  console.log("✅ Video saved:", filePath);
  return filePath;
}

async function waitUntilVideoCompleted(page) {
  console.log("⏳ Waiting for NEW video src to appear (no timeout)...");

  // Capture existing srcs before generation
  const existingSrcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("video"))
      .map((v) => v.src)
      .filter(Boolean),
  );

  while (true) {
    const src = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll("video"));
      const last = videos[videos.length - 1];
      return last?.src || null;
    });

    if (src && src.startsWith("https://") && !existingSrcs.includes(src)) {
      console.log("✅ New video src detected.");
      return src;
    }

    await page.waitForTimeout(1000);
  }
}

async function downloadCompletedVideo(page, DOWNLOAD_DIR, index) {
  console.log("⬇️ Downloading completed video...");

  // Hover the player area (so the navbar appears)
  // Use a stable anchor: the player container often contains the play icon.
  const playerArea = page
    .locator("i.google-symbols:has-text('play_arrow')")
    .first();
  if (await playerArea.count()) {
    await playerArea.hover({ force: true });
    await page.waitForTimeout(400);
  } else {
    // fallback hover anywhere on video
    const video = page.locator("video").last();
    if (await video.count()) {
      await video.hover({ force: true });
      await page.waitForTimeout(400);
    }
  }

  // The actual download button (icon text = download)
  const downloadBtn = page
    .locator("button", {
      has: page.locator("i.google-symbols:has-text('download')"),
    })
    .first();

  await downloadBtn.waitFor({ state: "visible", timeout: 60000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    downloadBtn.click(),
  ]);

  const filename = download.suggestedFilename() || `flow-${Date.now()}.mp4`;
  const filePath = `${DOWNLOAD_DIR}/${index}-${Date.now()}-${filename}`;
  await download.saveAs(filePath);

  console.log("✅ Download saved:", filePath);
  return filePath;
}

async function isLoggedIn(page) {
  // Heuristic: Flow's top-right shows a profile avatar or an account button.
  // If a "Sign in" button exists, we are not logged in.
  try {
    const signIn = await page.$("button:has-text('Sign in')");
    // If signIn exists and is visible -> not logged in
    return !signIn;
  } catch {
    return false;
  }
}

async function loginWithPopup(context, page, email, password) {
  console.log(`🔐 Attempting Google login for ${email} (popup flow)...`);

  // Click the "Sign in" button which will usually open a Google auth popup.
  const signInButton = await page.$("button:has-text('Sign in')");
  if (!signInButton) {
    throw new Error("Sign in button not found on Flow UI");
  }

  // Wait for popup page
  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 60000 }),
    signInButton.click({ timeout: 30000 }),
  ]);

  await popup.waitForLoadState("domcontentloaded", { timeout: 60000 });

  try {
    // Email flow
    const emailInputSelector = 'input[type="email"], input#identifierId';
    await popup.waitForSelector(emailInputSelector, { timeout: 45000 });
    await popup.fill(emailInputSelector, email);
    await popup.keyboard.press("Enter");

    // Wait for password input
    const pwSelector = 'input[type="password"]';
    await popup.waitForSelector(pwSelector, { timeout: 45000 });
    await popup.fill(pwSelector, password);
    await popup.keyboard.press("Enter");

    // Wait for popup to close or navigate back to Flow
    await popup
      .waitForLoadState("networkidle", { timeout: 60000 })
      .catch(() => {});
    // Give the main page some time to reflect logged-in state
    await sleep(3000);
    console.log("✅ Google login attempt finished (popup).");
  } catch (err) {
    // If any step fails, close popup to avoid stale windows
    try {
      await popup.close();
    } catch {}
    throw new Error(`Google login popup failed: ${err.message}`);
  }
}
async function waitAndDownloadFromUI(page, DOWNLOAD_DIR, index) {
  console.log("⬇️ Forcing UI download (no hover)...");

  // 1️⃣ Wait for the download button to appear
  const downloadButtonSelector =
    "button:has(i.google-symbols:has-text('download'))";
  await page.waitForSelector(downloadButtonSelector, { timeout: 60000 });

  // 2️⃣ Click the download button to open menu
  await page.click(downloadButtonSelector);
  await page.waitForTimeout(500); // let menu render

  // 3️⃣ Click the 'Upscaled' / 'high_res' menu item
  const upscaledSelector = "div[role='menuitem']:has-text('Upscaled')";
  await page.waitForSelector(upscaledSelector, { timeout: 30000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.click(upscaledSelector),
  ]);

  // 4️⃣ Save the file
  const filename = download.suggestedFilename();
  const filePath = `${DOWNLOAD_DIR}/${index}-${Date.now()}-${filename}`;
  await download.saveAs(filePath);

  console.log("✅ UI download finished:", filePath);
  return filePath;
}

async function logout(context, page) {
  console.log("🚪 Logging out / clearing session...");
  try {
    // Try to click account avatar -> sign out if present
    const accountBtn = await page.$(
      "button[aria-label*='Account'], button:has(img)",
    );
    if (accountBtn) {
      await accountBtn.click().catch(() => {});
      await sleep(500);
      // Try to find sign out option
      const signOut = await page.$(
        "button:has-text('Sign out'), text=Sign out",
      );
      if (signOut) {
        await signOut.click().catch(() => {});
        await sleep(2000);
      }
    }
  } catch (err) {
    // ignore UI logout errors
  }

  // As a reliable fallback, clear cookies & localStorage to force fresh auth
  try {
    await context.clearCookies();
    // also clear storage via page
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    });
  } catch (err) {
    console.warn("⚠️ Failed to clear cookies/storage:", err.message);
  }

  // Reload to reflect logged-out state
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(2000);
  console.log("✅ Logout/clear finished");
}

/* ---------------------------------- */
/* ✅ ERROR DETECTION */
/* ---------------------------------- */

async function hasDailyLimitError(page) {
  try {
    // Look for common words in UI modals/alerts
    const alerts = await page.$$eval("div, p, span", (nodes) =>
      nodes.map((n) => n.innerText?.toLowerCase()).filter(Boolean),
    );
    const joined = alerts.join(" ");
    if (!joined) return false;
    return (
      joined.includes("daily limit") ||
      joined.includes("quota") ||
      joined.includes("exceeded") ||
      joined.includes("reached the daily") ||
      joined.includes("try again later") ||
      joined.includes("temporarily unavailable") ||
      joined.includes("limit for your account")
    );
  } catch {
    return false;
  }
}

/* ---------------------------------- */
/* ✅ NETWORK VIDEO CAPTURE (optional) */
/* ---------------------------------- */

async function waitAndSaveVideoFromNetwork(
  page,
  DOWNLOAD_DIR,
  timeout = 15000,
) {
  return new Promise((resolve) => {
    const handler = async (response) => {
      try {
        const headers = response.headers();
        if (!headers["content-type"]?.includes("video")) return;
        const buffer = await response.body();
        if (!buffer || buffer.length < 100_000) return;
        const filePath = `${DOWNLOAD_DIR}/${Date.now()}-flow.mp4`;
        fs.writeFileSync(filePath, buffer);
        page.off("response", handler);
        resolve(filePath);
      } catch {
        // ignore
      }
    };
    page.on("response", handler);

    setTimeout(() => {
      page.off("response", handler);
      resolve(null);
    }, timeout);
  });
}

/* ---------------------------------- */
/* ✅ MAIN BATCH FUNCTION (updated) */
/* ---------------------------------- */
export async function generateVideoViaGoogleFlowBatch({ prompts }) {
  const DOWNLOAD_DIR = "/home/hawk/flow-videos";
  if (!fs.existsSync(DOWNLOAD_DIR))
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR_FLOW, {
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable",
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const page = await context.newPage();
  page.setDefaultTimeout(600000);

  console.log("🌐 Opening Google Flow...");
  await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" });

  // ✅ manual auth if needed
  await waitForLoginIfNeeded(page);

  const results = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    console.log(`🎯 Prompt ${i + 1}/${prompts.length}`);

    try {
      // New project
      await page.locator("button:has-text('New project')").click();
      const textarea = page.locator(
        "textarea[placeholder*='Generate a video']",
      );
      await textarea.waitFor({ timeout: 60000 });

      // Type prompt
      await textarea.fill("");
      await textarea.type(prompt, { delay: 20 });
      console.log("✅ Prompt typed");

      // Start generation (arrow_forward)
      await page
        .locator("button", {
          has: page.locator("i.google-symbols:has-text('arrow_forward')"),
        })
        .first()
        .click();

      console.log("🚀 Generation started");

      // Wait complete
      const videoSrc = await waitUntilVideoCompleted(page);

      const downloadedPath = await downloadVideoFromSrc(
        page,
        videoSrc,
        DOWNLOAD_DIR,
        i,
      );

      results.push({
        index: i,
        prompt,
        status: "completed",
        downloadedPath,
      });

      // 🔄 IMPORTANT: reset Flow UI before next prompt
      await page.waitForTimeout(2000);
      await resetToHome(page);
    } catch (err) {
      console.error(`❌ Failed prompt ${i}:`, err.message);
      results.push({ index: i, prompt, status: "failed", error: err.message });
    }
  }

  try {
    await context.close();
  } catch {}

  return results;
}
