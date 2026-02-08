// routes/medicationRoutes.js
import express from 'express';

import {
  getAllMedications,
  getMedicationById,
  createMedication,
  updateMedication,
  deleteMedication,
  getTodaysMedications,
  markMedicationTaken,
  regenerateAIDescription,
  getTodaysMedicationsWithStatus,
  getNextDoseTime,
  getMedicationLogs,
  getLogsByDateRange,
  getLogsStatistics, 
} from '../controllers/medicationsController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.use(requireAuth);

router.get('/logs', getMedicationLogs);
router.get('/logs/date-range', getLogsByDateRange);
router.get('/logs/statistics', getLogsStatistics);


router.get('/today', getTodaysMedications);
router.get('/today/status', getTodaysMedicationsWithStatus); 
router.get('/:id/next-dose', getNextDoseTime);
router.get('/:id', getMedicationById);

router.put('/:id', updateMedication);
router.delete('/:id', deleteMedication);
router.post('/:id/mark-status', markMedicationTaken);
router.post('/:id/regenerate-description', regenerateAIDescription); // Add this

router.get('/', getAllMedications);
router.post('/', createMedication);


export default router;