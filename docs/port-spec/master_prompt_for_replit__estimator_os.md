## Master Prompt for Replit: Estimator OS
Build a production-ready web app called Plus Ultra Roofing Estimator OS.
This app is the internal estimating engine for Plus Ultra Roofing. It must be designed for operator use first, with proposal generation as a downstream output.
The app should not be a generic form builder. It should function like a guided multi-step estimator operating system with structured logic, image capture, pricing calculations, internal reporting, and proposal generation.
### Core Objective
The app must allow an operator to:
Start a new estimate
Enter customer and property details
Upload or capture jobsite photos
Input roof and exterior measurements
Select pricing model and project type
Calculate package pricing using Plus Ultra Roofing formulas
Configure which upgrades should appear in the proposal
Generate an internal report first
Generate a client-facing proposal second
### Product Positioning
This is an Estimator OS, not just a proposal generator.
The correct workflow is:
Questionnaire → Pricing Engine → Internal Report → Proposal Generator
### Primary Users
Mackenzie
Internal sales / operator users
Future estimators and office staff
### Core UX Requirements
Build this as a multi-step guided wizard with a progress indicator.
 The interface must be clean, modern, mobile-friendly, and fast.
Steps should be:
Customer / Property Info
Photo Upload
Roof Measurements
Exterior Measurements
Pricing Model
Upgrades / Proposal Controls
Review Summary
Generate Internal Report
Generate Client Proposal
### Visual Style
Use a polished, contractor-grade interface with a Plus Ultra Roofing feel:
strong, clean layout
modern card-based sections
blue / gold / dark neutral brand feel
no clutter
professional, not startup gimmicky
optimized for desktop first, but mobile usable
should feel like a premium internal business tool
### Functional Requirements
## 1. Customer / Property Step
Collect:
customer full name
email
phone
property address
city
province
postal code
Also include:
proposal mode dropdown:
Roof Only
Roof + Soffit/Fascia
Full Exterior
Metal
Hybrid
pricing model dropdown:
Local
Out-of-Town Day Trip
Out-of-Town Extended Stay
## 2. Photo Upload Step
Allow both:
drag and drop image upload
camera capture from device
Require a minimum of 3 photos before continuing.
Minimum guidance text:
front elevation
rear elevation
roof or aerial reference
Allow more than 3 photos.
Store uploaded image references in the job record.
## 3. Roof Measurements Step
Collect:
roof area in squares
waste factor %
roof pitch
complexity
ridge LF
hips LF
valleys LF
eaves LF
drip edge LF
penetrations count
max vents count
pipe flashing count
chimney type:
none
small
large
chimney cricket yes/no
skylight count
layers to remove
cedar tear-off yes/no
redeck risk yes/no
## 4. Exterior Measurements Step
Collect:
soffit LF
fascia LF
gutter LF
downspout count
siding area sq ft
outside corners LF
inside corners LF
masonry excluded sq ft
This step should be skippable if proposal mode does not require exterior scope.
## 5. Pricing Logic Step
This is critical.
The pricing engine must support both local and remote job logic.
### Use the attached pricing docs as source of truth:
Estimating and Pricing Formula
Out of Town Pricing Formula
Do not invent formulas. Follow those rules.
### General logic structure
Hard Cost =
Materials
Labor
Project Adders
Mobilization if applicable
Project overhead if applicable
Selling Price =
Hard Cost × Package Multiplier
### Local multipliers
Gold: 1.47
Platinum: 1.52
Diamond: 1.58
### Remote multipliers
Gold: 1.22
Platinum: 1.27
Diamond: 1.33
### Daily overhead
Use current remote overhead logic from the Out of Town Pricing Formula.
### Mobilization
Support separate mobilization logic for:
Option 1
Option 2
### Important requirement
Build the pricing engine so it is modular and editable later.
Do not hardcode everything into UI handlers. Centralize formulas.
## 6. Upgrade / Proposal Controls Step
This step is operator-facing.
Allow toggles for whether the proposal should include:
soffit
fascia
gutters
siding
redeck language
skylight upgrade
ventilation upgrade
financing section
metal option
optional upgrade step after package selection
highlight Platinum package yes/no
recommended package dropdown
Allow operator to set or override upgrade prices if needed.
## 7. Review Summary Step
Show a clean review page with:
customer info
property info
selected pricing model
measurements summary
package prices
selected proposal mode
upgrades included
mobilization / overhead summary
photos preview
From here, provide 3 actions:
Save Draft
Generate Internal Report
Generate Proposal
## 8. Internal Report Generation
Generate a structured internal report view first.
This report must include:
job info
full measurements
pricing inputs
materials summary
labor summary
mobilization and overhead summary
hard cost by package
final package prices
selected upgrades
notes
photo references
This report is internal, audit-friendly, and detailed.
It should be exportable or printable later.
## 9. Client Proposal Generation
Generate a polished client-facing proposal from approved data.
Proposal should include:
project overview
package comparison
pricing
option 1 / option 2 if applicable
upgrade sections if enabled
timeline
trust / warranty section
call to action
Proposal should be simpler than the internal report.
### Important
Proposal generation must use the estimator outputs and selected toggles.
 The proposal is downstream, not the calculation engine.
## 10. Data Storage
Create a job record structure that stores all input and generated output.
At minimum store:
customer data
property data
measurements
image references
pricing model
package prices
upgrades
report output
proposal output
Design the data structure so this can later connect to:
Google Sheets
Zapier
webhooks
CRM
agreement generator
## 11. Architecture Requirements
Build the app so it can later support:
webhook to proposal sender
webhook to agreement generator
sync to Google Sheets
package selection links
upgrade selection links
Use clean separation between:
UI
pricing logic
data model
report generation
proposal generation
## 12. Technical Requirements
Use a maintainable stack appropriate for Replit.
Recommended:
React or Next.js frontend
clean component structure
server-side or API route for calculations / generation
persistent local storage or database-ready model
easy future webhook integration
### Must include:
reusable calculation functions
reusable step components
validation on required inputs
minimum 3 image upload validation
ability to save draft state
clean error handling
clear comments in code
## 13. Deliverables Required
Build the app with:
Full multi-step estimator UI
Working pricing engine
Internal report screen
Proposal generation screen
Clean job data model
Placeholder hooks for future webhook / Zapier integration
## 14. Important Constraints
Do not build this as a generic CRM
Do not build this as only a proposal page
Do not skip the internal report layer
Do not flatten everything into one long page
Do not use vague mock calculations
Use the attached pricing logic as source of truth
Make this feel like a serious internal estimating tool for a roofing company
## 15. Initial Seed Data
Seed the app with one demo project for testing:
125 Kelly Drive
Summerside, PE
use current remote job logic
include realistic package outputs
include optional exterior upgrades
## 16. Final Output Expectations
When complete, I should be able to:
open the app
create a new estimate
upload photos
enter measurements
choose local or remote pricing
review package outputs
generate an internal report
generate a polished proposal
Make the first version fully functional, not just a wireframe.

## What to attach with this prompt
Attach or paste these with it:
Estimating and Pricing Formula
Out of Town Pricing Formula
Optional:
current package descriptions
current upgrade descriptions
proposal copy sections you want mirrored

## Best instruction to add above the prompt
Add this one line before sending it to Replit:
Treat the attached pricing documents as canonical business rules. Build the app around those rules, and ask for clarification only if there is a true formula conflict.
