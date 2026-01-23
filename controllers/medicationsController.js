// controllers/medicationsController.js
import { query } from '../config/database.js';
import { generateMedicationDescription } from '../services/aiService.js';

// Get all medications for a user
// controllers/medicationsController.js

// Get all medications for a user
export const getAllMedications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50, is_active } = req.query;
    const offset = (page - 1) * limit;

    let queryText = `
      SELECT * FROM medications
      WHERE user_id = $1
    `;
    const params = [userId];

    if (is_active !== undefined) {
      queryText += ` AND is_active = $${params.length + 1}`;
      params.push(is_active === 'true');
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${
      params.length + 2
    }`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    // Parse times JSON for each medication
    const medications = result.rows.map((med) => ({
      ...med,
      times: typeof med.times === 'string' ? JSON.parse(med.times) : med.times,
    }));

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM medications WHERE user_id = $1 ${
        is_active !== undefined ? 'AND is_active = $2' : ''
      }`,
      is_active !== undefined ? [userId, is_active === 'true'] : [userId]
    );

    res.json({
      success: true,
      data: medications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get medications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch medications' });
  }
};

// Get single medication
export const getMedicationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      'SELECT * FROM medications WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Medication not found' });
    }

    const medication = {
      ...result.rows[0],
      times: typeof result.rows[0].times === 'string' 
        ? JSON.parse(result.rows[0].times) 
        : result.rows[0].times,
    };

    res.json({ success: true, data: medication });
  } catch (error) {
    console.error('Get medication error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch medication' });
  }
};


// Create medication
export const createMedication = async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      medication_name,
      medication_type,
      dosage,
      frequency_per_day,
      quantity_per_dose,
      medication_category,
      times,
      start_date,
      end_date,
      instructions,
      side_effects,
      notes,
      reminder_enabled = true,
      reminder_minutes = 0
    } = req.body;

    // Validation
    if (
      !medication_name ||
      !medication_type ||
      !dosage ||
      !frequency_per_day ||
      !quantity_per_dose ||
      !medication_category ||
      !times ||
      !start_date
    ) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Validate times array
    if (!Array.isArray(times) || times.length !== parseInt(frequency_per_day)) {
      return res.status(400).json({
        success: false,
        message: 'Times array must match frequency per day',
      });
    }

    // Create medication WITHOUT AI description first
    const result = await query(
      `
      INSERT INTO medications (
        user_id, medication_name, medication_type, dosage,
        frequency_per_day, quantity_per_dose, medication_category,
        times, start_date, end_date, instructions, side_effects,
        notes, ai_description, reminder_enabled, reminder_minutes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
      `,
      [
        userId,
        medication_name,
        medication_type,
        dosage,
        frequency_per_day,
        quantity_per_dose,
        medication_category,
        JSON.stringify(times),
        start_date,
        end_date,
        instructions,
        side_effects,
        notes,
        null, // ai_description will be null initially
        reminder_enabled,
        reminder_minutes
      ]
    );

    const medication = {
      ...result.rows[0],
      times: typeof result.rows[0].times === 'string' 
        ? JSON.parse(result.rows[0].times) 
        : result.rows[0].times,
    };

    // Create medication logs for reminders
    if (reminder_enabled) {
      await createMedicationReminders(
        result.rows[0].id,
        userId,
        times,
        start_date,
        end_date
      );
    }

    // Generate AI description in background (don't await)
    generateMedicationDescriptionInBackground(
      result.rows[0].id,
      medication_name,
      dosage
    );

    res.status(201).json({ success: true, data: medication });
  } catch (error) {
    console.error('Create medication error:', error);
    res.status(500).json({ success: false, message: 'Failed to create medication' });
  }
};

// Background function to generate AI description
async function generateMedicationDescriptionInBackground(
  medicationId,
  medicationName,
  dosage
) {
  try {
    console.log(`Generating AI description for medication ${medicationId}...`);
    const ai_description = await generateMedicationDescription(medicationName, dosage);

    // Update the medication with AI description
    await query(
      `UPDATE medications SET ai_description = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [ai_description, medicationId]
    );

    console.log(`AI description generated for medication ${medicationId}`);
  } catch (error) {
    console.error(
      `Failed to generate AI description for medication ${medicationId}:`,
      error
    );
    // Don't throw error - we don't want to fail the medication creation
  }
}

// Update medication
export const updateMedication = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const {
      medication_name,
      medication_type,
      dosage,
      frequency_per_day,
      quantity_per_dose,
      medication_category,
      times,
      start_date,
      end_date,
      instructions,
      side_effects,
      notes,
      is_active,
      reminder_enabled,
      reminder_minutes
    } = req.body;

    // If medication name or dosage changed, regenerate AI description in background
    let shouldRegenerateAI = false;
    if (medication_name || dosage) {
      const currentMed = await query('SELECT * FROM medications WHERE id = $1', [id]);
      if (currentMed.rows.length > 0) {
        const current = currentMed.rows[0];
        if (
          (medication_name && medication_name !== current.medication_name) ||
          (dosage && dosage !== current.dosage)
        ) {
          shouldRegenerateAI = true;
        }
      }
    }

    const result = await query(
      `
      UPDATE medications
      SET medication_name = COALESCE($1, medication_name),
          medication_type = COALESCE($2, medication_type),
          dosage = COALESCE($3, dosage),
          frequency_per_day = COALESCE($4, frequency_per_day),
          quantity_per_dose = COALESCE($5, quantity_per_dose),
          medication_category = COALESCE($6, medication_category),
          times = COALESCE($7, times),
          start_date = COALESCE($8, start_date),
          end_date = COALESCE($9, end_date),
          instructions = COALESCE($10, instructions),
          side_effects = COALESCE($11, side_effects),
          notes = COALESCE($12, notes),
          is_active = COALESCE($13, is_active),
          reminder_enabled = COALESCE($14, reminder_enabled),
          reminder_minutes = COALESCE($15, reminder_minutes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $16 AND user_id = $17
      RETURNING *
      `,
      [
        medication_name,
        medication_type,
        dosage,
        frequency_per_day,
        quantity_per_dose,
        medication_category,
        times ? JSON.stringify(times) : null,
        start_date,
        end_date,
        instructions,
        side_effects,
        notes,
        is_active,
        reminder_enabled,
        reminder_minutes,
        id,
        userId,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Medication not found' });
    }

    const medication = {
      ...result.rows[0],
      times: typeof result.rows[0].times === 'string' 
        ? JSON.parse(result.rows[0].times) 
        : result.rows[0].times,
    };

    // Regenerate AI description in background if needed
    if (shouldRegenerateAI) {
      const name = medication_name || medication.medication_name;
      const dose = dosage || medication.dosage;
      generateMedicationDescriptionInBackground(id, name, dose);
    }

    // Update reminders if times changed
    if (times && reminder_enabled) {
      await query(
        `DELETE FROM medication_logs 
         WHERE medication_id = $1 AND status = 'pending' AND scheduled_time > NOW()`,
        [id]
      );

      await createMedicationReminders(id, userId, times, start_date, end_date);
    }

    res.json({ success: true, data: medication });
  } catch (error) {
    console.error('Update medication error:', error);
    res.status(500).json({ success: false, message: 'Failed to update medication' });
  }
};

// Add endpoint to manually regenerate AI description
export const regenerateAIDescription = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      'SELECT * FROM medications WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Medication not found' });
    }

    const medication = result.rows[0];

    // Generate AI description
    const ai_description = await generateMedicationDescription(
      medication.medication_name,
      medication.dosage
    );

    // Update medication
    await query(
      `UPDATE medications SET ai_description = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [ai_description, id]
    );

    res.json({ success: true, data: { ai_description } });
  } catch (error) {
    console.error('Regenerate AI description error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to regenerate AI description',
    });
  }
};


// Delete medication
export const deleteMedication = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Delete medication logs first
    await query('DELETE FROM medication_logs WHERE medication_id = $1 AND user_id = $2', [
      id,
      userId,
    ]);

    const result = await query(
      'DELETE FROM medications WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Medication not found' });
    }

    res.json({ success: true, message: 'Medication deleted successfully' });
  } catch (error) {
    console.error('Delete medication error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete medication' });
  }
};

// Get today's medications
export const getTodaysMedications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date().toISOString().split('T')[0];

    const result = await query(
      `
      SELECT m.*, 
             COUNT(CASE WHEN ml.status = 'taken' THEN 1 END) as taken_count,
             COUNT(CASE WHEN ml.status = 'missed' THEN 1 END) as missed_count
      FROM medications m
      LEFT JOIN medication_logs ml ON m.id = ml.medication_id 
        AND DATE(ml.scheduled_time) = $2
      WHERE m.user_id = $1 
        AND m.is_active = true
        AND (m.start_date <= $2)
        AND (m.end_date IS NULL OR m.end_date >= $2)
      GROUP BY m.id
      ORDER BY m.times->0
      `,
      [userId, today]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get today medications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch today medications' });
  }
};

// controllers/medicationsController.js

// Add this new function
export const getTodaysMedicationsWithStatus = async (req, res) => {
  try {
    const userId = req.user.userId;
    const today = new Date().toISOString().split('T')[0];

    const result = await query(
      `
      SELECT 
        m.*,
        COALESCE(
          json_agg(
            json_build_object(
              'scheduled_time', ml.scheduled_time,
              'taken_at', ml.taken_at,
              'status', ml.status
            )
            ORDER BY ml.scheduled_time
          ) FILTER (WHERE ml.id IS NOT NULL),
          '[]'
        ) as today_logs
      FROM medications m
      LEFT JOIN medication_logs ml ON m.id = ml.medication_id 
        AND DATE(ml.scheduled_time) = $2
      WHERE m.user_id = $1 
        AND m.is_active = true
        AND (m.start_date <= $2)
        AND (m.end_date IS NULL OR m.end_date >= $2)
      GROUP BY m.id
      ORDER BY m.times->0
      `,
      [userId, today]
    );

    const medications = result.rows.map((med) => ({
      ...med,
      times: typeof med.times === 'string' ? JSON.parse(med.times) : med.times,
      today_logs: med.today_logs || [],
    }));

    res.json({ success: true, data: medications });
  } catch (error) {
    console.error('Get today medications with status error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch medications' });
  }
};

// Update the markMedicationTaken function
export const markMedicationTaken = async (req, res) => {
  try {
    const { id: medicationId } = req.params;
    const userId = req.user.userId;
    const { scheduled_time, status = 'taken', notes = null } = req.body;

    if (!scheduled_time) {
      return res.status(400).json({
        success: false,
        message: 'scheduled_time is required',
      });
    }

    if (!['taken', 'skipped', 'missed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    // 1️⃣ Fetch medication name (and validate ownership)
    const medResult = await query(
      `SELECT medication_name FROM medications WHERE id = $1 AND user_id = $2`,
      [medicationId, userId]
    );

    if (medResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Medication not found',
      });
    }

    const medicationName = medResult.rows[0].name;

    // 2️⃣ Insert or update ONE log only
    const result = await query(
      `
      INSERT INTO medication_logs (
        medication_id,
        user_id,
        medication_name,
        scheduled_time,
        taken_at,
        status,
        notes
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        CASE WHEN $5 = 'taken' THEN NOW() ELSE NULL END,
        $5,
        $6
      )
      ON CONFLICT (medication_id, user_id, scheduled_time)
      DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        medication_name = EXCLUDED.medication_name,
        taken_at = CASE
          WHEN EXCLUDED.status = 'taken'
               AND medication_logs.taken_at IS NULL
          THEN NOW()
          ELSE medication_logs.taken_at
        END
      RETURNING *;
      `,
      [
        medicationId,
        userId,
        medicationName,
        scheduled_time,
        status,
        notes,
      ]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Mark medication error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update medication status',
    });
  }
};


// Add endpoint to get next dose time
export const getNextDoseTime = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const medication = await query(
      'SELECT * FROM medications WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!medication.rows.length) {
      return res.status(404).json({ success: false, message: 'Medication not found' });
    }

    const med = medication.rows[0];
    const times = typeof med.times === 'string' ? JSON.parse(med.times) : med.times;
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;

    // Find next scheduled time today
    const nextTime = times.find((time) => time > currentTime);

    res.json({
      success: true,
      data: {
        next_time: nextTime || times[0], // If no more today, show first time tomorrow
        is_tomorrow: !nextTime,
      },
    });
  } catch (error) {
    console.error('Get next dose time error:', error);
    res.status(500).json({ success: false, message: 'Failed to get next dose time' });
  }
};

// Helper function to create medication reminders
async function createMedicationReminders(medicationId, userId, times, startDate, endDate) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days default
  const today = new Date();
  
  const reminders = [];
  
  for (let date = new Date(Math.max(start, today)); date <= end; date.setDate(date.getDate() + 1)) {
    for (const time of times) {
      const [hours, minutes] = time.split(':');
      const scheduledTime = new Date(date);
      scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      
      if (scheduledTime > new Date()) {
        reminders.push([medicationId, userId, scheduledTime.toISOString()]);
      }
    }
    
    // Limit to next 30 days to avoid too many entries
    if (reminders.length >= 300) break;
  }
  
  if (reminders.length > 0) {
    const values = reminders.map((_, i) => 
      `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, 'pending')`
    ).join(',');
    
    await query(
      `INSERT INTO medication_logs (medication_id, user_id, scheduled_time, status) 
       VALUES ${values}
       ON CONFLICT DO NOTHING`,
      reminders.flat()
    );
  }
}

// Get all medication logs for user
export const getMedicationLogs = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50, status } = req.query;
    const offset = (page - 1) * limit;

    let statusFilter = '';
    const params = [userId, limit, offset];

    if (status && ['taken', 'skipped', 'missed'].includes(status)) {
      statusFilter = 'AND ml.status = $4';
      params.push(status);
    }

    const result = await query(
      `SELECT 
        ml.id,
        ml.medication_id,
        ml.scheduled_time,
        ml.taken_at,
        ml.status,
        ml.notes,
        ml.created_at,
        m.medication_name,
        m.medication_type,
        m.dosage,
        m.quantity_per_dose
       FROM medication_logs ml
       JOIN medications m ON ml.medication_id = m.id
       WHERE ml.user_id = $1 ${statusFilter}
       ORDER BY ml.scheduled_time DESC
       LIMIT $2 OFFSET $3`,
      params
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM medication_logs 
       WHERE user_id = $1 ${statusFilter}`,
      statusFilter ? [userId, status] : [userId]
    );

    // Parse times for each medication
    const logs = result.rows.map((log) => ({
      ...log,
      scheduled_time: log.scheduled_time,
      taken_at: log.taken_at,
    }));

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('Get medication logs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch medication logs' });
  }
};

// Get logs by date range
export const getLogsByDateRange = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'start_date and end_date are required',
      });
    }

    const result = await query(
      `SELECT 
        ml.id,
        ml.medication_id,
        ml.scheduled_time,
        ml.taken_at,
        ml.status,
        ml.notes,
        ml.created_at,
        m.medication_name,
        m.medication_type,
        m.dosage,
        m.quantity_per_dose
       FROM medication_logs ml
       JOIN medications m ON ml.medication_id = m.id
       WHERE ml.user_id = $1 
       AND DATE(ml.scheduled_time) >= $2 
       AND DATE(ml.scheduled_time) <= $3
       ORDER BY ml.scheduled_time DESC`,
      [userId, start_date, end_date]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get logs by date range error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch logs' });
  }
};

// Get medication logs statistics
export const getLogsStatistics = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get statistics for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stats = await query(
      `SELECT 
        COUNT(*) as total_logs,
        COUNT(CASE WHEN status = 'taken' THEN 1 END) as taken_count,
        COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_count,
        COUNT(CASE WHEN status = 'missed' THEN 1 END) as missed_count,
        COUNT(CASE WHEN DATE(scheduled_time) = CURRENT_DATE THEN 1 END) as today_count,
        COUNT(CASE WHEN DATE(scheduled_time) = CURRENT_DATE AND status = 'taken' THEN 1 END) as today_taken
       FROM medication_logs
       WHERE user_id = $1 AND scheduled_time >= $2`,
      [userId, thirtyDaysAgo.toISOString()]
    );

    // Get adherence rate (percentage of medications taken vs total)
    const adherenceRate = stats.rows[0].total_logs > 0
      ? ((parseInt(stats.rows[0].taken_count) / parseInt(stats.rows[0].total_logs)) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        ...stats.rows[0],
        adherence_rate: adherenceRate,
        period: '30 days',
      },
    });
  } catch (error) {
    console.error('Get logs statistics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
};