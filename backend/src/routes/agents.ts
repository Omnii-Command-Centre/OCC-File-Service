import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET / — list agents the current user can see
router.get('/', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    // Check if current user is an admin
    const roleResult = await pool
      .request()
      .input('user_id', sql.UniqueIdentifier, userId)
      .query('SELECT role FROM users WHERE id = @user_id');

    const isAdmin = roleResult.recordset[0]?.role === 'admin';

    const result = await pool
      .request()
      .input('user_id', sql.UniqueIdentifier, userId)
      .query(
        isAdmin
          ? `SELECT DISTINCT a.id, a.name, a.description, a.system_prompt, a.model, a.config,
                    a.owner_id, a.team_id, a.visibility, a.created_at, a.updated_at,
                    t.name AS team_name,
                    u.name AS owner_name
             FROM agents a
             LEFT JOIN teams t ON t.id = a.team_id
             LEFT JOIN users u ON u.id = a.owner_id
             WHERE a.deleted_at IS NULL
             ORDER BY a.created_at DESC`
          : `SELECT DISTINCT a.id, a.name, a.description, a.system_prompt, a.model, a.config,
                    a.owner_id, a.team_id, a.visibility, a.created_at, a.updated_at,
                    t.name AS team_name,
                    u.name AS owner_name
             FROM agents a
             LEFT JOIN teams t ON t.id = a.team_id
             LEFT JOIN users u ON u.id = a.owner_id
             WHERE a.deleted_at IS NULL
               AND (a.owner_id = @user_id
                OR (a.visibility = 'team'
                    AND a.team_id IN (SELECT team_id FROM team_members WHERE user_id = @user_id))
                OR (a.visibility = 'selected'
                    AND a.id IN (SELECT agent_id FROM agent_access WHERE user_id = @user_id)))
             ORDER BY a.created_at DESC`
      );

    return res.json({ agents: result.recordset });
  } catch (error: any) {
    console.error('List agents error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /deleted — recycle bin: agents this user deleted in the last 30 days
// (must be declared before /:id so "deleted" is not parsed as an agent id)
router.get('/deleted', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    const result = await pool
      .request()
      .input('user_id', sql.UniqueIdentifier, userId)
      .query(
        `SELECT id, name, description, model, deleted_at
         FROM agents
         WHERE owner_id = @user_id AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC`
      );

    return res.json({ agents: result.recordset });
  } catch (error: any) {
    console.error('List deleted agents error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — get single agent (verify access)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    const roleResult = await pool
      .request()
      .input('user_id', sql.UniqueIdentifier, userId)
      .query('SELECT role FROM users WHERE id = @user_id');

    const isAdmin = roleResult.recordset[0]?.role === 'admin';

    const result = await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('user_id', sql.UniqueIdentifier, userId)
      .query(
        isAdmin
          ? `SELECT a.id, a.name, a.description, a.system_prompt, a.model, a.config,
                    a.owner_id, a.team_id, a.visibility, a.created_at, a.updated_at,
                    t.name AS team_name
             FROM agents a
             LEFT JOIN teams t ON t.id = a.team_id
             WHERE a.id = @id AND a.deleted_at IS NULL`
          : `SELECT a.id, a.name, a.description, a.system_prompt, a.model, a.config,
                    a.owner_id, a.team_id, a.visibility, a.created_at, a.updated_at,
                    t.name AS team_name
             FROM agents a
             LEFT JOIN teams t ON t.id = a.team_id
             WHERE a.id = @id
               AND a.deleted_at IS NULL
               AND (a.owner_id = @user_id
                    OR (a.visibility = 'team'
                        AND a.team_id IN (SELECT team_id FROM team_members WHERE user_id = @user_id))
                    OR (a.visibility = 'selected'
                        AND a.id IN (SELECT agent_id FROM agent_access WHERE user_id = @user_id)))`
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json({ agent: result.recordset[0] });
  } catch (error: any) {
    console.error('Get agent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create agent
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, system_prompt, model, team_id, visibility } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Agent name is required' });
    }

    const pool = await getPool();
    const userId = (req as any).user.userId;
    const agentId = uuidv4();
    const now = new Date();

    // If team_id provided, verify user is a member
    if (team_id) {
      const membership = await pool
        .request()
        .input('team_id', sql.UniqueIdentifier, team_id)
        .input('user_id', sql.UniqueIdentifier, userId)
        .query('SELECT role FROM team_members WHERE team_id = @team_id AND user_id = @user_id');

      if (membership.recordset.length === 0) {
        return res.status(403).json({ error: 'You are not a member of this team' });
      }
    }

    const agentVisibility = visibility || (team_id ? 'team' : 'private');

    await pool
      .request()
      .input('id', sql.UniqueIdentifier, agentId)
      .input('name', sql.NVarChar, name)
      .input('description', sql.NVarChar(sql.MAX), description || null)
      .input('system_prompt', sql.NVarChar(sql.MAX), system_prompt || null)
      .input('model', sql.NVarChar, model || 'claude-sonnet-4-20250514')
      .input('owner_id', sql.UniqueIdentifier, userId)
      .input('team_id', sql.UniqueIdentifier, team_id || null)
      .input('visibility', sql.NVarChar, agentVisibility)
      .input('created_at', sql.DateTime2, now)
      .input('updated_at', sql.DateTime2, now)
      .query(
        `INSERT INTO agents (id, name, description, system_prompt, model, owner_id, team_id, visibility, created_at, updated_at)
         VALUES (@id, @name, @description, @system_prompt, @model, @owner_id, @team_id, @visibility, @created_at, @updated_at)`
      );

    // Log to audit_log
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('user_id', sql.UniqueIdentifier, userId)
      .input('action', sql.NVarChar, 'agent_created')
      .input('entity_type', sql.NVarChar, 'agent')
      .input('entity_id', sql.UniqueIdentifier, agentId)
      .input('created_at', sql.DateTime2, now)
      .query(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at)
         VALUES (@id, @user_id, @action, @entity_type, @entity_id, @created_at)`
      );

    return res.status(201).json({
      agent: {
        id: agentId,
        name,
        description: description || null,
        system_prompt: system_prompt || null,
        model: model || 'claude-sonnet-4-20250514',
        owner_id: userId,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (error: any) {
    console.error('Create agent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /:id — update agent (verify ownership or admin)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    const roleResult = await pool
      .request()
      .input('user_id', sql.UniqueIdentifier, userId)
      .query('SELECT role FROM users WHERE id = @user_id');

    const isAdmin = roleResult.recordset[0]?.role === 'admin';

    const existing = await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('owner_id', sql.UniqueIdentifier, userId)
      .query(
        isAdmin
          ? 'SELECT id FROM agents WHERE id = @id AND deleted_at IS NULL'
          : 'SELECT id FROM agents WHERE id = @id AND owner_id = @owner_id AND deleted_at IS NULL'
      );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const { name, description, system_prompt, model, config, visibility, team_id, access_user_ids } = req.body;
    const now = new Date();

    // Build dynamic SET clause for partial updates
    const setClauses: string[] = ['updated_at = @updated_at'];
    const request = pool.request();
    request.input('id', sql.UniqueIdentifier, req.params.id);
    request.input('owner_id', sql.UniqueIdentifier, userId);
    request.input('updated_at', sql.DateTime2, now);

    if (name !== undefined) {
      setClauses.push('name = @name');
      request.input('name', sql.NVarChar, name);
    }
    if (description !== undefined) {
      setClauses.push('description = @description');
      request.input('description', sql.NVarChar(sql.MAX), description);
    }
    if (system_prompt !== undefined) {
      setClauses.push('system_prompt = @system_prompt');
      request.input('system_prompt', sql.NVarChar(sql.MAX), system_prompt);
    }
    if (model !== undefined) {
      setClauses.push('model = @model');
      request.input('model', sql.NVarChar, model);
    }
    if (config !== undefined) {
      setClauses.push('config = @config');
      request.input('config', sql.NVarChar(sql.MAX), typeof config === 'string' ? config : JSON.stringify(config));
    }
    if (visibility !== undefined) {
      setClauses.push('visibility = @visibility');
      request.input('visibility', sql.NVarChar, visibility);
    }
    if (team_id !== undefined) {
      setClauses.push('team_id = @team_id');
      request.input('team_id', sql.UniqueIdentifier, team_id || null);
    }

    await request.query(
      isAdmin
        ? `UPDATE agents SET ${setClauses.join(', ')} WHERE id = @id`
        : `UPDATE agents SET ${setClauses.join(', ')} WHERE id = @id AND owner_id = @owner_id`
    );

    // Update agent_access if access_user_ids provided
    if (access_user_ids !== undefined && Array.isArray(access_user_ids)) {
      await pool
        .request()
        .input('agent_id', sql.UniqueIdentifier, req.params.id)
        .query('DELETE FROM agent_access WHERE agent_id = @agent_id');

      for (const uid of access_user_ids) {
        await pool
          .request()
          .input('id', sql.UniqueIdentifier, uuidv4())
          .input('agent_id', sql.UniqueIdentifier, req.params.id)
          .input('user_id', sql.UniqueIdentifier, uid)
          .input('created_at', sql.DateTime2, now)
          .query(
            `INSERT INTO agent_access (id, agent_id, user_id, created_at)
             VALUES (@id, @agent_id, @user_id, @created_at)`
          );
      }
    }

    // Fetch updated agent
    const updated = await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('owner_id', sql.UniqueIdentifier, userId)
      .query(
        isAdmin
          ? `SELECT id, name, description, system_prompt, model, config, owner_id, team_id, visibility, created_at, updated_at
             FROM agents WHERE id = @id`
          : `SELECT id, name, description, system_prompt, model, config, owner_id, team_id, visibility, created_at, updated_at
             FROM agents WHERE id = @id AND owner_id = @owner_id`
      );

    return res.json({ agent: updated.recordset[0] });
  } catch (error: any) {
    console.error('Update agent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/access — list users who have access to this agent
router.get('/:id/access', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    const roleResult = await pool
      .request()
      .input('user_id', sql.UniqueIdentifier, userId)
      .query('SELECT role FROM users WHERE id = @user_id');

    const isAdmin = roleResult.recordset[0]?.role === 'admin';

    const existing = await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('owner_id', sql.UniqueIdentifier, userId)
      .query(
        isAdmin
          ? 'SELECT id FROM agents WHERE id = @id'
          : 'SELECT id FROM agents WHERE id = @id AND owner_id = @owner_id'
      );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const result = await pool
      .request()
      .input('agent_id', sql.UniqueIdentifier, req.params.id)
      .query(
        `SELECT aa.user_id, u.name, u.email
         FROM agent_access aa
         INNER JOIN users u ON u.id = aa.user_id
         WHERE aa.agent_id = @agent_id
         ORDER BY u.name`
      );

    return res.json({ access: result.recordset });
  } catch (error: any) {
    console.error('Get agent access error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — move agent to the recycle bin (restorable for 30 days)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    // Verify ownership
    const existing = await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('owner_id', sql.UniqueIdentifier, userId)
      .query('SELECT id FROM agents WHERE id = @id AND owner_id = @owner_id AND deleted_at IS NULL');

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Soft delete: the agent (and its conversations/messages) stay in the
    // database for 30 days and can be restored via POST /:id/restore
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('owner_id', sql.UniqueIdentifier, userId)
      .query('UPDATE agents SET deleted_at = GETUTCDATE() WHERE id = @id AND owner_id = @owner_id');

    // Log to audit_log
    const now = new Date();
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('user_id', sql.UniqueIdentifier, userId)
      .input('action', sql.NVarChar, 'agent_deleted')
      .input('entity_type', sql.NVarChar, 'agent')
      .input('entity_id', sql.UniqueIdentifier, req.params.id)
      .input('created_at', sql.DateTime2, now)
      .query(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at)
         VALUES (@id, @user_id, @action, @entity_type, @entity_id, @created_at)`
      );

    return res.json({ message: 'Agent moved to the recycle bin (restorable for 30 days)' });
  } catch (error: any) {
    console.error('Delete agent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/restore — bring an agent back from the recycle bin
router.post('/:id/restore', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const userId = (req as any).user.userId;

    const result = await pool
      .request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .input('owner_id', sql.UniqueIdentifier, userId)
      .query(
        'UPDATE agents SET deleted_at = NULL, updated_at = GETUTCDATE() WHERE id = @id AND owner_id = @owner_id AND deleted_at IS NOT NULL'
      );

    if ((result.rowsAffected?.[0] || 0) === 0) {
      return res.status(404).json({ error: 'Agent not found in the recycle bin' });
    }

    await pool
      .request()
      .input('id', sql.UniqueIdentifier, uuidv4())
      .input('user_id', sql.UniqueIdentifier, userId)
      .input('action', sql.NVarChar, 'agent_restored')
      .input('entity_type', sql.NVarChar, 'agent')
      .input('entity_id', sql.UniqueIdentifier, req.params.id)
      .input('created_at', sql.DateTime2, new Date())
      .query(
        `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, created_at)
         VALUES (@id, @user_id, @action, @entity_type, @entity_id, @created_at)`
      );

    return res.json({ message: 'Agent restored' });
  } catch (error: any) {
    console.error('Restore agent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
