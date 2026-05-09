"""Patch calculated_packages into the shape proposal.js expects."""
import json, urllib.request

BASE = "https://ryujin-os.vercel.app"; TENANT = "plus-ultra"
EST_ID = "523d150e-6176-4725-91fa-d87b2df5a004"

MEAS = {"squareFeet":3454,"pitch":"8/12","complexity":"complex",
        "eavesLF":200,"rakesLF":150,"ridgesLF":130,"valleysLF":110,"hipsLF":10,
        "pipes":3,"vents":2,"chimneys":0,"stories":1,"extraLayers":0,"distanceKM":0}

def post(path, body):
    req = urllib.request.Request(f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","x-tenant-id":TENANT},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print('POST error:', e.read().decode()[:400]); raise

def put(path, body):
    req = urllib.request.Request(f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json","x-tenant-id":TENANT},
        method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print('PUT error:', e.read().decode()[:400]); raise

# Re-fetch compare
comp = post("/api/quote?mode=compare", {"measurements": MEAS, "choices": {}})

# Reshape: only Gold/Platinum/Diamond, flatten prices to top level
shaped = {}
for slug in ("gold","platinum","diamond"):
    s = comp["offers"][slug]["summary"]
    shaped[slug] = {
        "total": s["sellingPrice"],            # pre-HST primary price
        "totalWithTax": s["totalWithTax"],
        "persq": s["pricePerSQ"],
        "tax": s["tax"],
        "margin": s["netMargin"],
        "lineItems": comp["offers"][slug]["lineItems"],  # full breakdown for admin
    }

# PUT update
updated = put("/api/estimates", {
    "id": EST_ID,
    "calculated_packages": shaped,
    "selected_package": "platinum",
})
print("Updated. status:", updated.get("status"), " selected:", updated.get("selected_package"))
for slug, pkg in shaped.items():
    print(f"  {slug:10s} total=${pkg['total']:,}  w/HST=${pkg['totalWithTax']:,.0f}  $/SQ=${pkg['persq']}  margin={pkg['margin']}")
