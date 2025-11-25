const db = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  // Create a new user
  static async create({ username, email, password }) {
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const query = `
      INSERT INTO users (username, email, password)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at
    `;
    
    const result = await db.query(query, [username, email, hashedPassword]);
    return result.rows[0];
  }

  // Find user by email
  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await db.query(query, [email]);
    return result.rows[0];
  }

  // Find user by username
  static async findByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = $1';
    const result = await db.query(query, [username]);
    return result.rows[0];
  }

  // Find user by ID
  static async findById(id) {
    const query = 'SELECT id, username, email, created_at FROM users WHERE id = $1';
    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  // Compare password
  static async comparePassword(candidatePassword, hashedPassword) {
    return await bcrypt.compare(candidatePassword, hashedPassword);
  }

  // Check if user exists
  static async exists(email, username) {
    const query = 'SELECT id FROM users WHERE email = $1 OR username = $2';
    const result = await db.query(query, [email, username]);
    return result.rows.length > 0;
  }
}

module.exports = User;