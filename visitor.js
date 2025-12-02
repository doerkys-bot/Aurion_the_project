// visitor.js - Besucher-Tracking für Aurion-Räume

const VISITOR_ID = 'Besucher_' + Math.floor(Math.random() * 1000000); // einmalige ID pro Browser/Session
let CURRENT_ROOM = window.location.pathname.replace('.html','');        // Raumname automatisch aus URL
const UPDATE_INTERVAL = 5000; // 5 Sekunden

// Hilfsfunktion zum Senden an Server
async function sendUpdate(payload, endpoint) {
    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error('Fehler beim Senden:', err);
    }
}

// Meldung beim Betreten des Raumes
async function enterRoom() {
    await sendUpdate({ id: VISITOR_ID, room: CURRENT_ROOM }, '/update_visitors');
    console.log(`Eintritt: ${VISITOR_ID} in ${CURRENT_ROOM}`);
}

// Meldung beim Verlassen der Seite
window.addEventListener('beforeunload', async () => {
    await sendUpdate({ id: VISITOR_ID }, '/remove_visitor');
    console.log(`Austritt: ${VISITOR_ID} aus ${CURRENT_ROOM}`);
});

// Raumwechsel prüfen (optional, falls du dynamische Navigation innerhalb der Seite hast)
let lastRoom = CURRENT_ROOM;
setInterval(async () => {
    const newRoom = window.location.pathname.replace('.html','');
    if (newRoom !== lastRoom) {
        await sendUpdate({ id: VISITOR_ID, from: lastRoom, to: newRoom }, '/update_visitors');
        console.log(`Raumwechsel: ${VISITOR_ID} von ${lastRoom} nach ${newRoom}`);
        lastRoom = newRoom;
    }
}, UPDATE_INTERVAL);

// Starte das Tracking
enterRoom();
setInterval(enterRoom, UPDATE_INTERVAL);
