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

export async function generateVideoViaGoogleFlowBatch({
  prompts,
  accounts = [],
}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error("prompts must be a non-empty array");
  }

  if (!Array.isArray(accounts)) {
    throw new Error("accounts must be an array (can be empty)");
  }

  const results = [];
  let accountIndex = 0;

  const DOWNLOAD_DIR = "/home/hawk/flow-videos";
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR_FLOW, {
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable",
    slowMo: 40,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  console.log("🌐 Opening Google Flow...");
  await resetToHome(page);

  // If accounts provided, ensure logged in as first account
  if (accounts.length > 0) {
    if (!(await isLoggedIn(page))) {
      try {
        await loginWithPopup(
          context,
          page,
          accounts[accountIndex].email,
          accounts[accountIndex].password,
        );
        // Wait & ensure Flow shows signed-in state
        await sleep(3000);
        if (!(await isLoggedIn(page))) {
          console.warn(
            "⚠️ Still not recognized as logged in after login attempt.",
          );
        } else {
          console.log("✅ Logged into Google Flow.");
        }
      } catch (err) {
        console.warn("⚠️ Initial login failed:", err.message);
      }
    } else {
      console.log("✅ Already logged in (session preserved).");
    }
  } else {
    console.log(
      "ℹ️ No accounts provided — proceeding unauthenticated (may hit limited functionality).",
    );
  }

  for (let i = 0; i < prompts.length; ) {
    const prompt = prompts[i];
    console.log(`🎯 Processing prompt ${i + 1}/${prompts.length}`);

    try {
      // If we require an authenticated session and it's missing, attempt login (and rotate if needed)
      if (accounts.length > 0 && !(await isLoggedIn(page))) {
        console.log("🔐 Session expired or not logged in — logging back in");
        // try current account or rotate
        try {
          await loginWithPopup(
            context,
            page,
            accounts[accountIndex].email,
            accounts[accountIndex].password,
          );
          await sleep(3000);
        } catch (err) {
          console.warn("⚠️ Login attempt failed:", err.message);
        }
      }

      /* ---------------------------------- */
      /* ✅ Start new project (fresh UI) */
      /* ---------------------------------- */
      await page.click("button:has-text('New project')");
      const textarea = "textarea[placeholder='Generate a video with text…']";
      await page.waitForSelector(textarea, { timeout: 30000 });

      /* ---------------------------------- */
      /* ✅ Ensure Text-to-Video */
      /* ---------------------------------- */
      const modeLabel = await page
        .textContent("button[role='combobox'] span")
        .catch(() => "");
      if (!modeLabel || !modeLabel.includes("Text to Video")) {
        await page.click("button[role='combobox']");
        await page.waitForSelector("div[role='listbox']", { timeout: 15000 });
        await page.click("div[role='option']:has-text('Text to Video')");
      }

      /* ---------------------------------- */
      /* ✅ Count videos before */
      /* ---------------------------------- */
      const prevVideos = await page.evaluate(
        () => document.querySelectorAll("video").length,
      );

      /* ---------------------------------- */
      /* ✅ Type prompt */
      /* ---------------------------------- */
      await page.fill(textarea, "");
      await page.type(textarea, prompt, { delay: 25 });
      console.log("✅ Prompt typed");

      /* ---------------------------------- */
      /* ✅ Start generation */
      /* ---------------------------------- */
      // Button with arrow_forward icon used in original script
      await page.click(
        "button:has(i.google-symbols:has-text('arrow_forward'))",
      );
      console.log("🚀 Video generation started");

      // Optionally capture video network stream (non-blocking)
      const networkPromise = waitAndSaveVideoFromNetwork(
        page,
        DOWNLOAD_DIR,
        120000,
      );

      /* ---------------------------------- */
      /* ✅ Wait for NEW video or error */
      /* ---------------------------------- */
      await page.waitForFunction(
        (prev) => {
          // If an in-page alert appears, let it be handled by outside check
          const hasAlert = Array.from(
            document.querySelectorAll("div, p, span"),
          ).some(
            (n) =>
              n.innerText &&
              /quota|limit|exceeded|try again later/i.test(n.innerText),
          );
          if (hasAlert) return true;

          const vCount = document.querySelectorAll("video").length;
          return vCount > prev;
        },
        prevVideos,
        { timeout: 360000 },
      );

      // After wait, check for daily/limit errors
      if (await hasDailyLimitError(page)) {
        console.log(
          "🚫 Detected limit/quota error after generation attempt — switching account if available",
        );

        accountIndex++;
        if (accountIndex >= accounts.length) {
          throw new Error("All accounts exhausted due to quota/limit");
        }

        // Logout & login next account
        await logout(context, page);
        await loginWithPopup(
          context,
          page,
          accounts[accountIndex].email,
          accounts[accountIndex].password,
        );
        // don't increment prompt index - retry the same prompt with new account
        await resetToHome(page);
        continue;
      }

      // Give time for video element to be ready
      await sleep(2000);

      // Try to get the newest video element source
      const videoUrl = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll("video"));
        if (!videos.length) return null;
        const v = videos[videos.length - 1];
        return v ? v.currentSrc || v.src : null;
      });

      // Wait a bit to ensure download button is enabled
      await sleep(4000);

      let uiDownloadedPath = null;

      // Try UI-based download FIRST (most reliable)
      try {
        uiDownloadedPath = await waitAndDownloadFromUI(page, DOWNLOAD_DIR, i);
      } catch (err) {
        console.warn(
          "⚠️ UI download failed, falling back to network:",
          err.message,
        );
      }

      // Network capture fallback
      const downloadedPath = await networkPromise.catch(() => null);

      console.log("✅ Video finished for prompt:", prompt);

      results.push({
        index: i,
        prompt,
        status: "completed",
        videoUrl,
        downloadedPath: uiDownloadedPath || downloadedPath || null,
      });

      // increment prompt index on success
      i++;

      /* ---------------------------------- */
      /* ✅ HARD RESET BETWEEN PROMPTS */
      /* ---------------------------------- */
      await sleep(8000);
      await resetToHome(page);
    } catch (err) {
      console.error(`❌ Prompt failed (index ${i}): ${err.message}`);

      // If it's a quota/daily-limit-like error, rotate account and retry
      const pageHasLimit = await hasDailyLimitError(page);
      if (pageHasLimit && accounts.length > 0) {
        console.log("🔁 Rotating account due to detected limit/quota...");
        accountIndex++;
        if (accountIndex >= accounts.length) {
          // exhausted all accounts
          results.push({
            index: i,
            prompt,
            error: "All accounts exhausted due to quota/limit",
          });
          break;
        }

        try {
          await logout(context, page);
          await loginWithPopup(
            context,
            page,
            accounts[accountIndex].email,
            accounts[accountIndex].password,
          );
        } catch (loginErr) {
          console.warn("⚠️ Failed to login new account:", loginErr.message);
        }

        // do not increment i, try same prompt again
        await resetToHome(page);
        continue;
      }

      // Non-rotate failure: record and move on
      results.push({
        index: i,
        prompt,
        error: err.message,
      });

      i++; // move to next prompt
      await sleep(5000);
      await resetToHome(page);
    }
  }

  try {
    await context.close();
  } catch {}

  return results;
}
