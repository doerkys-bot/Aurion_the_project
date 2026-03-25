// aurion_ui.js

export function createDotController(dot, books){
  let tx = innerWidth / 2;
  let ty = innerHeight / 2;
  let dx = tx;
  let dy = ty;

  const DOT_SPEED_OUTSIDE = 0.52;
  const DOT_SPEED_INSIDE = 0.12;

  let currentHover = null;

  const COUNTDOWN_DELAY_MS = 1200;
  const COUNTDOWN_SECONDS = 3;

  let focusedBook = null;
  let focusStartTs = 0;
  let countdownInterval = null;
  let countdownValue = COUNTDOWN_SECONDS;
  let countdownEl = null;

  function getBookUnderPoint(x, y){
    for(const book of books){
      const r = book.getBoundingClientRect();
      if(x > r.left && x < r.right && y > r.top && y < r.bottom){
        return book;
      }
    }
    return null;
  }

  function stopCountdown(){
    if(countdownInterval){
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if(countdownEl){
      countdownEl.remove();
      countdownEl = null;
    }
    countdownValue = COUNTDOWN_SECONDS;
  }

  function startCountdown(book, onOpen){
    stopCountdown();

    countdownValue = COUNTDOWN_SECONDS;
    countdownEl = document.createElement("div");
    countdownEl.className = "countdown";
    countdownEl.textContent = String(countdownValue);
    book.appendChild(countdownEl);

    countdownInterval = setInterval(() => {
      countdownValue -= 1;

      if(countdownEl){
        countdownEl.textContent = String(Math.max(0, countdownValue));
      }

      if(countdownValue <= 0){
        stopCountdown();
        onOpen?.(book);
      }
    }, 1000);
  }

  function handleBookFocus(hover, onOpen){
    if(!hover){
      focusedBook = null;
      focusStartTs = 0;
      stopCountdown();
      return;
    }

    if(focusedBook !== hover){
      focusedBook = hover;
      focusStartTs = Date.now();
      stopCountdown();
      return;
    }

    const heldMs = Date.now() - focusStartTs;
    if(!countdownInterval && heldMs >= COUNTDOWN_DELAY_MS){
      startCountdown(hover, onOpen);
    }
  }

  function loop(onOpen){
    const hoverByDot = getBookUnderPoint(dx, dy);
    const speed = hoverByDot ? DOT_SPEED_INSIDE : DOT_SPEED_OUTSIDE;

    dx += (tx - dx) * speed;
    dy += (ty - dy) * speed;

    dot.style.left = dx + "px";
    dot.style.top = dy + "px";

    const hover = getBookUnderPoint(dx, dy);
    currentHover = hover;

    books.forEach(book => {
      book.classList.toggle("active", book === hover);
    });

    handleBookFocus(hover, onOpen);

    requestAnimationFrame(() => loop(onOpen));
  }

  return {
    setTarget(x, y){
      tx = x;
      ty = y;
    },
    getCurrentHover(){
      return currentHover;
    },
    stopCountdown,
    start(onOpen){
      loop(onOpen);
    }
  };
}

export function pulse(dot, kind){
  dot.classList.remove("blink", "double");
  void dot.offsetWidth;
  dot.classList.add(kind);
  setTimeout(() => dot.classList.remove("blink", "double"), 140);
}

export function confirmFlash(book){
  if(!book) return;
  book.classList.add("confirmFlash");
  setTimeout(() => book.classList.remove("confirmFlash"), 240);
}

export function setDotVisible(dot, visible){
  dot.classList.toggle("on", visible);
}