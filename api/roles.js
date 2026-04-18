// Ryujin OS — Roles & Permissions API
// GET    /api/roles                  — List all roles for tenant
// GET    /api/roles?id=X             — Get single role
// GET    /api/roles?permissions=1    — Get the master permissions list
// POST   /api/roles                  — Create custom role
// PUT    /api/roles                  — Update role (name, permissions)
// DELETE /api/roles?id=X             — Delete role (if not system, not in use)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

// Master permissions list — grouped by category for the admin UI checkbox editor
const PERMISSIONS = {
  dashboard: [
    { key: 'view_dashboard', label: 'View Dashboard', desc: 'See the main overview dashboard' }
  ],
  users: [
    { key: 'manage_users', label: 'Manage Users', desc: 'Add, edit, deactivate users' },
    { key: 'manage_roles', label: 'Manage Roles', desc: 'Create and edit roles & permissions' },
    { key: 'invite_users', label: 'Invite Users', desc: 'Send invite links to new users' }
  ],
  estimates: [
    { key: 'view_estimates', label: 'View Estimates', desc: 'See all estimates' },
    { key: 'create_estimates', label: 'Create Estimates', desc: 'Create new estimates' },
    { key: 'edit_estimates', label: 'Edit Estimates', desc: 'Modify existing estimates' },
    { key: 'delete_estimates', label: 'Delete Estimates', desc: 'Cancel or remove estimates' },
    { key: 'view_pricing', label: 'View Pricing', desc: 'See cost breakdowns and margins' }
  ],
  proposals: [
    { key: 'view_proposals', label: 'View Proposals', desc: 'See all proposals' },
    { key: 'create_proposals', label: 'Create Proposals', desc: 'Generate new proposals' },
    { key: 'edit_proposals', label: 'Edit Proposals', desc: 'Modify proposal content' },
    { key: 'share_proposals', label: 'Share Proposals', desc: 'Send proposals to clients' }
  ],
  projects: [
    { key: 'view_all_projects', label: 'View All Projects', desc: 'See every project' },
    { key: 'view_own_projects', label: 'View Own Projects', desc: 'See only assigned projects' },
    { key: 'create_projects', label: 'Create Projects', desc: 'Start new projects' },
    { key: 'edit_projects', label: 'Edit Projects', desc: 'Modify project details' },
    { key: 'manage_client_portal', label: 'Manage Client Portal', desc: 'Toggle client access, share links' }
  ],
  tickets: [
    { key: 'view_all_tickets', label: 'View All Tickets', desc: 'See every ticket' },
    { key: 'view_own_tickets', label: 'View Own Tickets', desc: 'See only assigned tickets' },
    { key: 'create_tickets', label: 'Create Tickets', desc: 'Create new tickets' },
    { key: 'assign_tickets', label: 'Assign Tickets', desc: 'Assign tickets to users' },
    { key: 'complete_tickets', label: 'Complete Tickets', desc: 'Mark tickets as done' }
  ],
  files: [
    { key: 'upload_files', label: 'Upload Files', desc: 'Upload photos, videos, documents' },
    { key: 'edit_files', label: 'Edit Files', desc: 'Edit captions, annotations, tags' },
    { key: 'delete_files', label: 'Delete Files', desc: 'Remove uploaded files' },
    { key: 'set_client_visible', label: 'Set Client Visible', desc: 'Mark files visible to clients' }
  ],
  inspections: [
    { key: 'create_inspections', label: 'Create Inspections', desc: 'Generate inspection reports' },
    { key: 'edit_inspections', label: 'Edit Inspections', desc: 'Modify inspection content' },
    { key: 'share_inspections', label: 'Share Inspections', desc: 'Share reports with clients' }
  ],
  time: [
    { key: 'clock_in_out', label: 'Clock In/Out', desc: 'Track daily work hours' },
    { key: 'view_own_time', label: 'View Own Time', desc: 'See own time entries' },
    { key: 'view_all_time', label: 'View All Time', desc: 'See all crew time entries' },
    { key: 'approve_time', label: 'Approve Time', desc: 'Approve crew time entries' }
  ],
  sops: [
    { key: 'view_sops', label: 'View SOPs', desc: 'Browse the SOP library' },
    { key: 'create_sops', label: 'Create SOPs', desc: 'Add new SOPs' },
    { key: 'edit_sops', label: 'Edit SOPs', desc: 'Modify existing SOPs' },
    { key: 'delete_sops', label: 'Delete SOPs', desc: 'Remove SOPs' }
  ],
  settings: [
    { key: 'edit_branding', label: 'Edit Branding', desc: 'Change logo, colors, fonts' },
    { key: 'edit_settings', label: 'Edit Settings', desc: 'Change tenant configuration' }
  ],
  ai: [
    { key: 'use_chat', label: 'Use AI Chat', desc: 'Access the AI assistant' },
    { key: 'use_sop_search', label: 'SOP Photo Search', desc: 'Snap a photo to find SOPs' }
  ]
};

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // Return master permissions list
  if (req.method === 'GET' && req.query.permissions === '1') {
    return res.json({ permissions: PERMISSIONS });
  }

  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('roles')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error) return res.status(404).json({ error: 'Role not found' });

      // Count users with this role
      const { count } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role_id', id);

      return res.json({ ...data, user_count: count });
    }

    const { data, error } = await supabaseAdmin
      .from('roles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order');

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ roles: data });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const slug = (body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const { data, error } = await supabaseAdmin
      .from('roles')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        slug,
        description: body.description || '',
        permissions: body.permissions || [],
        sort_order: body.sort_order || 10
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Can't edit system roles' core properties
    const { data: existing } = await supabaseAdmin
      .from('roles').select('is_system').eq('id', id).single();

    if (existing?.is_system && updates.slug) {
      return res.status(403).json({ error: 'Cannot change system role slug' });
    }

    const { data, error } = await supabaseAdmin
      .from('roles')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    // Check if system role
    const { data: role } = await supabaseAdmin
      .from('roles').select('is_system, name').eq('id', id).single();

    if (role?.is_system) return res.status(403).json({ error: `Cannot delete system role "${role.name}"` });

    // Check if users are assigned
    const { count } = await supabaseAdmin
      .from('users').select('id', { count: 'exact', head: true }).eq('role_id', id);

    if (count > 0) return res.status(409).json({ error: `Cannot delete — ${count} user(s) still assigned to this role. Reassign them first.` });

    const { error } = await supabaseAdmin
      .from('roles').delete().eq('id', id).eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
