# Ryujin OS — AI Memory Architecture Spec

**Status:** Design spec — not yet implemented
**Author:** Mackenzie + Claude Code (Apr 17, 2026)
**Purpose:** Define the layered memory system that powers Ryujin's per-tenant AI brain

---

## Why This Matters

Generic AI chatbots give generic answers. Ryujin's AI knows each tenant's SOPs, pricing logic, client communication style, crew management patterns, and decision history. This is the product differentiator.

The memory system is what makes Ryujin's AI get smarter over time without manual maintenance.

---

## The Five Layers

### Layer 1: Platform Core (shared, read-only to tenants)
**Lifespan:** Permanent, updated by Ryujin team only
**Scope:** All tenants

What lives here:
- Industry knowledge (roofing materials, installation standards, building codes)
- Pricing formula templates (asphalt multiplier method, metal divisor method)
- Best practices (Hormozi/Martell frameworks, sales methodology)
- System prompts and AI behavior rules

**Storage:** Bundled with the platform. Not in tenant DB. Loaded into AI context as base layer.

---

### Layer 2: Tenant Knowledge (per-business, permanent)
**Lifespan:** Permanent (grows over time, rarely deleted)
**Scope:** Single tenant, all users

What lives here:
- Business identity (name, brand voice, values, service area)
- SOPs (from the existing `sops` table — already built)
- Pricing rules and overrides (package definitions, material preferences, margin targets)
- Team structure and roles
- Client communication patterns and templates
- Ingested knowledge (transcribed Loom videos, call recordings, documents)
- Learned preferences ("we always use CertainTeed not GAF", "never undercut insurance settlements")

**Storage:** New tables in Supabase, tenant-isolated with RLS:

```sql
-- Distilled knowledge entries (the AI's long-term memory)
create table tenant_knowledge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  category text not null,
  -- 'sop', 'pricing_rule', 'client_pattern', 'team_rule',
  -- 'brand_voice', 'material_pref', 'learned'
  title text not null,
  content text not null,                   -- markdown, searchable
  source text,                             -- 'loom_transcript', 'fathom_call', 'manual', 'ai_learned'
  source_id text,                          -- reference to original (loom ID, fathom recording ID)
  tags text[] default '{}',
  confidence float default 1.0,            -- 1.0 = human confirmed, 0.5 = AI inferred
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_tk_tenant on tenant_knowledge(tenant_id, category);
create index idx_tk_search on tenant_knowledge using gin(to_tsvector('english', title || ' ' || content));
```

**Ingestion pipeline (productized from Plus Ultra proof of concept):**
1. Connect video library (Loom, Fathom, YouTube) -> auto-transcribe -> distill -> index
2. Upload documents (PDFs, spreadsheets) -> extract text -> index
3. AI observes day-to-day usage -> infers patterns -> suggests knowledge entries (confidence < 1.0)
4. Human confirms/edits -> confidence becomes 1.0

---

### Layer 3: Project Context (per-job, per-client)
**Lifespan:** Duration of job + retention period
**Scope:** Single tenant, relevant users

What lives here:
- Client preferences and history ("Steve prefers video updates over email")
- Job-specific decisions ("cedar tearoff required, 2 layers existing")
- Communication log (what was said, when, outcome)
- Change orders and scope adjustments
- Photo annotations and inspection notes
- Related estimates, proposals, tickets

**Storage:** Mostly already exists across `projects`, `comments`, `activity_log`, `project_files`, `estimates`. The AI assembles project context by joining these tables. One new table for explicit AI context:

```sql
-- AI-specific project context (things the AI noticed or was told)
create table project_context (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  context_type text not null,
  -- 'client_preference', 'decision', 'risk', 'note', 'ai_observation'
  content text not null,
  created_by uuid references users(id),    -- null if AI-generated
  created_at timestamptz default now()
);

create index idx_pc_project on project_context(tenant_id, project_id);
```

---

### Layer 4: Session Memory (per-conversation)
**Lifespan:** Single conversation + short-term carryover
**Scope:** Single user session

What lives here:
- Current conversation history
- Active task state
- Handoff context (like SESSION_CONTEXT.md but per-user)
- Recent decisions not yet graduated to tenant knowledge

**Storage:** Ephemeral. In-memory during conversation, optionally persisted for handoff:

```sql
-- Session handoffs (optional persistence between conversations)
create table session_context (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  context jsonb not null,                  -- structured handoff data
  expires_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);

create index idx_sc_user on session_context(tenant_id, user_id);
```

---

### Layer 5: Live State (real-time)
**Lifespan:** Momentary (current state only)
**Scope:** Single tenant

What lives here:
- Open tickets and their status
- Today's schedule / calendar
- Active crew locations
- Pipeline state (leads, estimates, proposals)
- Weather (affects scheduling)
- Unread messages / notifications

**Storage:** No new tables needed. This is assembled in real-time from existing tables (`tickets`, `estimates`, `leads`, `time_entries`) plus external APIs (weather, calendar). Equivalent to the Shenron snapshot concept.

---

## How the AI Assembles Context

When a user asks the AI something, context is assembled bottom-up:

```
[Layer 1: Platform Core]        <- always loaded (system prompt)
  + [Layer 2: Tenant Knowledge] <- relevant entries via search
  + [Layer 3: Project Context]  <- if conversation is about a specific job
  + [Layer 4: Session Memory]   <- conversation history + handoff
  + [Layer 5: Live State]       <- current tickets, schedule, pipeline
  = Full AI context for this response
```

**Context budget:** Not everything loads every time. Use relevance scoring:
- Layer 1: Always (small, curated)
- Layer 2: Top-K entries matching the query (full-text search + category filter)
- Layer 3: Only if a project is referenced
- Layer 4: Last N messages + handoff
- Layer 5: Summary snapshot, not raw data

---

## Graduation Rules (how knowledge moves between layers)

| From | To | Trigger | Example |
|---|---|---|---|
| Session (4) | Project (3) | User confirms a project decision | "Client wants standing seam, not shingles" |
| Session (4) | Tenant (2) | Pattern repeated 3+ times or user says "always do this" | "We always include drip edge replacement" |
| Project (3) | Tenant (2) | Same decision made across 3+ projects | "Most clients prefer the Gold package" |
| AI observation | Tenant (2) | Human confirms (confidence 0.5 -> 1.0) | "You tend to add 10% to out-of-town jobs" |

---

## Decay Rules (how knowledge gets archived)

| Layer | Decay Rule |
|---|---|
| Session (4) | Auto-expire after 7 days if no handoff |
| Project (3) | Archive 90 days after project completed |
| Tenant (2) | Never auto-delete. Flag stale if not referenced in 6 months. Human review. |
| Platform (1) | Updated by Ryujin team only |

---

## Ingestion Pipeline (product feature)

This is the "connect your knowledge" onboarding flow:

### Video Library (Loom, Fathom, YouTube)
1. User connects account or pastes URLs
2. Platform fetches transcripts (Loom/Fathom native) or runs Whisper (uploaded video)
3. AI distills transcripts into knowledge entries (category, title, content, tags)
4. User reviews and confirms (or edits)
5. Entries go into `tenant_knowledge` with confidence 1.0

### Documents (PDFs, spreadsheets, manuals)
1. User uploads to project or SOP library
2. Platform extracts text
3. AI distills into searchable knowledge entries
4. Same review/confirm flow

### Ongoing Learning
1. AI observes patterns across estimates, proposals, client communication
2. Suggests new knowledge entries with confidence 0.5
3. User confirms -> 1.0, dismisses -> deleted
4. This is how the system gets smarter without manual input

---

## Database Summary (3 new tables)

| Table | Purpose | RLS |
|---|---|---|
| `tenant_knowledge` | Long-term AI memory per tenant | Yes |
| `project_context` | AI observations per project | Yes |
| `session_context` | Conversation handoffs per user | Yes |

Everything else (live state, project history, SOPs) already exists in the current schema.

---

## Implementation Priority

1. **`tenant_knowledge` table + API** — This is the foundation. Without it, the AI has no memory.
2. **Ingestion pipeline** — Video transcript -> distilled knowledge. Already proven with Plus Ultra.
3. **Context assembly** — The logic that builds the right context for each AI request.
4. **Graduation logic** — Pattern detection and knowledge promotion.
5. **Ongoing learning** — AI suggests knowledge entries from usage patterns.

---

## Reference: Plus Ultra Proof of Concept (Apr 17, 2026)

What was built and validated today:
- 229 Loom videos -> 200 transcripts fetched (205,158 words)
- 25 Fathom meetings -> distilled into workshop knowledge
- Auto-indexing pipeline that builds searchable knowledge base
- GPU-accelerated Whisper transcription as fallback (RTX 5070)
- All indexed into `Shenron/knowledge/` and accessible across Claude systems

This exact pipeline becomes the tenant onboarding experience in Ryujin OS.
