/**
 * AURION ENGINE v1.2 - Professional WfbM Edition
 * Inklusive stabiler Spracherkennung & Glow-Logik
 */
 /* Core logic generated with Claude (Anthropic), reviewed and modified by [Name] */

class AurionEngine {
    constructor() {
        this.isRunning = false;
        this.rawX = window.innerWidth / 2;
        this.rawY = window.innerHeight / 2;
        this.smoothX = this.rawX;
        this.smoothY = this.rawY;
        this.smoothing = 0.08; // Geduldiger Dot
        
        this.blinkCount = 0;
        this.lastBlinkTime = 0;
        this.leftEyeClosed = false;
        
        this.currentTarget = null;
        this.synth = window.speechSynthesis;
        
        // Spracherkennung initialisieren
        const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (Speech) {
            this.recognition = new Speech();
            this.recognition.lang = 'de-DE';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;

            this.recognition.onstart = () => this.setMicGlow(true);
            this.recognition.onend = () => this.setMicGlow(false);
            this.recognition.onresult = (e) => {
                const text = e.results[0][0].transcript;
                const display = document.getElementById("outputDisplay");
                if(display) display.innerText = text;
                this.speak(text);
            };
        }

        this.initOverlay();
        setInterval(() => this.updateLoop(), 20);
    }

    initOverlay() {
        if(document.getElementById("aurion-overlay-root")) return;
        const overlay = document.createElement('div');
        overlay.id = "aurion-overlay-root";
        overlay.innerHTML = `
            <div id="aurion-topBar" style="position:fixed; top:0; left:0; width:100%; background:#08111f; padding:15px; z-index:20000; border-bottom: 5px solid #16a34a; text-align: center;">
                <div id="aurion-silhouetteRow" style="display: flex; justify-content: center; align-items: center; height: 70px;">
                    <svg id="silCam" style="width:80px; height:70px; display:block;" viewBox="0 0 200 200">
                        <path class="silPath" d="M40 70h120v70H40zM70 70V50h60v20M100 105a15 15 0 100-30 15 15 0 000 30z" fill="none" stroke="#334155" stroke-width="6" />
                    </svg>
                </div>
            </div>
            <div id="gazeWrapper" style="position:fixed; z-index:21000; transform:translate(-50%, -50%); pointer-events: none; display: none;">
                <div id="gazeCursor" style="width:35px; height:35px; background:red; border-radius:50%; border: 3px solid white; box-shadow: 0 0 15px black;"></div>
            </div>
            <video id="aurionVideo" style="display:none;" playsinline></video>
        `;
        document.body.appendChild(overlay);
        
        const style = document.createElement('style');
        style.innerHTML = `
            .active-cam path { stroke: #16a34a !important; filter: drop-shadow(0 0 10px #16a34a); }
            .flash-action path { stroke: #10b981 !important; stroke-width: 15; filter: drop-shadow(0 0 25px #10b981); transition: 0.1s; }
            .focused { border-color: #fbbf24 !important; background: #2a5f9f !important; transform: scale(1.02); }
            .mic-glow { filter: grayscale(0) drop-shadow(0 0 15px #ef4444) !important; transform: scale(1.2); transition: 0.3s; }
        `;
        document.head.appendChild(style);
    }

    async start() {
        const videoElement = document.getElementById('aurionVideo');
        const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.7 });
        faceMesh.onResults((r) => this.process(r));

        this.cam = new Camera(videoElement, {
            onFrame: async () => { if(this.isRunning) await faceMesh.send({image: videoElement}) },
            width: 640, height: 480
        });

        await this.cam.start();
        this.isRunning = true;
        document.getElementById("gazeWrapper").style.display = "block";
        document.getElementById("silCam").classList.add("active-cam");
    }

    // Spracherkennung starten
    listen() {
        if (this.recognition) {
            try { this.recognition.start(); } catch(e) { console.log("Recognition busy"); }
        } else {
            alert("Spracherkennung wird von diesem Browser nicht unterstützt.");
        }
    }

    setMicGlow(active) {
        const mic = document.getElementById("boxMic") || document.getElementById("micSymbol");
        const btn = document.querySelector(".voice-trigger");
        if (active) {
            if(mic) mic.classList.add("mic-glow");
            if(btn) btn.style.visibility = "hidden";
        } else {
            if(mic) mic.classList.remove("mic-glow");
            if(btn) btn.style.visibility = "visible";
        }
    }

    process(r) {
        if (!r.multiFaceLandmarks?.length) return;
        const lm = r.multiFaceLandmarks[0];
        let tx = (1 - (lm[4].x - 0.38) / 0.24) * window.innerWidth;
        let ty = ((lm[4].y - 0.38) / 0.24) * window.innerHeight;
        this.rawX = Math.max(15, Math.min(window.innerWidth - 15, tx));
        this.rawY = Math.max(15, Math.min(window.innerHeight - 15, ty));

        const dist = (p1, p2) => Math.sqrt(Math.pow(lm[p1].x-lm[p2].x, 2) + Math.pow(lm[p1].y-lm[p2].y, 2));
        const closed = (dist(159, 145) / dist(33, 133) < 0.14 && dist(386, 374) / dist(263, 362) < 0.14);

        if (closed && !this.leftEyeClosed) {
            this.leftEyeClosed = true;
            const now = Date.now();
            if (now - this.lastBlinkTime < 600) this.blinkCount++;
            else this.blinkCount = 1;
            this.lastBlinkTime = now;
            if (this.blinkCount === 2) { this.triggerAction(); this.blinkCount = 0; }
        } else if (!closed) this.leftEyeClosed = false;
    }

    triggerAction() {
        const sil = document.querySelector(".silPath");
        if(sil) {
            sil.parentElement.classList.add("flash-action");
            setTimeout(() => sil.parentElement.classList.remove("flash-action"), 400);
        }
        if (this.currentTarget) this.currentTarget.click(); 
    }

    updateLoop() {
        if (!this.isRunning) return;
        this.smoothX += (this.rawX - this.smoothX) * this.smoothing;
        this.smoothY += (this.rawY - this.smoothY) * this.smoothing;
        const wrapper = document.getElementById("gazeWrapper");
        wrapper.style.left = `${this.smoothX}px`;
        wrapper.style.top = `${this.smoothY}px`;

        const scrollThreshold = window.innerHeight * 0.15;
        const scrollBox = document.querySelector('.aurion-scroll');
        if (scrollBox) {
            if (this.smoothY < scrollThreshold) scrollBox.scrollTop -= 10;
            else if (this.smoothY > window.innerHeight - scrollThreshold) scrollBox.scrollTop += 10;
        }

        const el = document.elementFromPoint(this.smoothX, this.smoothY);
        if (el?.classList.contains("aurion-btn")) {
            if (this.currentTarget !== el) {
                this.currentTarget = el;
                document.querySelectorAll(".aurion-btn").forEach(b => b.classList.remove("focused"));
                el.classList.add("focused");
            }
        } else {
            this.currentTarget = null;
            document.querySelectorAll(".aurion-btn").forEach(b => b.classList.remove("focused"));
        }
    }

    speak(t) {
        this.synth.cancel();
        const msg = new SpeechSynthesisUtterance(t);
        msg.lang = 'de-DE';
        this.synth.speak(msg);
    }
}

window.aurion = new AurionEngine();
