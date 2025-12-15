import { generateGrokImagineVideos } from "../browser/grok.browser.js";

export async function generateGrokImagineVideosService({ prompts, accounts }) {
  if (!Array.isArray(prompts)) prompts = [prompts];

  if (prompts.length > accounts.length) {
    throw new Error(
      `Not enough accounts for prompts: ${prompts.length} prompts but only ${accounts.length} accounts`,
    );
  }

  const results = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const account = accounts[i];

    let attempt = 0;
    while (attempt < 1) {
      // only one retry per account here
      try {
        console.log(
          `🔄 Using account: ${account.email} for prompt: "${prompt}"`,
        );
        const result = await generateGrokImagineVideos({ prompt, account });
        results.push(result);
        break; // success → move to next
      } catch (error) {
        if (error.message === "RATE_LIMIT_REACHED") {
          console.log("⏭️ Rate limit hit, account skipped, moving to next...");
          attempt++;
        } else {
          console.log(`❌ Account ${account.email} failed: ${error.message}`);
          results.push({ prompt, error: error.message });
          break;
        }
      }
    }
  }

  return results;
}
