## Proposal Generator Workflow
### 1. Lead enters system
A lead enters through one of two paths:
Path A: Instant Estimator
Customer completes the instant estimator
Estimator calculates core project data and pricing inputs
Zapier sends the data into a new row in the Google Sheet
Path B: Manual Entry
Operator creates a new row manually in the Google Sheet
Operator fills in the customer, property, pricing model, scope, and upgrade data
The Google Sheet becomes the single source of truth for proposal generation.

### 2. Google Sheet stores all proposal inputs
Each row contains the information required to generate a proposal.
This includes:
Customer / property information
customer name
email
phone
property address
city
province
Core estimator information
roof size
pitch
complexity
ridge
valleys
eaves
penetrations
chimney
skylights
material type
package set
Pricing model controls
province
pricing model
local vs out-of-town
remote / extended stay yes-no
mobilization amount
project overhead amount
Upgrade controls
include soffit yes-no
include fascia yes-no
include gutters yes-no
include siding yes-no
include redeck language yes-no
upgrade prices
Proposal controls
proposal mode
include financing yes-no
highlight platinum yes-no
recommended package
proposal notes
Trigger fields
ready for review yes-no
generate proposal yes-no
proposal generated yes-no
proposal URL
PDF URL

### 3. Operator reviews row before generation
If the row came from the instant estimator, the operator reviews it before proposal generation.
The operator confirms:
pricing model is correct
local or remote logic is correct
package prices are correct
upgrades to include are correct
wording options are correct
proposal mode is correct
Once the row is confirmed, the operator changes:
Generate Proposal = Yes
If the row is fully automatic, the instant estimator can set this value automatically.

### 4. Proposal trigger fires
Zapier watches the Google Sheet for rows where:
Generate Proposal = Yes
Proposal Generated is blank or No
When those conditions are met, Zapier sends the row data to the proposal generator webhook / web app.

### 5. Proposal generator builds the proposal
The proposal generator reads the row and creates the correct proposal version based on the row inputs.
It determines:
whether the proposal is roof only, roof + soffit/fascia, full exterior, metal, or hybrid
which package prices to display
which upgrades to display
whether to use local or remote pricing outputs
whether to include financing section
whether to include redeck language
which buttons and links to place in the proposal
The app then generates:
a live proposal URL
optionally a PDF version

### 6. Proposal output is written back to the sheet
After proposal generation succeeds, the automation writes back to the same row:
Proposal Generated = Yes
Proposal URL
Proposal PDF URL if available
This keeps the sheet synced and trackable.

### 7. Proposal is sent to the customer
The proposal can be sent one of two ways:
Manual send
operator copies proposal URL
sends by text or email
Automated send
Zapier sends email or SMS automatically once proposal URL is generated
The proposal contains:
package information
scope explanation
pricing
optional upgrade pathway
selection buttons

### 8. Customer reviews proposal
Customer moves through the proposal and chooses a package.
The proposal buttons either:
scroll to sections of the proposal
send the customer to the package selection step
send the customer to the optional upgrades step

### 9. Customer selects package
The customer selects one package:
Gold
Platinum
Diamond
or applicable metal / hybrid package
That selection is captured and passed into the next step.

### 10. Optional upgrades step appears
After package selection, the customer is shown an optional upgrades step.
This step allows the customer to select any relevant add-ons, such as:
soffit
fascia
gutters
siding
redeck acknowledgement
ventilation upgrade
other project-specific upgrades
This step should feel like a continuation of the project, not a new sales pitch.

### 11. Customer confirms selection
After choosing upgrades, the customer confirms their package and add-ons.
That confirmation triggers a webhook with:
customer information
project information
selected package
selected upgrades
proposal ID
final pricing

### 12. Agreement generation is triggered
The selection webhook triggers the agreement-generation workflow.
This creates:
final agreement scope
customer-ready agreement PDF
internal copy of the same agreement
The agreement should reflect:
chosen package
chosen upgrades
final project scope
final pricing
tax
signature-ready terms

### 13. Agreement is delivered
The agreement workflow sends:
customer PDF / signing link to the client
internal PDF copy to your email
optionally a CRM update or pipeline move
At this point the proposal process is complete and the project moves into signed agreement / job scheduling workflow.

## Core logic summary
### Estimator’s job
Create pricing inputs and package outputs
### Google Sheet’s job
Store truth, allow manual override, and act as trigger layer
### Proposal generator’s job
Turn row data into a polished customer-facing proposal
### Upgrade step’s job
Capture add-ons after package commitment
### Agreement generator’s job
Create the final signed scope and send copies internally and externally

## Recommended trigger logic summary
### Trigger 1
When row is created or updated
 and Generate Proposal = Yes
 and Proposal Generated ≠ Yes
 → generate proposal
### Trigger 2
When customer confirms package / upgrades
 → generate agreement

## Recommended sheet control fields
These are the most important control fields to keep:
Pricing Model
Proposal Mode
Generate Proposal
Proposal Generated
Include Upgrades
Include Financing
Recommended Package
Proposal URL
Agreement Triggered
Agreement URL

## Simplified visual flow
Lead / Estimator
 → Google Sheet row
 → Operator review
 → Generate Proposal = Yes
 → Proposal Generator
 → Proposal URL returned
 → Customer selects package
 → Customer selects upgrades
 → Agreement Webhook
 → Final agreement PDF
 → Client copy + internal email copy
