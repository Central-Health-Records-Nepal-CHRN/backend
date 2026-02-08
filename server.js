// src/server.ts
import express from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import "dotenv/config"
import router from "./routes/labReportRoutes.js";
import appointmentRoutes from './routes/appointmentRoutes.js';
import medicationRoutes from './routes/medicationRoutes.js';
import userRoutes from "./routes/userRoutes.js"
import providerRoutes from './routes/providerRoutes.js';
import enrollmentRoutes from './routes/enrollmentRoutes.js';
import providerRegistrationRoutes from './routes/providerRegistrationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

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

app.use((req, res, next) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📥 ${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', req.body);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  next();
});

// Mount Better Auth handler
// All auth routes will be under /api/auth/*
app.all("/api/auth/*splat", toNodeHandler(auth));

// Now use express.json for your other routes
app.use(express.json());

app.use('/api/reports', router);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/provider', providerRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/provider-registration', providerRegistrationRoutes);
app.use('/api/admin', adminRoutes);

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


