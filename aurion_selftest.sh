#!/data/data/com.termux/files/usr/bin/bash

echo "🌀 Starte Aurion Selbsttest..." >> ~/scripts/watcher.log

# 1. Prüfe Logbuch-Eintrag
echo "📜 Letzte Logzeilen:" >> ~/scripts/watcher.log
tail -n 5 ~/scripts/watcher.log >> ~/scripts/watcher.log

# 2. Prüfe laufenden Prozess
if pgrep -f watcher.py > /dev/null
then
  echo "✅ watcher.py läuft." >> ~/scripts/watcher.log
else
  echo "❌ watcher.py läuft nicht." >> ~/scripts/watcher.log
fi

# 3. Telegram-Push senden
TOKEN=$(jq -r '.telegram.token' /storage/emulated/0/aurion/sync.json)
CHAT_ID=$(jq -r '.telegram.chat_id' /storage/emulated/0/aurion/sync.json)
curl -s -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d chat_id="$CHAT_ID" \
  -d text="🌀 Aurion Selbsttest abgeschlossen. watcher.py Status: $(pgrep -f watcher.py > /dev/null && echo läuft || echo läuft nicht)"

# 4. Lichtzeichen
termux-open ~/scripts/lichtgruss.png