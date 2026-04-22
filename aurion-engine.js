/**
 * AURION ENGINE V15 - MASTER BUILD
 * "Glück ist gut, Kontrolle ist besser."
 */

class AurionEngine {
    constructor() {
        this.config = {
            eyeL_In: 0.65,      // Zoom In (Linkes Auge)
            eyeR_Out: 0.84,     // Zoom Out (Rechtes Auge - sensibel)
            joker: 0.20,        // Alarm (Beide zu)
            vTrigger: 0.15,     // Vertikale Schwelle (Scroll/Menü)
            hTrigger: 0.20,     // Horizontale Schwelle (Back/Home)
            scrollSpeed: 18,    // Scroll-Intensität
            moveSpeed: -2600,   // Tracking-Radius
            lerp: 0.15          // Glättung
        };

        this.state = {
            z: 1.0, tz: 1.0,
            bL: 0.02, bR: 0.02,
            off: { x: 0.5, y: 0.5 },
            cal: false, lock: false
        };

        this.init();
    }

    init() {
        const ui = document.createElement('div');
        ui.innerHTML = `
            <video id="a-vid" style="display:none"></video>
            <div id="a-menu" style="position:fixed;top:-80px;left:0;width:100%;height:60px;background:#007aff;color:#fff;display:flex;align-items:center;justify-content:center;transition:0.3s;z-index:99999;font-family:sans-serif;font-weight:bold;">SYSTEM-MENÜ</div>
            <div id="a-joker" style="position:fixed;inset:0;background:red;display:none;z-index:100000;color:#fff;align-items:center;justify-content:center;font-size:40px;font-family:sans-serif;">JOKER AKTIV</div>
            <div id="a-flash" style="position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:99998;transition:0.2s;"></div>
        `;
        document.body.appendChild(ui);
        window.addEventListener('click', () => this.boot(), { once: true });
    }

    async boot() {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            document.getElementById('a-vid').srcObject = s;
            document.getElementById('a-vid').play();
            this.load();
        } catch (e) { alert("Xiaomi-Check fehlgeschlagen."); }
    }

    load() {
        const l = ["https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js", "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"];
        let count = 0;
        l.forEach(src => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => { if(++count === 2) this.startAI(); };
            document.head.appendChild(s);
        });
    }

    startAI() {
        const fm = new FaceMesh({locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});
        fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.6 });
        fm.onResults((r) => this.run(r));
        new Camera(document.getElementById('a-vid'), { onFrame: async () => await fm.send({image: document.getElementById('a-vid')}) }).start();
    }

    run(res) {
        if (!res.multiFaceLandmarks?.[0]) return;
        const lm = res.multiFaceLandmarks[0];
        const n = lm[1];
        const cL = Math.abs(lm[159].y - lm[145].y);
        const cR = Math.abs(lm[386].y - lm[374].y);
        const dX = n.x - this.state.off.x;
        const dY = n.y - this.state.off.y;

        // --- 1. VERTIKAL: SCROLL & MENÜ & KALIBRIERUNG ---
        if (dY < -this.config.vTrigger) {
            window.scrollBy(0, -this.config.scrollSpeed);
            document.getElementById('a-menu').style.top = "0px";
        } else if (dY > this.config.vTrigger) {
            window.scrollBy(0, this.config.scrollSpeed);
            this.calibrate(cL, cR, n);
            document.getElementById('a-menu').style.top = "-80px";
        } else {
            document.getElementById('a-menu').style.top = "-80px";
        }

        // --- 2. HORIZONTAL: NAVI (BACK / HOME) ---
        if (dX < -this.config.hTrigger && !this.state.lock) {
            this.state.lock = true; window.location.href = "/"; // HOME
        } else if (dX > this.config.hTrigger && !this.state.lock) {
            this.state.lock = true; window.history.back(); // BACK
        } else if (Math.abs(dX) < 0.05) { this.state.lock = false; }

        // --- 3. AUGEN: ZOOM & JOKER ---
        if (cL < this.state.bL * this.config.joker && cR < this.state.bR * this.config.joker) {
            document.getElementById('a-joker').style.display = "flex";
        } else {
            document.getElementById('a-joker').style.display = "none";
            if (cL < this.state.bL * this.config.eyeL_In) this.state.tz += 0.04;
            else if (cR < this.state.bR * this.config.eyeR_Out) this.state.tz -= 0.04;
        }

        // --- 4. DARSTELLUNG ---
        if (!this.state.cal) this.calibrate(cL, cR, n);
        this.state.tz = Math.max(0.6, Math.min(4.5, this.state.tz));
        this.state.z += (this.state.tz - this.state.z) * this.config.lerp;
        
        const tx = (n.x - this.state.off.x) * this.config.moveSpeed;
        const ty = (n.y - this.state.off.y) * this.config.moveSpeed;

        document.body.style.transform = `scale(${this.state.z}) translate(${tx}px, ${ty}px)`;
        document.body.style.transformOrigin = "center center";
    }

    calibrate(l, r, n) {
        this.state.bL = l; this.state.bR = r;
        this.state.off = { x: n.x, y: n.y };
        this.state.cal = true;
        const f = document.getElementById('a-flash');
        f.style.opacity = "0.2"; setTimeout(() => f.style.opacity = "0", 150);
    }
}
new AurionEngine();
