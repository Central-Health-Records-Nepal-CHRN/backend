// src/server.ts
import express from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import "dotenv/config"
import router from "./routes/labReportRoutes.js";


const app = express();
const port = process.env.PORT || 3000;

// CORS (optional, but common)
app.use(
  cors({
    origin: true, // allow all origins
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);


// Mount Better Auth handler
// All auth routes will be under /api/auth/*
app.all("/api/auth/*splat", toNodeHandler(auth));

// Now use express.json for your other routes
app.use(express.json());

app.use('/api/reports', router);

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


