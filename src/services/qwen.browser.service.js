import { generateVideoViaQwenBrowserBatch } from "../browser/qwen.browser.js";

export async function generateVideoViaQwenBrowserBatchService({
  prompts,
  accounts,
}) {
  return await generateVideoViaQwenBrowserBatch({
    prompts,
    accounts,
  });
}
