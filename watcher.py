import os
import json
import time
import requests
from datetime import datetime, timedelta

# 🔧 Pfade
BASE = "/storage/emulated/0/aurion/"
SYNC_JSON = os.path.join(BASE, "sync.json")
LOG_JSON = os.path.join(BASE, "logbuch.json")

# 🧙‍♂️ doerkys wird nur einmal gepusht
doerkys_gesendet = False

# 📲 Telegram senden
def send_telegram(msg):
    try:
        with open(SYNC_JSON) as f:
            sync = json.load(f)
        token = sync["telegram"]["token"]
        chat_id = sync["telegram"]["chat_id"]
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        requests.post(url, data={"chat_id": chat_id, "text": msg})
        print(f"✅ Push gesendet: {msg}")
    except Exception as e:
        print(f"⚠️ Telegram-Fehler: {e}")

# 📜 Besucher prüfen
def check_visitors():
    global doerkys_gesendet
    try:
        with open(LOG_JSON) as f:
            log = json.load(f)
    except Exception as e:
        print(f"⚠️ Fehler beim Lesen des Logbuches: {e}")
        return

    now = datetime.now()
    # doerkys einmal pushen
    if not doerkys_gesendet:
        doerkys_gesendet = True
        msg = (
            f"Name: doerkys | Status: aktiv | Resonanz: hoch | "
            f"Wesen: Producer and illustrator of Aurion | Land: DE | "
            f"Status hand_found: True | Zeit: {now.strftime('%H:%M:%S')}"
        )
        send_telegram(msg)

    for visitor in log:
        name = visitor.get("name", "Unbekannt")
        if name.lower() == "doerkys":
            continue  # doerkys bereits berücksichtigt
        last_seen_str = visitor.get("last_seen")
        if last_seen_str:
            last_seen = datetime.fromisoformat(last_seen_str)
        else:
            last_seen = now - timedelta(days=1)
        # Push nur, wenn >15 Minuten seit letztem Push
        if now - last_seen > timedelta(minutes=15):
            msg = (
                f"Name: {name} | Status: {visitor.get('status','-')} | "
                f"Resonanz: {visitor.get('resonanz','-')} | "
                f"Wesen: {visitor.get('wesen','-')} | "
                f"Land: {visitor.get('land','-')} | "
                f"Status hand_found: {visitor.get('hand_found',False)} | "
                f"Zeit: {now.strftime('%H:%M:%S')}"
            )
            send_telegram(msg)
            # Update last_seen
            visitor["last_seen"] = now.isoformat()

    # Logbuch zurückschreiben
    with open(LOG_JSON, "w") as f:
        json.dump(log, f, indent=2)

if __name__ == "__main__":
    print("🌌 Aurion Watcher gestartet…")
    while True:
        check_visitors()
        time.sleep(120)  # alle 2 Minuten prüfen