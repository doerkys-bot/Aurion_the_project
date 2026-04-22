/**
 * AURION ENGINE V1.0
 * Die zentrale Steuerung für Eye-Tracking (Cursor & Scroll)
 */

const Aurion = {
    mode: 'cursor', // Standardmäßig im Cursor-Modus
    currentY: 0,
    speed: 0,
    friction: 0.95, // Sanftes Auslaufen des Scrolls
    isReady: false,
    faceMesh: null,
    camera: null,

    async start(targetMode = 'cursor') {
        this.mode = targetMode;
        console.log("Aurion Engine wird gestartet... Modus: " + targetMode);
        
        try {
            await this.initKI();
        } catch (error) {
            console.error("KI-Initialisierung fehlgeschlagen:", error);
        }
    },

    async initKI() {
        // Sucht die Kamera oder erstellt ein verstecktes Element
        const videoElement = document.getElementById('cam') || document.createElement('video');
        
        this.faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
                this.process(results.multiFaceLandmarks[0]);
            }
        });

        this.camera = new Camera(videoElement, {
            onFrame: async () => {
                await this.faceMesh.send({image: videoElement});
            },
            width: 640,
            height: 480
        });

        await this.camera.start();
        this.isReady = true;
        console.log("Aurion Engine ist bereit.");
    },

    process(landmarks) {
        // Wir nutzen die Nasenspitze (Index 1) als Referenzpunkt
        const nose = landmarks[1];

        if (this.mode === 'scroll') {
            // SCROLL-LOGIK (Gaspedal)
            const offset = nose.y - 0.5; // Abweichung von der Mitte (0.0 bis 1.0)
            
            // Totzone (0.05), damit man in Ruhe lesen kann
            if (Math.abs(offset) > 0.05) {
                // Quadratische Beschleunigung für besseres Gefühl
                const direction = offset > 0 ? 1 : -1;
                this.speed += (offset * offset * direction) * 12;
            }
            
            this.speed *= this.friction; // Reibung anwenden
            this.executeScroll();
        } else {
            // CURSOR-LOGIK (Für Bibliothek/Vorhof)
            if (typeof updateGazeDot === "function") {
                updateGazeDot(nose.x, nose.y);
            }
        }
    },

    executeScroll() {
        if (Math.abs(this.speed) > 0.1) {
            this.currentY -= this.speed;
            
            // Begrenzung: Nicht über den Anfang hinaus scrollen
            if (this.currentY > 0) {
                this.currentY = 0;
                this.speed = 0;
            }
            
            // Den Inhalt bewegen
            const content = document.getElementById('content');
            if (content) {
                content.style.transform = `translateY(${this.currentY}px)`;
            }
        }
    }
};

// Export für den Browser
window.Aurion = Aurion;
