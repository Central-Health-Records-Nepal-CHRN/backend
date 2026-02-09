// controllers/enrollmentController.js
import { query } from '../config/database.js';

// Get enrollment notifications (for patient)
export const getEnrollmentNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `
  SELECT 
    en.*,
    p.specialty,
    p.clinic_name,
    u.name AS provider_name,
    u.email AS provider_email,
    ppe.status AS status
  FROM enrollment_notifications en
  JOIN providers p 
    ON en.provider_id = p.id
  JOIN "user" u 
    ON p.user_id = u.id
  LEFT JOIN patient_provider_enrollments ppe
    ON ppe.provider_id = en.provider_id
   AND ppe.patient_id = en.patient_id
  WHERE en.patient_id = $1
  ORDER BY en.created_at DESC
  `,
      [userId],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get enrollment notifications error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch notifications" });
  }
};

// Get unread enrollment notifications count
export const getUnreadNotificationsCount = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT COUNT(*) as count FROM enrollment_notifications 
       WHERE patient_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch count' });
  }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notificationId } = req.params;

    await query(
      `UPDATE enrollment_notifications 
       SET is_read = true 
       WHERE id = $1 AND patient_id = $2`,
      [notificationId, userId]
    );

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
};

// Respond to enrollment invitation
export const respondToEnrollment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enrollmentId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be "accept" or "reject"',
      });
    }

    // Verify enrollment belongs to user
    const enrollmentResult = await query(
      `SELECT * FROM patient_provider_enrollments 
       WHERE id = $1 AND patient_id = $2 AND status = 'pending'`,
      [enrollmentId, userId]
    );

    if (!enrollmentResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Enrollment not found or already processed',
      });
    }

    const status = action === 'accept' ? 'accepted' : 'rejected';
    const enrolledAt = action === 'accept' ? 'CURRENT_TIMESTAMP' : 'NULL';

    // Update enrollment
    await query(
      `UPDATE patient_provider_enrollments 
       SET status = $1, enrolled_at = ${enrolledAt}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, enrollmentId]
    );

    res.json({
      success: true,
      message: `Enrollment ${action}ed successfully`,
    });
  } catch (error) {
    console.error('Respond to enrollment error:', error);
    res.status(500).json({ success: false, message: 'Failed to respond to enrollment' });
  }
};

// Get patient's enrolled providers
export const getEnrolledProviders = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT 
        p.id, p.specialty, p.clinic_name, p.clinic_address, p.phone, p.bio,
        u.name as provider_name, u.email as provider_email, u.avatar_url,
        ppe.enrolled_at
       FROM patient_provider_enrollments ppe
       JOIN providers p ON ppe.provider_id = p.id
       JOIN "user" u ON p.user_id = u.id
       WHERE ppe.patient_id = $1 AND ppe.status = 'accepted'
       ORDER BY ppe.enrolled_at DESC`,
      [userId]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get enrolled providers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch providers' });
  }
};