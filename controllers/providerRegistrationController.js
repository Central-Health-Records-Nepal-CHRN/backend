// controllers/providerRegistrationController.js
import { query } from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Register as a provider (creates user account + provider profile)
export const registerProvider = async (req, res) => {
    console.log("Register Provider called");
  try {
    const {
      name,
      email,
      password,
      phone,
      specialty,
      license_number,
      clinic_name,
      clinic_address,
      bio,
    } = req.body;

    // Validation
    if (!name || !email || !password || !specialty || !license_number) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, specialty, and license number are required',
      });
    }

    // Check if email already exists
    const existingUser = await query('SELECT id FROM "user" WHERE email = $1', [email]);
    console.log("Existing user query result:", existingUser.rows);
    console.log("Existing user", existingUser)
    console.log("Existing user length", existingUser.rows[0].id);

    try {


      // Create provider profile (pending verification)
      const providerResult = await query(
        `INSERT INTO providers (
          user_id, specialty, license_number, phone, clinic_name, 
          clinic_address, bio, verification_status, created_at
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) 
        RETURNING id`,
        [existingUser.rows[0].id, specialty, license_number, phone, clinic_name, clinic_address, bio, 'pending']
      );

      await query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Provider registration successful. Awaiting verification.',
        data: {
          user: {
            id: existingUser.rows[0].id,
            name,
            email,
            role: 'provider',
          },
          provider: {
            id: providerResult.rows[0].id,
            verification_status: 'pending',
          },
        },
      });
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Provider registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
    });
  }
};

// Upload verification document
export const uploadVerificationDocument = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { document_type, document_url, document_name } = req.body;

    // Get provider ID
    const providerResult = await query(
      'SELECT id FROM providers WHERE user_id = $1',
      [userId]
    );

    if (providerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found',
      });
    }

    const providerId = providerResult.rows[0].id;

    // Insert document
    const result = await query(
      `INSERT INTO provider_verification_documents 
       (provider_id, document_type, document_url, document_name) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [providerId, document_type, document_url, document_name]
    );

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
    });
  }
};

// Get provider verification status
export const getVerificationStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT 
        p.id,
        p.verification_status,
        p.verified_at,
        p.rejection_reason,
        json_agg(
          json_build_object(
            'id', pvd.id,
            'document_type', pvd.document_type,
            'document_name', pvd.document_name,
            'uploaded_at', pvd.uploaded_at
          )
        ) FILTER (WHERE pvd.id IS NOT NULL) as documents
       FROM providers p
       LEFT JOIN provider_verification_documents pvd ON p.id = pvd.provider_id
       WHERE p.user_id = $1
       GROUP BY p.id`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get verification status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verification status',
    });
  }
};