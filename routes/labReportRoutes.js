import express from 'express';
import { upload } from '../middleware/upload.js';

import {
  getLabReports,
  getLabReportById,
  createLabReport,
  uploadReportImage,
  updateLabReport,
  deleteLabReport,
  updateTests,
  getOCRStatus
} from '../controllers/labReportController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();


router.use(requireAuth);

// GET /api/reports
router.get('/', getLabReports);

// GET /api/reports/:id
router.get('/:id', getLabReportById);

// POST /api/reports
router.post('/', createLabReport);

// POST /api/reports/:id/upload
router.post('/:id/upload', upload.single('image'), uploadReportImage);
router.get("/:id/ocr-status", getOCRStatus);

// PUT /api/reports/:id
router.put('/:id', updateLabReport);

// PUT /api/reports/:id/tests
router.put('/:id/tests', updateTests);

// DELETE /api/reports/:id
router.delete('/:id', deleteLabReport);

export default router;
