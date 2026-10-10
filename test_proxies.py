import requests
import urllib.parse
import sys

url = "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_1.xml"
proxies = [
    "https://corsproxy.io/?url=",
    "https://api.allorigins.win/raw?url="
]

headers = {"User-Agent": "politmus-data-workers (https://politmus.com)"}

for p in proxies:
    full_url = p + urllib.parse.quote(url)
    try:
        r = requests.get(full_url, headers=headers, timeout=10)
        print(f"{p}: {r.status_code} ({len(r.content)} bytes)")
    except Exception as e:
        print(f"{p}: Error {e}")
