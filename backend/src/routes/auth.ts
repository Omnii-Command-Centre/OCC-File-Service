import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    const pool = await getPool();

    // Check if user already exists
    const existing = await pool
      .request()
      .input('email', sql.NVarChar, email)
      .query('SELECT id FROM users WHERE email = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const now = new Date();

    await pool
      .request()
      .input('id', sql.UniqueIdentifier, userId)
      .input('email', sql.NVarChar, email)
      .input('password_hash', sql.NVarChar, hashedPassword)
      .input('name', sql.NVarChar, name)
      .input('created_at', sql.DateTime2, now)
      .input('updated_at', sql.DateTime2, now)
      .query(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES (@id, @email, @password_hash, @name, @created_at, @updated_at)`
      );

    // Log to audit_log
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('user_id', sql.UniqueIdentifier, userId)
      .input('action', sql.NVarChar, 'user_registered')
      .input('entity_type', sql.NVarChar, 'user')
      .input('entity_id', sql.UniqueIdentifier, userId)
      .input('created_at', sql.DateTime2, now)
      .query(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at)
         VALUES (@id, @user_id, @action, @entity_type, @entity_id, @created_at)`
      );

    const token = jwt.sign(
      { userId, email, role: 'user' },
      process.env.JWT_SECRET as string,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '24h') as string & jwt.SignOptions['expiresIn'] }
    );

    return res.status(201).json({
      token,
      user: { id: userId, email, name, role: 'user', created_at: now, updated_at: now },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input('email', sql.NVarChar, email)
      .query('SELECT id, email, password_hash, name, role, created_at, updated_at FROM users WHERE email = @email');

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.recordset[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const now = new Date();

    // Update last_login_at
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, user.id)
      .input('last_login_at', sql.DateTime2, now)
      .query('UPDATE users SET last_login_at = @last_login_at WHERE id = @id');

    // Log to audit_log
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('user_id', sql.UniqueIdentifier, user.id)
      .input('action', sql.NVarChar, 'user_login')
      .input('entity_type', sql.NVarChar, 'user')
      .input('entity_id', sql.UniqueIdentifier, user.id)
      .input('created_at', sql.DateTime2, now)
      .query(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at)
         VALUES (@id, @user_id, @action, @entity_type, @entity_id, @created_at)`
      );

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role || 'user' },
      process.env.JWT_SECRET as string,
      { expiresIn: (process.env.JWT_EXPIRES_IN || '24h') as string & jwt.SignOptions['expiresIn'] }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || 'user',
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: now,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /me
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();

    const result = await pool
      .request()
      .input('id', sql.UniqueIdentifier, (req as any).user.userId)
      .query(
        `SELECT id, email, name, role, created_at, updated_at, last_login_at
         FROM users WHERE id = @id`
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: result.recordset[0] });
  } catch (error: any) {
    console.error('Get current user error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /users — list all users (admin only)
router.get('/users', authenticate, async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const currentUser = await pool
      .request()
      .input('id', sql.UniqueIdentifier, (req as any).user.userId)
      .query('SELECT role FROM users WHERE id = @id');

    if (currentUser.recordset.length === 0 || currentUser.recordset[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.request().query(
      `SELECT id, email, name, role, created_at, updated_at, last_login_at
       FROM users ORDER BY created_at ASC`
    );

    return res.json({ users: result.recordset });
  } catch (error: any) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /users/:userId/role — update a user's role (admin only)
router.put('/users/:userId/role', authenticate, async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    if (!role || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "user"' });
    }

    const pool = await getPool();
    const currentUser = await pool
      .request()
      .input('id', sql.UniqueIdentifier, (req as any).user.userId)
      .query('SELECT role FROM users WHERE id = @id');

    if (currentUser.recordset.length === 0 || currentUser.recordset[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Prevent removing your own admin access
    if (req.params.userId === (req as any).user.userId && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }

    const now = new Date();
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.userId)
      .input('role', sql.NVarChar, role)
      .input('updated_at', sql.DateTime2, now)
      .query('UPDATE users SET role = @role, updated_at = @updated_at WHERE id = @id');

    // Audit log
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('user_id', sql.UniqueIdentifier, (req as any).user.userId)
      .input('action', sql.NVarChar, 'role_changed')
      .input('entity_type', sql.NVarChar, 'user')
      .input('entity_id', sql.UniqueIdentifier, req.params.userId)
      .input('details', sql.NVarChar, JSON.stringify({ new_role: role }))
      .input('created_at', sql.DateTime2, now)
      .query(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, created_at)
         VALUES (@id, @user_id, @action, @entity_type, @entity_id, @details, @created_at)`
      );

    return res.json({ message: `User role updated to ${role}` });
  } catch (error: any) {
    console.error('Update role error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
