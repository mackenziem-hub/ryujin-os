/*
 * Ryujin OS · v2 placeholder dataset
 *
 * Synthetic data for the v2 pages until the graph API is wired to
 * Supabase in Phase 4. Every name, address, phone, and dollar figure
 * is fictitious. Mirrors the shapes the real graph API will return.
 */

export const RJ_DATA = Object.freeze({
  tenant: {
    name: 'Sample Tenant',
    accent: '#a85a2c',
    today: new Date().toISOString().slice(0, 10)
  },

  pillars: [
    { slug: 'hq',         label: 'HQ',         tone: 'charcoal', icon: 'star',  blurb: 'Today across the business.' },
    { slug: 'sales',      label: 'Sales',      tone: 'copper',   icon: 'flame', blurb: 'Pipeline and conversion.' },
    { slug: 'production', label: 'Production', tone: 'moss',     icon: 'hammer', blurb: 'Active jobs and crews.' },
    { slug: 'service',    label: 'Service',    tone: 'amber',    icon: 'wrench', blurb: 'Tickets and repairs.' },
    { slug: 'customer',   label: 'Customer',   tone: 'slate',    icon: 'heart',  blurb: 'Relationships and reviews.' },
    { slug: 'finance',    label: 'Finance',    tone: 'finance',  icon: 'coin',   blurb: 'AR, AP, P&L.' },
    { slug: 'materials',  label: 'Materials',  tone: 'materials', icon: 'box',   blurb: 'Inventory and orders.' },
    { slug: 'marketing',  label: 'Marketing',  tone: 'ochre',    icon: 'broadcast', blurb: 'Clips and campaigns.' },
    { slug: 'admin',      label: 'Admin',      tone: 'admin',    icon: 'gear',   blurb: 'Team, settings, integrations.' }
  ],

  customers: [
    { id: 'c-001', name: 'Demo Customer',  address: '123 Sample St, Example NB',    phone: '555-0100', since: '2026-01-04', ltv: 1000, status: 'active' },
    { id: 'c-002', name: 'Anna Whitepine', address: '456 Birch Rd, Example NB',     phone: '555-0101', since: '2025-11-14', ltv: 4200, status: 'active' },
    { id: 'c-003', name: 'Sample Customer', address: '78 Maple Ln, Example NB',     phone: '555-0102', since: '2026-02-21', ltv: 2100, status: 'active' },
    { id: 'c-004', name: 'Demo Henderson', address: '9 Cedar Way, Example NB',      phone: '555-0103', since: '2025-08-09', ltv: 8800, status: 'active' },
    { id: 'c-005', name: 'Sample Forester', address: '320 Pine Ave, Example NB',    phone: '555-0104', since: '2026-04-30', ltv: 600,  status: 'lead' }
  ],

  jobs: [
    { id: 'j-001', customerId: 'c-001', address: '123 Sample St',  stage: 'draft',     value: 1000,  startDate: '2026-05-22', crew: ['AJ', 'Diego'] },
    { id: 'j-002', customerId: 'c-002', address: '456 Birch Rd',   stage: 'active',    value: 4200,  startDate: '2026-05-19', crew: ['AJ', 'Ryan'] },
    { id: 'j-003', customerId: 'c-003', address: '78 Maple Ln',    stage: 'active',    value: 2100,  startDate: '2026-05-18', crew: ['Diego', 'Ryan'] },
    { id: 'j-004', customerId: 'c-004', address: '9 Cedar Way',    stage: 'closing',   value: 8800,  startDate: '2026-05-10', crew: ['AJ', 'Diego', 'Ryan'] }
  ],

  tickets: [
    { id: 't-001', customerId: 'c-002', title: 'Pickup materials from Coastal', priority: 'high', dueDate: '2026-05-20', assignedTo: 'AJ' },
    { id: 't-002', customerId: 'c-003', title: 'Cornhill Day 2 closeout',        priority: 'med',  dueDate: '2026-05-20', assignedTo: 'Diego' },
    { id: 't-003', customerId: 'c-004', title: 'Inspect 9 Cedar attic',          priority: 'med',  dueDate: '2026-05-21', assignedTo: 'AJ' },
    { id: 't-004', customerId: 'c-001', title: 'Send proposal follow-up',        priority: 'low',  dueDate: '2026-05-22', assignedTo: 'Mac' }
  ],

  proposals: [
    { id: 'p-001', customerId: 'c-001', quoteId: 'DEMO-0001', status: 'signed',  value: 1150,  date: '2026-01-15' },
    { id: 'p-002', customerId: 'c-002', quoteId: 'DEMO-0042', status: 'draft',   value: 4830,  date: '2026-05-12' },
    { id: 'p-003', customerId: 'c-005', quoteId: 'DEMO-0051', status: 'sent',    value: 720,   date: '2026-05-18' }
  ],

  events: [
    { time: '23:13', pillar: 'sales',      title: 'Demo Smoke Test accepted',  sub: 'DEMO-0001 flipped to signed',     value: 1150 },
    { time: '21:53', pillar: 'marketing',  title: 'EA replied: re morning brief', sub: 'Comms thread updated' },
    { time: '16:30', pillar: 'sales',      title: 'Sample lead converted',     sub: 'Deposit invoice queued',          value: 5200 },
    { time: '14:12', pillar: 'marketing',  title: 'New lead from intake form', sub: 'Routed to follow-up sequence' },
    { time: '10:00', pillar: 'production', title: 'Cornhill closeout due',     sub: 'Final paysheet pending' },
    { time: '09:14', pillar: 'sales',      title: 'DEMO-0001 signed',          sub: 'Deposit invoice queued',          value: 1150 },
    { time: '08:30', pillar: 'service',    title: 'Ticket opened for Anna W.', sub: 'Step flashing follow-up' }
  ],

  stats: {
    hq:         [ { label: 'Today',        value: '12 events' }, { label: 'Pipeline', value: '$50K' },   { label: 'Active jobs', value: '4' }, { label: 'Crew', value: '3' } ],
    sales:      [ { label: 'Pipeline',     value: '$50K' },      { label: 'Signed MTD', value: '$10,000' }, { label: 'Leads', value: '12' }, { label: 'Estimates', value: '8' } ],
    production: [ { label: 'Active jobs',  value: '4' },         { label: 'Crews out', value: '3' },     { label: 'Sched today', value: '2' }, { label: 'On track', value: '95%' } ],
    service:    [ { label: 'Open tickets', value: '4' },         { label: 'Due today', value: '2' },     { label: 'SLA', value: '92%' },     { label: 'Crew busy', value: '2' } ],
    customer:   [ { label: 'Active',       value: '5' },         { label: 'New MTD',   value: '2' },     { label: 'Reviews', value: '12' },   { label: 'NPS', value: '8.4' } ],
    finance:    [ { label: 'Cash in',      value: '$8.6K' },     { label: 'AR aged',   value: '$2.1K' }, { label: 'AP due',  value: '$1.3K' }, { label: 'MoM',  value: '+14%' } ],
    materials:  [ { label: 'On order',     value: '4 POs' },     { label: 'In stock',  value: '12 SKU' }, { label: 'Spend MTD', value: '$3.4K' }, { label: 'Low stock', value: '2' } ],
    marketing:  [ { label: 'Clips ready',  value: '6' },         { label: 'Scheduled', value: '4' },     { label: 'Posted MTD', value: '12' },   { label: 'Reach', value: '4.2K' } ],
    admin:      [ { label: 'Team',         value: '4' },         { label: 'Integrations', value: '7' }, { label: 'Audits',  value: '0 open' }, { label: 'Settings', value: 'OK' } ]
  }
});

export function customerById(id) { return RJ_DATA.customers.find(c => c.id === id) || null; }
export function jobById(id)      { return RJ_DATA.jobs.find(j => j.id === id) || null; }
export function ticketById(id)   { return RJ_DATA.tickets.find(t => t.id === id) || null; }
export function proposalById(id) { return RJ_DATA.proposals.find(p => p.id === id) || null; }

export function jobsForCustomer(cid)      { return RJ_DATA.jobs.filter(j => j.customerId === cid); }
export function ticketsForCustomer(cid)   { return RJ_DATA.tickets.filter(t => t.customerId === cid); }
export function proposalsForCustomer(cid) { return RJ_DATA.proposals.filter(p => p.customerId === cid); }

export function pillarBySlug(slug) { return RJ_DATA.pillars.find(p => p.slug === slug) || null; }
export function eventsForPillar(slug) {
  return slug === 'hq' ? RJ_DATA.events : RJ_DATA.events.filter(e => e.pillar === slug);
}

export function fmtMoney(n) {
  if (n == null) return '$0';
  return '$' + Number(n).toLocaleString('en-CA');
}
