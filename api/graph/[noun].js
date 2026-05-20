// Ryujin OS · Graph API · phase 2 scaffold
//
// GET /api/graph/<noun>?id=<id>
//   Returns the noun + its outbound edges.
//
// Supported nouns: customer, job, ticket, proposal, pillar
//
// Phase 2 returns synthetic placeholder data so the v2 pages can
// render against a real network endpoint while we finalize the
// Supabase joins. Phase 4 swaps the data source to live tables
// without changing the response shape.
//
// Auth: tenant-scoped via x-tenant-id header or ?tenant=. No auth
// required during the scaffold phase; tighten in Phase 4.

const DATA = {
  pillars: [
    { slug: 'hq',         label: 'HQ' },
    { slug: 'sales',      label: 'Sales' },
    { slug: 'production', label: 'Production' },
    { slug: 'service',    label: 'Service' },
    { slug: 'customer',   label: 'Customer' },
    { slug: 'finance',    label: 'Finance' },
    { slug: 'materials',  label: 'Materials' },
    { slug: 'marketing',  label: 'Marketing' },
    { slug: 'admin',      label: 'Admin' }
  ],
  customers: [
    { id: 'c-001', name: 'Demo Customer',   address: '123 Sample St, Example NB', phone: '555-0100', ltv: 1000 },
    { id: 'c-002', name: 'Anna Whitepine',  address: '456 Birch Rd, Example NB',  phone: '555-0101', ltv: 4200 },
    { id: 'c-003', name: 'Sample Customer', address: '78 Maple Ln, Example NB',   phone: '555-0102', ltv: 2100 },
    { id: 'c-004', name: 'Demo Henderson',  address: '9 Cedar Way, Example NB',   phone: '555-0103', ltv: 8800 },
    { id: 'c-005', name: 'Sample Forester', address: '320 Pine Ave, Example NB',  phone: '555-0104', ltv: 600  }
  ],
  jobs: [
    { id: 'j-001', customerId: 'c-001', address: '123 Sample St', stage: 'draft',   value: 1000 },
    { id: 'j-002', customerId: 'c-002', address: '456 Birch Rd',  stage: 'active',  value: 4200 },
    { id: 'j-003', customerId: 'c-003', address: '78 Maple Ln',   stage: 'active',  value: 2100 },
    { id: 'j-004', customerId: 'c-004', address: '9 Cedar Way',   stage: 'closing', value: 8800 }
  ],
  tickets: [
    { id: 't-001', customerId: 'c-002', title: 'Pickup materials from Coastal' },
    { id: 't-002', customerId: 'c-003', title: 'Cornhill Day 2 closeout' },
    { id: 't-003', customerId: 'c-004', title: 'Inspect 9 Cedar attic' },
    { id: 't-004', customerId: 'c-001', title: 'Send proposal follow-up' }
  ],
  proposals: [
    { id: 'p-001', customerId: 'c-001', quoteId: 'DEMO-0001', status: 'signed', value: 1150 },
    { id: 'p-002', customerId: 'c-002', quoteId: 'DEMO-0042', status: 'draft',  value: 4830 },
    { id: 'p-003', customerId: 'c-005', quoteId: 'DEMO-0051', status: 'sent',   value: 720  }
  ]
};

function buildCustomerEdges(customer) {
  const jobs      = DATA.jobs.filter(j => j.customerId === customer.id);
  const tickets   = DATA.tickets.filter(t => t.customerId === customer.id);
  const proposals = DATA.proposals.filter(p => p.customerId === customer.id);
  return [
    { type: 'jobs',      count: jobs.length,      items: jobs },
    { type: 'proposals', count: proposals.length, items: proposals },
    { type: 'tickets',   count: tickets.length,   items: tickets }
  ];
}

function buildJobEdges(job) {
  const customer = DATA.customers.find(c => c.id === job.customerId) || null;
  const tickets  = DATA.tickets.filter(t => t.customerId === job.customerId);
  return [
    { type: 'customer', count: customer ? 1 : 0, items: customer ? [customer] : [] },
    { type: 'tickets',  count: tickets.length,   items: tickets }
  ];
}

function buildTicketEdges(ticket) {
  const customer = DATA.customers.find(c => c.id === ticket.customerId) || null;
  const job      = DATA.jobs.find(j => j.customerId === ticket.customerId) || null;
  return [
    { type: 'customer', count: customer ? 1 : 0, items: customer ? [customer] : [] },
    { type: 'job',      count: job ? 1 : 0,      items: job ? [job] : [] }
  ];
}

function buildProposalEdges(proposal) {
  const customer = DATA.customers.find(c => c.id === proposal.customerId) || null;
  return [
    { type: 'customer', count: customer ? 1 : 0, items: customer ? [customer] : [] }
  ];
}

function buildPillarEdges(pillar) {
  if (pillar.slug === 'sales') {
    return [
      { type: 'proposals', count: DATA.proposals.length, items: DATA.proposals },
      { type: 'customers', count: DATA.customers.length, items: DATA.customers }
    ];
  }
  if (pillar.slug === 'production') {
    return [
      { type: 'jobs',    count: DATA.jobs.length,    items: DATA.jobs },
      { type: 'tickets', count: DATA.tickets.length, items: DATA.tickets }
    ];
  }
  if (pillar.slug === 'customer') {
    return [ { type: 'customers', count: DATA.customers.length, items: DATA.customers } ];
  }
  return [];
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const noun = String(req.query?.noun || '').toLowerCase();
  const id   = String(req.query?.id || '').trim();

  if (!noun) return res.status(400).json({ error: 'noun_required' });

  let nounRecord = null;
  let edges = [];

  if (noun === 'customer') {
    nounRecord = id ? DATA.customers.find(c => c.id === id) : DATA.customers[0];
    if (!nounRecord) return res.status(404).json({ error: 'customer_not_found', id });
    edges = buildCustomerEdges(nounRecord);
  } else if (noun === 'job') {
    nounRecord = id ? DATA.jobs.find(j => j.id === id) : DATA.jobs[0];
    if (!nounRecord) return res.status(404).json({ error: 'job_not_found', id });
    edges = buildJobEdges(nounRecord);
  } else if (noun === 'ticket') {
    nounRecord = id ? DATA.tickets.find(t => t.id === id) : DATA.tickets[0];
    if (!nounRecord) return res.status(404).json({ error: 'ticket_not_found', id });
    edges = buildTicketEdges(nounRecord);
  } else if (noun === 'proposal') {
    nounRecord = id ? DATA.proposals.find(p => p.id === id) : DATA.proposals[0];
    if (!nounRecord) return res.status(404).json({ error: 'proposal_not_found', id });
    edges = buildProposalEdges(nounRecord);
  } else if (noun === 'pillar') {
    nounRecord = id ? DATA.pillars.find(p => p.slug === id) : DATA.pillars[0];
    if (!nounRecord) return res.status(404).json({ error: 'pillar_not_found', id });
    edges = buildPillarEdges(nounRecord);
  } else {
    return res.status(400).json({ error: 'unsupported_noun', noun });
  }

  return res.status(200).json({
    noun: { type: noun, ...nounRecord },
    edges,
    source: 'scaffold',
    note: 'Phase 2 placeholder data. Swap to Supabase in Phase 4.'
  });
}
