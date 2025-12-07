/* === Einstellungen === */
const linkSpeed = 0.18;          // Langsamer, natürlicher
const runtextSpeed = 0.55;       // Laufschrift etwas schneller
const starCount = 180;           // Sterne
const shootingChance = 0.004;    // Sternschnuppen
let visitorCountValue = 0;

/* === Elemente sammeln === */
const links = [...document.querySelectorAll(".link")];
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
const lightObject = document.getElementById("lightObject");

canvas.width = innerWidth;
canvas.height = innerHeight;

/* === Sterne generieren === */
let stars = [];
for (let i = 0; i < starCount; i++) {
    stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 1.2 + 0.2,
        alpha: Math.random(),
        twinkle: Math.random() * 0.03 + 0.01
    });
}

/* === Link-Objekte === */
const linkObjects = links.map(link => ({
    el: link,
    x: Math.random() * (innerWidth - 200),
    y: Math.random() * (innerHeight - 200),
    dx: (Math.random() - 0.5) * linkSpeed,
    dy: (Math.random() - 0.5) * linkSpeed,
    runtext: null
}));

/* === Laufschrift erzeugen === */
function createRunText(obj) {
    if (obj.runtext) obj.runtext.remove();

    const rt = document.createElement("div");
    rt.className = "runtext";
    rt.textContent = obj.el.dataset.desc;

    document.body.appendChild(rt);

    rt.style.top = (obj.y + 27) + "px";

    // Link auf linker Seite → Text rechts starten
    if (obj.x < innerWidth / 2) {
        rt.style.left = (obj.x + 57) + "px";
        rt.direction = "left";
    } else {
        rt.style.left = (obj.x - rt.clientWidth - 57) + "px";
        rt.direction = "right";
    }

    obj.runtext = rt;
}

/* === Besucher-Glow aktualisieren === */
function updateGlow() {
    links.forEach(l => {
        if (visitorCountValue > 0) l.classList.add("glow");
    });
}

/* === Animation === */
function animate() {
    requestAnimationFrame(animate);

    /* Sterne */
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    stars.forEach(s => {
        s.alpha += (Math.random() - 0.5) * s.twinkle;
        if (s.alpha < 0.2) s.alpha = 0.2;
        if (s.alpha > 1) s.alpha = 1;

        ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
    });

    /* Sternschnuppen */
    if (Math.random() < shootingChance) {
        let sx = Math.random() * canvas.width;
        let sy = 0;
        let len = 120;
        for (let i = 0; i < len; i++) {
            ctx.fillStyle = `rgba(255,255,255,${1 - i/len})`;
            ctx.fillRect(sx - i*1.5, sy + i*1.5, 2, 2);
        }
    }

    /* Links bewegen */
    linkObjects.forEach(obj => {
        obj.x += obj.dx;
        obj.y += obj.dy;

        if (obj.x < 0 || obj.x > innerWidth - 160) obj.dx *= -1;
        if (obj.y < 0 || obj.y > innerHeight - 40) obj.dy *= -1;

        obj.el.style.left = obj.x + "px";
        obj.el.style.top = obj.y + "px";

        /* Laufschrift folgen lassen */
        if (obj.runtext) {
            const rt = obj.runtext;

            // Position
            rt.style.top = (obj.y + 27) + "px";

            if (rt.direction === "left") {
                rt.style.left = (parseFloat(rt.style.left) - runtextSpeed) + "px";
            } else {
                rt.style.left = (parseFloat(rt.style.left) + runtextSpeed) + "px";
            }
        }
    });

    /* Mystisches Licht langsam bewegen */
    const t = Date.now() * 0.0003;
    lightObject.style.left = (innerWidth/2 + Math.sin(t)*200) + "px";
    lightObject.style.top = (innerHeight/2 + Math.cos(t)*120) + "px";
}

animate();

/* === Laufschrift starten bei Hover === */
links.forEach(link => {
    const obj = linkObjects.find(o => o.el === link);

    link.addEventListener("mouseenter", () => createRunText(obj));
    link.addEventListener("mouseleave", () => {
        if (obj.runtext) obj.runtext.remove();
        obj.runtext = null;
    });
});

/* Besucherzahl empfangen */
async function pullVisitors() {
    try {
        const r = await fetch("https://auriontheproject.eu/counter.php");
        visitorCountValue = Number(await r.text());
        updateGlow();
    } catch (e) {}
}

setInterval(pullVisitors, 6000);
pullVisitors();
