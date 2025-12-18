// src/server.ts
import express from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import "dotenv/config"
import { sendMail } from "./utils/sendEmail.js";

const app = express();
const port = process.env.PORT || 3000;

// CORS (optional, but common)
app.use(
  cors({
     origin: ["http://localhost:3000", "http://127.0.0.1:3000", "exp://192.168.18.16:8082", "https://merohealth-web.vercel.app","exp://192.168.1.65:8081"], 
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// Mount Better Auth handler
// All auth routes will be under /api/auth/*
app.all("/api/auth/*splat", toNodeHandler(auth));

// Now use express.json for your other routes
app.use(express.json());

// Example protected route: get the current session
app.get("/api/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  res.json(session);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
