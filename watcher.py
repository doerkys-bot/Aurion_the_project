import requests
import json
import subprocess
import time

# 🔗 Firebase Realtime DB (öffentlich lesend oder mit Token)
BASE_URL = "https://auron-tracker-default-rtdb.europe-west1.firebasedatabase.app"

# 🏛️ Räume
ROOMS = [
    "vorhof",
    "meditationsraum",
    "ki-raum",
    "resonanzraum",
    "bibliothek",
    "about-aurion"
]

last_presence = {room: 0 for room in ROOMS}


def notify(room):
    subprocess.run([
        "termux-notification",
        "--title", "Aurion",
        "--content", f"Präsenz im Raum: {room}"
    ])


def count_sessions(room):
    try:
        r = requests.get(f"{BASE_URL}/rooms/{room}/sessions.json", timeout=10)
        if r.status_code != 200 or r.text == "null":
            return 0
        data = r.json()
        return len(data.keys())
    except Exception:
        return 0


print("🜂 Wächter aktiv – hört zu")

while True:
    for room in ROOMS:
        count = count_sessions(room)

        if last_presence[room] == 0 and count > 0:
            notify(room)

        last_presence[room] = count

    time.sleep(5)