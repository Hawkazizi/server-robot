import { generateGrokImagineVideos } from "../browser/grok.browser.js";

export async function generateGrokImagineVideosService({ prompt, accounts }) {
  let lastError = null;

  for (const account of accounts) {
    try {
      console.log(`🔄 Trying account: ${account.email}`);
      return await generateGrokImagineVideos({
        prompt,
        account,
      });
    } catch (error) {
      lastError = error;
      console.log(`❌ Account ${account.email} failed: ${error.message}`);

      // Check for rate limit errors
      if (
        error.message.toLowerCase().includes("rate limit") ||
        error.message.toLowerCase().includes("quota") ||
        error.message.toLowerCase().includes("too many requests")
      ) {
        console.log(`⏭️ Rate limit reached, trying next account...`);
        continue;
      }

      // For other errors, rethrow immediately
      throw error;
    }
  }

  throw new Error(`All accounts failed. Last error: ${lastError?.message}`);
}
