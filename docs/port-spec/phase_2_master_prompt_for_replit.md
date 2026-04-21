## Phase 2 Master Prompt for Replit
### Estimator OS Integration Layer
Build Phase 2 of the existing Plus Ultra Roofing Estimator OS.
Phase 1 already includes:
multi-step estimator wizard
pricing engine
photo upload
internal report generation
client proposal generation
draft save state
job record structure
Phase 2 should focus on integration, automation, and handoff.
This phase must turn the estimator app into a connected operational system.

# Core Objective
When an estimate is created and approved, the app should be able to:
Sync estimate data to Google Sheets
Trigger proposal generation workflows
Capture client package selections
Capture optional upgrades
Trigger agreement generation
Return agreement links / PDF references
Keep estimate, proposal, and agreement states synchronized

# System Architecture
The system should now behave like this:
Estimator OS
 → Google Sheet sync
 → Proposal generation / send step
 → Customer package selection
 → Upgrade selection
 → Agreement generation
 → Internal notification / copy
The Estimator OS remains the source system, while Google Sheets and webhooks act as automation layers.

# 1. Google Sheets Integration
Add a Google Sheets sync layer.
The estimator app must be able to:
create a new row in a Google Sheet when an estimate is saved
update an existing row when the estimate is edited
write back generated outputs such as:
proposal URL
proposal status
selected package
selected upgrades
agreement URL
agreement status
### Requirements
make the Google Sheet integration modular
assume the sheet columns already exist
use a clear mapping layer between estimator fields and sheet columns
support both create and update operations
include a visible sync status on the estimate record
### Desired fields to sync
At minimum:
record ID
customer full name
email
phone
property address
city
province
pricing model
proposal mode
roof area SQ
roof pitch
complexity
ridge LF
valleys LF
eaves LF
chimney type
skylight count
mobilization amount
project overhead amount
gold price
platinum price
diamond price
upgrade toggles
proposal URL
agreement URL
selected package
selected upgrades
job status

# 2. Proposal Trigger Layer
Add a workflow action called:
Send to Proposal Queue
When this action is clicked:
estimator data is marked as approved
syncs to Google Sheets
sets a proposal-ready state
optionally triggers proposal generation webhook
The app should support both modes:
### Manual proposal mode
Operator reviews the estimate, then clicks Generate Proposal
### Auto proposal mode
Approved estimate automatically sends to proposal generation endpoint
Add a settings toggle for which mode is active.

# 3. Proposal Link / Status Tracking
Each estimate record must support these fields:
Proposal Generated? Yes/No
Proposal URL
Proposal PDF URL
Sent to Client? Yes/No
Sent Date
Proposal Status
### Proposal Status values
Draft
Generated
Sent
Viewed
Awaiting Selection
Accepted
Declined
Create a simple status badge UI for these.

# 4. Customer Package Selection Capture
Create a lightweight client response capture structure.
The proposal generator / proposal page should be able to send back:
estimate record ID
selected package
selection timestamp
The Estimator OS must be able to receive this payload through a webhook endpoint or API route.
When received:
update the estimate record
update Google Sheet row
change Proposal Status to Accepted
move record to upgrade / agreement stage

# 5. Upgrade Selection Capture
After package selection, the customer may choose upgrades.
The system must support receiving upgrade selections from the proposal or upgrade page.
Captured fields:
selected upgrades list
upgrade prices
final subtotal
tax
final accepted total
These should update:
estimate record
Google Sheet row
agreement payload builder
Add a structured upgrades object, not just a plain text string.
Example:
{
 "gutters": true,
 "fascia": true,
 "soffit": false,
 "siding": false,
 "redeck_language": true
}

# 6. Agreement Generation Trigger
Add a workflow action called:
Generate Agreement
This should be triggerable in two ways:
### Automatic
After customer confirms package and upgrades
### Manual
Operator clicks Generate Agreement
When triggered, the app must build an agreement payload containing:
customer information
property information
selected package
selected upgrades
final project scope
final accepted price
tax
internal notes if needed
proposal ID / estimate ID
This payload is then sent to a future agreement generator endpoint or webhook.

# 7. Agreement Link / PDF Tracking
Each estimate record must support:
Agreement Generated? Yes/No
Agreement URL
Agreement PDF URL
Internal Copy Sent? Yes/No
Agreement Status
### Agreement Status values
Not Started
Generated
Sent
Signed
Declined
Show these inside the estimate dashboard.

# 8. Notifications / Internal Handoff
Create a notification / handoff layer.
At minimum, create placeholder hooks or functions for:
notifying internal email when proposal is generated
notifying internal email when package is selected
notifying internal email when agreement is generated
notifying internal email when agreement is signed
Do not fully implement email delivery if credentials are not available, but build the event structure so it can be wired later.

# 9. Job Dashboard / Lifecycle View
Add a simple estimate detail page or dashboard that shows the full lifecycle of the job:
### Estimate Stage
Draft
Reviewed
Approved
### Proposal Stage
Not Generated
Generated
Sent
Accepted
### Agreement Stage
Not Generated
Generated
Sent
Signed
### Job Stage
Proposal
Agreement
Scheduled
Complete
This page should make it easy for an operator to see where the project is stuck.

# 10. Data Model Requirements
Update the data model so each estimate record contains:
## Estimate layer
measurements
pricing inputs
package outputs
report output
proposal output
## Proposal layer
proposal status
proposal URLs
sent state
selected package
## Upgrade layer
selected upgrades
upgrade pricing
accepted totals
## Agreement layer
agreement status
agreement URLs
PDF links
signed status
This data structure should be future-safe and easy to sync externally.

# 11. Webhook / API Requirements
Create clean server endpoints or handler functions for:
create or update estimate
sync to Google Sheets
receive proposal selection
receive upgrade selection
generate agreement payload
receive agreement signed status
Use structured JSON payloads.
Do not tightly couple endpoints to UI components.
Keep this integration layer modular.

# 12. Logging and Error Handling
Add visible and logged handling for:
failed Google Sheet sync
failed proposal generation
missing required fields
duplicate record ID
missing package selection
failed agreement trigger
The operator should be able to see:
what succeeded
what failed
what needs retrying
Add retry-safe design where possible.

# 13. Settings / Config Layer
Create a simple settings object or config file for:
Google Sheet ID
webhook URLs
proposal mode (manual vs auto)
agreement mode (manual vs auto)
tax rate default
company email for internal copy
default province options
default pricing model options
This should be easy to edit without rewriting core logic.

# 14. UI Requirements
Do not overbuild a CRM.
This is still the Estimator OS, but now with operational controls.
Add these operator controls:
Save Draft
Sync to Sheet
Generate Proposal
Copy Proposal Link
Generate Agreement
Copy Agreement Link
Add status tags and timestamps.
Keep the UI clean, contractor-grade, and operational.

# 15. Deliverables Required
Phase 2 must include:
Google Sheets sync layer
Proposal trigger layer
Proposal status tracking
Customer package selection capture
Upgrade selection capture
Agreement trigger payload builder
Agreement status tracking
Lifecycle dashboard
Error handling for sync / trigger failures
Configurable integration settings

# 16. Important Constraints
Do not remove or rewrite the Phase 1 estimator core
Do not turn this into a bloated CRM
Keep the estimator as the source system
Keep integration logic modular
Build placeholder-ready systems if live credentials are unavailable
Prioritize reliability and data flow over fancy visuals

# 17. Test Scenario
Use 125 Kelly Drive as the test scenario.
The test flow should allow:
estimate created
proposal generated
proposal URL stored
customer package accepted
upgrade selections returned
agreement payload generated
agreement URL stored
This should work end-to-end in a demo-ready way even if some external services are mocked.

# 18. Final Output Expectation
When complete, I should be able to:
build an estimate
sync it to the sheet
generate a proposal
capture customer selection
capture upgrades
generate an agreement payload
track the job lifecycle from estimate to signed agreement
Build this as a stable operational layer for the Plus Ultra Roofing Estimator OS.

## Attach with this prompt
Attach or paste:
Estimating and Pricing Formula
Out of Town Pricing Formula
your optimized spreadsheet structure if needed
sample proposal content if you want output consistency

## Best line to put above the prompt
Treat Phase 1 as the approved estimator core. Build Phase 2 as the integration and lifecycle layer without changing the core pricing logic.
