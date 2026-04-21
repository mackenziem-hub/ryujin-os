# Official Pricing Logic
This document defines the pricing structure used by:
Instant Estimator
Internal Estimator Spreadsheet
Proposal Generator
Automation System
All estimates must follow this logic.

# 1. Core Pricing Formula
Every project begins with the same base formula.
Hard Cost =
 Materials
Labor
Project Adders
Selling Price is then calculated using the package multiplier.
Selling Price = Hard Cost × Package Multiplier

# 2. Company Cost Structure
The company operates with a fixed operational allocation built into pricing.
Total operational allocation = 35%
These allocations are included in the package multipliers.

# 3. Package Pricing Multipliers
These multipliers convert Hard Cost into selling price.
Multipliers already include:
sales commission
marketing
company overhead
net profit
No additional markup should be applied after this step.

# 4. Remote Location Pricing Modifier
Projects outside the primary service region require additional operational overhead.
Typical additional overhead:
travel time
lodging
fuel
crew per diem
material logistics
lost productivity
Remote jobs increase the effective overhead from 20% to approximately 30%.
This results in adjusted multipliers.
Estimator logic:
IF province = NB
 → use local multipliers
IF province = PEI or remote region
 → use remote multipliers

# 5. Asphalt Roofing Material Systems
### Gold Package
Materials include:
CertainTeed Landmark shingles
Synthetic underlayment
Ice and water protection
Starter shingles
Ridge cap shingles
Standard flashing
Standard ventilation
Workmanship warranty: 15 years

### Platinum Package
Materials include:
CertainTeed Landmark Pro shingles
Premium synthetic underlayment
Grace ice and water shield
Starter shingles
Ridge caps
Metal valleys
Upgraded ventilation
Workmanship warranty: 20 years
Warranty upgrade cost guideline:
$25 per square

### Diamond Package
Materials include:
CertainTeed Presidential designer shingles
Premium underlayment system
Grace ice and water protection
Starter shingles
Ridge cap shingles
Premium flashing system
Enhanced ventilation
Workmanship warranty: 25 years
Warranty upgrade cost guideline:
$50 per square

# 6. Asphalt Roofing Labor Pricing
Labor is calculated using measured roof area before waste factor.

# 7. Roofing Labor Adders

# 8. Distance Adders

# 9. Chimney Work

# 10. Metal Roofing Systems
Two metal roofing systems are offered.
### Ribbed Panel Metal
Economical exposed fastener system.
Common uses:
garages
agricultural buildings
cost-sensitive residential jobs

### European Clay Imitation Metal
Premium metal tile system.
Features:
clay tile appearance
long lifespan
architectural aesthetic

# 11. Metal Installation Packages
### Standard
tear off roof
install metal system
Warranty: 15 years

### Enhanced
tear off roof
seal roof deck
install metal
Warranty: 20 years
Upgrade cost guideline:
$25 per square

### Premium
tear off roof
redeck roof
seal deck
install metal
Warranty: 25 years
Upgrade cost guideline:
$50 per square

# 12. Metal Roofing Labor Pricing

# 13. Siding Systems
Supported siding systems include:
vinyl siding
premium vinyl siding
engineered wood
fiber cement
Pricing must account for:
Material cost
 Labor cost
 Trim components
 Housewrap
 Removal labor
Final price is calculated using the same multiplier model.

# 14. Soffit and Fascia Pricing
Typical installed pricing targets:
Combined soffit/fascia installations typically fall between:
$35–$45 per LF

# 15. Gutter Systems
Standard offering:
5" aluminum seamless gutters
Typical installed price:
$10 per LF
Additional components:

# 16. Roof Deck Replacement
Redecking is treated as a conditional repair.
Installed cost guideline:
$103.50 per sheet installed
Typical roof estimate:
80–100 sheets possible on full redeck.
This item is usually presented as:
optional repair allowance
or
conditional replacement cost

# 17. Upgrade Structure
Upgrades are offered after package selection.
Typical upgrade options:
seamless gutters
soffit replacement
fascia replacement
siding replacement
deck protection plan
skylight replacement
ventilation upgrades
Upgrades are priced individually and added to the final contract total.

# 18. Estimating Workflow
All estimators must follow this workflow.
Measure roof area
Apply waste factor
Calculate materials
Calculate labor
Add project adders
Apply correct pricing model (local vs remote)
Apply package multiplier
Verify margin target
Deliver package pricing

# 19. Proposal Generation Logic
The proposal generator reads estimator outputs and builds the proposal using:
package prices
scope descriptions
upgrade options
warranty language
timeline expectations
Upgrades appear after package selection.

# 20. Agreement Generation
When a customer selects a package and upgrades:
A webhook triggers the agreement generator.
The agreement includes:
chosen package
chosen upgrades
final project scope
total price
tax
terms and conditions
Agreement PDF is sent to:
customer
internal email copy

# Final Pricing System Summary
Estimator Engine
 → calculates project pricing
Google Sheet
 → stores proposal data and triggers automation
Proposal Generator
 → builds client-facing proposal
Upgrade Selector
 → captures optional add-ons
Agreement Generator
 → produces final signed scope


| Category | Allocation |
|---|---|
| Sales Commission | 10% |
| Marketing | 5% |
| Company Overhead | 20% |

| Package | Target Net Profit | Multiplier |
|---|---|---|
| Gold | ~12% | 1.47 |
| Platinum | ~17% | 1.52 |
| Diamond | ~23% | 1.58 |

| Package | Local | Remote |
|---|---|---|
| Gold | 1.47 | 1.62 |
| Platinum | 1.52 | 1.67 |
| Diamond | 1.58 | 1.74 |

| Roof Pitch | Labor |
|---|---|
| Up to 6/12 | $130 per square |
| 7/12 – 9/12 | $160 per square |
| 10/12 – 12/12 | $190 per square |

| Item | Cost |
|---|---|
| Redecking | $30 per sheet |
| Ridge vent install | $2 per LF |
| Extra shingle layer | $40 per layer |
| Cedar tear-off | $70 per SQ |
| Maximum vent install | $50 per vent |

| Distance | Cost |
|---|---|
| 30–60 km | +$20 per SQ |
| 60+ km | +$30 per SQ |

| Item | Cost |
|---|---|
| Small chimney flashing | $125 |
| Large chimney flashing | $350 |
| Cricket build | $150 |

| Roof Pitch | Labor |
|---|---|
| Low pitch | $250 / SQ |
| Moderate pitch | $300 / SQ |
| Steep pitch | $350 / SQ |

| Item | Installed Price |
|---|---|
| Soffit | $30–$40 / LF |
| Fascia | $20–$30 / LF |

| Item | Cost |
|---|---|
| Leaf guard install | $2 / LF labor |
| Downspout install | $5 per unit |