// routes/providerRegistrationRoutes.js
import express from 'express';
import {
  registerProvider,
  uploadVerificationDocument,
  getVerificationStatus,
} from '../controllers/providerRegistrationController.js';

const router = express.Router();

router.post('/register', registerProvider);
router.post('/documents', uploadVerificationDocument);
router.get('/verification-status', getVerificationStatus);

export default router;