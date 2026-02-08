// controllers/adminController.js
import { query } from '../config/database.js';

// Middleware to check if user is admin
export const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await query('SELECT is_admin FROM "user" WHERE id = $1', [userId]);

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.',
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({
      success: false,
      message: 'Authorization check failed',
    });
  }
};

// Get all pending providers
export const getPendingProviders = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT 
        p.id,
        p.specialty,
        p.license_number,
        p.phone,
        p.clinic_name,
        p.clinic_address,
        p.bio,
        p.verification_status,
        p.created_at,
        u.id as user_id,
        u.name,
        u.email,
        json_agg(
          json_build_object(
            'id', pvd.id,
            'document_type', pvd.document_type,
            'document_url', pvd.document_url,
            'document_name', pvd.document_name,
            'uploaded_at', pvd.uploaded_at
          )
        ) FILTER (WHERE pvd.id IS NOT NULL) as documents
       FROM providers p
       JOIN "user" u ON p.user_id = u.id
       LEFT JOIN provider_verification_documents pvd ON p.id = pvd.provider_id
       WHERE p.verification_status = 'pending'
       GROUP BY p.id, u.id
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(
      "SELECT COUNT(*) FROM providers WHERE verification_status = 'pending'"
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get pending providers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending providers',
    });
  }
};

// Get all providers (with filters)
export const getAllProviders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params = [limit, offset];
    let paramIndex = 3;

    if (status) {
      whereClause += ` AND p.verification_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR p.specialty ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const result = await query(
      `SELECT 
        p.id,
        p.specialty,
        p.license_number,
        p.phone,
        p.clinic_name,
        p.verification_status,
        p.verified_at,
        p.created_at,
        u.id as user_id,
        u.name,
        u.email,
        COUNT(DISTINCT ppe.id) as patient_count
       FROM providers p
       JOIN "user" u ON p.user_id = u.id
       LEFT JOIN patient_provider_enrollments ppe ON p.id = ppe.provider_id AND ppe.status = 'accepted'
       WHERE ${whereClause}
       GROUP BY p.id, u.id
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countParams = params.slice(2); // Remove limit and offset
    const countResult = await query(
      `SELECT COUNT(*) FROM providers p JOIN "user" u ON p.user_id = u.id WHERE ${whereClause}`,
      countParams
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get all providers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch providers',
    });
  }
};

// Get all users
export const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, role, search } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = '1=1';
    const params = [limit, offset];
    let paramIndex = 3;

    if (role) {
      whereClause += ` AND u.role = $${paramIndex}`;
      params.push(role);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const result = await query(
      `SELECT 
        u.id,
        u.name,
        u.email,
        u.role,
        u.date_of_birth,
        u.gender,
       u."createdAt",
        u.is_admin,
        CASE 
          WHEN u.role = 'patient' THEN (
            SELECT COUNT(*) FROM appointments WHERE user_id = u.id
          )
          ELSE NULL
        END as appointment_count,
        CASE 
          WHEN u.role = 'patient' THEN (
            SELECT COUNT(*) FROM medications WHERE user_id = u.id
          )
          ELSE NULL
        END as medication_count
       FROM "user" u
       WHERE ${whereClause}
       ORDER BY u."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countParams = params.slice(2);
    const countResult = await query(
      `SELECT COUNT(*) FROM "user" u WHERE ${whereClause}`,
      countParams
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
    });
  }
};

// Verify provider
export const verifyProvider = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const { providerId } = req.params;
    const { approved, rejection_reason } = req.body;

    await query('BEGIN');

    try {
      if (approved) {
        // Approve provider
        await query(
          `UPDATE providers 
           SET verification_status = 'verified', 
               verified_at = CURRENT_TIMESTAMP,
               verified_by = $1,
               rejection_reason = NULL
           WHERE id = $2`,
          [adminId, providerId]
        );

        // Log admin activity
        await query(
          `INSERT INTO admin_activity_logs (admin_id, action_type, target_type, target_id, details)
           VALUES ($1, 'verify_provider', 'provider', $2, $3)`,
          [adminId, providerId, JSON.stringify({ approved: true })]
        );
      } else {
        // Reject provider
        await query(
          `UPDATE providers 
           SET verification_status = 'rejected',
               rejection_reason = $1,
               verified_by = $2
           WHERE id = $3`,
          [rejection_reason, adminId, providerId]
        );

        // Log admin activity
        await query(
          `INSERT INTO admin_activity_logs (admin_id, action_type, target_type, target_id, details)
           VALUES ($1, 'reject_provider', 'provider', $2, $3)`,
          [adminId, providerId, JSON.stringify({ approved: false, rejection_reason })]
        );
      }

      await query('COMMIT');

      res.json({
        success: true,
        message: approved ? 'Provider verified successfully' : 'Provider rejected',
      });
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Verify provider error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process verification',
    });
  }
};

// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM "user" WHERE role = 'patient') as total_patients,
        (SELECT COUNT(*) FROM providers) as total_providers,
        (SELECT COUNT(*) FROM providers WHERE verification_status = 'verified') as verified_providers,
        (SELECT COUNT(*) FROM providers WHERE verification_status = 'pending') as pending_providers,
        (SELECT COUNT(*) FROM appointments) as total_appointments,
        (SELECT COUNT(*) FROM medications) as total_medications,
        (SELECT COUNT(*) FROM "user" WHERE "createdAt" >= CURRENT_DATE - INTERVAL '7 days') as new_users_week,
        (SELECT COUNT(*) FROM providers WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_providers_week
    `);

    res.json({
      success: true,
      data: stats.rows[0],
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
    });
  }
};

// Get admin activity logs
export const getActivityLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT 
        aal.*,
        u.name as admin_name,
        u.email as admin_email
       FROM admin_activity_logs aal
       JOIN "user" u ON aal.admin_id = u.id
       ORDER BY aal.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query('SELECT COUNT(*) FROM admin_activity_logs');

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity logs',
    });
  }
};