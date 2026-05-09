"""Upload before + after photos to the existing 9 Heron Ct estimate."""
import json, urllib.request, mimetypes, os, uuid

BASE = "https://ryujin-os.vercel.app"
TENANT = "plus-ultra"
ESTIMATE_ID = "b0184069-3002-4224-be33-e356636cfc02"
FOLDER = r"C:\Users\macke\OneDrive\Desktop\Plus Ultra\Jobs\9 Heron Ct"

PHOTOS = [
    ("before photo.png", "before"),
    ("after photo.jpg",  "after"),
]


def upload(estimate_id, file_path, caption):
    boundary = uuid.uuid4().hex
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="estimate_id"\r\n\r\n{estimate_id}\r\n'.encode()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="is_cover"\r\n\r\nfalse\r\n'.encode()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="caption"\r\n\r\n{caption}\r\n'.encode()
    fname = os.path.basename(file_path)
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="photos"; filename="{fname}"\r\n'.encode()
    body += f"Content-Type: {ctype}\r\n\r\n".encode()
    with open(file_path, "rb") as f:
        body += f.read()
    body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{BASE}/api/estimate-photos?tenant={TENANT}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "x-tenant-id": TENANT},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


for fname, caption in PHOTOS:
    path = os.path.join(FOLDER, fname)
    if not os.path.exists(path):
        print(f"SKIP missing: {fname}")
        continue
    try:
        r = upload(ESTIMATE_ID, path, caption)
        for p in r.get("photos", []):
            if p.get("error"):
                print(f"FAIL {fname}: {p['error']}")
            else:
                print(f"OK   {fname}  caption={p.get('caption')}")
    except Exception as e:
        print(f"ERROR {fname}: {e}")
