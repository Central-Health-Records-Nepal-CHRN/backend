// controllers/providerController.js
import { query } from '../config/database.js';

// Get provider profile
export const getProviderProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT p.*, u.name, u.email, u.avatar_url
       FROM providers p
       JOIN "user" u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get provider profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch provider profile' });
  }
};

// Update provider profile
export const updateProviderProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { specialty, license_number, phone, clinic_name, clinic_address, bio } = req.body;

    const result = await query(
      `UPDATE providers 
       SET specialty = COALESCE($1, specialty),
           license_number = COALESCE($2, license_number),
           phone = COALESCE($3, phone),
           clinic_name = COALESCE($4, clinic_name),
           clinic_address = COALESCE($5, clinic_address),
           bio = COALESCE($6, bio),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $7
       RETURNING *`,
      [specialty, license_number, phone, clinic_name, clinic_address, bio, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update provider profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get provider ID
    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
    
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    // Get total patients
    const totalPatientsResult = await query(
      `SELECT COUNT(*) as count FROM patient_provider_enrollments 
       WHERE provider_id = $1 AND status = 'accepted'`,
      [providerId]
    );

    // Get active patients (patients with recent activity)
    const activePatientsResult = await query(
      `SELECT COUNT(DISTINCT ppe.patient_id) as count
       FROM patient_provider_enrollments ppe
       LEFT JOIN appointments a ON a.user_id = ppe.patient_id
       WHERE ppe.provider_id = $1 
       AND ppe.status = 'accepted'
       AND (a.created_at > NOW() - INTERVAL '30 days' OR a.appointment_date > NOW())`,
      [providerId]
    );

    // Get pending enrollments
    const pendingEnrollmentsResult = await query(
      `SELECT COUNT(*) as count FROM patient_provider_enrollments 
       WHERE provider_id = $1 AND status = 'pending'`,
      [providerId]
    );

    // Get upcoming appointments count
    const upcomingAppointmentsResult = await query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN patient_provider_enrollments ppe ON a.user_id = ppe.patient_id
       WHERE ppe.provider_id = $1 
       AND ppe.status = 'accepted'
       AND a.appointment_date >= CURRENT_DATE
       AND a.status IN ('scheduled', 'confirmed')`,
      [providerId]
    );

    // Get recent enrollments
    const recentEnrollmentsResult = await query(
      `SELECT ppe.*, u.name, u.email
       FROM patient_provider_enrollments ppe
       JOIN "user" u ON ppe.patient_id = u.id
       WHERE ppe.provider_id = $1 AND ppe.status = 'accepted'
       ORDER BY ppe.enrolled_at DESC
       LIMIT 5`,
      [providerId]
    );

    res.json({
      success: true,
      data: {
        total_patients: parseInt(totalPatientsResult.rows[0].count),
        active_patients: parseInt(activePatientsResult.rows[0].count),
        pending_enrollments: parseInt(pendingEnrollmentsResult.rows[0].count),
        upcoming_appointments: parseInt(upcomingAppointmentsResult.rows[0].count),
        recent_enrollments: recentEnrollmentsResult.rows,
      },
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
};

// Get all enrolled patients
export const getEnrolledPatients = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Get provider ID
    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
    
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    const result = await query(
      `SELECT 
        u.id, u.name, u.email, u.date_of_birth, u.gender, u.phone,
        u.blood_type, u.avatar_url,
        ppe.enrolled_at, ppe.status,
        COUNT(DISTINCT a.id) as appointment_count,
        COUNT(DISTINCT m.id) as medication_count
       FROM patient_provider_enrollments ppe
       JOIN "user" u ON ppe.patient_id = u.id
       LEFT JOIN appointments a ON a.user_id = u.id
       LEFT JOIN medications m ON m.user_id = u.id AND m.is_active = true
       WHERE ppe.provider_id = $1 AND ppe.status = 'accepted'
       GROUP BY u.id, u.name, u.email, u.date_of_birth, u.gender, u.phone,
                u.blood_type, u.avatar_url, ppe.enrolled_at, ppe.status
       ORDER BY ppe.enrolled_at DESC
       LIMIT $2 OFFSET $3`,
      [providerId, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM patient_provider_enrollments 
       WHERE provider_id = $1 AND status = 'accepted'`,
      [providerId]
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
    console.error('Get enrolled patients error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch patients' });
  }
};

// Send enrollment invitation
export const sendEnrollmentInvitation = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patient_email, patient_name } = req.body;

    if (!patient_email) {
      return res.status(400).json({
        success: false,
        message: 'Patient email is required',
      });
    }

    // Get provider info
    const providerResult = await query(
      `SELECT p.id, u.name as provider_name, p.specialty, p.clinic_name
       FROM providers p
       JOIN "user" u ON p.user_id = u.id
       WHERE p.user_id = $1`,
      [userId]
    );

    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const provider = providerResult.rows[0];

    // Find patient by email
    const patientResult = await query(
      'SELECT id, name, email FROM "user" WHERE email = $1 AND role = $2',
      [patient_email.toLowerCase(), 'patient']
    );

    if (!patientResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found with this email',
      });
    }

    const patient = patientResult.rows[0];

    // Check if enrollment already exists
    const existingEnrollment = await query(
      `SELECT * FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2`,
      [patient.id, provider.id]
    );

    if (existingEnrollment.rows.length > 0) {
      const status = existingEnrollment.rows[0].status;
      if (status === 'accepted') {
        return res.status(400).json({
          success: false,
          message: 'Patient is already enrolled',
        });
      } else if (status === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Enrollment invitation already sent',
        });
      }
    }

    // Create enrollment
    const enrollmentResult = await query(
      `INSERT INTO patient_provider_enrollments (patient_id, provider_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [patient.id, provider.id]
    );

    const enrollment = enrollmentResult.rows[0];

    // Create notification
    const message = `Dr. ${provider.provider_name}${
      provider.clinic_name ? ` from ${provider.clinic_name}` : ''
    }${provider.specialty ? ` (${provider.specialty})` : ''} has sent you an enrollment request.`;

    await query(
      `INSERT INTO enrollment_notifications 
       (enrollment_id, patient_id, provider_id, message)
       VALUES ($1, $2, $3, $4)`,
      [enrollment.id, patient.id, provider.id, message]
    );

    res.json({
      success: true,
      message: 'Enrollment invitation sent successfully',
      data: enrollment,
    });
  } catch (error) {
    console.error('Send enrollment invitation error:', error);
    res.status(500).json({ success: false, message: 'Failed to send invitation' });
  }
};

// Get patient details (for provider)
export const getPatientDetails = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patientId } = req.params;

    // Get provider ID and verify enrollment
    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
    
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    // Check enrollment
    const enrollmentCheck = await query(
      `SELECT * FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2 AND status = 'accepted'`,
      [patientId, providerId]
    );

    if (!enrollmentCheck.rows.length) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this patient',
      });
    }

    // Get patient details
    const patientResult = await query(
      `SELECT id, name, email, date_of_birth, gender, phone, 
              blood_type, height, weight, avatar_url, "createdAt"
       FROM "user" WHERE id = $1`,
      [patientId]
    );

    if (!patientResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    res.json({ success: true, data: patientResult.rows[0] });
  } catch (error) {
    console.error('Get patient details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch patient details' });
  }
};

// Get patient appointments (for provider)
export const getPatientAppointments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patientId } = req.params;

    // Verify provider access
    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
    
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    const enrollmentCheck = await query(
      `SELECT * FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2 AND status = 'accepted'`,
      [patientId, providerId]
    );

    if (!enrollmentCheck.rows.length) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this patient',
      });
    }

    // Get appointments
    const result = await query(
      `SELECT * FROM appointments 
       WHERE user_id = $1 
       ORDER BY appointment_date DESC, appointment_time DESC`,
      [patientId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get patient appointments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch appointments' });
  }
};

// Get patient medications (for provider)
export const getPatientMedications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patientId } = req.params;

    // Verify provider access
    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
    
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    const enrollmentCheck = await query(
      `SELECT * FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2 AND status = 'accepted'`,
      [patientId, providerId]
    );

    if (!enrollmentCheck.rows.length) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this patient',
      });
    }

    // Get medications
    const result = await query(
      `SELECT * FROM medications 
       WHERE user_id = $1 
       ORDER BY is_active DESC, start_date DESC`,
      [patientId]
    );

    // Parse times JSON for each medication
    const medications = result.rows.map((med) => ({
      ...med,
      times: typeof med.times === 'string' ? JSON.parse(med.times) : med.times,
    }));

    res.json({ success: true, data: medications });
  } catch (error) {
    console.error('Get patient medications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch medications' });
  }
};

// Get pending enrollments (for provider)
export const getPendingEnrollments = async (req, res) => {
  try {
    const userId = req.user.userId;

    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
    
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    const result = await query(
      `SELECT ppe.*, u.name, u.email
       FROM patient_provider_enrollments ppe
       JOIN "user" u ON ppe.patient_id = u.id
       WHERE ppe.provider_id = $1 AND ppe.status = 'pending'
       ORDER BY ppe.created_at DESC`,
      [providerId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get pending enrollments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending enrollments' });
  }
};

export const getProviderNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('Fetching provider notifications for userId:', userId);

    const result = await query(
      `SELECT * FROM provider_notifications 
       WHERE is_read = false
       ORDER BY created_at DESC`,
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get provider notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' }); 
  }
  }

  export const getPatientMedicationLogs = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patientId } = req.params;

    const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
     
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;
    // Verify enrollment
    const enrollment = await query(
      `SELECT id FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2 AND status = 'accepted'`,
      [patientId, providerId]
    );

    if (enrollment.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this patient',
      });
    }

    const logs = await query(
      `SELECT 
        ml.id,
        ml.scheduled_time,
        ml.taken_at,
        ml.status,
        ml.notes,
        m.medication_name,
        m.dosage,
        m.quantity_per_dose
       FROM medication_logs ml
       JOIN medications m ON ml.medication_id = m.id
       WHERE ml.user_id = $1
       ORDER BY ml.scheduled_time DESC
       LIMIT 100`,
      [patientId]
    );

    res.json({
      success: true,
      data: logs.rows,
    });
  } catch (error) {
    console.error('Get patient medication logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch medication logs',
    });
  }
};

// Get patient lab reports
export const getPatientLabReports = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patientId } = req.params;

      const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
     
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    // Verify enrollment
    const enrollment = await query(
      `SELECT id FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2 AND status = 'accepted'`,
      [patientId, providerId]
    );

    if (enrollment.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this patient',
      });
    }

    const reports = await query(
      `SELECT 
        lr.id,
        lr.lab_name,
        lr.report_date,
        lr.image_url,
        lr.notes,
        lr.ai_summary,
        lr.created_at,
        (SELECT COUNT(*) FROM lab_tests WHERE report_id = lr.id) as test_count
       FROM lab_reports lr
       WHERE lr.user_id = $1
       ORDER BY lr.report_date DESC`,
      [patientId]
    );

    res.json({
      success: true,
      data: reports.rows,
    });
  } catch (error) {
    console.error('Get patient lab reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lab reports',
    });
  }
};

// controllers/providerController.js - Add this function

// Get patient lab report detail
export const getPatientLabReportDetail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { patientId, reportId } = req.params;
      const providerResult = await query('SELECT id FROM providers WHERE user_id = $1', [userId]);
     
    if (!providerResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    const providerId = providerResult.rows[0].id;

    console.log('📋 Getting lab report detail:', { providerId, patientId, reportId });

    // Verify enrollment
    const enrollment = await query(
      `SELECT id FROM patient_provider_enrollments 
       WHERE patient_id = $1 AND provider_id = $2 AND status = 'accepted'`,
      [patientId, providerId]
    );

    if (enrollment.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this patient data',
      });
    }

    // Get lab report details
    const reportResult = await query(
      `SELECT 
        lr.id,
        lr.lab_name,
        lr.report_date,
        lr.image_url,
        lr.notes,
        lr.ai_summary,
        lr.ai_summary_generated_at,
        lr.created_at,
        lr.updated_at
       FROM lab_reports lr
       WHERE lr.id = $1 AND lr.user_id = $2`,
      [reportId, patientId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lab report not found',
      });
    }

    const report = reportResult.rows[0];

    // Get test results for this report
    const testsResult = await query(
      `SELECT 
        id,
        test_name,
        value,
        unit,
        normal_range,
        created_at
       FROM lab_tests
       WHERE report_id = $1
       ORDER BY test_name ASC`,
      [reportId]
    );

    res.json({
      success: true,
      data: {
        report,
        tests: testsResult.rows,
      },
    });

  } catch (error) {
    console.error('Get patient lab report detail error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lab report details',
      error: error.message,
    });
  }
};