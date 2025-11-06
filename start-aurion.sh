#!/data/data/com.termux/files/usr/bin/bash

# 1️⃣ Updates & Python installieren
pkg update && pkg upgrade -y
pkg install python unzip lsof -y

# 2️⃣ Speicherzugriff erlauben
termux-setup-storage

# 3️⃣ Aurion-Pfad setzen (keine Leerzeichen!)
AURON_DIR="/storage/emulated/0/Download/aurion/aurion_local/www"
cd "$AURON_DIR" || { echo "❌ Ordner nicht gefunden: $AURON_DIR"; exit 1; }

# 4️⃣ images-Ordner prüfen und verschieben, falls nötig
if [ ! -d images ] && [ -d aurion_images ]; then
    echo "🚀 Verschiebe aurion_images zu images ..."
    mv aurion_images images
fi

# 5️⃣ Wichtige Dateien prüfen
REQUIRED_FILES=("index.html" "aurion-paths.js" "app.js" "config.json")
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        if [ "$f" = "config.json" ]; then
            echo "⚠️ $f fehlt → erstelle Minimalversion..."
            cat > config.json <<'EOF'
{
  "name": "Aurion",
  "version": "1.0",
  "description": "Lokale Testkonfiguration",
  "author": "Dirk"
}
EOF
            echo "✅ config.json erstellt"
        else
            echo "⚠️ FEHLT: $f"
        fi
    else
        echo "✅ Vorhanden: $f"
    fi
done

# 6️⃣ images-Inhalt prüfen
REQUIRED_IMAGES=("cover.png" "background.jpg" "icon.png")
for img in "${REQUIRED_IMAGES[@]}"; do
    if [ ! -f "images/$img" ]; then
        echo "⚠️ FEHLT: images/$img → bitte hinzufügen"
    else
        echo "✅ Vorhanden: images/$img"
    fi
done

# 7️⃣ Alte Server auf Port 8080 beenden (falls vorhanden)
if lsof -i :8080 > /dev/null; then
    echo "⚠️ Alter Server auf Port 8080 läuft → wird beendet..."
    fuser -k 8080/tcp
fi

# 8️⃣ Webserver starten
echo "🚀 Starte Aurion-Webserver auf Port 8080 ..."
python3 -m http.server 8080