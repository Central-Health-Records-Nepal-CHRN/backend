// controllers/userController.js
import { query } from '../config/database.js';
import bcrypt from 'bcryptjs';

// Get user profile
export const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT id, email, name, phone, date_of_birth, gender, 
              blood_type, height, weight, avatar_url, 
              "createdAt", "updatedAt" 
       FROM "user" WHERE id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

// Update user profile
export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      name,
      phone,
      date_of_birth,
      gender,
      blood_type,
      height,
      weight,
      avatar_url,
    } = req.body;

    const result = await query(
      `UPDATE "user" 
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           date_of_birth = COALESCE($3, date_of_birth),
           gender = COALESCE($4, gender),
           blood_type = COALESCE($5, blood_type),
           height = COALESCE($6, height),
           weight = COALESCE($7, weight),
           avatar_url = COALESCE($8, avatar_url),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING id, email, name, phone, date_of_birth, gender, 
                 blood_type, height, weight, avatar_url, 
                 "createdAt", "updatedAt"`,
      [name, phone, date_of_birth, gender, blood_type, height, weight, avatar_url, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};

// Update email
export const updateEmail = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    // Verify current password
    const userResult = await query('SELECT password FROM "user" WHERE id = $1', [userId]);
    
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(password, userResult.rows[0].password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
      });
    }

    // Check if email already exists
    const emailCheck = await query('SELECT id FROM "user" WHERE email = $1 AND id != $2', [
      email,
      userId,
    ]);

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already in use',
      });
    }

    // Update email
    const result = await query(
      `UPDATE "user" SET email = $1, "updatedAt" = CURRENT_TIMESTAMP 
       WHERE id = $2 RETURNING id, email, name`,
      [email, userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update email error:', error);
    res.status(500).json({ success: false, message: 'Failed to update email' });
  }
};

// Update password
export const updatePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long',
      });
    }

    // Verify current password
    const userResult = await query('SELECT password FROM "user" WHERE id = $1', [userId]);
    
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(
      currentPassword,
      userResult.rows[0].password
    );
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await query(
      `UPDATE "user" SET password = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $2`,
      [hashedPassword, userId]
    );

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ success: false, message: 'Failed to update password' });
  }
};

// Get user settings/preferences
export const getUserSettings = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT settings FROM user_settings WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows.length) {
      // Return default settings if none exist
      const defaultSettings = {
        notifications: {
          medication_reminders: true,
          appointment_reminders: true,
          health_tips: true,
          email_notifications: false,
        },
        privacy: {
          share_data_for_research: false,
          allow_analytics: true,
        },
        display: {
          theme: 'light',
          language: 'en',
        },
        health: {
          weight_unit: 'kg',
          height_unit: 'cm',
          temperature_unit: 'celsius',
        },
      };

      return res.json({ success: true, data: defaultSettings });
    }

    res.json({ success: true, data: result.rows[0].settings });
  } catch (error) {
    console.error('Get user settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
};

// Update user settings
export const updateUserSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { settings } = req.body;

    if (!settings) {
      return res.status(400).json({
        success: false,
        message: 'Settings are required',
      });
    }

    // Upsert settings
    const result = await query(
      `INSERT INTO user_settings (user_id, settings)
       VALUES ($1, $2)
       ON CONFLICT (user_id) 
       DO UPDATE SET settings = $2, updated_at = CURRENT_TIMESTAMP
       RETURNING settings`,
      [userId, JSON.stringify(settings)]
    );

    res.json({ success: true, data: result.rows[0].settings });
  } catch (error) {
    console.error('Update user settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
};

// Delete account
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required',
      });
    }

    // Verify password
    const userResult = await query('SELECT password FROM "user" WHERE id = $1', [userId]);
    
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(password, userResult.rows[0].password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password',
      });
    }

    // Delete user (cascading deletes will handle related data)
    await query('DELETE FROM "user" WHERE id = $1', [userId]);

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
};