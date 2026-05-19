---
source: https://app.companycam.com
scraped_at: 2026-05-19
purpose: ryujin-rebuild-reference
scope: full UI walkthrough (Projects, Photos, Photo viewer, Checklists, Reports, Map, Team, Marketing/Suite/Reviews/Showcases, Resources/Integrations/Templates/Tags/Labels/Snippets, Settings)
scraper: cowork
workspace: Plus Ultra Roofing
related: ryujin-os/docs/ASSET_MAP.md, ryujin-os/docs/interface_bible_v0.2_addendum.md
---

# CompanyCam → Ryujin Rebuild Debrief
*Captured 2026-05-19 via UI walkthrough of Plus Ultra Roofing's CompanyCam workspace*
*For Claude Code / Ryujin engineering reference*

---

## 0. TL;DR

CompanyCam is a contractor photo-management SaaS. Plus Ultra runs an active workspace with ~30+ projects, thousands of photos, 4 active + 6 deactivated team members. Core value: **geo-tagged, timestamped photos organized by project, with team-level access control, plus surrounding workflow features (checklists, reports, marketing/portfolio, integrations).**

For Ryujin to replicate this, four entities are load-bearing: **Project, Photo, Team Member, Tag/Label**. Everything else (Reports, Checklists, Showcases, Templates, Snippets, Map) is built on top of those four.

---

## 1. Site Map / IA

```
Top-level nav (left sidebar):
├── Projects               # Main entity list
├── Photos                 # All photos across all projects
├── Checklists             # Aggregate checklist feed
├── Reports                # Generated PDF reports
├── Map                    # Geo-view of projects
├── Team                   # Users + User Groups
├── Marketing/             # Customer-facing marketing tools
│   ├── Marketing Suite    # (Coming soon — waitlist)
│   ├── Reviews            # Google Reviews integration
│   └── Showcases          # Public portfolio site
├── Resources/             # Reusable building blocks
│   ├── Integrations       # 3rd-party CRM/proposal tools
│   ├── Templates          # Project/Checklist/Report/File/Page templates
│   ├── Tags               # Photo-level tags
│   ├── Labels             # Project-level color-coded labels
│   └── Snippets           # Reusable text for reports
├── Starred Items          # Bookmarked projects
└── (Bottom): Refer/get $$$, Support, Settings
```

Top bar:
- App logo (left)
- + (Create) button — quick action for new project/photo
- Notifications bell (with red dot count)
- User avatar (top right)

Settings popover (from bottom sidebar):
```
PERSONAL: My Settings, Notification Settings
COMPANY:  Company Settings, Billing
```

Company Settings has tabs: **Company Info, Email Recaps, Exports, Labs, Legal**

---

## 2. Data Model

### Core entities

**Project**
- name (string)
- address (full street address with postal code)
- coordinates (lat/lng for Map view)
- thumbnail (auto-generated from first photo)
- labels (many — color-coded, project-level)
- users (many — assigned team members with avatars)
- collaborators (many — external?)
- description (free text)
- tasks (many — project-level to-dos)
- conversation (threaded comments)
- last_updated (timestamp)
- created_at
- starred (boolean per user)
- archived (boolean)
- status flags: Active, Complete, Scheduled (from observed label values)

**Photo**
- file (image binary, multiple sizes)
- project_id (FK)
- photographer_id (FK to team member)
- timestamp (capture time, separate from upload time)
- location (lat/lng — captured on mobile)
- tags (many — photo-level workflow stage)
- description (free text)
- tasks (many — photo-level to-dos)
- comments (threaded)
- annotations (drawing/markup on image)
- before_after_group (linked to a Before/After pair)

**Team Member (User)**
- name, email, phone
- avatar / initials
- role: Admin | Manager | Standard | Restricted
- status: Active | Deactivated
- last_activity timestamp
- t_shirt_size (yes, really)
- belongs_to: User Group(s)

**User Group**
- (collection of users for access control / assignment)

**Tag** (photo-level)
- name
- color? (UI shows just text-based tags, no color)
- created_at
- photo_count (cached aggregate)
- examples from PUR: "Keeping You Dry", "Almost Done", "In-progress", "Before and After", "Start", "Finished", "New", "Old", "Clock Out", "SumoQuote"

**Label** (project-level)
- name
- color (visual color swatch)
- project_count (cached aggregate)
- examples from PUR: shingle product colors like "Moire Black", "Burnt Sienna", "Heather Blend", "Coastal Blue", "Pewter", "Cobblestone Grey", "Georgetown Grey" plus status labels like "Active", "Complete", "Scheduled", "Inspection", "Repair"

**Checklist**
- name (e.g. "Jobsite Protocol")
- items (list of completion-trackable steps)
- project_id (FK)
- assignees (many)
- progress (X/Y completed)
- latest_activity (timestamped event log: Checklist Created, Progress Photos Nail Penetration, Finished Photos)
- status: Finished | Unfinished

**Report**
- title (often address-based)
- project_id (FK)
- created_at
- thumbnail
- (PDF deliverable, generated from photos + template)

**File**
- project_id (FK)
- file binary
- (catch-all for PDFs/docs uploaded to a project)

**Page**
- project_id (FK)
- (a rich-text/photo doc — like a Notion page tied to a project)

**Template** (5 types)
- Projects | Checklists | Reports | Files | Pages
- (Reusable scaffolding for each entity type)

**Snippet**
- Reusable text for reports

**Showcase / Portfolio**
- public-facing curated project gallery
- Portfolio Map Preview (project pins on map)
- Showcase items (Published / Drafts)
- shareable URL ("Copy Link")
- "Add Map to Website" / "Add Gallery to Website" embed options

### Relationships at a glance

```
Project 1───* Photo
Project 1───* File
Project 1───* Page
Project 1───* Checklist
Project 1───* Report
Project *───* User (via assignees)
Project *───* Label
Photo   *───* Tag
Photo   1───1 User (photographer)
Photo   1───1 Location
Showcase *───* Project (curated)
```

---

## 3. Feature Inventory by Section

### Projects (list view)
- Tabs: **Projects** | Project Groups
- Filters: All | Starred | My Projects | Archived
- Sort/filter icon (more granular controls)
- Refresh button + "Page last refreshed X minutes ago" indicator
- Search by project name
- **Create** button
- Columns: Project Name, Last Updated, Stats (Photos / Files / Checklists / Pages), Recent Photos (4 thumbnails)
- Each row clickable → project detail
- Each project shows: thumbnail, name, address, labels chips, assignee avatars (initials)

### Projects (detail view)
URL pattern: `/projects/{id}/photos`
- Header: Back to Projects, Star, Share, Showcase This Project, Request Review, ... (more menu)
- Project thumbnail + name + clickable address + Add Labels
- Content tabs: **Photos (N) | Pages | Files | Checklists | Reports** (counts per tab)
- Filter bar (when on Photos tab): Start Date | End Date | Users | User Groups | View dropdown | **Upload Photos** button
- Photos grouped by date (Day-of-week, Date) with day-group checkbox for bulk select
- Right sidebar: Contact Info, Project Users (with edit), Collaborators, Description, Tasks (New Task), Project Conversation

### Photo viewer (full-screen modal)
- Left: image fills viewport
- Top toolbar: annotate/draw, fullscreen, zoom out, zoom in, upload/download, delete
- Right sidebar:
  - Project name link, address
  - Photographer (avatar + name) + timestamp + location/map icon
  - Add Tags
  - Tasks (New Task)
  - Description (Edit button)
  - Comments (threaded with @-mentions, Post button)
- ">" arrow on right edge → next photo navigation

### Photos (top-level aggregate)
URL: `/photos`
- Same filter bar + day-group checkbox structure
- Filters: Start Date | End Date | **Projects** dropdown | Users | User Groups | Tags
- Bulk selection enables top action bar:
  - **Actions** menu: Download, Tag, Remove Tags, Print, Hide in Project Timeline, Unhide, Move, Move to Trash
  - **Reports** menu
  - **Share** action
  - **Create Before & After** action (groups two photos into a before/after pair)

### Checklists (aggregate feed)
URL: `/checklists`
- Tabs: All | Finished | Unfinished
- **Export Checklist Data (NEW)** button
- Columns: Checklist, Project, Assignees, Progress (visual bar + X/Y), Latest Activity (event with timestamp)
- Search

### Reports (aggregate)
URL: `/reports`
- Grid of report cards (thumbnail + title + date + ... menu)
- Search by report name
- **Create Report** button

### Map
URL: `/map`
- Google Maps embed
- Filters: Start Date | End Date | Users | User Groups | Labels
- Address search
- Project pins clickable → project detail

### Team
URL: `/users`
- Tabs: Users | User Groups
- Columns: Name (avatar + name), Role (dropdown editable), Info (email + phone), Latest Activity, ... menu
- Search by user
- **Invite Users** button
- Deactivated users shown muted with red "DEACTIVATED" badge

### Marketing > Marketing Suite
- Waitlist page (feature not live yet for this account)
- Promised features: portfolio builder, review collector, AI social videos from project photos
- **Direct competitor to what Ryujin will rebuild — worth tracking CompanyCam's roadmap here**

### Marketing > Reviews
URL: `/reviews/google?rpid={id}`
- Plus Ultra Roofing dropdown (location selector) + Manage Locations
- Columns: Name, Rating, Feedback, Status
- **Request Review** button
- Empty state for PUR currently

### Marketing > Showcases / Portfolio
URL: `/portfolio/manage`
- Portfolio Map Preview (project pins map embed)
- **Add Map to Website** (embed code)
- **Add Gallery to Website** (embed code)
- **Open Portfolio Site** (public URL)
- **Copy Link** (share)
- **Create Showcases** button
- Showcases tabs: Published | Drafts

### Resources > Integrations
URL: `/integrations`
- Tabs: All Integrations | Connected Integrations
- Filter chips: All | CRM/FSM | Estimating/Proposals | Time Tracking/Scheduling | Other
- Featured tier + full list of partner integrations (Beam, Jobber, JobTread, Monday.com, QuickBooks, Roofr, Smartsheet, SRS Roof Hub, AccuLynx, Albiware, Arrivy, Aspire, etc.)
- Search by integration name
- "Don't see your software listed? Request an Integration" CTA

### Resources > Templates
URL: `/templates/projects`
- Tabs: Projects | Checklists | Reports | Files | Pages
- Empty state for PUR (no templates created)
- **Create Project Template** button

### Resources > Tags
URL: `/tags`
- Columns: Tag Name, Tagged Photos count, Last Updated, ... menu
- Search
- **Create Tag** button
- Tags listed in date-modified order

### Resources > Labels
URL: `/labels`
- Columns: Color swatch, Name, Projects count, Last Updated, ... menu
- Search
- **Create Label** button

### Resources > Snippets
URL: `/snippets`
- Empty state for PUR
- "Text snippets let you save and reuse common text across reports."
- **Create Snippet** button

### Settings > Company Settings
URL: `/companies/{id}`
- Tabs: Company Info | Email Recaps | Exports | Labs | Legal
- **Company Info**: Company Name, Phone, Email, Address (1+2/City/State/Postal/Country), Time Zone, Industry, Company Size, "How did you hear about us?", Company Logo upload
- **Exports tab** (key for our use case): Time frame dropdown (Today, Yesterday, 1 Week, 30 Days, 60 Days, 1 Year, **All Time**), Data dropdown (Checklists, Projects — checkbox each), **Export .CSV** button. CSV emailed to inbox, NOT downloaded immediately. **No photo file export from this UI.**

### Settings > My Settings
URL: `/users/{user_id}/edit`
- Account Info: Change Email/Password
- Profile Info: First/Last Name, Phone, Job Title
- User Role: Admin | Manager | Standard | Restricted (with descriptions)
- T-Shirt Size (for CompanyCam swag — culture detail worth replicating?)
- **No API/developer token UI here** — token must be generated at `developer.companycam.com`

### Search (top of sidebar)
Global search bar — searches across projects/photos/users. Hotkey: Ctrl+K equivalent (search field has cursor focus indicator).

---

## 4. Key UX Patterns Worth Copying

1. **Day-grouped photo feed with day-level multi-select.** Scrolling through hundreds of photos is bearable because they're grouped by date with a single checkbox per day.

2. **Hierarchical aggregate + per-entity views.** Photos exist at two levels: per-project AND aggregate across all projects, with the same filter bar at both levels. Same for Checklists, Reports. This consistency is the right pattern.

3. **Color-coded project labels distinct from photo tags.** Labels = project-level taxonomy (often product/material in roofing). Tags = photo-level workflow state. Don't conflate them.

4. **Embeddable widgets for marketing site.** Portfolio Map and Gallery embed codes let the site auto-update as new projects close. Replicate in Ryujin.

5. **Bulk action contextual top bar.** When items are selected, a dark contextual top bar replaces the default header with batch actions. Cleaner than dropdown menus.

6. **Right-sidebar enrichment.** Project detail keeps photos as primary content; meta (users, tasks, conversation, description) lives in a right sidebar that can collapse. Don't bury photos behind metadata forms.

7. **Templates for everything.** Projects/Checklists/Reports/Files/Pages all support templates. New project = pick template + fill in address. This is how a contractor scales process.

8. **"Latest Activity" event log.** Each Checklist row shows the most recent event (Created, Photo added, Step completed). Implicit audit trail without a dedicated audit log page.

9. **Refresh affordance with "last refreshed X min ago" timestamp.** Projects view explicitly shows freshness. Builds trust that the page isn't stale.

10. **Showcase / portfolio = first-class marketing product.** CompanyCam treats public-facing portfolio as a primary feature, not an afterthought. This is the leverage point for Mack's "use real photos for social" strategy.

---

## 5. Plus Ultra-specific Observations (state of the workspace)

- **Active team:** 4 (Mackenzie, Arielle, Darcy, Diego)
- **Deactivated team:** 6+ (Jeremie, Sergio, Christian, etc.) — visible echo of the 2025 churn year from DNA
- **Projects visible in scroll:** 14+ recent (May 2026 cluster). True count likely 100+ across full history
- **Photo volume per project:** range 9 to 118+ photos. Sackville Touch Ups alone = 118. Realistic total estimate: 3,000–8,000 photos across all projects
- **Tags:** ~10 created. Mostly unused (most show 0-3 photos tagged). One exception: "Before and After" with 18 photos
- **Labels:** Mix of shingle-product names (Moire Black 15 projects, Burnt Sienna 4, etc.) and status (Active, Complete, Inspection, Repair, Scheduled). "Moire Black" is the most-used material — useful for "popular product" social posts
- **Checklists:** "Jobsite Protocol" applied to most projects but completion rate is poor — most show "0/13 completed". Two visible exceptions (43 Therrien, 81 Hunterwood) at 7/13. **Workflow opportunity: checklists exist but crews aren't completing them**
- **Reports:** Active use — dozens of "Roof Inspection Report" docs by address. This is where revenue documentation lives
- **Integrations connected:** Zero
- **Reviews collected via this tool:** Zero
- **Templates created:** Zero (all 5 types empty)
- **Snippets created:** Zero
- **Showcases / Portfolio:** Set up with portfolio map showing NB project pins. Public-facing portfolio exists

---

## 6. Ryujin Rebuild — Recommendations

### Phase 1: Core (replicate the load-bearing 70%)
- Project + Photo + User + Tag/Label entities with the relationships above
- Photo upload from mobile with GPS + timestamp capture
- Project detail view with the photo-feed-by-date + right-sidebar pattern
- Aggregate Photos view with the same filter bar
- Team management with the 4 role tiers
- Basic search across project name + address

### Phase 2: Workflow (the next 20%)
- Checklists (templated, attachable to projects)
- Reports (templated, photo-aware PDF generation)
- Pages (rich-text + photo-embedded notes per project)
- Files (catch-all attachments)
- Snippets for reusable text in reports

### Phase 3: Marketing (the differentiating 10%, where Ryujin can outpace CompanyCam)
- Showcase / Portfolio with embeddable widgets
- Auto-tagged photo library for fast social pull (this is the Mack-specific use case)
- AI photo categorization (subject: roof / gutters / damage / crew / before-after; quality: hero-shot / process / behind-scenes)
- One-click "generate social post from project" using indexed photos + real captions (vs. AI hallucinations)
- Native review collector

### Mobile considerations
CompanyCam's killer feature is the mobile app (not seen in this web scrape but central to user flow). Crews take photos with the app, photos auto-sync with GPS + timestamp, then office team works with them on web. **Ryujin must have a mobile-first photo capture flow or this rebuild fails.** The web UI is for office work; photos come from the field.

### What to skip in v1
- T-Shirt Size field
- Marketing Suite (CompanyCam's own roadmap competitor — we're building parallel)
- Refer-a-friend mechanics
- The full 30+ external integration list (start with 2-3: Jobber/QuickBooks if Mack uses them)

---

## 7. CompanyCam's Own Trajectory (competitive note)

CompanyCam is rolling out a **Marketing Suite** (currently waitlist) that does what Mack wants:
> "Turn finished projects into professional videos and posts across social, Google, and your website in one simplified flow."

Three pillars:
1. Show off work (Portfolio with material/job-type filtering)
2. Get more reviews (Review inbox with reply tracking)
3. Reach new customers (AI turns photos into compelling social videos)

**Implication:** If Ryujin's primary value is "better photo-driven social for contractors," CompanyCam is building exactly that natively. Ryujin needs a differentiated angle:
- Deeper AI photo intelligence (auto-categorize, find-the-best-shot)
- Integration with Plus Ultra's actual brand voice / Mack's Clone (the social content generation)
- Tighter ownership of the photos (not stuck in CompanyCam's walled garden)
- Possibly: better mobile UX for the office side of the workflow

---

## 8. Open Item: Photo Export

**No native bulk photo export from CompanyCam UI.** Three confirmed paths:

1. **CompanyCam API** (recommended): Personal Access Token generated at `developer.companycam.com`. Endpoints support listing projects, photos, and downloading photo files with metadata. This is the only realistic path for "index all photos."

2. **UI bulk download per day-group**: Photos > Bulk select day → Actions → Download. Functional but at PUR's scale (thousands of photos across dozens of projects), this is a multi-hour click-fest.

3. **Settings > Exports > CSV**: Projects metadata only. Useful as a structured index of every project (with photo counts) but does NOT include photo URLs or the photo files themselves.

**Recommended next step:** Mack generates a CompanyCam API token. With that, Ryujin (or a one-off Python script) can pull the full photo library + metadata in a structured way, then index/categorize using vision models.

---

## 9. Notes for Claude Code

- **Auth model:** CompanyCam uses Bearer token auth on the API. Each Personal Access Token is scoped to the user that created it, so it inherits that user's role (use an Admin's token to see everything).
- **API base:** `https://app.companycam.com/api/v2/` (per their developer docs — verify when Mack generates token)
- **Rate limits:** unknown, plan for batching with backoff
- **Photo URLs:** likely time-limited signed S3 URLs — download on retrieval, don't bookmark them long-term
- **Webhook support:** likely available for real-time sync into Ryujin (verify in developer portal)
- **PII:** photos can contain people's homes, license plates, faces. Index needs to respect privacy if Ryujin ever surfaces photos externally

---

*End of debrief. Last UI walkthrough: 2026-05-19. Re-verify before relying on specific URL patterns or feature claims — CompanyCam ships frequently.*
