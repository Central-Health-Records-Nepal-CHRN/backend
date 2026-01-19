// routes/userRoutes.js
import express from 'express';
import { requireAuth } from "../middleware/requireAuth.js"
import {
  getUserProfile,
  updateUserProfile,
  updateEmail,
  updatePassword,
  getUserSettings,
  updateUserSettings,
  deleteAccount,
} from '../controllers/userController.js';

const router = express.Router();

router.use(requireAuth);

router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);
router.put('/email', updateEmail);
router.put('/password', updatePassword);
router.get('/settings', getUserSettings);
router.put('/settings', updateUserSettings);
router.delete('/account', deleteAccount);

export default router;