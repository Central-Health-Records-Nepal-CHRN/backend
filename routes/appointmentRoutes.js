// routes/appointmentRoutes.js
import express from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  getAllAppointments,
  getAppointmentById,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getUpcomingAppointments,
  getPastAppointments,
} from '../controllers/appointmentsController.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

router.get('/', getAllAppointments);
router.get('/upcoming', getUpcomingAppointments);
router.get('/past', getPastAppointments);
router.get('/:id', getAppointmentById);
router.post('/', createAppointment);
router.put('/:id', updateAppointment);
router.delete('/:id', deleteAppointment);

export default router;