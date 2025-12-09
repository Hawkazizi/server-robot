import { generateVideoViaGoogleFlowBatch } from "../browser/google.browser.js";

/**
 * Run a batch of Google Flow text-to-video prompts with account rotation.
 *
 * @param {Object} params
 * @param {string[]} params.prompts - List of text prompts
 * @param {Array<{email: string, password: string}>} params.accounts - Google accounts
 */
export async function generateVideoViaGoogleFlowBatchService({
  prompts,
  accounts,
}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error("prompts must be a non-empty array");
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("accounts must be a non-empty array");
  }

  return await generateVideoViaGoogleFlowBatch({
    prompts,
    accounts,
  });
}
