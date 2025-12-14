import { chromium } from "playwright";
import fs from "fs";

/* ---------------------------------- */
/* CONFIG */
/* ---------------------------------- */

const USER_DATA_DIR = "/home/hawk/.chrome-automation-grok-imagine";
const DOWNLOAD_DIR = "/home/hawk/grok-imagine-videos";

const GROK_HOME_URL = "https://grok.com";
const GROK_IMAGINE_URL = "https://grok.com/imagine";

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------- */
/* AUTH HELPERS */
/* ---------------------------------- */

async function isLoggedIn(page) {
  return page.evaluate(() => {
    const logoutButton = document.querySelector(
      "button[aria-label='Log out'], a[href*='logout'], a[href*='sign-out']",
    );

    const userProfile = document.querySelector(
      "[data-testid='user-profile'], .user-profile, [aria-label*='profile']",
    );

    const requiresAuth =
      window.location.pathname.includes("/imagine") ||
      window.location.pathname.includes("/account");

    return !!(logoutButton || (userProfile && requiresAuth));
  });
}
async function ensureLoggedIn(page, account) {
  console.log("🔍 Checking login status...");

  // First check if already logged in
  if (await isLoggedIn(page)) {
    console.log("✅ Already logged in - skipping login");
    return true;
  }

  console.log("❌ Not logged in - proceeding with login");

  try {
    // Go directly to imagine URL
    await page.goto(GROK_IMAGINE_URL, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // CHANGE: Check for the specific "Sign in" button
    const signInButton = page.locator(
      'button[data-slot="button"][type="button"]:has-text("Sign in")',
    );
    if (await signInButton.count()) {
      console.log("➡ Found Sign in button - proceeding with login");
      await login(page, account.email, account.password);
    }

    // Verify login was successful
    await page.waitForTimeout(2000);
    console.log("✅ Login verified");
    return true;
  } catch (error) {
    console.error("🚨 Login process failed:", error.message);
    throw error;
  }
}
/* ---------------------------------- */
/* LOGIN FLOW (EXACT AS DESCRIBED) */
/* ---------------------------------- */
async function login(page, email, password) {
  console.log(`🔐 Logging in as ${email}`);

  /* ---- Click Sign in button ---- */
  // CHANGE: Use text-based selector to specifically target the "Sign in" button
  const signInButton = page.locator(
    'button[data-slot="button"][type="button"]:has-text("Sign in")',
  );
  await signInButton.waitFor({ timeout: 0 });
  await signInButton.click();

  /* ---- Login with email ---- */
  const loginWithEmailBtn = page.locator("button", {
    hasText: "Login with email",
  });

  await loginWithEmailBtn.waitFor({ timeout: 0 });
  await loginWithEmailBtn.click();

  /* ---- Email step ---- */
  const emailInput = page.locator('input[name="email"]');
  await emailInput.waitFor({ timeout: 0 });
  await emailInput.fill(email);

  await page.locator("button", { hasText: "Next" }).click();

  /* ---- Password step ---- */
  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.waitFor({ timeout: 0 });
  await passwordInput.fill(password);

  console.log("🛑 Waiting for Cloudflare Turnstile (solve manually)");

  /* ---- WAIT FOR CLOUDFLARE TURNSTILE TO DISAPPEAR ---- */
  await page.waitForFunction(
    () => {
      const iframe = document.querySelector(
        'iframe[src*="challenges.cloudflare.com"]',
      );
      return !iframe;
    },
    { timeout: 0 },
  );

  console.log("✅ CAPTCHA solved");

  /* ---- Login ---- */
  await page.locator("button", { hasText: "Login" }).click();

  console.log("✅ Login successful");
}
/* ---------------------------------- */
/* submit prompt */
/* ---------------------------------- */
async function submitPrompt(page, prompt) {
  console.log("✍️ Writing prompt");

  // Wait for the editable area (textarea or contenteditable div)
  const editable = page.locator("textarea, [contenteditable='true']");
  await editable.waitFor({ timeout: 0 });

  // Focus it
  await editable.click({ force: true });

  // Clear any placeholder text (some React components need this)
  await page.evaluate(
    (el) => {
      el.innerText = "";
      el.value = "";
    },
    await editable.elementHandle(),
  );

  // Type the prompt manually (safer than fill)
  await editable.type(prompt, { delay: 15 });

  // Wait a short moment to let React update state
  await page.waitForTimeout(300);

  // Press Enter to submit
  await editable.press("Enter");

  // Fallback: click the enabled Submit button if Enter didn’t work
  const submitButton = page.locator(
    "button[aria-label='Submit']:not([disabled])",
  );
  if (await submitButton.count()) {
    console.log("➡ Clicking Submit button");
    await submitButton.first().click();
  }

  console.log("✅ Prompt submitted");
}

/* ---------------------------------- */
/* RATE LIMIT DETECTION */
/* ---------------------------------- */

async function isRateLimited(page) {
  return page.evaluate(() => {
    // Look for the specific rate limit error element
    const rateLimitElement = document.querySelector(
      "div.flex.items-center.font-semibold",
    );
    if (!rateLimitElement) return false;

    // Check if it contains the specific text "Rate limit reached"
    return rateLimitElement.textContent?.includes("Rate limit reached");
  });
}

/* ---------------------------------- */
/* WAIT FOR IMAGES */
/* ---------------------------------- */

async function waitForImages(page, minCount = 16) {
  console.log("⏳ Waiting for generated images...");

  await page.waitForFunction(
    (count) => {
      const imgs = document.querySelectorAll("img[alt='Generated image']");
      return imgs.length >= count;
    },
    minCount,
    { timeout: 0 },
  );

  console.log("✅ Images generated");
}

/* ---------------------------------- */
/* CLICK MAKE VIDEO */
/* ---------------------------------- */

async function clickMakeVideoOnAllImages(page) {
  console.log("🎬 Clicking Make video on all images");

  const total = await page.evaluate(() => {
    const buttons = document.querySelectorAll(
      "button[aria-label='Make video']",
    );
    buttons.forEach((b) => b.click());
    return buttons.length;
  });

  console.log(`▶️ Triggered ${total} video generations`);
}

/* ---------------------------------- */
/* CAPTURE VIDEOS */
/* ---------------------------------- */
function sanitizePrompt(prompt, maxLength = 60) {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_") // safe filename
    .replace(/^_+|_+$/g, "") // trim underscores
    .slice(0, maxLength); // limit length
}

async function captureAllVideos(page, expectedCount, prompt, timeout = 120000) {
  console.log("⬇️ Capturing generated videos");

  const collected = new Set();

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([...collected]), timeout);

    const handler = async (response) => {
      try {
        const url = response.url();
        if (!url.includes(".mp4")) return;

        if (collected.has(url)) return;

        const buffer = await response.body();
        if (buffer.length < 500_000) return;

        const safePrompt = sanitizePrompt(prompt);
        const filePath = `${DOWNLOAD_DIR}/${safePrompt}-${collected.size + 1}.mp4`;

        fs.writeFileSync(filePath, buffer);

        collected.add(filePath);
        console.log(`💾 Saved ${collected.size}/${expectedCount}`);

        if (collected.size >= expectedCount) {
          clearTimeout(timer);
          page.off("response", handler);
          resolve([...collected]);
        }
      } catch {}
    };

    page.on("response", handler);
  });
}

/* ---------------------------------- */
/* MAIN EXPORT */
/* ---------------------------------- */
export async function generateGrokImagineVideos({
  prompt,
  account,
  imageCount = 16,
}) {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    executablePath: "/usr/bin/google-chrome-stable",
    viewport: { width: 1400, height: 900 },
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    acceptDownloads: true,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  /* ENSURE LOGGED IN */
  await ensureLoggedIn(page, account);

  /* PROMPT */
  await submitPrompt(page, prompt);

  /* CHECK FOR RATE LIMIT ERROR */
  if (await isRateLimited(page)) {
    console.log("🚨 Rate limit detected! Logging out and trying next account");
    await logout(page);
    await context.close();
    throw new Error("RATE_LIMIT_REACHED");
  }

  /* WAIT */
  await waitForImages(page, imageCount);

  /* VIDEO */
  await clickMakeVideoOnAllImages(page);

  /* DOWNLOAD */
  const videos = await captureAllVideos(page, imageCount, prompt);

  await context.close();

  return {
    prompt,
    images: imageCount,
    videos: videos.length,
    files: videos,
  };
}
