// controllers/appointmentsController.js
import { query } from '../config/database.js';

// Get all appointments for a user
export const getAllAppointments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50, status } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
      SELECT * FROM appointments
      WHERE user_id = $1
    `;
    const params = [userId];

    if (status) {
      queryText += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    queryText += ` ORDER BY appointment_date DESC, appointment_time DESC LIMIT $${
      params.length + 1
    } OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM appointments WHERE user_id = $1 ${
        status ? 'AND status = $2' : ''
      }`,
      status ? [userId, status] : [userId]
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
    console.error('Get appointments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch appointments' });
  }
};

// Get single appointment
export const getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      'SELECT * FROM appointments WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch appointment' });
  }
};

// Create appointment
export const createAppointment = async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      doctor_name,
      specialty,
      appointment_type,
      appointment_date,
      appointment_time,
      location,
      phone_number,
      address,
      notes,
      status = 'scheduled',
      reminder_minutes = 60
    } = req.body;

    // Validation
    if (
      !doctor_name ||
      !specialty ||
      !appointment_type ||
      !appointment_date ||
      !appointment_time ||
      !location
    ) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const result = await query(
      `
      INSERT INTO appointments (
        user_id, doctor_name, specialty, appointment_type,
        appointment_date, appointment_time, location, phone_number,
        address, notes, status, reminder_minutes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        userId,
        doctor_name,
        specialty,
        appointment_type,
        appointment_date,
        appointment_time,
        location,
        phone_number,
        address,
        notes,
        status,
        reminder_minutes
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ success: false, message: 'Failed to create appointment' });
  }
};

// Update appointment
export const updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const {
      doctor_name,
      specialty,
      appointment_type,
      appointment_date,
      appointment_time,
      location,
      phone_number,
      address,
      notes,
      status,
      reminder_minutes,
    } = req.body;

    const result = await query(
      `
      UPDATE appointments
      SET doctor_name = COALESCE($1, doctor_name),
          specialty = COALESCE($2, specialty),
          appointment_type = COALESCE($3, appointment_type),
          appointment_date = COALESCE($4, appointment_date),
          appointment_time = COALESCE($5, appointment_time),
          location = COALESCE($6, location),
          phone_number = COALESCE($7, phone_number),
          address = COALESCE($8, address),
          notes = COALESCE($9, notes),
          status = COALESCE($10, status),
          updated_at = CURRENT_TIMESTAMP,
          reminder_minutes= COALESCE($11,  reminder_minutes)
      WHERE id = $12 AND user_id = $13
      RETURNING *
      `,
      [
        doctor_name,
        specialty,
        appointment_type,
        appointment_date,
        appointment_time,
        location,
        phone_number,
        address,
        notes,
        status,
        reminder_minutes,
        id,
        userId,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ success: false, message: 'Failed to update appointment' });
  }
};

// Delete appointment
export const deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      'DELETE FROM appointments WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    res.json({ success: true, message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete appointment' });
  }
};

// Get upcoming appointments
export const getUpcomingAppointments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date().toISOString().split('T')[0];

    const result = await query(
      `
      SELECT * FROM appointments
      WHERE user_id = $1 
        AND appointment_date >= $2
        AND status IN ('scheduled', 'confirmed')
      ORDER BY appointment_date ASC, appointment_time ASC
      LIMIT 10
      `,
      [userId, today]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get upcoming appointments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch upcoming appointments' });
  }
};

// Get past appointments
export const getPastAppointments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date().toISOString().split('T')[0];

    const result = await query(
      `
      SELECT * FROM appointments
      WHERE user_id = $1 
        AND (appointment_date < $2 OR status IN ('completed', 'cancelled'))
      ORDER BY appointment_date DESC, appointment_time DESC
      LIMIT 20
      `,
      [userId, today]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get past appointments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch past appointments' });
  }
};