# PLUS ULTRA ROOFING
# MASTER PRICING ENGINE (Filled Version)

# SHEET — MATERIALS_MASTER

# SHEET — MATERIAL_QUANTITY_RULES

# SHEET — LABOR_RATES

# SHEET — EXTERIOR_LABOR

# SHEET — PROJECT_OVERHEAD

# SHEET — PACKAGE_MULTIPLIERS
These already include:
sales 10%
marketing 5%
overhead 20%

# REMOTE JOB MULTIPLIERS
Based on PEI travel overhead modeling
These absorb:
ferry
travel
lodging
mobilization
risk

# SHEET — PACKAGE_FEATURES
### Gold
• Landmark shingles
 • synthetic underlayment
 • ice and water protection
 • starter strip
 • ridge cap
 • standard flashing
 • standard ventilation
Workmanship warranty
 15 years

### Platinum
• Landmark Pro shingles
 • premium synthetic
 • Grace ice and water
 • starter strip
 • ridge cap
 • metal valleys
 • upgraded ventilation
Workmanship warranty
 20 years
Upgrade cost
 +$25/SQ

### Diamond
• CertainTeed Presidential
 • premium underlayment system
 • Grace ice and water
 • starter strip
 • ridge cap
 • premium flashing
 • enhanced ventilation
Workmanship warranty
 25 years
Upgrade cost
 +$50/SQ

# SHEET — UPGRADE_PRICES
These match your earlier target ranges.

# CALCULATION ENGINE
## Step 1 — Material Cost
Material Total = SUM(Material Qty × Material Cost)

## Step 2 — Labor Cost
Labor Total =
(SQ × Labor Rate)
+ Valley labor
+ Vent installs
+ Pipe flashing installs
+ Chimney work
+ Decking labor

## Step 3 — Hard Cost
Hard Cost = Materials + Labor + Adders

## Step 4 — Package Pricing
Gold Price = Hard Cost × 1.47
Platinum Price = Hard Cost × 1.52
Diamond Price = Hard Cost × 1.58
Remote job:
Gold Price = Hard Cost × 1.60
Platinum Price = Hard Cost × 1.65
Diamond Price = Hard Cost × 1.72

# RESULT OUTPUT
Estimator produces:
Also outputs:
Material cost
 Labor cost
 Hard cost
 Margin

# Why this matrix works
It keeps your system:
deterministic
consistent
margin protected
easy to modify
Change one price, everything updates.
Exactly what your Estimator OS needs.



| Material | Unit | Cost | Notes |
|---|---|---|---|
| Landmark Shingles | bundle | 49 | confirmed |
| Designer Shingles | bundle | 90 | confirmed |
| Starter Strip | bundle | 52 | typical |
| Ridge Cap | bundle | 55 | typical |
| Ice & Water (Grace) | roll | 178 | confirmed |
| Synthetic Underlayment | roll | 167 | confirmed |
| Roof Runner Synthetic | roll | 167 | same material |
| Drip Edge | piece | 17.99 | confirmed |
| Metal Valley | sheet | 32 | confirmed |
| Pipe Flashing | each | 20 | confirmed |
| Maximum Vent | each | 50 | confirmed |
| OSB 7/16 | sheet | 34 | Atlantic wholesale |
| Aluminum Fascia | LF | 2.5 | material only |
| Aluminum Soffit | LF | 2.3 | material only |
| Aluminum Gutters | LF | 10 | 5" aluminum |
| Downspout | each | 18 | typical |
| Vinyl Siding | SQ FT | 3.10 | mid-grade |
| Leaf Guard | LF | 7 | mid-range |

| Component | Formula |
|---|---|
| Shingles (Gold/Platinum) | SQ × 3 |
| Shingles (Diamond) | SQ × 4 |
| Ice & Water | (Eaves + Valleys) ÷ 60 |
| Synthetic Underlayment | SQ ÷ 10 |
| Drip Edge | LF ÷ 10 |
| Starter | Total Eves+ total rakes |
| Ridge Cap | Ridge ÷ 30 |
| Pipe Flashing | count |
| Maximum Vent | count |
| Metal Valley | Valley LF ÷ 10 |

| Item | Unit | Cost |
|---|---|---|
| Base install labor | SQ | 130 |
| 7–9 pitch modifier | SQ | +30 |
| 10–12 pitch modifier | SQ | +60 |
| Valley install | LF | 1.5 |
| Chimney flashing | each | 150 |
| Maximum vent install | each | 50 |
| Pipe flashing install | each | 20 |
| Tear-off second layer | SQ | 40 |
| Cedar tear-off | SQ | 70 |
| Decking install | sheet | 30 |

| Component | Unit | Cost |
|---|---|---|
| Soffit install | LF | 16 |
| Fascia install | LF | 14 |
| Gutter install | LF | 9 |
| Downspout install | each | 22 |
| Vinyl siding install | SQ FT | 1.75 |
| Fiber cement install | SQ FT | 3.75 |

| Item | Cost |
|---|---|
| Daily overhead | 110 |
| Local overhead % | 20% |
| Mobilization local | 0 |
| Mobilization remote | 1500 |
| Lodging per night | 180 |
| Per diem per worker | 60 |

| Package | Multiplier |
|---|---|
| Gold | 1.47 |
| Platinum | 1.52 |
| Diamond | 1.58 |

| Package | Multiplier |
|---|---|
| Gold Remote | 1.60 |
| Platinum Remote | 1.65 |
| Diamond Remote | 1.72 |

| Upgrade | Unit | Price |
|---|---|---|
| Redeck | sheet | 95 |
| Soffit | LF | 35 |
| Fascia | LF | 25 |
| Gutters | LF | 18 |
| Leaf Guard | LF | 12 |
| Downspouts | each | 85 |
| Vinyl siding | SQ FT | 11 |
| Fiber cement siding | SQ FT | 18 |
| Skylight install | each | 900 |
| Ventilation upgrade | each | 120 |

| Package | Price |
|---|---|
| Gold | $ |
| Platinum | $ |
| Diamond | $ |