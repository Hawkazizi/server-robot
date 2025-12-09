import { generateVideoViaGeminiBrowser } from "../browser/gemini.browser.js";

export async function generateVideoViaGeminiBrowserService(prompt) {
  return await generateVideoViaGeminiBrowser(prompt);
}
