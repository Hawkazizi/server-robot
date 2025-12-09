import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import videoRoutes from "./routes/video.route.js";

dotenv.config();

const app = express();

// ✅ ENABLE CORS
app.use(
  cors({
    origin: "http://localhost:5173", // Vite default
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

app.use(express.json());

app.use("/api/video", videoRoutes);

export default app;
