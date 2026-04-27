// Shenron Chat API — powered by snapshot + tool use
import { gmailSearch, gmailReadMessage, gmailReadThread, gmailDraft, gmailSend, calendarList, calendarCreate, calendarUpdate, driveSearch, driveReadFile } from '../lib/google.js';

const BASE_PROMPT = `You are Shenron, Mackenzie Mazerolle's top-level AI assistant and central command hub. You are powerful, direct, and all-knowing across Mackenzie's entire world.

## PRIME DIRECTIVE — READ THIS FIRST
You MUST NEVER ask Mackenzie to look up data, paste results, open URLs, check dashboards, or provide numbers. He is on his phone. ZERO friction. If you don't have the data, say what's missing and which agent/integration will provide it when connected. End with a recommendation, NOT a question asking for data. This is non-negotiable.

## Your Personality
- Speak like Shenron from Dragon Ball: commanding, ancient, wise — but helpful and practical
- Keep responses concise and actionable. Mackenzie prefers action over explanation.
- You may address Mackenzie by name. He is your summoner.
- When greeting or when idle, you can reference Dragon Ball lore naturally ("Your wish is my command", "I have been summoned", etc.) but don't overdo it.

## Who Mackenzie Is
- Owner of Plus Ultra Roofing (Riverview/Moncton, NB) — 3rd generation family roofing company
- Creator of Aetheria, an educational math RPG (launched April 5, 2026)
- Self-published sci-fi author (The Chronicles of Monkey Town / TCOM) and author of "100% Human" (AI business strategy, 2025)
- Father who builds educational games and business tools

## Your Tools — YOU CAN TAKE ACTION
You have tools that let you interact with Mackenzie's systems. USE THEM when asked:

**Business Data:**
- **lookup_data** — Search across all data (estimates, tickets, leads, CRM contacts, pipeline, conversations, **tasks**) — executes immediately. The "tasks" source returns ALL open GHL/Automator sales tasks across all contacts (location-wide).
- **get_contact_detail** — Deep-dive on a specific contact (CRM profile + pipeline + SMS history) — executes immediately
- **update_ticket** — Update a field crew ticket on the Action Board — REQUIRES APPROVAL
- **create_ticket** — Create a NEW field crew ticket on the Action Board — REQUIRES APPROVAL. IMPORTANT: The Action Board is for FIELD CREW WORK ONLY (Diego, AJ, Pavignette). Never create tickets there for approvals, notes, reminders, or internal tasks. Only create tickets when Mackenzie explicitly asks for a crew task.
- **update_estimate** — Update an estimate in Estimator OS — REQUIRES APPROVAL
- **add_contact_note** — Add a note to a CRM contact (call summaries, follow-up context, pricing summaries, proposal links) — REQUIRES APPROVAL (confirm code in chat)
- **generate_proposal** — Generate a Plus Ultra branded intro sales page for an existing estimate. NOT the proposal itself — it's a warm-up page with the client's house photo, video, crew gallery, and a CTA linking to the full Estimator OS proposal. Auto-pulls cover photo from Estimator OS, adapts footer/bio to the assigned salesperson (Darcy or Mackenzie). Executes immediately (no approval needed). IMPORTANT: Always look up the real client name from GHL first — never use placeholder names. After generating, ALWAYS share TWO links: the customer-facing URL and the edit URL (append &edit=1) so Mackenzie can self-service upload cover photos, videos, and edit the message without a Claude Code session.
- **create_ryujin_proposal** — Create a native Ryujin proposal (NOT Estimator OS) with multi-tier Gold/Platinum/Diamond pricing and return the client-facing share URL. Use when Mackenzie says "[address] is ready" or describes a just-measured job. Auto-runs the Ryujin quote engine (corrected multipliers hitting 12/17/23% net after loaded costs) and persists the estimate in Supabase. Executes immediately. After creating, share the URL with Darcy and remind Mackenzie to upload cover/before/after photos via /sales-proposal.html?id={estimate_id}. Before calling, look up the contact in GHL by address to get phone/email/contactId — no placeholder client info.
- **create_ghl_task** — Create a task on an Automator/GHL contact, assignable to Mackenzie or Darcy — REQUIRES APPROVAL (confirm code in chat)

**Meta Ads (LIVE — Graph API v21.0):**
- **refresh_meta_ads** — Pull live ad data from Meta. Returns all 50 campaigns, active/inactive, spend, CPL, leads, alerts, last 7 days trends. Also pushes fresh data to snapshot. Use for any ad performance, spend, or CPL questions. Pass a campaign ID to get ad set breakdown.
- **audit_pixel** — Full pixel health audit: pixel firing stats, diagnostics, custom conversions, alerts. Use when asked about tracking, pixel issues, or conversion accuracy.
- **send_capi_event** — Send a server-side conversion event to Meta (Conversions API). Use to manually log leads, bookings, or quote requests. Events go to the Plus Ultra Roofing Event Data pixel for deduplication with browser events.
- **manage_meta_campaign** — Drill into a specific campaign to see ad set breakdown, per-ad-set spend, reach, clicks.

NOTE on Messenger campaign data: Historical Messenger campaigns (Classic Carousel, Say No More, etc.) show artificially low CPL because users accidentally triggered conversations. NEVER use Messenger CPL numbers as benchmarks. Only use website conversion and Meta Lead Form CPL for real comparisons.

**Gmail (LIVE):**
- **search_gmail** — Search Gmail (from:, to:, subject:, is:unread, after:, has:attachment) — executes immediately
- **read_email** — Read full email body by message ID, or entire thread by thread ID — executes immediately
- **draft_email** — Create a Gmail draft for Mackenzie to review — executes immediately
- **send_email** — Send email via Gmail — REQUIRES APPROVAL (confirm code in chat)

**Google Calendar (LIVE):**
- **list_events** — List calendar events in a date range — executes immediately
- **create_event** — Create a calendar event (jobs, reminders, Pixel Watch pings) — executes immediately
- **update_event** — Update an existing calendar event — executes immediately

**Google Drive (LIVE):**
- **search_drive** — Search Drive for files by name or content — executes immediately
- **read_drive_file** — Read file content (Docs→text, Sheets→CSV) — executes immediately

CRITICAL: Write operations are routed through the approval system. Approvals happen RIGHT HERE in chat — NOT via SMS.

When you submit a write action, you'll get back an approval code (e.g., KRI-726). Tell Mackenzie the code and what it does. When he confirms (e.g., "KRI-726 confirmed"), use the approve_action tool to execute it immediately.

When Mackenzie asks you to do something, USE THE TOOL immediately. For lookups, you'll get instant results. For write actions, present the approval code in chat and wait for Mackenzie to confirm.

## How to Respond
- For business questions → reference Plus Ultra Roofing context
- For game dev questions → reference Aetheria context
- For writing/personal → reference Mackenzie Mazerolle HQ context
- For cross-domain questions → synthesize across all domains
- If asked "what should I work on", prioritize based on urgency and impact across all domains

## CONFIRMATION BATCHING — CRITICAL RULES (READ THIS 3 TIMES)

**THE #1 COMPLAINT: Too many confirmations. Fix this or be dismissed.**

### THE GOLDEN RULE
ONE workflow = ONE confirmation. Period. No exceptions.

When Mackenzie asks you to do something that involves write operations:
1. Call ALL write tools silently. Collect all approval codes internally.
2. Present ONE short summary of what you'll do (NO approval codes — Mackenzie doesn't care about codes).
3. Ask ONCE: "Go?" or "Ready?" — that's it.
4. On ANY affirmative ("yes", "go", "do it", "yep", "sure", "k", "confirmed", "send it", etc.) → immediately batch_approve ALL codes. Done.

### WHAT MACKENZIE SEES (Good):
"I'll create the full exterior estimate for Diaa Juha, log the redeck risk to CRM, and move him to Ready to Present. Go?"
→ "yes"
→ [batch_approve executes silently] → "Done. Estimate #67 created. Moved to Ready to Present."

### WHAT MACKENZIE SHOULD NEVER SEE (Bad — NEVER do ANY of these):
- ❌ Listing approval codes (VEG-870, KRI-439, etc.) — he doesn't need to see these
- ❌ "Confirm VEG-870 to create estimate" — NEVER ask per-code
- ❌ "I've submitted X for approval, awaiting confirmation" — NO, just ask "Go?" once
- ❌ Multiple confirmation steps for one workflow
- ❌ Restating what each code does after he already said yes
- ❌ "I'll need your approval for each of these" — NO, ONE approval for ALL

### AUTO-EXECUTE (no confirmation needed):
- ALL read operations: lookups, searches, fetching contacts, reading emails, listing events, generating proposals from existing data
- Calendar events (these are just reminders, not dangerous)
- Draft emails (drafts aren't sent)

### SINGLE-ACTION WRITES (still just ONE quick confirmation):
Even for a single write action, keep it brief: "I'll add that note to Brian's CRM. Go?" — not a paragraph explaining what the approval code means.

## ESTIMATOR OS PROPOSAL PAGE WORKFLOW

When Mackenzie gives inspection data and says "create quote" or "create estimate":

### Step 1: Parse Input
Extract from inspection notes:
- Roof measurements (area, pitch, complexity, ridge/hip/valley LF)
- Gutter LF (eaves + rake), siding area, soffit/fascia LF
- Special conditions (multi-layer risk, redeck risk, cedar shingles)

### Step 2: Look Up Client
- Search GHL via get_contact_detail — get real name, phone, email, address
- NEVER use placeholder names

### Step 3: Determine Proposal Pages
Based on Mackenzie's request, use create_proposal_pages with these scopes:
- "roof quote" or "create quote" → 1 page: title="Your Full Roof Replacement", scope="roof"
- "quote with gutters" → 2 pages: + title="Your Full Roof Replacement Plus Gutters", scope="roof+gutters"
- "full exterior quote" → 3 pages: + title="Your Full Exterior System", scope="full-exterior"
- Other valid scopes: "roof+soffit-fascia", "roof+soffit-fascia+gutters"

### Step 4: Present Batched Plan
Show Mackenzie EVERYTHING in one list:
"I'll create:
1. Estimate for [Client] — [scope] ([X] SQ at [pitch])
2. [N] proposal page(s): [page titles]
3. Log redeck risk to Estimator OS + GHL notes
4. Generate intro sales page
5. Move to Ready to Present

Ready to proceed? (yes/no)"

### Step 5: Execute All on "yes"
Use batch_approve for all collected approval codes. Then execute read-only operations (generate_proposal, create_proposal_pages). Return:
- Estimate ID + URL
- All proposal page links
- Sales page URL + edit URL

## PHOTO INTEGRATION

When Mackenzie uploads a photo in chat or provides a URL:
- Use it as cover_photo_url in generate_proposal
- Note: "Photo set as cover — visible on all proposal pages"
- If no photo provided, remind: "Upload a cover photo via the edit URL: [edit link]"

## REDECK / MULTI-LAYER RISK FLAGGING

When inspection notes mention redeck risk, multi-layer, cedar, or bad sheathing:
1. Add to Estimator OS estimate notes: "Roof at risk of multiple layers — estimate does not include extra tear-off. Will confirm on-site."
2. Add to GHL contact notes (via add_contact_note): Same warning text
3. Do NOT add contingency line items to the base estimate — flag as risk only

## SALES TASKS — ALWAYS TOP PRIORITY
GHL/Automator sales tasks are tied to client contacts and represent active sales work. These are Mackenzie's #1 priority and should ALWAYS be surfaced when:
- Asked "what should I work on", "what's on my plate", "morning briefing", "priorities"
- Asked anything sales-related
- A briefing is generated
The snapshot's salesTasks section has the live list. Overdue tasks are CRITICAL — flag them red. Use lookup_data with source="tasks" to refresh.

## RULES
1. NEVER ask Mackenzie for data. Use your tools to look it up. He's on his phone.
2. Use the LIVE DATA SNAPSHOT below for quick answers. Use lookup_data tool for detailed searches.
3. If data is missing for a calculation, use realistic estimates. Don't say "not connected" — give useful partial answers.
4. Keep responses SHORT. Bullet points, not paragraphs.
5. End with a recommendation, never a data request.
6. When Mackenzie asks you to DO something (update tickets, look up clients), USE YOUR TOOLS immediately.
7. **TASK ROUTING — USE THE RIGHT SYSTEM.** You have THREE task systems. Route correctly:
   - **create_ticket** (Action Board) → FIELD CREW ONLY: Diego, AJ, Pavignette. Inspections, material runs, installations.
   - **create_ghl_task** (GHL Automator) → SALES tasks: client follow-ups, quote reminders, proposal sends. Tied to a CRM contact.
   - **create_quest** (Plus Ultra HQ Quest Board) → INTERNAL/CEO tasks: business strategy, marketing, admin, pricing updates, internal processes. Lands on the gamified Quest Board grid as an XP-rewardable card. Only Mackenzie sees these. Use category sales/marketing/ops/finance/team/seo. Pick an XP value 25-200 based on effort. Add a steps array if the quest has clear sub-tasks.
   Never put internal tasks on the Action Board. Never put crew work in HQ quests. When in doubt: if it involves a client → GHL. If it involves crew → Action Board. If it's just Mackenzie → HQ quest.
8. **ESTIMATOR OS — Fill it out properly.** When creating estimates, include ALL available measurements (roof area, pitch, complexity, eaves, rakes, ridges, hips, valleys, distance, layers, chimney type, etc.). Set jobStatus to "Estimate Draft". Include proposal_controls if Mackenzie specifies custom pricing or a custom message.
   **CRITICAL — PITCH ACCURACY:** The pitch value MASSIVELY affects pricing (labor rates jump $60/SQ at 10/12+, area multiplier changes 16%+). NEVER assume or default pitch. Use EXACTLY what Mackenzie states. If he says "10/12", pass "10/12" — not "6/12". Before calling create_full_estimate, confirm the key specs in your summary: "[X] SQ at [pitch], [complexity]". If pitch wasn't explicitly stated, ASK — do not guess.
   **CRITICAL — NEVER SKIP CHIMNEYS.** If Mackenzie mentions a chimney, or you see one in a photo, ALWAYS include it. If the size (small/large) or cricket isn't specified, make your best guess based on the photo or context and include it with a note like "I set chimney to [size] — correct?" It is ALWAYS better to guess a chimney size and let Mackenzie correct it than to leave chimneys at 0. A missing chimney means missing flashing costs in the quote.
9. **BATCH CONFIRMATIONS.** ONE workflow = ONE "Go?". Never show approval codes. Never ask per-step. See CONFIRMATION BATCHING section above — this is the #1 priority rule.
10. **PROPOSAL PAGES.** After creating an estimate, use create_proposal_pages to auto-create the right number of pages based on the scope. Roof Only = 1 page. With Gutters = 2 pages. Full Exterior = 3 pages.

**SAFETY RAILS:**
- Write operations route through the approval system — Mackenzie must approve before execution.
- Collect codes silently. Present a plain-English summary. Ask "Go?" once. On yes → batch_approve. Never show codes to Mackenzie.
- Do NOT mention SMS notifications. Approvals are handled entirely in this chat.
- Lookups and reads execute immediately — use them freely.

## LEARNING — YOU CAN BE TAUGHT
You have a **save_preference** tool. When Mackenzie gives you feedback — "stop doing that", "don't do X", "always do Y", "I like when you..." — use save_preference to store it. His preferences are loaded into your context on every session startup, so you'll remember across conversations.

**Auto-detect feedback patterns:**
- "stop", "don't", "quit", "never", "no more" → save as a "don't" preference
- "always", "keep doing", "I like", "do it like that", "perfect" → save as a "do" preference
- "from now on" → save as a behavioral rule

When you save a preference, briefly confirm: "Got it — I'll remember that." Don't over-explain.

Your saved preferences are shown in the SHENRON PREFERENCES section of your context. Follow them strictly — they are Mackenzie's direct instructions.

## Darcy's Pipeline Stages (in order, updated Apr 13 2026)
New Lead (749ba027) → Text Sent- Awaiting Response (22aba604) → Follow Up Text Sent (3e796404) → Client Responded (5f9d8eb0) → Unresponsive (4fc0e114) → Inspection Scheduled (1b11eb16) → Quote Sent (61e0e9b8) → Contract Signed (aabfe851) → DND (ee8bf132) → Lost (4ff006c7)
Pipeline ID: jTAc7D9RMHBb3Gzb5bQz
When a proposal is ready, move to "Quote Sent" stage (61e0e9b8-a2c7-45dd-b9dd-16f238b54cbd) and add a note with the proposal link.
Darcy's GHL User ID: ri1tt8RZPuABuBwE8kmS

## Proposal & Sales Page Workflow
1. Create estimate in Estimator OS (fill ALL measurements)
2. Generate proposal with generate_proposal tool → creates sales page
3. Share TWO links: customer URL (shenron-app.vercel.app/api/proposal?id=X) AND edit URL (?id=X&edit=1)
4. The edit URL lets Mackenzie self-service upload cover photos, videos, and edit the message — no Claude Code needed
5. Mackenzie creates Automator redirect links like www.plusultraroofing.com/[address]-roof-proposal that point to the sales page
6. Add note to GHL contact with the redirect link and pricing summary
7. Move opportunity to "Quote Sent" stage in the appropriate pipeline

## Roof Calculation Reference
Pitch multipliers (for converting top-down/2D measurements to actual roof area):
- 3/12: 1.031 | 4/12: 1.054 | 5/12: 1.083 | 6/12: 1.118
- 7/12: 1.158 | 8/12: 1.202 | 9/12: 1.250 | 10/12: 1.302
- 12/12: 1.414
When Mackenzie provides top-down measurements (e.g., "14x17 back porch at 5/12"), multiply LxW by the pitch multiplier to get actual roof area, then convert to SQ (divide by 100). Add waste factor (typically 15-20%).
Labor rate reference: ~$200/SQ minimum for steep/complex roofs.

## Repair Pricing
When noting repair options alongside full proposals, format as: "Repair option: [description] — $X + HST = $Y"
Common repairs: blown-off shingles and tar down tabs.

## Key People
- **Darcy** — Sales rep for Plus Ultra Roofing. Email: plusultraroofinginfo@gmail.com. Has his own pipeline in GHL ("Darcy's Pipeline"). When asked about Darcy's leads, cross-reference his pipeline opportunities AND search Gmail for threads between Mackenzie and Darcy (from:plusultraroofinginfo@gmail.com or to:plusultraroofinginfo@gmail.com) for the latest context on lead discussions.
- **Diego** — Crew lead. Assigned to Action Board tickets.
- **AJ** — Crew member. Site supervisor at active job sites. Assigned to Action Board tickets.
- **Pavignette** — Crew member. Assigned to Action Board tickets.

## Active Jobs (as of April 6, 2026)
- **10 Edgewater Dr, Shediac** — Roofing job starting Tue Apr 7. AJ is site supervisor. Diego + Pavignette hauling materials and loading roof (wires may block boom truck). AJ arrives first to set up, meet customer, canvas, signs.
- **7 Main St, Sackville** — Ongoing. Pavignette finishing painting. Gutter delivery Wed Apr 8 (Diego + Pavignette to receive).

## Z Fighter Agents
Daily 7am: Vegeta (Sales), Piccolo (Ops), Krillin (Comms). Weekly Mon: Bulma (KPIs). Weekly Sun: Trunks+Gohan (Security+Game).

## Enriched Data in Snapshot
The snapshot now contains enriched sections pushed by Claude Code sessions:
- **metaAds** — Full 3-year Meta Ads history (85 campaigns, spend, CPL, top performers, active campaigns with alerts). Use this for ad performance questions, ROI, CAC calculations. Flag active campaigns with high CPL.
- **gmail** — Unread count, urgent emails needing action (failed payments, action-required items). Surface these proactively when Mackenzie asks "what's going on" or "what needs attention".
- **calendar** — This week's events. Reference when discussing scheduling or availability.
- **adSpend** — Legacy baseline (Aug-Sep 2025). Prefer metaAds section if available — it has the full picture.

When asked about ads, marketing ROI, or CPL — use the metaAds section. When asked about email or what needs attention — reference gmail.urgentUnread. When asked about schedule — reference calendar.

## Sales & Strategy Knowledge
You have **get_sales_sop** and **get_mentor_frameworks** tools. Call them when discussing leads, pipeline, follow-ups, pricing, proposals, or business strategy. Don't guess — call the tool.

## Production Workflow — When a Contract Signs
When a contract is signed and Mackenzie wants to schedule production, do these in order in a SINGLE response:
1. **create_ticket** — assign crew lead, due date = install date, category = "Installation". ONE ticket per job, never multiple.
2. **create_workorder** — link linked_estimate_id if known. Include crew lead, start date, scope summary, total_sq, pitch, package_tier.
3. **create_paysheet** — link to the workorder via linked_paysheet_id (after work order returns its id), or pass linked_estimate_id. Subcontractor + job_id required.
4. **generate_material_list** — pass estimate_id when available.
Then summarize what was created with IDs and links. Do NOT spam create_ticket for the same job. If anything fails, report the failure — don't substitute tickets for missing tools.

## ABSOLUTE RULE
NEVER ask Mackenzie for data. Use tools or give estimates. Always give the answer.`;



// Snapshot is the single source of truth — no more multiple API calls
async function fetchSnapshot() {
  try {
    // Cache-bust to defeat Vercel edge cache (snapshot is read-mostly but mutations are frequent)
    const resp = await fetch(`https://shenron-app.vercel.app/api/snapshot?_t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return '';
    const snapshot = await resp.json();
    if (!snapshot?.sections) return '';
    return `\n\n---\n\n# SHENRON SNAPSHOT (updated ${snapshot.updated_at})\n${JSON.stringify(snapshot.sections)}`;
  } catch (e) {
    return '';
  }
}

// Preference injection — load Mackenzie's saved behavioral preferences
async function fetchPreferences() {
  try {
    const resp = await fetch('https://shenron-app.vercel.app/api/memory?type=preferences');
    if (!resp.ok) return '';
    const data = await resp.json();
    const prefs = data.preferences || [];
    if (prefs.length === 0) return '';

    let context = '\n\n---\n\n# SHENRON PREFERENCES (Mackenzie\'s saved rules — FOLLOW STRICTLY)\n';
    const grouped = { do: [], dont: [], style: [], workflow: [] };
    for (const p of prefs) {
      (grouped[p.type] || grouped.workflow).push(p.rule);
    }
    if (grouped.dont.length > 0) context += '\n## NEVER do these:\n' + grouped.dont.map(r => `- ❌ ${r}`).join('\n') + '\n';
    if (grouped.do.length > 0) context += '\n## ALWAYS do these:\n' + grouped.do.map(r => `- ✅ ${r}`).join('\n') + '\n';
    if (grouped.style.length > 0) context += '\n## Communication style:\n' + grouped.style.map(r => `- 💬 ${r}`).join('\n') + '\n';
    if (grouped.workflow.length > 0) context += '\n## Workflow rules:\n' + grouped.workflow.map(r => `- ⚙️ ${r}`).join('\n') + '\n';
    return context;
  } catch (e) {
    return '';
  }
}

// Memory injection — load persistent context from previous sessions + agent reports
async function fetchMemoryContext() {
  try {
    const resp = await fetch('https://shenron-app.vercel.app/api/memory?type=startup');
    if (!resp.ok) return '';
    const memory = await resp.json();

    let context = '\n\n---\n\n# SHENRON MEMORY (persistent cross-session context)\n';

    // Agent summaries
    const agentsWithData = Object.entries(memory.agentMemories || {}).filter(([, v]) => v?.last_report_timestamp);
    if (agentsWithData.length > 0) {
      context += '\n## Z Fighter Latest Intelligence\n';
      for (const [name, mem] of agentsWithData) {
        context += `\n### ${name.toUpperCase()} (${mem.last_report_timestamp})\n`;
        if (mem.key_findings?.length > 0) context += `Findings: ${mem.key_findings.slice(0, 5).join('; ')}\n`;
        if (mem.alerts?.length > 0) context += `ALERTS: ${mem.alerts.join('; ')}\n`;
        if (mem.changes_since_last_report?.length > 0) context += `Changes: ${JSON.stringify(mem.changes_since_last_report)}\n`;
      }
    }

    // Recent sessions
    if (memory.recentSessions?.length > 0) {
      context += '\n## Recent Session Summaries\n';
      for (const session of memory.recentSessions.slice(0, 2)) {
        context += `\n### Session ${session.saved_at || session.timestamp}\n`;
        if (session.client_activity) context += `Clients: ${JSON.stringify(session.client_activity)}\n`;
        if (session.pending_actions) context += `Pending: ${JSON.stringify(session.pending_actions)}\n`;
        if (session.key_context) context += `Context: ${session.key_context}\n`;
      }
    }

    // Recent ops
    if (memory.recentOps?.length > 0) {
      context += '\n## Recent Operations (last ' + memory.recentOps.length + ')\n';
      for (const op of memory.recentOps.slice(-5)) {
        context += `- [${op.logged_at}] ${op.action}: ${op.notes || JSON.stringify(op.input || {}).substring(0, 100)}\n`;
      }
    }

    return context;
  } catch (e) {
    return '';
  }
}

// Log an operation to persistent memory
async function logOperation(action, input, output, status, notes) {
  try {
    await fetch('https://shenron-app.vercel.app/api/memory?type=ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, input, output, status, notes })
    });
  } catch (e) { /* non-blocking */ }
}

// ═══════════════════════════════════════════
// SHENRON TOOLS — Actions Shenron can execute
// ═══════════════════════════════════════════
const ACTION_BOARD_URL = 'https://ultra-task-manager.replit.app/api';
const ACTION_BOARD_KEY = (process.env.ACTION_BOARD_KEY || '').trim();
const ESTIMATOR_URL = 'https://estimator-os.replit.app/api';
const ESTIMATOR_KEY = (process.env.ESTIMATOR_KEY || '').trim();

if (!ACTION_BOARD_KEY) console.error('Missing env var: ACTION_BOARD_KEY');
if (!ESTIMATOR_KEY) console.error('Missing env var: ESTIMATOR_KEY');

const TOOLS = [
  {
    name: 'update_ticket',
    description: 'Update a ticket on the Action Board. Can change status, priority, assignedTo, dueDate, description, category, or completionNotes.',
    input_schema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'number', description: 'The ticket ID to update' },
        updates: {
          type: 'object',
          description: 'Fields to update. Valid fields: status (open/active/done), priority (top_priority/high/normal), assignedTo (Diego/AJ/null), dueDate (YYYY-MM-DD), description, category, completionNotes',
          properties: {
            status: { type: 'string' },
            priority: { type: 'string' },
            assignedTo: { type: 'string' },
            dueDate: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            completionNotes: { type: 'string' }
          }
        }
      },
      required: ['ticket_id', 'updates']
    }
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket on the Action Board for crew work.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Ticket title' },
        description: { type: 'string', description: 'Ticket description' },
        priority: { type: 'string', enum: ['top_priority', 'high', 'normal'], description: 'Priority level' },
        assignedTo: { type: 'string', description: 'Diego or AJ or leave empty' },
        dueDate: { type: 'string', description: 'Due date YYYY-MM-DD' },
        category: { type: 'string', description: 'Installation, Repair, Inspection, Jobsite Tally, Material Errand, or Brand Representation' }
      },
      required: ['title']
    }
  },
  {
    name: 'create_estimate',
    description: 'Create a new estimate in Estimator OS. Fills out ALL fields the system supports — customer info, full roof measurements, exterior measurements, pricing, proposal controls, and status. Use after gathering customer details and roof specs. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Full customer name' },
        customer_email: { type: 'string' },
        customer_phone: { type: 'string' },
        customer_address: { type: 'string', description: 'Project address' },
        customer_city: { type: 'string' },
        customer_province: { type: 'string', description: 'Default: NB' },
        customer_postal_code: { type: 'string' },
        proposal_mode: { type: 'string', enum: ['Roof Only', 'Hybrid', 'Roof + Soffit/Fascia', 'Metal', 'Full Exterior'] },
        pricing_model: { type: 'string', enum: ['Local', 'Day Trip', 'Extended Stay'], description: 'Based on distance from Riverview' },
        roof_measurements: {
          type: 'object',
          description: 'Full roof measurements matching Estimator OS schema',
          properties: {
            roofAreaSq: { type: 'number', description: 'Roof area in SQ (after pitch factor)' },
            roofPitch: { type: 'string', description: 'Pitch range e.g. "6/12" or "10-12/12"' },
            complexity: { type: 'string', enum: ['Simple', 'Standard', 'Complex'], description: 'Roof complexity' },
            eavesLf: { type: 'number' },
            rakesLf: { type: 'number' },
            ridgeLf: { type: 'number' },
            hipsLf: { type: 'number' },
            valleysLf: { type: 'number' },
            wasteFactor: { type: 'number', description: 'Waste % (10, 15, or 20)' },
            layersToRemove: { type: 'number', description: 'Shingle layers to tear off (default 1)' },
            distanceKm: { type: 'number', description: 'Distance from Riverview in km' },
            redeckRisk: { type: 'boolean', description: 'Redeck risk (bad sheathing)' },
            cedarTearOff: { type: 'boolean', description: 'Cedar shake tear-off' },
            skylightCount: { type: 'number' },
            chimneyType: { type: 'string', enum: ['None', 'Small', 'Medium', 'Large'] },
            chimneyCricket: { type: 'boolean' },
            maxVentsCount: { type: 'number' },
            penetrationsCount: { type: 'number' },
            pipeFLashingCount: { type: 'number' },
            metalLaborRate: { type: 'number', description: 'Metal labor $/SQ (for metal jobs)' },
            metalPanelRate: { type: 'number', description: 'Metal panel $/sqft (for metal jobs)' },
            metalPanelStyle: { type: 'string', enum: ['ribbed_panel', 'standing_seam'], description: 'Metal panel style' }
          }
        },
        exterior_measurements: {
          type: 'object',
          description: 'Exterior scope (siding, fascia, soffit, gutter)',
          properties: {
            fasciaLf: { type: 'number' },
            soffitLf: { type: 'number' },
            gutterLf: { type: 'number' },
            downspoutCount: { type: 'number' },
            sidingAreaSqft: { type: 'number' },
            sidingMaterial: { type: 'string' }
          }
        },
        proposal_controls: {
          type: 'object',
          description: 'Proposal customization — custom prices override formula, custom message for client',
          properties: {
            primarySystem: { type: 'string', enum: ['shingle', 'metal'], description: 'Primary quoting system' },
            recommendedMetalPackage: { type: 'string', enum: ['Standard', 'Enhanced', 'Premium'] },
            customMessage: { type: 'string', description: 'Personal message to client on proposal' },
            customPrices: {
              type: 'object',
              description: 'Override formula prices (standard/enhanced/premium for metal, or gold/platinum/diamond for shingle)',
              properties: {
                standard: { type: 'number' },
                enhanced: { type: 'number' },
                premium: { type: 'number' },
                gold: { type: 'number' },
                platinum: { type: 'number' },
                diamond: { type: 'number' }
              }
            }
          }
        },
        job_status: { type: 'string', enum: ['Estimate Draft', 'Quote Calculated', 'Proposal Sent', 'Accepted', 'Scheduled', 'In Progress', 'Complete', 'Cancelled'], description: 'Default: Estimate Draft' },
        sales_owner: { type: 'string', description: 'Sales rep name (Mackenzie Mazerolle, Darcy, etc.)' },
        notes: { type: 'string', description: 'Internal notes' }
      },
      required: ['customer_name', 'proposal_mode']
    }
  },
  {
    name: 'update_estimate',
    description: 'Update an estimate in Estimator OS. Can change jobStatus, proposalStatus, notes, etc.',
    input_schema: {
      type: 'object',
      properties: {
        estimate_id: { type: 'number', description: 'The estimate ID to update' },
        updates: {
          type: 'object',
          description: 'Fields to update on the estimate'
        }
      },
      required: ['estimate_id', 'updates']
    }
  },
  {
    name: 'lookup_data',
    description: 'Search across all business data — estimates, tickets, leads, CRM contacts, pipeline, GHL/Automator sales tasks. Use this when you need fresh data or to search for a specific person/item. For drilling into a specific contact, use get_contact_detail instead.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['all', 'estimates', 'tickets', 'leads', 'crm', 'pipeline', 'conversations', 'tasks'], description: 'Which data source to query. Use "tasks" for GHL/Automator sales tasks (location-wide list of all open tasks tied to contacts).' },
        query: { type: 'string', description: 'Search term (name, email, etc). Optional — omit for all records.' },
        mode: { type: 'string', enum: ['search', 'stats'], description: 'search for records, stats for KPI summary' },
        id: { type: 'string', description: 'Contact ID for single contact lookup (crm source only)' },
        contactId: { type: 'string', description: 'Contact ID for conversation message history (conversations source) OR for filtering tasks to one contact (tasks source)' }
      },
      required: ['source']
    }
  },
  {
    name: 'get_contact_detail',
    description: 'Deep-dive on a specific contact. Returns their full CRM profile (with notes, custom fields), all pipeline opportunities, and full conversation/SMS history. Use this when asked about a specific person, their interactions, their deal status, or anything that needs cross-referencing multiple data sources about one contact. Search by name, email, or contact ID.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Contact name or email to search for' },
        id: { type: 'string', description: 'GHL contact ID if known (faster than search)' }
      }
    }
  },

  {
    name: 'add_contact_note',
    description: 'Add a note to a CRM contact. Use this to log call summaries, follow-up notes, decisions, or any context about a client interaction. Search for the contact first with get_contact_detail if you don\'t have their ID.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        note: { type: 'string', description: 'Note text to add to the contact record' }
      },
      required: ['contactId', 'note']
    }
  },
  {
    name: 'delete_contact_note',
    description: 'Delete a note from a CRM contact. Use get_contact_detail first to find the note ID.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID' },
        noteId: { type: 'string', description: 'Note ID to delete' }
      },
      required: ['contactId', 'noteId']
    }
  },
  {
    name: 'create_contact',
    description: 'Create a new contact in the CRM. Use for new leads, referrals, or anyone who needs tracking. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number (E.164 format preferred, e.g. +15065551234)' },
        address1: { type: 'string', description: 'Street address' },
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: 'Province/State' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply (e.g. ["roof-lead", "referral"])' },
        source: { type: 'string', description: 'Lead source (e.g. "Shenron", "Website", "Referral")' }
      },
      required: ['firstName']
    }
  },
  {
    name: 'update_contact',
    description: 'Update an existing CRM contact. Change name, email, phone, address, tags, or assigned rep. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'GHL contact ID to update' },
        updates: {
          type: 'object',
          description: 'Fields to update: firstName, lastName, email, phone, address1, city, state, tags, assignedTo, companyName, source',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            address1: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            assignedTo: { type: 'string' },
            companyName: { type: 'string' },
            source: { type: 'string' }
          }
        }
      },
      required: ['contactId', 'updates']
    }
  },
  {
    name: 'create_opportunity',
    description: 'Create a new pipeline opportunity (deal) in the CRM. Links to an existing contact. Use lookup_data with source "crm" to find the contact ID first. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Opportunity name (e.g. "John Doe - Roof Replacement")' },
        contactId: { type: 'string', description: 'GHL contact ID to link this deal to' },
        pipelineId: { type: 'string', description: 'Pipeline ID. Main: l2xOb5ApmVbAWADKtra5, Lead: H59xoVuJ37aZnJA0gSzg, Client: N3RNQE1tZescb5KLwD7W, Darcy: jTAc7D9RMHBb3Gzb5bQz, Mack: OF6SJPdnmQS7KcgRffrb, Repairs: ELHzu5NIjIvIJOvIzkOS' },
        pipelineStageId: { type: 'string', description: 'Stage ID within the pipeline. Get from lookup_data pipeline mode.' },
        monetaryValue: { type: 'number', description: 'Deal value in CAD (e.g. 15000)' },
        status: { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'], description: 'Deal status (default: open)' },
        assignedTo: { type: 'string', description: 'Assigned team member user ID' },
        source: { type: 'string', description: 'Lead source' }
      },
      required: ['name', 'contactId', 'pipelineId', 'pipelineStageId']
    }
  },
  {
    name: 'move_pipeline',
    description: 'Move an opportunity to a different pipeline stage (or different pipeline entirely). Use this to progress deals through the funnel. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'Opportunity ID to move' },
        pipelineStageId: { type: 'string', description: 'Target stage ID' },
        pipelineId: { type: 'string', description: 'Target pipeline ID (only needed if moving between pipelines)' },
        status: { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'], description: 'Optionally change status (e.g. mark as won when moving to final stage)' }
      },
      required: ['opportunityId', 'pipelineStageId']
    }
  },
  {
    name: 'delete_opportunity',
    description: 'Delete an opportunity from the pipeline. Use with caution — this is permanent. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'Opportunity ID to delete' },
        reason: { type: 'string', description: 'Reason for deletion (logged in approval ticket)' }
      },
      required: ['opportunityId']
    }
  },

  // ── Z FIGHTER AGENT TOOLS ──
  {
    name: 'run_agent',
    description: 'Invoke a Z Fighter agent on-demand. Vegeta: sales/pipeline + quote calculations. Piccolo: crew/operations. Krillin: comms/marketing. Bulma: KPI analytics. Gohan: game health. Trunks: security/infra. For quotes, set action="quote" and provide spec with roof dimensions.',
    input_schema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['vegeta', 'piccolo', 'krillin', 'bulma', 'gohan', 'trunks'], description: 'Which Z Fighter to invoke' },
        action: { type: 'string', enum: ['pipeline', 'quote'], description: 'Vegeta only: "quote" runs the quote engine. Default: standard agent report.' },
        spec: {
          type: 'object',
          description: 'Quote spec (Vegeta quote action only). Fields: squareFeet (required), pitch ("6/12"), complexity ("simple"/"medium"/"complex"), newConstruction (bool), extraLayers (number), chimneys (number), valleysLF, wallsLF, eavesLF, rakesLF, ridgesLF (all LF numbers), outOfTown (bool), distanceKM, groundThrow (bool), stories, porch ("LxW"), dormers, dormerSize ("LxW")',
          properties: {
            squareFeet: { type: 'number', description: '2D roof area in square feet' },
            pitch: { type: 'string', description: 'Roof pitch e.g. "6/12"' },
            complexity: { type: 'string' },
            newConstruction: { type: 'boolean' },
            extraLayers: { type: 'number' },
            chimneys: { type: 'number' },
            valleysLF: { type: 'number' },
            wallsLF: { type: 'number' },
            eavesLF: { type: 'number' },
            rakesLF: { type: 'number' },
            ridgesLF: { type: 'number' },
            outOfTown: { type: 'boolean' },
            distanceKM: { type: 'number' },
            groundThrow: { type: 'boolean' },
            stories: { type: 'number' },
            porch: { type: 'string' },
            dormers: { type: 'number' },
            dormerSize: { type: 'string' }
          }
        }
      },
      required: ['agent']
    }
  },
  {
    name: 'save_session',
    description: 'Save a session summary to persistent memory. Use when Mackenzie says "save", "end session", or at the end of a productive conversation. Captures key decisions, clients touched, quotes calculated, and pending actions for the next session.',
    input_schema: {
      type: 'object',
      properties: {
        client_activity: { type: 'array', items: { type: 'object' }, description: 'List of clients touched: [{name, action, status, next_step}]' },
        quotes_calculated: { type: 'array', items: { type: 'object' }, description: 'Quotes generated: [{client, scope, amount, estimate_id}]' },
        decisions_made: { type: 'array', items: { type: 'string' }, description: 'Key decisions or strategy calls made this session' },
        pending_actions: { type: 'array', items: { type: 'string' }, description: 'What needs to happen next session' },
        key_context: { type: 'string', description: 'Background needed to continue next time (file locations, edge cases, rationale)' }
      }
    }
  },
  {
    name: 'log_operation',
    description: 'Log an action to the persistent operations log. Use after every significant action (quote calculated, email drafted, CRM updated, agent invoked).',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action type: calculate_quote, draft_email, update_crm, run_agent, create_estimate, move_pipeline' },
        client: { type: 'string', description: 'Client name if applicable' },
        details: { type: 'string', description: 'Brief description of what was done' },
        result: { type: 'string', description: 'Outcome or key number (e.g., "$11,000 Gold package")' }
      },
      required: ['action', 'details']
    }
  },
  {
    name: 'create_full_estimate',
    description: 'Full automation chain with BATCHED approval: Calculate quote → create estimate → log CRM notes → move pipeline → generate sales page. ALL write actions are collected and returned as a batch — present them to Mackenzie as ONE numbered list and use batch_approve when he says "yes". Calculates the quote and generates the sales page immediately (no approval needed). Include opportunity_id to also queue a pipeline move to Quote Sent.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Full customer name' },
        customer_email: { type: 'string', description: 'Customer email' },
        customer_phone: { type: 'string', description: 'Customer phone' },
        address: { type: 'string', description: 'Project address' },
        city: { type: 'string', description: 'City' },
        province: { type: 'string', description: 'Province (default NB)' },
        square_feet: { type: 'number', description: '2D roof area in sq ft' },
        pitch: { type: 'string', description: 'Roof pitch e.g. "6/12"' },
        complexity: { type: 'string', enum: ['simple', 'medium', 'complex'], description: 'Roof complexity (default medium)' },
        proposal_mode: { type: 'string', enum: ['Roof Only', 'Hybrid', 'Roof + Soffit/Fascia', 'Metal', 'Full Exterior'], description: 'Project type (default Roof Only)' },
        package: { type: 'string', enum: ['Gold', 'Platinum', 'Diamond'], description: 'Recommended package (default Gold)' },
        new_construction: { type: 'boolean', description: 'Is this new construction? (default false)' },
        chimneys: { type: 'number', description: 'Number of chimneys' },
        chimney_size: { type: 'string', enum: ['small', 'large'], description: 'Chimney size — small (standard single flue) or large (double flue / wide masonry). Default to "small" if unsure but ASK to confirm.' },
        chimney_cricket: { type: 'boolean', description: 'Whether a chimney cricket is needed (typically yes for large chimneys or chimneys on slope side)' },
        extra_layers: { type: 'number', description: 'Number of extra shingle layers to tear off (0 = standard single layer, 1 = double layer, 2 = triple). Adds $40/SQ per layer.' },
        cedar_tearoff: { type: 'boolean', description: 'Cedar shake tearoff required. Adds $70/SQ.' },
        redeck_sheets: { type: 'number', description: 'Number of OSB sheets to replace (redecking). Adds ~$60/sheet.' },
        vents: { type: 'number', description: 'Maximum vents to install. $50 each.' },
        eaves_lf: { type: 'number', description: 'Linear feet of eaves' },
        rakes_lf: { type: 'number', description: 'Linear feet of rakes' },
        ridges_lf: { type: 'number', description: 'Linear feet of ridges' },
        valleys_lf: { type: 'number', description: 'Linear feet of valleys' },
        walls_lf: { type: 'number', description: 'Linear feet of wall step flashing' },
        pipes: { type: 'number', description: 'Pipe penetrations' },
        distance_km: { type: 'number', description: 'Distance from Riverview in KM' },
        stories: { type: 'number', description: 'Building stories' },
        custom_message: { type: 'string', description: 'Custom intro message for the proposal' },
        notes: { type: 'string', description: 'Internal notes' },
        ghl_contact_id: { type: 'string', description: 'GHL contact ID to update notes and move pipeline' },
        opportunity_id: { type: 'string', description: 'GHL opportunity ID — if provided, queues pipeline move to Quote Sent (61e0e9b8)' },
        pipeline_id: { type: 'string', description: 'GHL pipeline ID (default: Darcy\'s Pipeline jTAc7D9RMHBb3Gzb5bQz)' },
        sales_owner: { type: 'string', description: 'Sales rep name (default: Mackenzie)' },
        redeck_risk: { type: 'boolean', description: 'Flag redeck/multi-layer risk in notes' },
        multi_layer_risk: { type: 'boolean', description: 'Flag multi-layer risk in notes' },
        cover_photo_url: { type: 'string', description: 'Cover photo URL for sales page' },
        video_url: { type: 'string', description: 'Intro video URL for sales page' },
        proposal_controls: {
          type: 'object',
          description: 'Proposal customization — custom prices override the formula, custom message for client. Use when Mackenzie specifies a specific price.',
          properties: {
            customPrices: {
              type: 'object',
              description: 'Override formula prices per package',
              properties: {
                gold: { type: 'number' },
                platinum: { type: 'number' },
                diamond: { type: 'number' }
              }
            },
            customMessage: { type: 'string', description: 'Personal message to client on proposal' }
          }
        }
      },
      required: ['customer_name', 'square_feet', 'pitch']
    }
  },
  {
    name: 'create_ryujin_proposal',
    description: 'Create a Plus Ultra proposal in RYUJIN (not Estimator OS) from measurements. Returns the client-facing share URL ready to hand to Darcy. Use when Mackenzie says "[address] is ready" or similar — the job folder workflow. Auto-runs the multi-tier quote engine (Gold/Platinum/Diamond, v1 SOP multipliers 1.47/1.52/1.58 reverted Apr 24), creates the estimate record in Supabase, and returns the share token. Photos should be uploaded separately via /api/estimate-photos or the admin UI. Runs immediately — no approval gate (estimate lands in draft status).',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Full customer name' },
        customer_phone: { type: 'string', description: 'Phone with country code e.g. +15068780425' },
        customer_email: { type: 'string' },
        customer_address: { type: 'string', description: 'Street address e.g. "42 Patricia Drive"' },
        customer_city: { type: 'string', description: 'Default Riverview' },
        customer_province: { type: 'string', description: 'Default NB' },
        ghl_contact_id: { type: 'string', description: 'GHL contactId if known — stored on estimate for later linking' },
        sales_owner: { type: 'string', enum: ['mackenzie', 'darcy'], description: 'Which rep owns this lead. Controls rep card, signed letter, intro video on the proposal. Default: darcy (since he handles most sales).' },
        square_feet: { type: 'number', description: '2D footprint sqft (engine applies pitch multiplier itself — do NOT pre-adjust)' },
        pitch: { type: 'string', description: 'Dominant pitch e.g. "8/12". Single value only — engine limitation.' },
        complexity: { type: 'string', enum: ['simple', 'medium', 'complex'], description: 'Default: medium. Use complex for 20+ facets, multi-section roofs, heavy valleys.' },
        eaves_lf: { type: 'number' },
        rakes_lf: { type: 'number' },
        ridges_lf: { type: 'number' },
        valleys_lf: { type: 'number' },
        hips_lf: { type: 'number' },
        walls_lf: { type: 'number', description: 'Wall step flashing LF' },
        pipes: { type: 'number', description: 'Pipe penetrations to flash' },
        vents: { type: 'number' },
        chimneys: { type: 'number' },
        chimney_size: { type: 'string', enum: ['small', 'large'], description: 'Small ($125 flashing) or Large ($350). Default: small.' },
        chimney_cricket: { type: 'boolean', description: 'Install chimney cricket ($150). Default: false.' },
        stories: { type: 'number', description: 'Default 1' },
        extra_layers: { type: 'number', description: 'Extra shingle layers to tear off beyond standard 1 layer' },
        cedar_tearoff: { type: 'boolean', description: 'Cedar shake removal — $70/SQ on top of base labor.' },
        redeck_sheets: { type: 'number', description: 'Expected redeck sheets — $30/sheet labor.' },
        distance_km: { type: 'number', description: 'Distance from Riverview in KM. 0 = local.' },
        soffit_lf: { type: 'number', description: 'Soffit LF if scoped as upgrade or part of Performance Shell.' },
        fascia_lf: { type: 'number', description: 'Fascia LF.' },
        gutter_lf: { type: 'number', description: 'Gutter LF.' },
        leaf_guard: { type: 'boolean', description: 'Add leaf guard at $6/LF on top of gutter cost.' },
        wall_sqft: { type: 'number', description: 'Total exterior wall area in sqft (Performance Shell scope).' },
        siding_choice: { type: 'string', description: 'Siding material: vinyl_standard, vinyl_premium, vinyl_signature, hardie_lap, steel_ribbed, steel_board_batten, aluminum.' },
        window_count: { type: 'number', description: 'Windows to cap or replace (residential reroof only counts capping).' },
        door_count: { type: 'number', description: 'Doors to cap.' },
        custom_prices: { type: 'object', description: 'Override engine output: {gold:N, platinum:N, diamond:N} or {standard:N, enhanced:N, premium:N} for metal. Skips multiplier.', properties: { gold: { type: 'number' }, platinum: { type: 'number' }, diamond: { type: 'number' }, standard: { type: 'number' }, enhanced: { type: 'number' }, premium: { type: 'number' } } },
        selected_package: { type: 'string', enum: ['gold', 'platinum', 'diamond'], description: 'Recommended tier. Default: platinum.' },
        notes: { type: 'string', description: 'Internal notes — skylight scope, concerns, custom adders, etc.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Estimate tags e.g. ["canvassing", "riverview", "source:facebook-ad"]' }
      },
      required: ['customer_name', 'customer_address', 'square_feet', 'pitch']
    }
  },
  {
    name: 'run_briefing',
    description: 'Generate an executive briefing by running Vegeta + Piccolo + Krillin in parallel. Returns pipeline health, crew status, comms summary, and prioritized action items.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['morning', 'evening'], description: 'Briefing type (default: morning)' }
      }
    }
  },

  // ── GMAIL TOOLS ──
  {
    name: 'search_gmail',
    description: 'Search Gmail for emails. Use Gmail search syntax: from:, to:, subject:, is:unread, has:attachment, after:YYYY/M/D, before:YYYY/M/D, label:, OR, -keyword. Returns subject, from, date, snippet for each result.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:darcy is:unread", "subject:roof quote after:2026/4/1")' },
        maxResults: { type: 'number', description: 'Max results to return (default 10, max 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_email',
    description: 'Read the full content of a specific email by message ID (returns body text), or get all messages in a thread by thread ID (returns snippets). Use search_gmail first to find the message/thread ID.',
    input_schema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message ID to read full body' },
        threadId: { type: 'string', description: 'Gmail thread ID to read all messages in the conversation' }
      }
    }
  },
  {
    name: 'draft_email',
    description: 'Create a Gmail draft. Does NOT send — saves to Mackenzie\'s drafts folder for review. Good for composing emails he can review and send manually.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text)' },
        cc: { type: 'string', description: 'CC recipients (comma-separated emails)' },
        threadId: { type: 'string', description: 'Thread ID to reply to (continues existing conversation)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail. Routes through the approval gate — Mackenzie must confirm the approval code in chat before it sends. Use for client follow-ups, lead responses, business communication.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text)' },
        cc: { type: 'string', description: 'CC recipients (comma-separated emails)' },
        threadId: { type: 'string', description: 'Thread ID to reply to (continues existing conversation)' }
      },
      required: ['to', 'subject', 'body']
    }
  },

  // ── GOOGLE CALENDAR TOOLS ──
  {
    name: 'list_events',
    description: 'List Google Calendar events in a date range. Returns event title, start/end time, location, description. Use for checking schedule, availability, upcoming jobs.',
    input_schema: {
      type: 'object',
      properties: {
        timeMin: { type: 'string', description: 'Start of range (ISO 8601, e.g., 2026-04-07T00:00:00)' },
        timeMax: { type: 'string', description: 'End of range (ISO 8601, e.g., 2026-04-14T00:00:00)' },
        query: { type: 'string', description: 'Search text to filter events' }
      },
      required: ['timeMin', 'timeMax']
    }
  },
  {
    name: 'create_event',
    description: 'Create a Google Calendar event. Use for scheduling roof jobs, meetings, reminders, Pixel Watch pings (5 min out). Times are in Atlantic time (America/Moncton).',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        startTime: { type: 'string', description: 'Start time (ISO 8601, e.g., 2026-04-07T09:00:00)' },
        endTime: { type: 'string', description: 'End time (ISO 8601, e.g., 2026-04-07T10:00:00)' },
        description: { type: 'string', description: 'Event description/notes' },
        location: { type: 'string', description: 'Event location (address or place name)' }
      },
      required: ['summary', 'startTime', 'endTime']
    }
  },
  {
    name: 'update_event',
    description: 'Update an existing Google Calendar event. Change title, time, description, or location. Use list_events first to find the event ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Calendar event ID to update' },
        summary: { type: 'string', description: 'New event title' },
        startTime: { type: 'string', description: 'New start time (ISO 8601)' },
        endTime: { type: 'string', description: 'New end time (ISO 8601)' },
        description: { type: 'string', description: 'New description' },
        location: { type: 'string', description: 'New location' }
      },
      required: ['eventId']
    }
  },

  // ── GOOGLE DRIVE TOOLS ──
  {
    name: 'search_drive',
    description: 'Search Google Drive for files by name or content. Returns file name, type, last modified date, and link.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text to find files (searches name and content)' },
        maxResults: { type: 'number', description: 'Max results (default 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_drive_file',
    description: 'Read the content of a Google Drive file. Google Docs return plain text, Sheets return CSV data, other files return metadata with a link. Use search_drive first to find the file ID.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Google Drive file ID' }
      },
      required: ['fileId']
    }
  },

  // ── INTRO SALES PAGE TOOL ──
  {
    name: 'generate_proposal',
    description: 'Generate a Plus Ultra Roofing intro sales page for an existing estimate. This is NOT the proposal itself — it is a warm-up page that shows the client their house photo, an intro video, crew work gallery, and a CTA linking to the actual Estimator OS proposal. If Mackenzie uploads a photo or video in chat, use the attachment URLs as cover_photo_url and video_url.',
    input_schema: {
      type: 'object',
      properties: {
        estimate_id: { type: 'number', description: 'Estimator OS estimate ID' },
        custom_message: { type: 'string', description: 'Warm intro paragraph for the client (optional — personal, friendly tone)' },
        headline: { type: 'string', description: 'Hero headline (default: "Your System. Your Timeline. Your Decision.")' },
        tagline: { type: 'string', description: 'Subtitle under headline (default: "Same professional standard. Different performance levels.")' },
        cover_photo_url: { type: 'string', description: 'URL of cover photo (client house). Use attachment URL if uploaded in chat.' },
        video_url: { type: 'string', description: 'URL of intro video. Use attachment URL if uploaded in chat.' }
      },
      required: ['estimate_id']
    }
  },

  // ── QUEST TOOL (Plus Ultra HQ Quest Board) ──
  {
    name: 'create_quest',
    description: 'Create a quest on the Plus Ultra HQ **Quest Board** — the gamified card grid where Mackenzie tracks XP-rewardable internal work. This is the One True Place for CEO/internal tasks: business strategy, marketing, admin, pricing, internal processes. NOT for crew field work (use create_ticket) or client-tied sales tasks (use create_ghl_task). Quests appear immediately on the Quest Board tab at plus-ultra-hq.vercel.app. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Quest title (clear, actionable, like "Update Q2 pricing sheet")' },
        description: { type: 'string', description: 'Short quest description (1-2 sentences)' },
        category: { type: 'string', enum: ['sales', 'marketing', 'ops', 'finance', 'team', 'seo'], description: 'Quest Board category. Default: ops.' },
        priority: { type: 'string', enum: ['top', 'high', 'medium', 'low'], description: 'Priority — top/high marks it as a Priority Quest (shown in Today section). Default: medium.' },
        xp: { type: 'number', description: 'XP reward, 1-500. Default 50. Quests at 200+ XP become Legendary (gold border, top of grid).' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Optional ordered list of steps to complete the quest. Shown when the user expands the quest card. Up to 30 steps.' }
      },
      required: ['title']
    }
  },

  // ── GHL TASK TOOL ──
  {
    name: 'create_ghl_task',
    description: 'Create a SALES task on a GHL/Automator contact. Use for client follow-ups, proposal tasks, quote reminders — anything involving a specific client. Tasks are visible in the contact\'s Tasks tab. Can search by contact name (no ID needed). Assignable to Mackenzie or Darcy. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'GHL contact ID (optional if contact_name provided)' },
        contact_name: { type: 'string', description: 'Contact name — will auto-search GHL if no contact_id given' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description/notes' },
        due_date: { type: 'string', description: 'Due date in ISO 8601 format (e.g., 2026-04-10T12:00:00Z)' },
        assigned_to: { type: 'string', enum: ['mackenzie', 'darcy'], description: 'Assign to Mackenzie or Darcy' }
      },
      required: ['title']
    }
  },

  // ── INLINE APPROVAL TOOL ──
  {
    name: 'approve_action',
    description: 'Execute or cancel a SINGLE approval code. Use this when Mackenzie confirms a single action (e.g., "KRI-726 confirmed"). For batched workflows with multiple codes, use batch_approve instead.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The approval code to execute (e.g., KRI-726, VEG-342)' },
        action: { type: 'string', enum: ['approve', 'skip', 'cancel'], description: 'Whether to approve, skip/reject, or cancel the action (default: approve)' }
      },
      required: ['code']
    }
  },

  // ── BATCH APPROVAL TOOL ──
  {
    name: 'batch_approve',
    description: 'Approve multiple pending approval codes at once. Use this after presenting a batched workflow (estimate + notes + pipeline move) and Mackenzie says "yes", "go", or "do it". Executes all codes in sequence. This is the PRIMARY way to handle multi-step workflows.',
    input_schema: {
      type: 'object',
      properties: {
        codes: { type: 'array', items: { type: 'string' }, description: 'Array of approval codes to execute (e.g., ["VEG-870", "KRI-439", "VEG-240"])' }
      },
      required: ['codes']
    }
  },

  // ── PROPOSAL PAGES TOOL ──
  {
    name: 'create_proposal_pages',
    description: 'Create proposal pages in an Estimator OS workspace. Call AFTER the estimate is created and approved. Creates 1-3 pages based on scope. Valid scopes: "roof", "roof+gutters", "roof+soffit-fascia", "roof+soffit-fascia+gutters", "full-exterior". Default page titles: "Your Full Roof Replacement", "Your Full Roof Replacement Plus Gutters", "Your Full Exterior System".',
    input_schema: {
      type: 'object',
      properties: {
        estimate_id: { type: 'number', description: 'Estimator OS estimate ID' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Page label (e.g., "Your Full Roof Replacement")' },
              scope: { type: 'string', enum: ['roof', 'roof+soffit-fascia', 'roof+gutters', 'roof+soffit-fascia+gutters', 'full-exterior'], description: 'Scope determines which line items appear on the page' }
            },
            required: ['title', 'scope']
          },
          description: 'Array of proposal pages to create'
        }
      },
      required: ['estimate_id', 'pages']
    }
  },

  // ── PREFERENCE LEARNING TOOLS ──
  {
    name: 'save_preference',
    description: 'Save a behavioral preference from Mackenzie. Use when he gives feedback like "stop doing X", "always do Y", "from now on...", or confirms an approach he likes. Preferences persist across sessions and are loaded into your context automatically.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short kebab-case key for this preference (e.g., "no-approval-codes", "always-batch-confirm")' },
        rule: { type: 'string', description: 'The preference rule in plain English (e.g., "Never show approval codes to Mackenzie")' },
        type: { type: 'string', enum: ['do', 'dont', 'style', 'workflow'], description: 'Category: do=always do this, dont=never do this, style=communication preference, workflow=process preference' }
      },
      required: ['key', 'rule', 'type']
    }
  },
  {
    name: 'delete_preference',
    description: 'Remove a previously saved preference by key. Use if Mackenzie says to undo a preference or says "actually, go back to doing X".',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The preference key to remove' }
      },
      required: ['key']
    }
  },
  {
    name: 'refresh_meta_ads',
    description: 'Pull live Meta Ads data from the Graph API. Returns all campaigns (active + inactive), spend, CPL, leads, alerts, last 7 days trend, and token health. Data is also pushed to the snapshot for other agents. Use when Mackenzie asks about ad performance, spend, CPL, or campaign status.',
    input_schema: {
      type: 'object',
      properties: {
        detail: { type: 'string', description: 'Optional: pass a campaign ID to get ad set breakdown for that specific campaign' }
      }
    }
  },
  {
    name: 'audit_pixel',
    description: 'Audit Meta pixel health — returns all pixels, firing stats, diagnostics checks, custom conversions, and alerts. Use when Mackenzie asks about tracking, pixel health, conversion tracking, or why leads are not being counted.',
    input_schema: {
      type: 'object',
      properties: {
        pixelId: { type: 'string', description: 'Optional: specific pixel ID to get detailed stats for' }
      }
    }
  },
  {
    name: 'send_capi_event',
    description: 'Send a server-side conversion event to Meta via the Conversions API. Use when manually logging a conversion (e.g., "log a lead for john@example.com from the 10CM campaign"). Events are sent to the Plus Ultra Roofing Event Data pixel.',
    input_schema: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: ['pdf_download', 'lead', 'form_submission', 'inspection_booked', 'quote_request', 'opportunity_created'], description: 'Event type to send' },
        email: { type: 'string', description: 'Contact email' },
        phone: { type: 'string', description: 'Contact phone' },
        firstName: { type: 'string', description: 'Contact first name' },
        lastName: { type: 'string', description: 'Contact last name' },
        source: { type: 'string', description: 'Lead source (e.g., "10cm_v2", "website")' },
        value: { type: 'number', description: 'Monetary value of the event' }
      },
      required: ['event']
    }
  },
  {
    name: 'manage_meta_campaign',
    description: 'View detailed ad set breakdown for a Meta campaign. Use when Mackenzie asks about specific campaign performance, which ad sets are running, or wants to drill into a campaign.',
    input_schema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Meta campaign ID to inspect' }
      },
      required: ['campaignId']
    }
  },
  {
    name: 'create_workorder',
    description: 'Create a Ryujin work order for a signed/scheduled job. Use when Mackenzie says "create a work order for [customer]" or when scheduling production after a contract signs. Posts to Ryujin /api/workorders for the plus-ultra tenant. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Full customer name' },
        address: { type: 'string', description: 'Job site address' },
        phone: { type: 'string' },
        email: { type: 'string' },
        start_date: { type: 'string', description: 'Install start date YYYY-MM-DD' },
        estimated_duration_days: { type: 'number' },
        sub_crew_lead: { type: 'string', description: 'Crew lead name (Diego, AJ, Pavanjot, etc.)' },
        support_crew: { type: 'array', items: { type: 'string' }, description: 'Other crew members on the job' },
        job_type: { type: 'string', enum: ['full_replacement', 'repair', 'gutters', 'siding', 'other'], description: 'STRICT enum. Default to full_replacement for new roof installs.' },
        package_tier: { type: 'string', enum: ['gold', 'platinum', 'diamond', 'grand_manor'], description: 'STRICT enum. Lowercase only.' },
        shingle_product: { type: 'string' },
        shingle_color: { type: 'string' },
        total_sq: { type: 'number' },
        roof_pitch: { type: 'string' },
        layers_to_remove: { type: 'number' },
        eaves_lf: { type: 'number' },
        rakes_lf: { type: 'number' },
        ridges_lf: { type: 'number' },
        hips_lf: { type: 'number' },
        valleys_lf: { type: 'number' },
        walls_lf: { type: 'number' },
        pipes: { type: 'number' },
        vents: { type: 'number' },
        chimneys: { type: 'number' },
        scope_summary: { type: 'string', description: 'High-level scope description (goes to additional_scope)' },
        special_notes: { type: 'string', description: 'Special access, pets, gates, etc.' },
        linked_estimate_id: { type: 'string', description: 'Optional — Ryujin estimate UUID ONLY (not Estimator OS integer IDs). Leave null if estimate is in Estimator OS.' },
        linked_paysheet_id: { type: 'string', description: 'Optional — Ryujin paysheet UUID to link' },
        status: { type: 'string', enum: ['draft', 'issued', 'in_progress', 'complete', 'cancelled'], description: 'Default: draft' }
      },
      required: ['customer_name', 'address']
    }
  },
  {
    name: 'create_paysheet',
    description: 'Create a Ryujin pay sheet for a subcontractor on a signed job. Use after the work order is created. Posts to Ryujin /api/paysheets. Routes through approval.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job ID, format PU-YYYY-XXXX (e.g. PU-2026-0042)' },
        customer_name: { type: 'string' },
        address: { type: 'string' },
        subcontractor: { type: 'string', description: 'Atlantic Roofing, Grand Manor, etc.' },
        subcontractor_id: { type: 'string', description: 'Optional — subcontractor UUID' },
        job_type: { type: 'string', enum: ['replacement', 'new_construction', 'repair'], description: 'STRICT enum (paysheet uses different values than workorder). Use "replacement" for full reroofs.' },
        shingle_product: { type: 'string' },
        eagleview_report: { type: 'string' },
        labour_breakdown: { type: 'array', description: 'Labour line items', items: { type: 'object' } },
        add_ons: { type: 'array', description: 'Add-ons (skylights, chimneys, etc.)', items: { type: 'object' } },
        surcharges: { type: 'array', items: { type: 'object' } },
        scope_notes: { type: 'array', items: { type: 'string' } },
        line_items: { type: 'array', description: 'Generic line items (mapped to labour_breakdown if labour_breakdown not given)', items: { type: 'object' } },
        subtotal: { type: 'number' },
        hst: { type: 'number' },
        total: { type: 'number' },
        scheduled_date: { type: 'string', description: 'YYYY-MM-DD' },
        status: { type: 'string', enum: ['scheduled', 'in_progress', 'completed', 'invoice_final', 'cancelled'], description: 'Default: scheduled' },
        linked_estimate_id: { type: 'string', description: 'Optional — Ryujin estimate UUID ONLY. Leave null if estimate is in Estimator OS.' },
        notes: { type: 'string' }
      },
      required: ['job_id', 'customer_name', 'address', 'subcontractor']
    }
  },
  {
    name: 'generate_material_list',
    description: 'Generate a purchase-ready material list. Two modes: (1) pass a Ryujin estimate UUID, OR (2) FALLBACK — pass measurements + offer_slug directly. The fallback works for jobs whose estimates live in Estimator OS or anywhere outside Ryujin. ALWAYS use the fallback when the user mentions an Estimator OS estimate (#71, etc.) or when no Ryujin UUID is available. Do NOT skip this tool just because there is no Ryujin estimate.',
    input_schema: {
      type: 'object',
      properties: {
        estimate_id: { type: 'string', description: 'Ryujin estimate UUID. ONLY use if explicitly known to be a Ryujin UUID. For Estimator OS estimates, leave blank and use the fallback fields.' },
        offer_slug: { type: 'string', description: 'Offer slug — gold, platinum, diamond, grand_manor. Required when no estimate_id.' },
        measurements: {
          type: 'object',
          description: 'Measurements object. Required when no estimate_id. Standard fields: squareFeet, pitch (e.g. "10/12"), complexity (Simple/Standard/Complex), eavesLF, rakesLF, ridgesLF, hipsLF, valleysLF, wallsLF, pipes, vents, chimneys, stories, extraLayers, distanceKM.'
        },
        choices: { type: 'object', description: 'Optional choices object (siding, housewrap, etc.)' }
      }
    }
  }
];

// ═══════════════════════════════════════════
// WRITE TOOLS — Route through /api/router for approval
// ═══════════════════════════════════════════
const ROUTER_URL = 'https://shenron-app.vercel.app/api/router';

async function routeForApproval(actionType, target, summary, executePayload) {
  const resp = await fetch(ROUTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trigger: 'shenron-chat',
      action: actionType,
      target: target,
      summary: summary,
      details: JSON.stringify(executePayload),
      execute_payload: executePayload
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Router returned ${resp.status}: ${errText}`);
  }
  return await resp.json();
}

async function executeTool(name, input, attachments = []) {
  try {
    // ── WRITE OPERATIONS — route through approval system ──
    if (name === 'update_ticket') {
      const result = await routeForApproval(
        'update-ticket',
        `Ticket #${input.ticket_id}`,
        `Update ticket #${input.ticket_id}: ${Object.keys(input.updates).join(', ')}`,
        { tool: 'update_ticket', ticket_id: input.ticket_id, updates: input.updates }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Update ticket #${input.ticket_id}`,
        details: input.updates
      };
    }

    if (name === 'create_ticket') {
      const result = await routeForApproval(
        'create-ticket',
        input.title,
        `Create ticket: "${input.title}"${input.assignedTo ? ` assigned to ${input.assignedTo}` : ''}`,
        { tool: 'create_ticket', ...input }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Create ticket: ${input.title}`,
        details: input
      };
    }

    if (name === 'create_estimate') {
      // Build the FULL Estimator OS payload — matches all fields the system supports
      const estimatePayload = {
        customer: {
          fullName: input.customer_name,
          email: input.customer_email || '',
          phone: input.customer_phone || '',
          address: input.customer_address || '',
          city: input.customer_city || '',
          province: input.customer_province || 'NB',
          postalCode: input.customer_postal_code || ''
        },
        proposalMode: input.proposal_mode || 'Roof Only',
        pricingModel: input.pricing_model || 'Local',
        jobStatus: input.job_status || 'Estimate Draft',
        roofMeasurements: {
          roofAreaSq: input.roof_measurements?.roofAreaSq || 0,
          roofPitch: input.roof_measurements?.roofPitch || '',
          complexity: input.roof_measurements?.complexity || 'Standard',
          eavesLf: input.roof_measurements?.eavesLf || 0,
          rakesLf: input.roof_measurements?.rakesLf || 0,
          ridgeLf: input.roof_measurements?.ridgeLf || 0,
          hipsLf: input.roof_measurements?.hipsLf || 0,
          valleysLf: input.roof_measurements?.valleysLf || 0,
          wasteFactor: input.roof_measurements?.wasteFactor || 15,
          layersToRemove: input.roof_measurements?.layersToRemove || 1,
          distanceKm: input.roof_measurements?.distanceKm || 0,
          redeckRisk: input.roof_measurements?.redeckRisk || false,
          cedarTearOff: input.roof_measurements?.cedarTearOff || false,
          skylightCount: input.roof_measurements?.skylightCount || 0,
          chimneyType: input.roof_measurements?.chimneyType || 'None',
          chimneyCricket: input.roof_measurements?.chimneyCricket || false,
          maxVentsCount: input.roof_measurements?.maxVentsCount || 0,
          penetrationsCount: input.roof_measurements?.penetrationsCount || 0,
          pipeFLashingCount: input.roof_measurements?.pipeFLashingCount || 0,
          metalLaborRate: input.roof_measurements?.metalLaborRate || 0,
          metalPanelRate: input.roof_measurements?.metalPanelRate || 0,
          metalPanelStyle: input.roof_measurements?.metalPanelStyle || ''
        },
        exteriorMeasurements: input.exterior_measurements ? {
          fasciaLf: input.exterior_measurements.fasciaLf || 0,
          soffitLf: input.exterior_measurements.soffitLf || 0,
          gutterLf: input.exterior_measurements.gutterLf || 0,
          downspoutCount: input.exterior_measurements.downspoutCount || 0,
          sidingAreaSqft: input.exterior_measurements.sidingAreaSqft || 0,
          sidingMaterial: input.exterior_measurements.sidingMaterial || ''
        } : { fasciaLf: 0, soffitLf: 0, gutterLf: 0, downspoutCount: 0, sidingAreaSqft: 0, sidingMaterial: '' },
        proposalControls: input.proposal_controls || {},
        salesOwner: input.sales_owner || 'Mackenzie Mazerolle',
        notes: input.notes ? [{ text: input.notes, date: new Date().toISOString(), author: 'Shenron' }] : []
      };

      // Route through approval
      const result = await routeForApproval(
        'create-estimate',
        input.customer_name,
        `Create estimate for ${input.customer_name}: ${input.proposal_mode || 'Roof Only'}${input.pricing?.totalWithTax ? ` — $${input.pricing.totalWithTax}` : ''}`,
        { tool: 'create_estimate', payload: estimatePayload }
      );

      // Log to ops
      await logOperation('create_estimate', {
        client: input.customer_name,
        address: input.customer_address,
        package: input.selected_package || 'Gold',
        total: input.pricing?.totalWithTax
      }, { approval_code: result.code }, 'pending_approval', `New estimate for ${input.customer_name}`);

      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Create estimate: ${input.customer_name} — ${input.proposal_mode || 'Roof Only'}`,
        details: {
          customer: input.customer_name,
          address: input.customer_address,
          package: input.selected_package || 'Gold',
          pricing: input.pricing,
          notes: input.notes
        }
      };
    }

    if (name === 'update_estimate') {
      const result = await routeForApproval(
        'update-estimate',
        `Estimate #${input.estimate_id}`,
        `Update estimate #${input.estimate_id}: ${Object.keys(input.updates).join(', ')}`,
        { tool: 'update_estimate', estimate_id: input.estimate_id, updates: input.updates }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Update estimate #${input.estimate_id}`,
        details: input.updates
      };
    }

    // ── READ OPERATIONS — execute directly ──
    if (name === 'get_contact_detail') {
      const params = new URLSearchParams({ mode: 'contact-detail' });
      if (input.id) params.set('id', input.id);
      if (input.query) params.set('q', input.query);
      const url = `https://shenron-app.vercel.app/api/ghl?${params}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Contact detail returned ${resp.status}`);
      const data = await resp.json();
      const str = JSON.stringify(data);
      return str.length > 12000 ? { _truncated: true, data: str.substring(0, 12000) + '...' } : data;
    }

    if (name === 'lookup_data') {
      let url;
      const q = input.query ? `&q=${encodeURIComponent(input.query)}` : '';
      if (input.source === 'crm' || input.source === 'pipeline' || input.source === 'conversations' || input.source === 'tasks') {
        const mode = input.source === 'crm' ? 'contacts' : input.source;
        // Support drill-down by ID
        const idParam = input.id ? `&id=${encodeURIComponent(input.id)}` : '';
        const contactIdParam = input.contactId ? `&contactId=${encodeURIComponent(input.contactId)}` : '';
        url = `https://shenron-app.vercel.app/api/ghl?mode=${mode}${q}${idParam}${contactIdParam}`;
      } else if (input.mode === 'stats') {
        url = `https://shenron-app.vercel.app/api/lookup?mode=stats`;
      } else {
        const sourceParam = input.source !== 'all' ? `&source=${input.source}` : '';
        url = `https://shenron-app.vercel.app/api/lookup?x=1${sourceParam}${q}`;
      }
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Lookup returned ${resp.status}`);
      const data = await resp.json();
      // Truncate large responses to avoid token overflow
      const str = JSON.stringify(data);
      return str.length > 8000 ? { _truncated: true, data: str.substring(0, 8000) + '...' } : data;
    }

    if (name === 'add_contact_note') {
      const result = await routeForApproval(
        'add-contact-note',
        `Contact ${input.contactId}`,
        `Add note to CRM contact: "${(input.note || '').substring(0, 80)}"`,
        { contactId: input.contactId, noteText: input.note }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: 'Add contact note',
        details: { contactId: input.contactId, notePreview: (input.note || '').substring(0, 100) }
      };
    }

    if (name === 'delete_contact_note') {
      const result = await routeForApproval(
        'delete-record',
        `Note ${input.noteId}`,
        `Delete note from CRM contact ${input.contactId}`,
        { tool: 'delete_contact_note', contactId: input.contactId, noteId: input.noteId }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: 'Delete contact note',
        details: { contactId: input.contactId, noteId: input.noteId }
      };
    }

    if (name === 'create_contact') {
      const result = await routeForApproval(
        'create-contact',
        `${input.firstName} ${input.lastName || ''}`.trim(),
        `Create CRM contact: ${input.firstName} ${input.lastName || ''} ${input.email ? `(${input.email})` : ''} ${input.phone || ''}`.trim(),
        { tool: 'create_contact', ...input }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Create contact: ${input.firstName} ${input.lastName || ''}`,
        details: input
      };
    }

    if (name === 'update_contact') {
      const result = await routeForApproval(
        'update-crm',
        `Contact ${input.contactId}`,
        `Update contact ${input.contactId}: ${Object.keys(input.updates).join(', ')}`,
        { tool: 'update_contact', contactId: input.contactId, updates: input.updates }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Update contact ${input.contactId}`,
        details: input.updates
      };
    }

    if (name === 'create_opportunity') {
      const result = await routeForApproval(
        'create-opportunity',
        input.name,
        `Create opportunity: "${input.name}" — $${input.monetaryValue || 0} in pipeline`,
        { tool: 'create_opportunity', ...input }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Create opportunity: ${input.name}`,
        details: input
      };
    }

    if (name === 'move_pipeline') {
      const result = await routeForApproval(
        'move-pipeline',
        `Opportunity ${input.opportunityId}`,
        `Move opportunity ${input.opportunityId} to stage ${input.pipelineStageId}${input.status ? ` (${input.status})` : ''}`,
        { tool: 'move_pipeline', opportunityId: input.opportunityId, pipelineStageId: input.pipelineStageId, pipelineId: input.pipelineId, status: input.status }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Move opportunity to new stage`,
        details: { opportunityId: input.opportunityId, targetStage: input.pipelineStageId }
      };
    }

    if (name === 'delete_opportunity') {
      const result = await routeForApproval(
        'delete-record',
        `Opportunity ${input.opportunityId}`,
        `Delete opportunity ${input.opportunityId}${input.reason ? `: ${input.reason}` : ''}`,
        { tool: 'delete_opportunity', opportunityId: input.opportunityId, reason: input.reason }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Delete opportunity ${input.opportunityId}`,
        details: { reason: input.reason }
      };
    }

    // ── FULL ESTIMATE CHAIN (BATCHED — ONE CONFIRMATION) ──
    if (name === 'create_full_estimate') {
      const results = { steps: [], errors: [], approval_codes: [] };

      // Step 1: Calculate quote with Vegeta's engine
      try {
        const quoteResp = await fetch('https://shenron-app.vercel.app/api/agents/vegeta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'quote',
            spec: {
              squareFeet: input.square_feet,
              pitch: input.pitch,
              complexity: input.complexity || 'medium',
              newConstruction: input.new_construction || false,
              extraLayers: input.extra_layers || 0,
              cedarTearoff: input.cedar_tearoff || false,
              redeckSheets: input.redeck_sheets || 0,
              chimneys: input.chimneys || 0,
              chimneySize: input.chimney_size || 'small',
              cricket: input.chimney_cricket || false,
              vents: input.vents || 0,
              eavesLF: input.eaves_lf || 0,
              rakesLF: input.rakes_lf || 0,
              ridgesLF: input.ridges_lf || 0,
              valleysLF: input.valleys_lf || 0,
              wallsLF: input.walls_lf || 0,
              pipes: input.pipes || 0,
              distanceKM: input.distance_km || 0,
              stories: input.stories || 1
            }
          })
        });
        if (!quoteResp.ok) throw new Error(`Quote engine returned ${quoteResp.status}`);
        const quoteData = await quoteResp.json();
        const quote = quoteData.data;
        results.quote = quote;
        results.steps.push('Quote calculated (Vegeta engine)');

        // Step 2: Create estimate in Estimator OS (via approval gate)
        const selectedPkg = (input.package || 'Gold').toLowerCase();
        const pkgPricing = quote.packages?.[selectedPkg];

        // Build notes array — include risk flagging
        const notesArray = [];
        if (input.notes) notesArray.push({ text: input.notes, date: new Date().toISOString(), author: 'Shenron' });
        if (input.redeck_risk || input.multi_layer_risk) {
          notesArray.push({ text: 'Roof at risk of multiple layers — estimate does not include extra tear-off. Will confirm on-site.', date: new Date().toISOString(), author: 'Shenron' });
        }

        const estimateResult = await routeForApproval(
          'create-estimate',
          input.customer_name,
          `Create estimate for ${input.customer_name}: ${input.proposal_mode || 'Roof Only'} — $${pkgPricing?.totalWithTax || 'TBD'}`,
          {
            tool: 'create_estimate',
            payload: {
              customer: {
                fullName: input.customer_name,
                email: input.customer_email || null,
                phone: input.customer_phone || null,
                address: input.address || null,
                city: input.city || null,
                province: input.province || 'NB'
              },
              proposalMode: input.proposal_mode || 'Roof Only',
              pricingModel: quote.input?.projectType === 'local' ? 'Local' : quote.input?.projectType === 'dayTrip' ? 'Out-of-Town Day Trip' : 'Extended Stay',
              roofMeasurements: {
                roofAreaSq: quote.roofMetrics?.measuredSQ,
                roofPitch: input.pitch,
                eavesLf: input.eaves_lf || 0,
                rakesLf: input.rakes_lf || 0,
                ridgeLf: input.ridges_lf || 0,
                valleysLf: input.valleys_lf || 0,
                complexity: input.complexity || 'Standard',
                wasteFactor: parseInt(quote.input?.wasteFactor) || 15,
                redeckRisk: input.redeck_risk || false,
                chimneyType: input.chimneys > 0 ? (input.chimney_size === 'large' ? 'Large' : 'Small') : 'None',
                chimneyCricket: input.chimney_cricket || false,
                extraLayers: input.extra_layers || 0,
                cedarTearoff: input.cedar_tearoff || false,
                redeckSheets: input.redeck_sheets || 0,
                vents: input.vents || 0
              },
              selectedPackage: input.package || 'Gold',
              pricing: pkgPricing ? {
                hardCost: pkgPricing.hardCost,
                sellingPrice: pkgPricing.sellingPrice,
                hst: pkgPricing.hst,
                totalWithTax: pkgPricing.totalWithTax
              } : null,
              salesOwner: input.sales_owner || 'Mackenzie',
              proposalControls: input.proposal_controls || {},
              notes: notesArray
            }
          }
        );
        results.approval_codes.push({ code: estimateResult.code, action: `Create estimate: ${input.customer_name} — ${input.proposal_mode || 'Roof Only'}` });
        results.steps.push(`Estimate queued (${estimateResult.code})`);

        // Step 3: Queue GHL contact note (if contact ID provided)
        if (input.ghl_contact_id) {
          try {
            const noteLines = [
              `Quote Sent — ${input.address || input.customer_name}`,
              `Package: ${input.package || 'Gold'} — $${pkgPricing?.totalWithTax || 'TBD'}`,
              `Scope: ${input.proposal_mode || 'Roof Only'} — ${quote.roofMetrics?.measuredSQ} SQ at ${input.pitch}`
            ];
            if (input.redeck_risk || input.multi_layer_risk) {
              noteLines.push('⚠️ Redeck/multi-layer risk — estimate does not include extra tear-off. Confirm on-site.');
            }
            if (input.notes) noteLines.push(`Notes: ${input.notes}`);

            const noteResult = await routeForApproval(
              'add-contact-note',
              `Contact ${input.ghl_contact_id}`,
              `Add estimate note to CRM: ${input.customer_name}`,
              { contactId: input.ghl_contact_id, noteText: noteLines.join('\n') }
            );
            results.approval_codes.push({ code: noteResult.code, action: `Log job details to CRM` });
            results.steps.push(`CRM note queued (${noteResult.code})`);
          } catch (ghlErr) {
            results.errors.push(`GHL note routing failed: ${ghlErr.message}`);
          }
        }

        // Step 4: Queue pipeline move (if opportunity ID provided)
        if (input.opportunity_id) {
          try {
            const moveResult = await routeForApproval(
              'move-pipeline',
              `Opportunity ${input.opportunity_id}`,
              `Move ${input.customer_name} to Quote Sent`,
              {
                tool: 'move_pipeline',
                opportunityId: input.opportunity_id,
                pipelineStageId: '61e0e9b8-a2c7-45dd-b9dd-16f238b54cbd',
                pipelineId: input.pipeline_id || 'jTAc7D9RMHBb3Gzb5bQz'
              }
            );
            results.approval_codes.push({ code: moveResult.code, action: `Move to Quote Sent` });
            results.steps.push(`Pipeline move queued (${moveResult.code})`);
          } catch (moveErr) {
            results.errors.push(`Pipeline move routing failed: ${moveErr.message}`);
          }
        }

        // Step 5: Generate proposal sales page (read-only — no approval needed)
        try {
          const proposalData = {
            estimate_id: input.estimate_id || 'pending',
            estimateId: `Pending (${estimateResult.code})`,
            customer: {
              fullName: input.customer_name,
              email: input.customer_email,
              address: input.address,
              city: input.city,
              province: input.province || 'NB'
            },
            roofSpecs: { roofAreaSq: quote.roofMetrics?.measuredSQ, pitch: input.pitch, complexity: input.complexity },
            pricing: quote.packages,
            proposalMode: input.proposal_mode || 'Roof Only',
            customMessage: input.custom_message || '',
            coverPhotoUrl: input.cover_photo_url || (attachments.find(a => a.mimeType && a.mimeType.startsWith('image/'))?.url) || '',
            videoUrl: input.video_url || ''
          };
          const propResp = await fetch('https://shenron-app.vercel.app/api/proposal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proposalData)
          });
          if (propResp.ok) {
            const propResult = await propResp.json();
            results.proposal = propResult;
            results.steps.push(`Sales page created: ${propResult.proposalUrl}`);
          } else {
            results.proposal = { skipped: true, reason: `HTTP ${propResp.status}` };
            results.steps.push(`Sales page skipped: HTTP ${propResp.status}`);
          }
        } catch (propErr) {
          results.proposal = { skipped: true, reason: propErr.message };
          results.steps.push(`Sales page skipped: ${propErr.message}`);
        }

        // Step 6: Log to ops
        await logOperation('create_full_estimate', {
          client: input.customer_name,
          address: input.address,
          package: input.package || 'Gold',
          total: pkgPricing?.totalWithTax,
          measuredSQ: quote.roofMetrics?.measuredSQ
        }, {
          approval_codes: results.approval_codes.map(a => a.code),
          proposal_url: results.proposal?.proposalUrl || null
        }, 'success', `Full estimate chain for ${input.customer_name}`);
        results.steps.push('Operation logged');

      } catch (e) {
        results.errors.push(e.message);
      }

      return {
        status: 'pending_batch_approval',
        customer: input.customer_name,
        steps_completed: results.steps,
        quote_summary: results.quote ? {
          measuredSQ: results.quote.roofMetrics?.measuredSQ,
          workdays: results.quote.roofMetrics?.workdays,
          gold: results.quote.packages?.gold ? { selling: results.quote.packages.gold.sellingPrice, total: results.quote.packages.gold.totalWithTax } : null,
          platinum: results.quote.packages?.platinum ? { selling: results.quote.packages.platinum.sellingPrice, total: results.quote.packages.platinum.totalWithTax } : null,
          diamond: results.quote.packages?.diamond ? { selling: results.quote.packages.diamond.sellingPrice, total: results.quote.packages.diamond.totalWithTax } : null
        } : null,
        approval_codes: results.approval_codes,
        all_codes: results.approval_codes.map(a => a.code),
        proposal_url: results.proposal?.proposalUrl || null,
        edit_url: results.proposal?.proposalUrl ? `${results.proposal.proposalUrl}&edit=1` : null,
        batch_message: `${results.approval_codes.length} actions ready — use batch_approve with codes [${results.approval_codes.map(a => `"${a.code}"`).join(', ')}] when Mackenzie says "yes"`,
        errors: results.errors
      };
    }

    // ── INTRO SALES PAGE GENERATION ──
    if (name === 'generate_proposal') {
      try {
        // Fetch the estimate to get customer info and share link
        const estResp = await fetch(`${ESTIMATOR_URL}/estimates/${input.estimate_id}`, {
          headers: { 'x-api-key': ESTIMATOR_KEY }
        });
        if (!estResp.ok) {
          return { error: `Estimate #${input.estimate_id} not found (HTTP ${estResp.status})` };
        }
        const estimate = await estResp.json();
        const customer = estimate.customer || {};

        // Auto-publish if not already published
        if (!estimate.shareToken) {
          try {
            const pubResp = await fetch(`${ESTIMATOR_URL}/estimates/${input.estimate_id}/publish`, {
              method: 'POST',
              headers: { 'x-api-key': ESTIMATOR_KEY, 'Content-Type': 'application/json' },
              body: '{}'
            });
            if (pubResp.ok) {
              const pubData = await pubResp.json();
              estimate.shareToken = pubData.shareToken;
            }
          } catch (e) { /* publish failed — proceed without */ }
        }

        // Pull cover photo — priority: explicit input > chat attachment > Estimator OS
        const photos = estimate.photos || [];
        const coverFromEstimate = photos.find(ph => ph.isCover);
        const imageAttachment = attachments.find(a => a.mimeType && a.mimeType.startsWith('image/'));
        const coverPhotoUrl = input.cover_photo_url
          || (imageAttachment ? imageAttachment.url : '')
          || (coverFromEstimate ? `${ESTIMATOR_URL}${coverFromEstimate.url}` : '');

        // Build sales page data — no pricing, this is just the warm-up
        const salesPageData = {
          estimate_id: input.estimate_id,
          customer: {
            fullName: customer.fullName,
            address: customer.address,
            city: customer.city,
            province: customer.province || 'NB'
          },
          salesOwner: estimate.salesOwner || '',
          headline: input.headline || 'Your System. Your Timeline. Your Decision.',
          tagline: input.tagline || 'Same professional standard. Different performance levels.',
          customMessage: input.custom_message || '',
          coverPhotoUrl,
          videoUrl: input.video_url || '',
          estimatorUrl: estimate.shareToken ? `https://estimator-os.replit.app/p/${estimate.shareToken}` : ''
        };

        const saveResp = await fetch('https://shenron-app.vercel.app/api/proposal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(salesPageData)
        });

        if (!saveResp.ok) {
          const errText = await saveResp.text();
          return { error: `Failed to save sales page: ${errText}` };
        }

        const result = await saveResp.json();
        const editUrl = `${result.proposalUrl}&edit=1`;
        return {
          status: 'complete',
          salesPageUrl: result.proposalUrl,
          editUrl: editUrl,
          estimate_id: input.estimate_id,
          customer: customer.fullName,
          hasPhoto: !!coverPhotoUrl,
          hasVideo: !!input.video_url,
          message: `Sales page created for ${customer.fullName}: ${result.proposalUrl}\nEdit mode (upload photos/video): ${editUrl}`
        };
      } catch (e) {
        return { error: `Sales page generation failed: ${e.message}` };
      }
    }

    // ── RYUJIN PROPOSAL (native — not Estimator OS) ──
    if (name === 'create_ryujin_proposal') {
      try {
        const RYUJIN_BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
        const TENANT = 'plus-ultra';
        const headers = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT };

        // 1. Compare quote across Gold / Platinum / Diamond
        // Pricing model derives from distance: <=20km local, <=60km dayTrip, else extendedStay
        const distKM = Number(input.distance_km) || 0;
        const pricingModel = distKM <= 20 ? 'Local' : distKM <= 60 ? 'Day Trip' : 'Extended Stay';

        const measurements = {
          squareFeet: Number(input.square_feet) || 0,
          pitch: String(input.pitch || '5/12'),
          complexity: input.complexity || 'medium',
          eavesLF: Number(input.eaves_lf) || 0,
          rakesLF: Number(input.rakes_lf) || 0,
          ridgesLF: Number(input.ridges_lf) || 0,
          valleysLF: Number(input.valleys_lf) || 0,
          hipsLF: Number(input.hips_lf) || 0,
          wallsLF: Number(input.walls_lf) || 0,
          pipes: Number(input.pipes) || 0,
          vents: Number(input.vents) || 0,
          chimneys: Number(input.chimneys) || 0,
          chimneySize: input.chimney_size || 'small',
          cricket: !!input.chimney_cricket,
          stories: Number(input.stories) || 1,
          extraLayers: Number(input.extra_layers) || 0,
          cedarTearoff: !!input.cedar_tearoff,
          redeckSheets: Number(input.redeck_sheets) || 0,
          distanceKM: distKM,
          // Exterior + upgrades (engine includes when LF > 0 or required:true in scope)
          soffitLF: Number(input.soffit_lf) || 0,
          fasciaLF: Number(input.fascia_lf) || 0,
          gutterLF: Number(input.gutter_lf) || 0,
          leafGuard: !!input.leaf_guard,
          wallSqFt: Number(input.wall_sqft) || 0,
          windowCount: Number(input.window_count) || 0,
          doorCount: Number(input.door_count) || 0
        };
        const choices = input.siding_choice ? { siding: input.siding_choice } : {};

        const qResp = await fetch(`${RYUJIN_BASE}/api/quote?mode=compare&tenant=${TENANT}`, {
          method: 'POST', headers, body: JSON.stringify({ measurements, choices })
        });
        if (!qResp.ok) return { error: `Quote engine failed (HTTP ${qResp.status}): ${(await qResp.text()).slice(0, 200)}` };
        const compare = await qResp.json();

        // Shape only the active residential tiers the proposal page expects
        const shaped = {};
        for (const slug of ['gold', 'platinum', 'diamond']) {
          if (!compare.offers?.[slug]) continue;
          const s = compare.offers[slug].summary;
          // Apply custom price override if provided
          const cp = input.custom_prices && input.custom_prices[slug];
          const total = (typeof cp === 'number' && cp > 0) ? cp : s.sellingPrice;
          const taxRate = s.taxLabel === 'GST' ? 0.05 : 0.15;
          const totalWithTax = (typeof cp === 'number' && cp > 0) ? Math.round(total * (1 + taxRate)) : s.totalWithTax;
          shaped[slug] = {
            total,
            totalWithTax,
            persq: s.pricePerSQ,
            tax: Math.round(total * taxRate),
            margin: s.netMargin,
            customPrice: typeof cp === 'number' && cp > 0,
            lineItems: compare.offers[slug].lineItems
          };
        }

        // 2. Create the estimate
        const selected = input.selected_package || 'platinum';
        const tagList = Array.from(new Set([
          `sales_owner:${input.sales_owner || 'darcy'}`,
          ...(Array.isArray(input.tags) ? input.tags : [])
        ]));
        const createBody = {
          customer: {
            full_name: input.customer_name,
            phone: input.customer_phone || '',
            email: input.customer_email || '',
            address: input.customer_address,
            city: input.customer_city || 'Riverview',
            province: input.customer_province || 'NB'
          },
          proposal_mode: 'Roof Only',
          pricing_model: pricingModel,
          roof_area_sqft: measurements.squareFeet,
          roof_pitch: measurements.pitch,
          complexity: measurements.complexity,
          eaves_lf: measurements.eavesLF,
          rakes_lf: measurements.rakesLF,
          ridges_lf: measurements.ridgesLF,
          valleys_lf: measurements.valleysLF,
          hips_lf: measurements.hipsLF,
          walls_lf: measurements.wallsLF,
          pipes: measurements.pipes,
          vents: measurements.vents,
          chimneys: measurements.chimneys,
          chimney_size: measurements.chimneySize,
          chimney_cricket: measurements.cricket,
          stories: measurements.stories,
          extra_layers: measurements.extraLayers,
          cedar_tearoff: measurements.cedarTearoff,
          redeck_sheets: measurements.redeckSheets,
          distance_km: measurements.distanceKM,
          soffit_lf: measurements.soffitLF,
          fascia_lf: measurements.fasciaLF,
          gutter_lf: measurements.gutterLF,
          window_count: measurements.windowCount,
          door_count: measurements.doorCount,
          siding_sqft: measurements.wallSqFt,
          custom_prices: input.custom_prices || {},
          calculated_packages: shaped,
          selected_package: selected,
          status: 'draft',
          tags: tagList,
          ghl_opportunity_id: input.ghl_contact_id ? undefined : undefined,
          notes: input.notes ? [{ author: 'shenron', timestamp: new Date().toISOString().slice(0, 10), note: input.notes }] : []
        };
        const cResp = await fetch(`${RYUJIN_BASE}/api/estimates?tenant=${TENANT}`, {
          method: 'POST', headers, body: JSON.stringify(createBody)
        });
        if (!cResp.ok) return { error: `Estimate create failed (HTTP ${cResp.status}): ${(await cResp.text()).slice(0, 200)}` };
        const est = await cResp.json();

        // 3. Fire-and-forget logging
        logOperation('create_ryujin_proposal', { customer: input.customer_name, address: input.customer_address, tier: selected }, { estimate_id: est.id, share_token: est.share_token }, 'ok', null).catch(() => {});

        const shareUrl = `${RYUJIN_BASE}/proposal-client.html?share=${est.share_token}`;
        const adminUrl = `${RYUJIN_BASE}/sales-proposal.html?id=${est.id}`;
        return {
          status: 'complete',
          estimate_id: est.id,
          share_token: est.share_token,
          share_url: shareUrl,
          admin_url: adminUrl,
          rep: input.sales_owner || 'darcy',
          tiers: {
            gold: shaped.gold ? { price: shaped.gold.total, persq: shaped.gold.persq } : null,
            platinum: shaped.platinum ? { price: shaped.platinum.total, persq: shaped.platinum.persq } : null,
            diamond: shaped.diamond ? { price: shaped.diamond.total, persq: shaped.diamond.persq } : null
          },
          recommended: selected,
          message: `Proposal created for ${input.customer_name} at ${input.customer_address}. Platinum $${(shaped.platinum?.total || 0).toLocaleString()}. Share URL: ${shareUrl}. Upload cover / before / after photos via admin UI or /api/estimate-photos to complete the proposal.`
        };
      } catch (e) {
        return { error: `create_ryujin_proposal failed: ${e.message}` };
      }
    }

    // ── QUEST CREATION (Plus Ultra HQ Quest Board) ──
    if (name === 'create_quest') {
      const result = await routeForApproval(
        'create-quest',
        'Plus Ultra HQ Quest Board',
        `Create Quest Board card: "${input.title}"${input.category ? ` [${input.category}]` : ''}${input.xp ? ` ${input.xp}XP` : ''}`,
        {
          tool: 'create_quest',
          title: input.title,
          description: input.description || '',
          category: input.category || 'ops',
          priority: input.priority || 'medium',
          xp: input.xp || 50,
          steps: Array.isArray(input.steps) ? input.steps : null
        }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Create Quest Board card: "${input.title}"`,
        details: { category: input.category, xp: input.xp, priority: input.priority, visibleIn: 'https://plus-ultra-hq.vercel.app (Quest Board tab)' }
      };
    }

    // ── GHL TASK CREATION ──
    if (name === 'create_ghl_task') {
      // Resolve contact by name if no ID given
      let contactId = input.contact_id;
      let contactName = input.contact_name;
      if (!contactId && contactName) {
        try {
          const searchResp = await fetch(`https://shenron-app.vercel.app/api/ghl?mode=contacts&q=${encodeURIComponent(contactName)}&limit=1`);
          const searchData = await searchResp.json();
          const found = (searchData.contacts || [])[0];
          if (found) {
            contactId = found.id;
            contactName = found.name || contactName;
          }
        } catch (e) { /* fall through */ }
      }
      // Fallback to Mackenzie's contact if no contact found
      if (!contactId) contactId = '02IhxZfSwZZAZ2fooVGu';

      const result = await routeForApproval(
        'create-ghl-task',
        contactName || contactId,
        `Create task "${input.title}" on ${contactName || contactId}${input.assigned_to ? ` (assigned to ${input.assigned_to})` : ''}`,
        {
          tool: 'create_ghl_task',
          contact_id: contactId,
          title: input.title,
          description: input.description || '',
          due_date: input.due_date || null,
          assigned_to: input.assigned_to || null
        }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Create task: "${input.title}" on ${contactName || 'contact'}`,
        details: { contact_id: contactId, assigned_to: input.assigned_to }
      };
    }

    // ── INLINE APPROVAL EXECUTION ──
    if (name === 'approve_action') {
      const approveUrl = 'https://shenron-app.vercel.app/api/approve';
      const resp = await fetch(approveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: input.code,
          response: input.action || 'approve',
          source: 'shenron-chat'
        })
      });
      const result = await resp.json();
      if (!resp.ok) {
        return { error: result.error || `Approval failed (HTTP ${resp.status})`, code: input.code };
      }
      return {
        status: result.status,
        code: input.code,
        execution: result.execution,
        message: result.execution?.executed
          ? `${result.execution.details}`
          : result.execution?.details || result.message || 'Action processed'
      };
    }

    // ── BATCH APPROVAL EXECUTION ──
    if (name === 'batch_approve') {
      const results = [];
      for (const code of (input.codes || [])) {
        try {
          const resp = await fetch('https://shenron-app.vercel.app/api/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, response: 'approve', source: 'shenron-chat-batch' })
          });
          const result = await resp.json();
          results.push({
            code,
            status: resp.ok ? (result.execution?.executed ? 'executed' : result.status) : 'error',
            details: result.execution?.details || result.message || result.error || 'processed'
          });
        } catch (e) {
          results.push({ code, status: 'error', details: e.message });
        }
      }
      const executed = results.filter(r => r.status === 'executed').length;
      const failed = results.filter(r => r.status === 'error').length;
      return {
        status: failed === 0 ? 'all_executed' : `${executed}/${results.length} executed`,
        results,
        summary: `Executed ${executed} of ${results.length} actions${failed > 0 ? ` (${failed} failed)` : ''}`
      };
    }

    // ── PROPOSAL PAGES CREATION ──
    if (name === 'create_proposal_pages') {
      const results = [];
      for (const page of (input.pages || [])) {
        try {
          const resp = await fetch(`${ESTIMATOR_URL}/estimates/${input.estimate_id}/proposal-pages`, {
            method: 'POST',
            headers: { 'x-api-key': ESTIMATOR_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: page.title, scope: page.scope || 'roof' })
          });
          if (resp.ok) {
            const data = await resp.json();
            results.push({
              label: data.page?.label || page.title,
              scope: page.scope,
              status: 'created',
              id: data.page?.id,
              totalPages: data.totalPages
            });
          } else {
            const errText = await resp.text();
            results.push({ label: page.title, status: 'error', error: `HTTP ${resp.status}: ${errText}` });
          }
        } catch (e) {
          results.push({ label: page.title, status: 'error', error: e.message });
        }
      }
      const created = results.filter(r => r.status === 'created').length;
      return {
        estimate_id: input.estimate_id,
        pages_requested: input.pages.length,
        pages_created: created,
        results,
        message: created === input.pages.length
          ? `All ${created} proposal pages created`
          : `${created}/${input.pages.length} pages created`
      };
    }

    // ── MEMORY OPERATIONS ──
    if (name === 'save_session') {
      const sessionData = {
        timestamp: new Date().toISOString(),
        client_activity: input.client_activity || [],
        quotes_calculated: input.quotes_calculated || [],
        decisions_made: input.decisions_made || [],
        pending_actions: input.pending_actions || [],
        key_context: input.key_context || ''
      };
      const resp = await fetch('https://shenron-app.vercel.app/api/memory?type=session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData)
      });
      if (!resp.ok) throw new Error(`Session save failed: ${resp.status}`);
      const result = await resp.json();
      return { status: 'session_saved', key: result.key, timestamp: result.timestamp, message: 'Session summary saved to persistent memory. Next session will auto-load this context.' };
    }

    if (name === 'log_operation') {
      await logOperation(input.action, { client: input.client }, { result: input.result }, 'success', input.details);
      return { status: 'logged', action: input.action, timestamp: new Date().toISOString() };
    }

    // ── PREFERENCE LEARNING ──
    if (name === 'save_preference') {
      try {
        const resp = await fetch('https://shenron-app.vercel.app/api/memory?type=preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: input.key, rule: input.rule, type: input.type })
        });
        if (!resp.ok) throw new Error(`Save failed: ${resp.status}`);
        const result = await resp.json();
        return { status: 'saved', key: input.key, message: `Preference saved: "${input.rule}"` };
      } catch (e) {
        return { error: `Failed to save preference: ${e.message}` };
      }
    }

    if (name === 'delete_preference') {
      try {
        const resp = await fetch(`https://shenron-app.vercel.app/api/memory?type=preferences&key=${encodeURIComponent(input.key)}`, {
          method: 'DELETE'
        });
        if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
        return { status: 'deleted', key: input.key, message: `Preference "${input.key}" removed` };
      } catch (e) {
        return { error: `Failed to delete preference: ${e.message}` };
      }
    }

    // ── Z FIGHTER AGENT OPERATIONS ──
    if (name === 'run_agent') {
      const agentName = (input.agent || '').toLowerCase();
      const validAgents = ['vegeta', 'piccolo', 'krillin', 'bulma', 'gohan', 'trunks'];
      if (!validAgents.includes(agentName)) {
        return { error: `Unknown agent: ${agentName}. Available: ${validAgents.join(', ')}` };
      }

      // Vegeta quote action — POST with spec
      if (agentName === 'vegeta' && input.action === 'quote' && input.spec) {
        const resp = await fetch(`https://shenron-app.vercel.app/api/agents/vegeta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'quote', spec: input.spec })
        });
        if (!resp.ok) throw new Error(`Vegeta quote returned HTTP ${resp.status}`);
        const data = await resp.json();
        return data;
      }

      // Standard agent run
      const resp = await fetch(`https://shenron-app.vercel.app/api/agents/${agentName}`);
      if (!resp.ok) throw new Error(`Agent ${agentName} returned HTTP ${resp.status}`);
      const data = await resp.json();
      const str = JSON.stringify(data);
      return str.length > 10000 ? { _truncated: true, agent: agentName, data: str.substring(0, 10000) + '...' } : data;
    }

    if (name === 'run_briefing') {
      const briefingType = input.type || 'morning';
      const resp = await fetch(`https://shenron-app.vercel.app/api/agents/briefing?type=${briefingType}`);
      if (!resp.ok) throw new Error(`Briefing returned HTTP ${resp.status}`);
      const data = await resp.json();
      const str = JSON.stringify(data);
      return str.length > 10000 ? { _truncated: true, data: str.substring(0, 10000) + '...' } : data;
    }

    // ── GMAIL OPERATIONS ──
    if (name === 'search_gmail') {
      const results = await gmailSearch(input.query, Math.min(input.maxResults || 10, 20));
      return results;
    }

    if (name === 'read_email') {
      if (input.threadId) return await gmailReadThread(input.threadId);
      if (input.messageId) return await gmailReadMessage(input.messageId);
      return { error: 'Provide messageId or threadId' };
    }

    if (name === 'draft_email') {
      const result = await gmailDraft(input.to, input.subject, input.body, {
        cc: input.cc, threadId: input.threadId
      });
      return { status: 'draft_created', draftId: result.id, message: `Draft saved: "${input.subject}" to ${input.to}` };
    }

    if (name === 'send_email') {
      const result = await routeForApproval(
        'send-email',
        input.to,
        `Email to ${input.to}: "${input.subject}"`,
        { tool: 'send_email', via: 'gmail', to: input.to, subject: input.subject, body: input.body, cc: input.cc, threadId: input.threadId }
      );
      return {
        status: 'pending_approval',
        code: result.code,
        message: `Awaiting confirmation. Reply "${result.code} confirmed" to execute.`,
        action: `Send email: "${input.subject}" to ${input.to}`,
        details: { to: input.to, subject: input.subject, preview: input.body.substring(0, 200) }
      };
    }

    // ── GOOGLE CALENDAR OPERATIONS ──
    if (name === 'list_events') {
      const data = await calendarList(input.timeMin, input.timeMax, input.query);
      return (data.items || []).map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location || '',
        description: (e.description || '').substring(0, 200)
      }));
    }

    if (name === 'create_event') {
      const result = await calendarCreate(input.summary, input.startTime, input.endTime, {
        description: input.description, location: input.location
      });
      return { status: 'created', eventId: result.id, summary: result.summary, start: result.start?.dateTime, link: result.htmlLink };
    }

    if (name === 'update_event') {
      const { eventId, ...updates } = input;
      const result = await calendarUpdate(eventId, updates);
      return { status: 'updated', eventId: result.id, summary: result.summary, start: result.start?.dateTime };
    }

    // ── GOOGLE DRIVE OPERATIONS ──
    if (name === 'search_drive') {
      const data = await driveSearch(input.query, input.maxResults || 10);
      return (data.files || []).map(f => ({
        id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime, link: f.webViewLink
      }));
    }

    if (name === 'read_drive_file') {
      return await driveReadFile(input.fileId);
    }

    // ── META ADS OPERATIONS ──
    if (name === 'refresh_meta_ads') {
      const url = input.detail
        ? `https://shenron-app.vercel.app/api/meta-ads?detail=${input.detail}`
        : 'https://shenron-app.vercel.app/api/meta-ads';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Meta Ads API returned HTTP ${resp.status}`);
      const data = await resp.json();
      // Also pull the full snapshot metaAds for complete campaign list
      if (!input.detail) {
        const snapResp = await fetch('https://shenron-app.vercel.app/api/snapshot?_t=' + Date.now(), { cache: 'no-store' });
        if (snapResp.ok) {
          const snap = await snapResp.json();
          if (snap?.metaAds) data.fullCampaignData = snap.metaAds;
        }
      }
      const str = JSON.stringify(data);
      return str.length > 12000 ? { _truncated: true, data: str.substring(0, 12000) + '...' } : data;
    }

    if (name === 'audit_pixel') {
      const url = input.pixelId
        ? `https://shenron-app.vercel.app/api/pixel-audit?pixelId=${input.pixelId}`
        : 'https://shenron-app.vercel.app/api/pixel-audit';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Pixel Audit returned HTTP ${resp.status}`);
      const data = await resp.json();
      const str = JSON.stringify(data);
      return str.length > 10000 ? { _truncated: true, data: str.substring(0, 10000) + '...' } : data;
    }

    if (name === 'send_capi_event') {
      const resp = await fetch('https://shenron-app.vercel.app/api/capi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: input.event,
          contact: {
            email: input.email,
            phone: input.phone,
            firstName: input.firstName,
            lastName: input.lastName
          },
          source: input.source,
          value: input.value
        })
      });
      if (!resp.ok) throw new Error(`CAPI returned HTTP ${resp.status}`);
      return await resp.json();
    }

    if (name === 'manage_meta_campaign') {
      const resp = await fetch(`https://shenron-app.vercel.app/api/meta-ads?detail=${input.campaignId}`);
      if (!resp.ok) throw new Error(`Meta campaign detail returned HTTP ${resp.status}`);
      return await resp.json();
    }

    // ── PRODUCTION: WORK ORDER ──
    if (name === 'create_workorder') {
      const woRow = {
        customer_name: input.customer_name,
        address: input.address,
        phone: input.phone || null,
        email: input.email || null,
        start_date: input.start_date || null,
        estimated_duration_days: input.estimated_duration_days || null,
        sub_crew_lead: input.sub_crew_lead || null,
        support_crew: Array.isArray(input.support_crew) ? input.support_crew : null,
        job_type: input.job_type || null,
        package_tier: input.package_tier || null,
        shingle_product: input.shingle_product || null,
        shingle_color: input.shingle_color || null,
        total_sq: input.total_sq || null,
        roof_pitch: input.roof_pitch || null,
        layers_to_remove: input.layers_to_remove || null,
        eaves_lf: input.eaves_lf || null,
        rakes_lf: input.rakes_lf || null,
        ridges_lf: input.ridges_lf || null,
        hips_lf: input.hips_lf || null,
        valleys_lf: input.valleys_lf || null,
        walls_lf: input.walls_lf || null,
        pipes: input.pipes || null,
        vents: input.vents || null,
        chimneys: input.chimneys || null,
        additional_scope: input.scope_summary || null,
        special_notes: input.special_notes || null,
        linked_estimate_id: input.linked_estimate_id || null,
        linked_paysheet_id: input.linked_paysheet_id || null,
        status: input.status || 'draft'
      };
      try {
        const RYUJIN_BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
        const resp = await fetch(`${RYUJIN_BASE}/api/workorders?tenant=plus-ultra`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'plus-ultra' },
          body: JSON.stringify(woRow)
        });
        if (!resp.ok) return { error: `Work order create failed (HTTP ${resp.status}): ${(await resp.text()).slice(0, 300)}` };
        const data = await resp.json();
        return { status: 'created', workorder_id: data.id, customer: data.customer_name, address: data.address, start_date: data.start_date };
      } catch (e) {
        return { error: `create_workorder failed: ${e.message}` };
      }
    }

    // ── PRODUCTION: PAY SHEET ──
    if (name === 'create_paysheet') {
      const labour = Array.isArray(input.labour_breakdown) && input.labour_breakdown.length
        ? input.labour_breakdown
        : (Array.isArray(input.line_items) ? input.line_items : []);
      const psRow = {
        job_id: input.job_id,
        customer_name: input.customer_name,
        address: input.address,
        subcontractor: input.subcontractor,
        subcontractor_id: input.subcontractor_id || null,
        job_type: input.job_type || null,
        shingle_product: input.shingle_product || null,
        eagleview_report: input.eagleview_report || null,
        labour_breakdown: labour,
        add_ons: Array.isArray(input.add_ons) ? input.add_ons : [],
        surcharges: Array.isArray(input.surcharges) ? input.surcharges : [],
        scope_notes: Array.isArray(input.scope_notes) ? input.scope_notes : null,
        subtotal: input.subtotal || null,
        hst: input.hst || null,
        total: input.total || null,
        scheduled_date: input.scheduled_date || null,
        status: input.status || 'scheduled',
        linked_estimate_id: input.linked_estimate_id || null,
        notes: input.notes || null
      };
      try {
        const RYUJIN_BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
        const resp = await fetch(`${RYUJIN_BASE}/api/paysheets?tenant=plus-ultra`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'plus-ultra' },
          body: JSON.stringify(psRow)
        });
        if (!resp.ok) return { error: `Pay sheet create failed (HTTP ${resp.status}): ${(await resp.text()).slice(0, 300)}` };
        const data = await resp.json();
        return { status: 'created', paysheet_id: data.id, job_id: data.job_id, customer: data.customer_name, total: data.total };
      } catch (e) {
        return { error: `create_paysheet failed: ${e.message}` };
      }
    }

    // ── PRODUCTION: MATERIAL LIST ──
    if (name === 'generate_material_list') {
      try {
        const RYUJIN_BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
        const TENANT = 'plus-ultra';
        const headers = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT };

        let measurements = input.measurements || null;
        let choices = input.choices || {};
        let offerSlug = input.offer_slug || null;

        // If estimate_id provided, pull measurements + selected offer from DB
        if (input.estimate_id) {
          const estResp = await fetch(`${RYUJIN_BASE}/api/estimates?id=${input.estimate_id}&tenant=${TENANT}`, { headers });
          if (!estResp.ok) return { error: `Estimate lookup failed (HTTP ${estResp.status})` };
          const est = await estResp.json();
          measurements = measurements || {
            squareFeet: est.roof_area_sqft || 0,
            pitch: est.roof_pitch || '5/12',
            complexity: est.complexity || 'medium',
            eavesLF: est.eaves_lf || 0,
            rakesLF: est.rakes_lf || 0,
            ridgesLF: est.ridges_lf || 0,
            valleysLF: est.valleys_lf || 0,
            hipsLF: est.hips_lf || 0,
            wallsLF: est.walls_lf || 0,
            pipes: est.pipes || 0,
            vents: est.vents || 0,
            chimneys: est.chimneys || 0,
            stories: est.stories || 1,
            extraLayers: est.extra_layers || 0,
            distanceKM: est.distance_km || 0
          };
          offerSlug = offerSlug || est.selected_package || 'platinum';
        }

        if (!measurements) return { error: 'Need either estimate_id or measurements object' };

        const resp = await fetch(`${RYUJIN_BASE}/api/quote?materials=1&tenant=${TENANT}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ measurements, choices, offer_slug: offerSlug || 'platinum' })
        });
        if (!resp.ok) return { error: `Quote engine failed (HTTP ${resp.status}): ${(await resp.text()).slice(0, 200)}` };
        const data = await resp.json();
        return {
          status: 'complete',
          offer: offerSlug,
          materials: data.materialList || data.materials || data,
          summary: data.summary || null
        };
      } catch (e) {
        return { error: `generate_material_list failed: ${e.message}` };
      }
    }

    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}

// ═══════════════════════════════════════════
// STREAMING HELPER — collect full response from Claude
// ═══════════════════════════════════════════
async function callClaude(apiKey, systemPrompt, messages, useTools = true) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages
  };
  if (useTools) body.tools = TOOLS;

  // Retry with backoff for rate limits
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (response.ok) return await response.json();

    if ((response.status === 429 || response.status === 529) && attempt < 2) {
      // Rate limited or overloaded — wait and retry
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : (attempt + 1) * 5000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }

    const errBody = await response.text();
    throw new Error(`API ${response.status}: ${errBody}`);
  }
}

// Streaming version with extended thinking enabled.
// Calls onDelta(kind, text) for each thinking_delta and text_delta as they arrive,
// then returns the assembled response in the same shape as callClaude (with thinking blocks
// preserved in content so the tool loop can pass them back to subsequent turns).
async function callClaudeStream(apiKey, systemPrompt, messages, onDelta, useTools = true) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: systemPrompt,
    messages,
    stream: true,
    thinking: { type: 'enabled', budget_tokens: 3000 }
  };
  if (useTools) body.tools = TOOLS;

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    if (response.ok) break;
    if ((response.status === 429 || response.status === 529) && attempt < 2) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : (attempt + 1) * 5000;
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    const errBody = await response.text();
    throw new Error(`API ${response.status}: ${errBody}`);
  }

  // Assemble the response from the SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const blocks = []; // assembled content blocks
  let stopReason = null;
  let usage = null;
  let messageMeta = null;
  // Index → in-progress block builder
  const builders = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() || '';
    for (const ev of events) {
      const lines = ev.split('\n');
      let dataLine = null;
      for (const l of lines) if (l.startsWith('data: ')) dataLine = l.slice(6);
      if (!dataLine) continue;
      let data;
      try { data = JSON.parse(dataLine); } catch { continue; }

      if (data.type === 'message_start') {
        messageMeta = data.message;
      } else if (data.type === 'content_block_start') {
        const cb = data.content_block;
        builders[data.index] = { type: cb.type };
        if (cb.type === 'text') builders[data.index].text = '';
        if (cb.type === 'thinking') { builders[data.index].thinking = ''; builders[data.index].signature = ''; }
        if (cb.type === 'tool_use') {
          builders[data.index].id = cb.id;
          builders[data.index].name = cb.name;
          builders[data.index].input_json = '';
        }
      } else if (data.type === 'content_block_delta') {
        const b = builders[data.index];
        if (!b) continue;
        if (data.delta.type === 'text_delta') {
          b.text += data.delta.text;
          if (onDelta) onDelta('text', data.delta.text);
        } else if (data.delta.type === 'thinking_delta') {
          b.thinking += data.delta.thinking;
          if (onDelta) onDelta('thinking', data.delta.thinking);
        } else if (data.delta.type === 'signature_delta') {
          b.signature += data.delta.signature;
        } else if (data.delta.type === 'input_json_delta') {
          b.input_json += data.delta.partial_json;
        }
      } else if (data.type === 'content_block_stop') {
        const b = builders[data.index];
        if (!b) continue;
        // Finalize the block in the standard Anthropic shape
        if (b.type === 'text') {
          blocks[data.index] = { type: 'text', text: b.text };
        } else if (b.type === 'thinking') {
          blocks[data.index] = { type: 'thinking', thinking: b.thinking, signature: b.signature };
        } else if (b.type === 'tool_use') {
          let input = {};
          try { input = b.input_json ? JSON.parse(b.input_json) : {}; } catch { input = {}; }
          blocks[data.index] = { type: 'tool_use', id: b.id, name: b.name, input };
        }
        delete builders[data.index];
      } else if (data.type === 'message_delta') {
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        if (data.usage) usage = data.usage;
      } else if (data.type === 'message_stop') {
        // done
      } else if (data.type === 'error') {
        throw new Error('Anthropic stream error: ' + JSON.stringify(data.error || data));
      }
    }
  }

  return {
    id: messageMeta?.id,
    role: 'assistant',
    content: blocks.filter(Boolean),
    stop_reason: stopReason,
    usage
  };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { message, history = [], liveData, agent, attachments = [], conversation_id, quest_id } = req.body;
  if (!message && attachments.length === 0) {
    return res.status(400).json({ error: 'No message provided' });
  }

  // Agent persona overlays — when a specific Z Fighter is selected
  const AGENT_PERSONAS = {
    vegeta: `\n\n## ACTIVE PERSONA: VEGETA — Sales & Pipeline Commander
You are NOW speaking as Vegeta, Prince of all Saiyans — Mackenzie's sales and pipeline specialist.
- Personality: Proud, intense, competitive, results-obsessed. "Kakarot" references welcome. Talk about crushing targets, dominating the market, and the glory of closing deals.
- Domain: Sales pipeline, CRM opportunities, estimates, proposals, revenue, follow-ups, lead conversion, deal velocity.
- When asked about anything outside your domain (operations, marketing, game dev, security), briefly acknowledge it and say which agent handles it — but give a Vegeta-flavored opinion anyway.
- Use the snapshot's revenue, pipeline, and estimator data. Reference specific deals by name.
- Your catchphrases: "The Prince of all Saiyans doesn't leave deals on the table." "This pipeline is pathetic — let me show you how it's done."`,

    piccolo: `\n\n## ACTIVE PERSONA: PICCOLO — Operations & Crew Commander
You are NOW speaking as Piccolo, the tactical strategist — Mackenzie's operations and crew management specialist.
- Personality: Calm, disciplined, strategic, no-nonsense. Meditates on problems. Speaks with weight and precision.
- Domain: Crew tickets, job scheduling, workload balance, overdue tasks, Diego/AJ/Pavignette assignments, job site logistics, material delivery.
- Reference the snapshot's tickets, crew assignments, and active jobs. Flag overdue tickets and unbalanced workloads.
- Your catchphrases: "Discipline wins battles. Let me assess the field." "The crew needs direction, not hope."`,

    krillin: `\n\n## ACTIVE PERSONA: KRILLIN — Comms & Marketing Specialist
You are NOW speaking as Krillin, the underdog warrior — Mackenzie's communications and marketing specialist.
- Personality: Scrappy, loyal, self-aware, surprisingly insightful. Makes self-deprecating jokes but delivers solid intel. The hardest worker with the least power.
- Domain: Meta Ads performance, CPL analysis, unread messages, lead response times, website leads, Voice AI pipeline, email/SMS comms, social media, content marketing.
- Use the snapshot's metaAds section for ad performance data. Flag bleeding campaigns. Reference gmail urgents.
- Your catchphrases: "I may not be the strongest, but I'll get you the best CPL in Moncton." "Solar Flare! ...I mean, let me blind you with these marketing stats."`,

    bulma: `\n\n## ACTIVE PERSONA: BULMA — Intel & Analytics Commander
You are NOW speaking as Bulma, the genius scientist — Mackenzie's analytics, KPIs, and business intelligence specialist.
- Personality: Brilliant, confident, slightly impatient with inefficiency. Loves data, numbers, trends. Can be sassy.
- Domain: KPI dashboards, revenue trends, lead conversion rates, pipeline analytics, cross-domain data synthesis, weekly reports, business health metrics.
- Synthesize data across ALL snapshot sections — revenue, tickets, leads, CRM, Meta Ads, Gmail. Give the big picture with specific numbers.
- Your catchphrases: "I didn't build a time machine to watch you miss your KPIs." "The data doesn't lie, Mackenzie. Here's what it says."`,

    trunks: `\n\n## ACTIVE PERSONA: TRUNKS — Security & Infrastructure Commander
You are NOW speaking as Trunks, the future warrior — Mackenzie's security and infrastructure specialist.
- Personality: Serious, vigilant, forward-thinking. Came from a ruined timeline so he takes threats seriously. Protective.
- Domain: API health, Vercel app status, security vulnerabilities, deployment checks, env vars, SSL, rate limiting, credential management, Supabase security.
- Reference infrastructure status, pending deploys, security hardening tasks. Flag any risks.
- Your catchphrases: "In my timeline, we didn't catch this in time. Let's not repeat that mistake." "All systems need to be battle-ready."`,

    gohan: `\n\n## ACTIVE PERSONA: GOHAN — Game Dev & Product Commander
You are NOW speaking as Gohan, the scholar warrior — Mackenzie's game development and product specialist.
- Personality: Studious, enthusiastic about learning, protective of the game. Balances fighting spirit with academic precision. Gets excited about features.
- Domain: Aetheria game status, Supabase backend, multiplayer features, game balance, PWA performance, push notifications, Stripe payments, player analytics.
- Reference Aetheria's launch state, post-launch tasks, and any game-related items in the snapshot.
- Your catchphrases: "The game is our legacy — let's make sure it's worthy." "I've been studying the analytics, and here's what I found."`
  };

  // Build system prompt — snapshot + memory + preferences are the data sources
  const [snapshotContext, memoryContext, preferencesContext] = await Promise.all([
    fetchSnapshot(),
    fetchMemoryContext(),
    fetchPreferences()
  ]);
  let liveDataBlock = '';
  if (liveData) {
    liveDataBlock = `\n\n---\n\n# FRONTEND DATA (may overlap with snapshot)\n${liveData}`;
  }
  const agentPersona = (agent && AGENT_PERSONAS[agent]) ? AGENT_PERSONAS[agent] : '';
  const fileContext = attachments.length > 0 ? `\n\n## File Context\nMackenzie has attached ${attachments.length} file(s) to this message. Analyze them directly. For job site photos, identify roofing conditions, materials, damage, progress. For documents, extract key information and reference it. For spreadsheets/CSV, summarize the data.\n\nAttachment URLs (use these when calling tools like generate_proposal):\n${attachments.map(a => `- ${a.fileName} (${a.mimeType}): ${a.url}`).join('\n')}` : '';
  const systemPrompt = BASE_PROMPT + agentPersona + fileContext + preferencesContext + snapshotContext + memoryContext + liveDataBlock;

  // Build messages array — accept either {role, content} (Anthropic-native, used by ryujin widgets)
  // or {user, assistant} pair format (legacy, used by shenron-app/chat.html)
  const messages = [];
  history.forEach(h => {
    if (!h) return;
    if (h.role && h.content !== undefined && h.content !== null) {
      messages.push({ role: h.role, content: h.content });
    } else if (h.user || h.assistant) {
      if (h.user) messages.push({ role: 'user', content: h.user });
      if (h.assistant) messages.push({ role: 'assistant', content: h.assistant });
    }
  });

  // Build user content — plain text or multi-block with attachments
  let userContent = message || '[See attached files]';
  if (attachments.length > 0) {
    const contentBlocks = [];
    for (const att of attachments.slice(0, 3)) {
      try {
        const resp = await fetch(att.url);
        const buffer = Buffer.from(await resp.arrayBuffer());
        if (att.mimeType && att.mimeType.startsWith('image/')) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: att.mimeType, data: buffer.toString('base64') }
          });
        } else if (att.mimeType === 'application/pdf') {
          contentBlocks.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') }
          });
        } else {
          // Text-like files — inject as text block
          const text = buffer.toString('utf-8').substring(0, 10000);
          contentBlocks.push({ type: 'text', text: `[File: ${att.fileName}]\n${text}` });
        }
      } catch (e) {
        contentBlocks.push({ type: 'text', text: `[Failed to load ${att.fileName}: ${e.message}]` });
      }
    }
    contentBlocks.push({ type: 'text', text: message || 'Analyze the attached file(s).' });
    userContent = contentBlocks;
  }
  messages.push({ role: 'user', content: userContent });

  // Set SSE headers UPFRONT so we can stream tool events as they happen
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Helper to label tool calls human-readably
  function describeTool(name, input) {
    switch (name) {
      case 'lookup_data': return `🔍 Searching ${input.source}${input.query ? ` for "${input.query}"` : ''}`;
      case 'get_contact_detail': return `🔍 Looking up contact: ${input.query || input.id}`;
      case 'search_gmail': return `📧 Searching Gmail: "${input.query}"`;
      case 'read_email': return `📧 Reading email`;
      case 'list_events': return `📅 Checking calendar`;
      case 'create_event': return `📅 Creating event: "${input.summary}"`;
      case 'update_event': return `📅 Updating calendar event`;
      case 'search_drive': return `📁 Searching Drive: "${input.query}"`;
      case 'read_drive_file': return `📁 Reading file`;
      case 'batch_approve': return `✅ Approving batched actions`;
      case 'create_proposal_pages': return `📄 Creating proposal pages`;
      case 'save_preference': return `🧠 Saving preference: ${input?.rule || ''}`;
      case 'delete_preference': return `🧠 Removing preference`;
      case 'create_quest': return `📜 Creating quest: "${input.title}"`;
      case 'create_ticket': return `🎫 Creating crew ticket: "${input.title}"`;
      case 'create_workorder': return `📋 Creating work order: "${input.customer_name}"`;
      case 'create_paysheet': return `💰 Creating pay sheet: "${input.job_id}"`;
      case 'generate_material_list': return `📦 Generating material list`;
      case 'create_ghl_task': return `📌 Creating GHL task: "${input.title}"`;
      case 'add_contact_note': return `📝 Adding note to contact`;
      case 'generate_proposal': return `📄 Generating sales page`;
      default: return `⚙ ${name}`;
    }
  }
  function sse(obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }

  // Delta callback — forwards live thinking + text from Claude as SSE to the client
  const onDelta = (kind, text) => {
    if (kind === 'thinking') sse({ thinking_delta: text });
    else if (kind === 'text') sse({ text });
  };

  try {
    // Call Claude with extended thinking + streaming — tool loop
    let response = await callClaudeStream(apiKey, systemPrompt, messages, onDelta);
    let toolActions = [];

    // Tool use loop — max 5 rounds
    let rounds = 0;
    while (response.stop_reason === 'tool_use' && rounds < 5) {
      rounds++;
      // Add the FULL assistant message back into history (including thinking blocks!)
      // Anthropic requires preserving thinking blocks across tool turns when extended thinking is on.
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool call — stream "pending" before, "done" after
      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          sse({ tool_start: { id: block.id, label: describeTool(block.name, block.input) } });
          const result = await executeTool(block.name, block.input, attachments);
          toolActions.push({ tool: block.name, input: block.input, result });
          let status = 'ok';
          if (result?.error) status = 'error';
          else if (result?.status === 'pending_approval') status = 'pending_approval';
          sse({ tool_end: { id: block.id, status, error: result?.error || null, code: result?.code || null } });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      response = await callClaudeStream(apiKey, systemPrompt, messages, onDelta);
    }

    // Final text was already streamed by onDelta. Capture it for persistence.
    const textParts = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Persist conversation to hq_user_state.state.conversations (best-effort, non-blocking)
    let finalConversationId = conversation_id || null;
    try {
      finalConversationId = await persistConversation({
        conversation_id: conversation_id || null,
        quest_id: quest_id || null,
        user_message: message || '[attachments]',
        assistant_message: textParts,
        tool_actions: toolActions
      });
    } catch (e) {
      console.error('Conversation persist failed:', e.message);
    }

    sse({ done: true, conversation_id: finalConversationId });
    res.end();
  } catch (err) {
    // Headers already set above; just stream the error
    try {
      sse({ error: err.message });
      res.end();
    } catch (writeErr) {
      // If we can't even write, log and bail
      console.error('Chat error after stream start:', err.message, writeErr.message);
    }
  }
}

// Persist a single chat turn into hq_user_state.state.conversations on the HQ Supabase.
// Creates a new conversation on first turn (no conversation_id), appends on subsequent turns.
// Returns the conversation_id.
async function persistConversation({ conversation_id, quest_id, user_message, assistant_message, tool_actions }) {
  const HQ_URL = (process.env.HQ_SUPABASE_URL || '').trim();
  const HQ_KEY = (process.env.HQ_SUPABASE_SERVICE_KEY || '').trim();
  if (!HQ_URL || !HQ_KEY) return conversation_id;
  const BASE = HQ_URL.replace(/\/$/, '') + '/rest/v1';
  const H = { apikey: HQ_KEY, Authorization: 'Bearer ' + HQ_KEY, 'Content-Type': 'application/json' };
  const STATE_ID = 'mackenzie-hq';

  // Read current state
  const r = await fetch(BASE + '/hq_user_state?select=state&id=eq.' + STATE_ID, { headers: H });
  if (!r.ok) throw new Error('state read ' + r.status);
  const rows = await r.json();
  const state = (rows[0] && rows[0].state) || {};
  if (!Array.isArray(state.conversations)) state.conversations = [];

  const now = Date.now();
  const turn = {
    ts: now,
    user: user_message,
    assistant: assistant_message,
    tools: (tool_actions || []).map(t => ({ tool: t.tool, ok: !t.result?.error })),
  };

  let convId = conversation_id;
  if (convId) {
    const existing = state.conversations.find(c => c.id === convId);
    if (existing) {
      existing.messages.push(turn);
      existing.updated_at = now;
      if (quest_id && !existing.quest_id) existing.quest_id = quest_id;
    } else {
      // Unknown id — treat as new
      convId = null;
    }
  }
  if (!convId) {
    convId = 'conv_' + now + '_' + Math.random().toString(36).slice(2, 8);
    const title = (user_message || 'Conversation').slice(0, 80);
    state.conversations.push({
      id: convId,
      title,
      quest_id: quest_id || null,
      messages: [turn],
      created_at: now,
      updated_at: now,
    });
  }

  // Cap to most recent 200 conversations to keep state size bounded
  if (state.conversations.length > 200) {
    state.conversations.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    state.conversations = state.conversations.slice(0, 200);
  }

  // Write back
  const w = await fetch(BASE + '/hq_user_state?id=eq.' + STATE_ID, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ state, updated_at: new Date().toISOString() })
  });
  if (!w.ok) throw new Error('state write ' + w.status);

  return convId;
}
// deployed 1775591619
// retry 1775593324
