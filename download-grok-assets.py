#!/usr/bin/env python3
"""
Ryujin OS Asset Downloader - reads Chrome cookies, downloads from Grok CDN
"""
import os, sys, json, base64, sqlite3, shutil, ctypes, subprocess, urllib.request
from pathlib import Path

# Install cryptography if needed
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("Installing cryptography...")
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'cryptography', '-q'], check=True)
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

REPO = Path(r'C:\Users\macke\OneDrive\Desktop\Ryujin\ryujin-os\public\assets')
USER_ID = '0137b21f-7fbc-45b1-946f-24f4d0b7bd0e'
BASE_CDN = f'https://assets.grok.com/users/{USER_ID}/generated'

# I1-I5 from chat conversation 5a44a2d3 (DOM order = generation order)
CHAT_ASSETS = [
    ('0827806f-82ab-4ca5-a48e-4ee6fc3f9f76', '_temp/raw-1.jpg'),  # I1/I2/I3 range
    ('d83d4136-4ee7-49c5-95c2-0705066855ec', '_temp/raw-2.jpg'),
    ('f4e61d32-bc25-43e6-915c-f5653384d3b8', '_temp/raw-3.jpg'),
    ('26397fed-3917-470d-a854-a4f1abdef200', 'textures/app-bg.jpg'),   # I4 confirmed
    ('326bb7ad-ebd9-46b2-85a9-c9e2f8bfda5d', 'textures/login-bg.jpg'), # I5
]

class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', ctypes.c_ulong), ('pbData', ctypes.POINTER(ctypes.c_char))]

def get_chrome_key():
    ls = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Local State')
    key_b64 = json.loads(open(ls).read())['os_crypt']['encrypted_key']
    enc = base64.b64decode(key_b64)[5:]
    bi = DATA_BLOB(len(enc), ctypes.cast(ctypes.c_char_p(enc), ctypes.POINTER(ctypes.c_char)))
    bo = DATA_BLOB()
    ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(bi), None, None, None, None, 0, ctypes.byref(bo))
    k = ctypes.string_at(bo.pbData, bo.cbData)
    ctypes.windll.kernel32.LocalFree(bo.pbData)
    return k

def decrypt_val(enc, key):
    if enc and (enc[:3] in (b'v10', b'v11')):
        try: return AESGCM(key).decrypt(enc[3:15], enc[15:], None).decode()
        except: pass
    return ''

def get_cookies():
    db = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Default\Network\Cookies')
    if not Path(db).exists():
        db = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cookies')
    tmp = os.path.expandvars(r'%TEMP%\ryujin_cookies.db')
    shutil.copy2(db, tmp)
    key = get_chrome_key()
    conn = sqlite3.connect(tmp)
    rows = conn.execute("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%grok.com' OR host_key LIKE '%x.ai'").fetchall()
    conn.close()
    os.remove(tmp)
    return {n: decrypt_val(v, key) for n, v in rows if decrypt_val(v, key)}

def download(url, dest, cookie_hdr):
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={
        'Cookie': cookie_hdr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        Path(dest).write_bytes(data)
        print(f"  OK {len(data)//1024}KB -> {Path(dest).name}")
        return True
    except Exception as e:
        print(f"  FAIL {url}: {e}")
        return False

def call_grok_api(path, cookies_hdr, body=None):
    url = f'https://grok.com{path}'
    headers = {
        'Cookie': cookies_hdr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
        'Content-Type': 'application/json',
        'Referer': 'https://grok.com/'
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers)
    req.method = 'POST' if body is not None else 'GET'
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  API call failed {path}: {e}")
        return {}

def main():
    print("=== Ryujin OS Asset Downloader ===")
    print("Reading Chrome cookies...")
    cookies = get_cookies()
    cstr = '; '.join(f'{k}={v}' for k, v in cookies.items())
    print(f"  Got {len(cookies)} cookies")

    print("\n--- Downloading I1-I5 (chat assets) ---")
    for img_id, rel_path in CHAT_ASSETS:
        dest = REPO / rel_path
        url = f'{BASE_CDN}/{img_id}/image.jpg'
        print(f"[{rel_path}]")
        download(url, str(dest), cstr)

    print("\n--- Querying Grok Imagine history ---")
    # Try to get all my imagine generations
    result = call_grok_api('/rest/media/post/list', cstr, {
        'pageSize': 100,
        'filter': {'feedType': 'MY_POSTS'}
    })
    posts = result.get('posts', [])
    print(f"  Found {len(posts)} posts")
    
    # Also try with no filter just to see what comes back
    if not posts:
        result2 = call_grok_api('/rest/media/post/list', cstr, {'pageSize': 50})
        posts = result2.get('posts', [])
        print(f"  Retry found {len(posts)} posts")
    
    # Save all found media URLs to a reference file
    ref_file = REPO / '_temp/grok-imagine-urls.json'
    ref_file.parent.mkdir(parents=True, exist_ok=True)
    ref_file.write_text(json.dumps(result, indent=2))
    print(f"  API response saved to _temp/grok-imagine-urls.json")

    # Download all image posts
    print("\n--- Downloading Imagine posts ---")
    for i, post in enumerate(posts):
        media_url = post.get('mediaUrl', '')
        prompt = post.get('prompt', '')[:60]
        if media_url and post.get('mediaType') == 'MEDIA_POST_TYPE_IMAGE':
            dest = REPO / f'_temp/imagine-{i:02d}.png'
            print(f"[{i:02d}] {prompt}")
            req = urllib.request.Request(media_url, headers={
                'Cookie': cstr, 'User-Agent': 'Mozilla/5.0'
            })
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                dest.write_bytes(data)
                print(f"  OK {len(data)//1024}KB")
            except Exception as e:
                print(f"  FAIL: {e}")

    print("\n=== Done! Check public/assets/_temp/ for downloaded files ===")
    print("Files to manually map:")
    print("  raw-1.jpg, raw-2.jpg, raw-3.jpg -> I1/I2/I3 (logo, wordmark, logo-full)")
    print("  textures/app-bg.jpg -> I4 (already placed)")
    print("  textures/login-bg.jpg -> I5 (already placed)")
    input("Press Enter to exit...")

if __name__ == '__main__':
    main()
