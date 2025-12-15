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
async function safeCloseContext(context) {
  try {
    await context.close();
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
}

async function isLoggedIn(page) {
  return page.evaluate(() => {
    const logoutButton = Array.from(
      document.querySelectorAll("div[role='menuitem'], button"),
    ).some((el) => /sign\s*out/i.test(el.textContent || ""));

    const userAvatar = document.querySelector(
      "button img, img[alt*='profile'], img[alt*='user']",
    );

    const signInButton = Array.from(document.querySelectorAll("button")).some(
      (b) => /sign\s*in/i.test(b.textContent || ""),
    );

    return Boolean((logoutButton || userAvatar) && !signInButton);
  });
}
async function ensureLoggedIn(page, account) {
  console.log("🔍 Checking login status...");

  await page.goto(GROK_IMAGINE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Fast path
  if (await isLoggedIn(page)) {
    console.log("✅ Already logged in");
    return true;
  }

  console.log("❌ Not logged in - proceeding with login");
  await login(page, account.email, account.password);

  console.log("⏳ Verifying login state...");

  // WAIT for ANY valid logged-in signal
  await Promise.race([
    // 1️⃣ Imagine prompt is available (BEST SIGNAL)
    page.waitForSelector("textarea, [contenteditable='true']", {
      timeout: 200000,
    }),

    // 2️⃣ Logout / avatar appears
    page.waitForFunction(
      () => {
        return Array.from(document.querySelectorAll("button, div")).some((el) =>
          /sign\s*out/i.test(el.textContent || ""),
        );
      },
      { timeout: 20000 },
    ),
  ]);

  // FINAL sanity check: Sign in should be gone
  const stillSignedOut = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).some((b) =>
      /sign\s*in/i.test(b.textContent || ""),
    );
  });

  if (stillSignedOut) {
    throw new Error("LOGIN_FAILED");
  }

  console.log("✅ Login verified");
  return true;
}

async function ensureImageModelSelected(page) {
  const modelButton = page
    .locator('button#model-select-trigger[aria-label="Model select"]')
    .first();

  await modelButton.waitFor({ state: "visible" });

  const expanded = await modelButton.getAttribute("aria-expanded");

  if (expanded !== "true") {
    await modelButton.click();
  }

  // Wait for Radix menu container
  const menu = page.locator('div[role="menu"][data-state="open"]');
  await menu.waitFor({ state: "visible" });

  // ✅ TARGET THE MENUITEM ITSELF (NOT THE SPAN)
  const imageMenuItem = menu.locator('div[role="menuitem"]', {
    has: page.getByText("Image", { exact: true }),
  });

  await imageMenuItem.first().click();

  // Wait until dropdown closes
  await page.waitForFunction(() => {
    const btn = document.querySelector("#model-select-trigger");
    return btn && btn.getAttribute("aria-expanded") === "false";
  });

  console.log("🖼️ Image model selected");
}

/* ---------------------------------- */
/* LOGIN FLOW (EXACT AS DESCRIBED) */
/* ---------------------------------- */
async function login(page, email, password) {
  console.log(`🔐 Logging in as ${email}`);

  const signInButton = page.locator(
    'button[data-slot="button"][type="button"]:has-text("Sign in")',
  );

  if (await signInButton.count()) {
    await signInButton.first().click();
  }

  // Login with email
  const loginWithEmailBtn = page.locator("button", {
    hasText: "Login with email",
  });
  await loginWithEmailBtn.waitFor({ timeout: 15000 });
  await loginWithEmailBtn.click();

  // Email
  const emailInput = page.locator('input[name="email"]');
  await emailInput.waitFor({ timeout: 15000 });
  await emailInput.fill(email);
  await page.locator("button", { hasText: "Next" }).click();

  // Password
  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.waitFor({ timeout: 15000 });
  await passwordInput.fill(password);

  console.log("🛑 Waiting for Cloudflare Turnstile (solve manually)");

  await page.waitForFunction(
    () => !document.querySelector('iframe[src*="challenges.cloudflare.com"]'),
    { timeout: 5 * 60 * 1000 },
  );

  console.log("✅ CAPTCHA solved");

  // 🔥 FIXED: submit button (NOT OAuth logins)
  const submitLoginBtn = page.locator(
    'form button[type="submit"], form button:has-text("Login")',
  );
  await submitLoginBtn.first().click();

  console.log("✅ Login submitted");
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
      // Check images
      const imgs = document.querySelectorAll("img[alt='Generated image']");
      if (imgs.length >= count) return true;

      // Also check rate limit toast
      const rateToast = document.querySelector(
        "li[data-type='error'] .flex.items-center.font-semibold",
      );
      if (rateToast?.textContent.includes("Rate limit reached")) {
        return "RATE_LIMIT_REACHED";
      }

      return false;
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

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off("response", handler);
      resolve([...collected]);
    }, timeout);

    const handler = async (response) => {
      try {
        // --- RATE LIMIT DETECTION ---
        const rateToast = await page.$(
          "li[data-type='error'] .flex.items-center.font-semibold",
        );
        if (rateToast) {
          const text = await rateToast.textContent();
          if (text.includes("Rate limit reached")) {
            console.log("🚨 Rate limit detected during video capture!");

            page.off("response", handler); // ⛔ stop handler immediately
            clearTimeout(timer);

            await logout(page);
            await safeCloseContext(page.context());

            reject(new Error("RATE_LIMIT_REACHED"));
            return;
          }
        }

        // --- VIDEO CAPTURE ---
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
      } catch (err) {
        console.error("⚠️ Error in captureAllVideos handler:", err);
      }
    };

    page.on("response", handler);
  });
}
async function logout(page) {
  console.log("🚪 Logging out...");

  try {
    // Open profile menu
    const profileBtn = page.locator('button[aria-haspopup="menu"]');
    if (await profileBtn.count()) {
      await profileBtn.first().click();
      await page.waitForTimeout(300);
    }

    // Click Sign Out
    const signOutItem = page.locator('div[role="menuitem"]', {
      hasText: "Sign Out",
    });

    if (await signOutItem.count()) {
      await signOutItem.first().click();
      console.log("✅ Sign Out clicked");
    }
  } catch (err) {
    console.log("⚠️ Logout UI not available, skipping:", err.message);
  }

  // 🔑 IMPORTANT: wait for backend session invalidation
  console.log("⏳ Waiting 5s for session cleanup...");
  await page.waitForTimeout(10000);

  console.log("🚪 Logout completed");
}

/* ---------------------------------- */
/* MAIN EXPORT */
/* ---------------------------------- */
export async function generateGrokImagineVideos({
  prompt,
  account,
  imageCount = 16,
}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt must be a non-empty string");
  }
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

  await ensureImageModelSelected(page);
  /* Inside generateGrokImagineVideos */
  await submitPrompt(page, prompt);

  /* CHECK FOR RATE LIMIT */
  if (await isRateLimited(page)) {
    console.log("🚨 Rate limit detected! Logging out...");
    await logout(page);
    await safeCloseContext(page.context());
    throw new Error("RATE_LIMIT_REACHED");
  }

  /* WAIT */
  const imageStatus = await waitForImages(page, imageCount);

  if (imageStatus === "RATE_LIMIT_REACHED") {
    console.log("🚨 Rate limit reached — logging out & rotating account");
    await logout(page);
    await safeCloseContext(page.context());

    throw new Error("RATE_LIMIT_REACHED");
  }

  /* VIDEO */
  await clickMakeVideoOnAllImages(page);

  /* DOWNLOAD */
  const videos = await captureAllVideos(page, imageCount, prompt);

  await safeCloseContext(page.context());

  return {
    prompt,
    images: imageCount,
    videos: videos.length,
    files: videos,
  };
}
