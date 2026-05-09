import json, urllib.request
BASE="https://ryujin-os.vercel.app"; TENANT="plus-ultra"
EST="523d150e-6176-4725-91fa-d87b2df5a004"
MEAS={"squareFeet":3454,"pitch":"8/12","complexity":"complex",
      "eavesLF":200,"rakesLF":150,"ridgesLF":130,"valleysLF":110,"hipsLF":10,
      "pipes":3,"vents":2,"chimneys":0,"stories":1,"extraLayers":0,"distanceKM":0}

def req(path, method, body=None):
    r=urllib.request.Request(f"{BASE}{path}{'&' if '?' in path else '?'}tenant={TENANT}",
        data=json.dumps(body).encode() if body else None,
        headers={"Content-Type":"application/json","x-tenant-id":TENANT}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x: return json.loads(x.read())
    except urllib.error.HTTPError as e:
        print('ERR', e.read().decode()[:300]); raise

# Re-run compare with new multipliers
comp = req("/api/quote?mode=compare", "POST", {"measurements": MEAS, "choices": {}})

shaped = {}
for slug in ("gold","platinum","diamond"):
    s = comp["offers"][slug]["summary"]
    shaped[slug] = {
        "total": s["sellingPrice"],
        "totalWithTax": s["totalWithTax"],
        "persq": s["pricePerSQ"],
        "tax": s["tax"],
        "margin": s["netMargin"],
        "lineItems": comp["offers"][slug]["lineItems"],
    }

upd = req("/api/estimates", "PUT",
    {"id": EST, "calculated_packages": shaped, "selected_package": "platinum"})

print("Updated estimate:", upd.get("id"), "selected:", upd.get("selected_package"))
print()
print(f"{'Tier':12s} {'Pre-HST':>11s} {'w/HST':>11s} {'$/SQ':>7s} {'Gross Margin':>14s}")
print('-'*60)
for slug, pkg in shaped.items():
    print(f"{slug:12s} ${pkg['total']:>9,.0f} ${pkg['totalWithTax']:>9,.0f} ${pkg['persq']:>5}  {pkg['margin']:>14s}")
print()
print("After real net (subtract 10% sales + 5% mkt + 20% OH = 35%):")
for slug, pkg in shaped.items():
    gross = float(pkg['margin'].rstrip('%'))/100
    real_net = (gross - 0.35) * 100
    print(f"  {slug:10s} net = {real_net:+.1f}%   (${pkg['total']*(gross-0.35):>+8,.0f} profit on ${pkg['total']:,})")
