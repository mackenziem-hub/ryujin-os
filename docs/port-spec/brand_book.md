# 1. Plus Ultra Roofing Brand Book (for the app + proposals)
You should absolutely upload a brand book into the build environment so the UI generator and proposal templates follow it consistently.
Here’s the structure I recommend.
## Brand Book Structure
### 1. Brand Overview
Purpose of the company.
Example:
Plus Ultra Roofing provides high-quality residential roofing and exterior upgrades in Atlantic Canada. The brand emphasizes durability, professionalism, and operational excellence.
Core values:
craftsmanship
reliability
transparency
premium service
disciplined operations
Tone:
professional
confident
clear
not flashy
contractor credibility

### 2. Logo Usage
Include:
Primary logo
 Secondary logo
 Icon version
Rules:
Minimum padding
 Background variations
 Do not distort or recolor rules.

### 3. Color System
Example structure:
Primary Blue
 Deep Navy
 Steel Gray
 Gold Accent
 White
Example palette (adjust if needed):
Primary Blue
 #1F4E78
Dark Navy
 #0F2A44
Gold Accent
 #C79A3B
Steel Gray
 #4A4A4A
Light Background
 #F5F7FA
Use:
Blue → headers / buttons
 Gold → highlight / premium package
 Gray → body text
 White → background

### 4. Typography
Primary font:
 Inter or Montserrat
Usage:
Headings
 Bold / strong
Body text
 Regular
Numbers / pricing
 Semi-bold
Avoid decorative fonts.

### 5. UI Style Rules
Estimator OS should follow these principles:
card-based layout
generous spacing
minimal clutter
dark text on light backgrounds
strong hierarchy
Buttons:
Primary Button
 Blue background
Secondary Button
 Outline
Action Button
 Gold

### 6. Proposal Layout System
Proposal pages should follow this order:
Cover
Project Overview
Package Options
Upgrade Options
Installation Process
Warranty
Company Credibility
Next Steps

### 7. Image Style
Images should be:
real jobsite photos
natural lighting
roof-level or street-level angles
minimal editing
no stock photos
This is very important for credibility.

### 8. Icon System
Use simple line icons for:
Roof
 Gutters
 Soffit
 Fascia
 Siding
 Ventilation
 Warranty
 Inspection
Avoid cartoonish icons.

### 9. Tone of Voice
Write like:
Experienced contractor explaining the job.
Avoid:
marketing hype
exclamation marks
gimmicky language
Prefer:
Clear statements.
Example:
Instead of
 "Upgrade to our incredible platinum system!"
Use
"The Platinum system includes upgraded ventilation and enhanced underlayment for long-term durability."

### 10. UI Components
Define consistent:
cards
dropdowns
toggles
sliders
step navigation

# 2. Visual Upgrade Mockups (this is powerful)
What you described is basically property visualization.
The easiest version to build first:
### Before / After Slider
Structure:
Original Photo | Modified Photo
User drags slider.
Libraries exist for this.
Use cases:
Roof replacement
 Siding replacement
 Gutter addition
 Fascia upgrade

# 3. AI Image Modification for Upgrades
You can absolutely generate upgrade visuals from the house photos.
Approach:
Input photo of house.
Prompt examples:
Roof
"Replace the existing roof with architectural asphalt shingles in Moiré Black. Maintain realistic lighting and roof geometry."
Metal Roof
"Replace the roof with dark charcoal standing seam metal roofing."
Siding
"Replace siding with light gray vinyl siding with white trim."
Gutters
"Add white aluminum gutters and downspouts along the roof edge."
Fascia
"Replace fascia with white aluminum fascia boards."

# 4. Implementation Method (Estimator OS)
Your estimator app could do this:
Step: Upload Photos
Then generate preview buttons:
Preview options:
New Roof
Metal Roof
New Siding
Gutters
Full Exterior
Each generates a visual variant.
Then you show:
Before / After slider
This becomes a powerful sales tool.

# 5. What the UI should look like
Example proposal section:
See Your Home With the Upgrade
Slider
Left side → current photo
 Right side → upgraded version
Caption:
"Example visualization of the Platinum roofing system."

# 6. Important limitation
Roof geometry AI is imperfect.
So use language like:
Visualization example — final installation may vary slightly.

# 7. Biggest advantage for you
Roofing companies almost never do this.
But homeowners LOVE it.
Especially for:
siding
metal roofing
full exterior
It massively increases confidence and emotional buy-in.

# 8. My recommendation for first implementation
Start simple:
Upload house photo
Generate one upgraded version
Show slider
Focus first on:
Roof
 Siding
 Full exterior
Don't overbuild it yet.
