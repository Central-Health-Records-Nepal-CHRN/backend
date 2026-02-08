// routes/adminRoutes.js
import express from 'express';
import {
  requireAdmin,
  getPendingProviders,
  getAllProviders,
  getAllUsers,
  verifyProvider,
  getDashboardStats,
  getActivityLogs,
} from '../controllers/adminController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// All routes require authentication and admin privileges
router.use(requireAuth);
router.use(requireAdmin);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);
router.get('/activity-logs', getActivityLogs);

// Providers management
router.get('/providers/pending', getPendingProviders);
router.get('/providers', getAllProviders);
router.post('/providers/:providerId/verify', verifyProvider);

// Users management
router.get('/users', getAllUsers);

export default router;