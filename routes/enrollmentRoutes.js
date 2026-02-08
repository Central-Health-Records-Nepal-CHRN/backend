// routes/enrollmentRoutes.js
import express from 'express';
import {
  getEnrollmentNotifications,
  getUnreadNotificationsCount,
  markNotificationAsRead,
  respondToEnrollment,
  getEnrolledProviders,
} from '../controllers/enrollmentController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.use(requireAuth);

router.get('/notifications', getEnrollmentNotifications);
router.get('/notifications/unread-count', getUnreadNotificationsCount);
router.put('/notifications/:notificationId/read', markNotificationAsRead);
router.post('/enrollments/:enrollmentId/respond', respondToEnrollment);
router.get('/providers', getEnrolledProviders);

export default router;