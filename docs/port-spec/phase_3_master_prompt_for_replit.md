## Phase 3 Master Prompt for Replit
### Operator Dashboard, Pipeline, and Scheduling Handoff Layer
Build Phase 3 of the existing Plus Ultra Roofing Estimator OS.
Phase 1 already includes:
multi-step estimator wizard
pricing engine
photo upload
internal report generation
proposal generation
Phase 2 already includes:
Google Sheets sync
proposal status tracking
package selection capture
upgrade capture
agreement generation trigger
agreement status tracking
Phase 3 should build the operator command center that manages the project after proposal and agreement.
This phase should connect sales to execution.

# Core Objective
Once an estimate becomes a live project, the system should allow the operator to:
View all jobs in a structured pipeline
Track each project from estimate to scheduling to completion
See proposal, agreement, and project status in one place
Hand off projects into scheduling / production
Assign internal ownership
Track key project milestones
Store project notes, files, and job links
Prepare jobs for production without using multiple disconnected tools
This is not a full CRM. It is an operator dashboard and handoff layer.

# System Architecture
The system should now behave like this:
Estimator
 → Proposal
 → Customer Selection
 → Agreement
 → Job Pipeline
 → Scheduling Handoff
 → Production Readiness
 → Completion Tracking
Phase 3 begins where the agreement stage is accepted.

# 1. Dashboard Home
Create a main dashboard page for the operator.
This dashboard should show:
jobs needing review
proposals awaiting response
agreements awaiting signature
signed jobs awaiting scheduling
scheduled jobs
active jobs
completed jobs
Use clear summary cards at the top:
Draft Estimates
Proposal Sent
Proposal Accepted
Agreement Sent
Agreement Signed
Awaiting Schedule
Scheduled
Active
Completed
These should be visually clear, fast to scan, and contractor-grade.

# 2. Job Pipeline View
Create a pipeline / kanban-style view with stages:
Estimate Draft
Proposal Ready
Proposal Sent
Proposal Accepted
Agreement Generated
Agreement Sent
Agreement Signed
Awaiting Schedule
Scheduled
Active
Completed
Lost / Cancelled
Each job card should display:
customer name
property address
selected package
proposal mode
current status
accepted price
last updated timestamp
The pipeline should be easy to drag visually later, but for now it can also support dropdown stage selection.

# 3. Job Detail Page
Each project should have a full detail page.
The job detail page should combine all critical information into one place.
It must include:
### Customer / Property
name
phone
email
address
province
### Estimate Data
roof size
pitch
measurements
pricing model
package prices
report summary
### Proposal Data
proposal status
proposal URL
selected package
selected upgrades
### Agreement Data
agreement status
agreement URL
agreement signed yes/no
agreement signed date
### Project Data
assigned owner
scheduling status
internal notes
production notes
photos
linked documents
This page should act as the single project workspace.

# 4. Scheduling Handoff Layer
Create a dedicated handoff structure once a job is won.
This handoff should collect:
projected start window
estimated duration
pricing model
remote or local
crew requirements
material order status
dumpster required yes/no
equipment required
notes for production
notes for office
notes for customer communication
Add a button:
Mark Ready for Scheduling
Once clicked, the job moves from:
Agreement Signed
 to
Awaiting Schedule
Then add a second action:
Schedule Project
This should set:
scheduled start date
estimated end date
schedule status

# 5. Production Readiness Checklist
Create a production readiness checklist that appears once the job is signed.
Checklist items should include:
agreement signed
deposit received
proposal finalized
package selected
upgrades confirmed
measurements verified
material list confirmed
material order placed
crew requirements noted
customer contact confirmed
jobsite photos uploaded
special conditions documented
Each item should be a toggle or checkbox.
At the top of the project detail page, show:
Production Ready: Yes / No
This should auto-evaluate based on checklist completion.

# 6. Internal Ownership and Assignment
Each project should support assignment fields:
sales owner
estimator owner
production owner
primary contact
These can be simple dropdowns or text fields for now.
The goal is to know who owns each stage.

# 7. Calendar / Schedule Prep Fields
Even if calendar integration is not fully built yet, create the fields needed for it.
Include:
preferred install week
earliest start date
customer unavailable dates
project duration days
remote accommodations required yes/no
mobilization required yes/no
weather sensitivity notes
This creates a clean bridge to future scheduling automation.

# 8. Job Notes and Communication Log
Each project should support a structured note feed or note sections.
At minimum include:
internal notes
sales notes
production notes
customer communication notes
Timestamps should be included where possible.
This should not become a chat app, but the system should preserve operational context.

# 9. File and Link Storage
Each job should support storing links or references for:
proposal URL
proposal PDF
agreement URL
agreement PDF
Loom video URL
CompanyCam or photo references
Google Drive job folder
material list file
estimate report file
This creates a single place to access project assets.

# 10. Financial Snapshot
Add a simple job financial summary block to each project page.
Display:
selected package
selected upgrades
subtotal
tax
final accepted total
deposit required
deposit paid
balance remaining
This is not accounting software, but it should help operations know what the project is worth.

# 11. Status Logic
Define these primary job stages clearly:
### Sales Stages
Estimate Draft
Proposal Ready
Proposal Sent
Proposal Accepted
### Agreement Stages
Agreement Generated
Agreement Sent
Agreement Signed
### Operations Stages
Awaiting Schedule
Scheduled
Active
Completed
### Exit Stages
Lost
Cancelled
The dashboard and pipeline should use these standardized statuses.

# 12. Filters and Views
Add filters for:
status
province
proposal mode
pricing model
assigned owner
signed vs unsigned
scheduled vs unscheduled
Add quick saved views such as:
My Open Jobs
Awaiting Proposal
Awaiting Agreement
Awaiting Schedule
Remote Jobs
Signed This Week

# 13. Notifications / Operational Flags
Add internal flags or badges for:
remote project
extended stay project
deposit missing
agreement unsigned
not production ready
missing photos
missing measurements
proposal not generated
These should help the operator see problems before they become delays.

# 14. Data Model Requirements
Expand the estimate/project model to support:
### Estimate Layer
measurements
inputs
package prices
### Sales Layer
proposal status
accepted package
upgrades
### Agreement Layer
agreement status
signed date
agreement links
### Operations Layer
scheduling status
production checklist
ownership
internal notes
readiness flags
This should be a clean unified project model.

# 15. UI Requirements
The UI should feel like an operator dashboard, not a consumer app.
Style requirements:
clear cards
clean tables
visible statuses
minimal clutter
fast scanability
professional roofing-company tone
desktop-first
mobile usable
Avoid gimmicks and unnecessary motion.

# 16. Deliverables Required
Phase 3 must include:
Dashboard home
Job pipeline view
Job detail page
Scheduling handoff section
Production readiness checklist
Assignment fields
Financial summary block
File/link storage section
Filtering / saved views
Operational flags / missing data warnings

# 17. Important Constraints
Do not turn this into a bloated CRM
Do not rewrite the estimator logic
Do not replace Google Sheets or external tools
Keep this as the operational dashboard layer
Prioritize clarity, handoff, and job readiness
Focus on moving jobs from sale to production cleanly

# 18. Test Scenario
Use 125 Kelly Drive as the seed job.
It should demonstrate:
estimate complete
proposal accepted
agreement generated
signed state
ready for scheduling
remote job flag
full exterior project structure
This should let the system be demoed end-to-end.

# 19. Final Output Expectation
When complete, I should be able to:
see all jobs in pipeline form
open a job and see all sales + agreement + operations data
know whether the project is ready for scheduling
assign the next action
track project progress from proposal to completion
This phase should turn the Estimator OS into an actual job operations command center.

## Best line to put above the prompt
Treat Phase 3 as the operational handoff layer between sales and production. Build it as a clean contractor command center, not a generic CRM.
