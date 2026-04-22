/**
 * AURION ENGINE V1.1
 * Zentrale Steuerung für Eye-Tracking & Head-Gaze
 * Korrektur: Achsen-Spiegelung für X und Y aktiv.
 */

const Aurion = {
    mode: 'cursor', 
    currentY: 0,
    speed: 0,
    friction: 0.95, 
    isReady: false,
    faceMesh: null,
    camera: null,

    async start(targetMode = 'cursor') {
        this.mode = targetMode;
        console.log("Aurion Engine startet im Modus: " + targetMode);
        
        try {
            await this.initKI();
        } catch (error) {
            console.error("KI-Initialisierung fehlgeschlagen:", error);
        }
    },

    async initKI() {
        // Sucht die Kamera oder erstellt ein verstecktes Video-Element
        const videoElement = document.getElementById('cam') || document.createElement('video');
        
        // MediaPipe FaceMesh Initialisierung
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

        // Kamera-Setup
        this.camera = new Camera(videoElement, {
            onFrame: async () => {
                await this.faceMesh.send({image: videoElement});
            },
            width: 640,
            height: 480
        });

        await this.camera.start();
        this.isReady = true;
        console.log("Aurion Engine bereit und Achsen kalibriert.");
    },

    process(landmarks) {
        // Nasenspitze als Referenzpunkt (Index 1)
        const nose = landmarks[1];

        // ACHSEN-SPIEGELUNG
        // Wir ziehen die Werte von 1 ab, um die Kamera-Invertierung aufzuheben
        const flippedX = 1 - nose.x; 
        const flippedY = 1 - nose.y; 

        if (this.mode === 'scroll') {
            /**
             * SCROLL-MODUS (Bücher)
             * Wir nutzen flippedY für das "Gaspedal-Gefühl"
             */
            const offset = flippedY - 0.5; // Mitte bei 0.5
            
            // Totzone, um unbeabsichtigtes Scrollen zu vermeiden
            if (Math.abs(offset) > 0.05) {
                const direction = offset > 0 ? 1 : -1;
                // Beschleunigung basierend auf Neigung
                this.speed += (offset * offset * direction) * 12;
            }
            
            this.speed *= this.friction; // Reibung für sanften Stopp
            this.executeScroll();
        } else {
            /**
             * CURSOR-MODUS (Bibliothek / Vorhof)
             * Übergibt die korrigierten Koordinaten an das UI-Script
             */
            if (typeof updateGazeDot === "function") {
                updateGazeDot(flippedX, flippedY);
            }
        }
    },

    executeScroll() {
        if (Math.abs(this.speed) > 0.1) {
            this.currentY -= this.speed;
            
            // Verhindert das Scrollen über den oberen Rand hinaus
            if (this.currentY > 0) {
                this.currentY = 0;
                this.speed = 0;
            }
            
            // Verschiebt den Content-Container
            const content = document.getElementById('content');
            if (content) {
                content.style.transform = `translateY(${this.currentY}px)`;
            }
        }
    }
};

// Global verfügbar machen
window.Aurion = Aurion;
