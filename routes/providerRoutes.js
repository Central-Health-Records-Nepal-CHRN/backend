// routes/providerRoutes.js
import express from 'express';
import {
  getProviderProfile,
  updateProviderProfile,
  getDashboardStats,
  getEnrolledPatients,
  sendEnrollmentInvitation,
  getPatientDetails,
  getPatientAppointments,
  getPatientMedications,
  getPendingEnrollments,
} from '../controllers/providerController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.use(requireAuth);

router.get('/profile', getProviderProfile);
router.put('/profile', updateProviderProfile);
router.get('/dashboard/stats', getDashboardStats);
router.get('/patients', getEnrolledPatients);
router.get('/patients/:patientId', getPatientDetails);
router.get('/patients/:patientId/appointments', getPatientAppointments);
router.get('/patients/:patientId/medications', getPatientMedications);
router.post('/enrollments/invite', sendEnrollmentInvitation);
router.get('/enrollments/pending', getPendingEnrollments);

export default router;