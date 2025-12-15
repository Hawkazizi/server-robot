import { generateGrokImagineVideos } from "../browser/grok.browser.js";

export async function generateGrokImagineVideosService({ prompts, accounts }) {
  if (!Array.isArray(prompts)) prompts = [prompts]; // ensure array

  if (prompts.length > accounts.length) {
    throw new Error(
      `Not enough accounts for prompts: ${prompts.length} prompts but only ${accounts.length} accounts`,
    );
  }

  const results = [];
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const account = accounts[i]; // 1 prompt per 1 account

    try {
      console.log(`🔄 Using account: ${account.email} for prompt: "${prompt}"`);
      const result = await generateGrokImagineVideos({ prompt, account });
      results.push(result);
    } catch (error) {
      console.log(`❌ Account ${account.email} failed: ${error.message}`);
      results.push({ prompt, error: error.message });
    }
  }

  return results;
}
