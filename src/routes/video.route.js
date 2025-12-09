import express from "express";
import { generateVideoViaGeminiBrowserService } from "../services/gemini.browser.service.js";
import { generateVideoViaQwenBrowserBatchService } from "../services/qwen.browser.service.js";
import { generateVideoViaGoogleFlowBatchService } from "../services/google.browser.service.js";

const router = express.Router();

// Gemini
router.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;
    const videoUrl = await generateVideoViaGeminiBrowserService(prompt);
    res.json({ provider: "gemini", videoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/generate-qwen-batch", async (req, res) => {
  try {
    const { prompts, accounts } = req.body;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({
        error: "prompts must be a non-empty array of strings",
      });
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        error: "accounts must be a non-empty array",
      });
    }

    const results = await generateVideoViaQwenBrowserBatchService({
      prompts,
      accounts,
    });

    res.json({
      provider: "qwen",
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("❌ Batch error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------- */
/* ✅ GOOGLE FLOW (batch + accounts) */
/* ---------------------------------- */

router.post("/generate-google-flow-batch", async (req, res) => {
  try {
    const { prompts, accounts } = req.body;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({
        error: "prompts must be a non-empty array of strings",
      });
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({
        error: "accounts must be a non-empty array",
      });
    }

    const results = await generateVideoViaGoogleFlowBatchService({
      prompts,
      accounts,
    });

    res.json({
      provider: "google-flow",
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("❌ Google Flow batch error:", err);
    res.status(500).json({ error: err.message });
  }
});
export default router;
