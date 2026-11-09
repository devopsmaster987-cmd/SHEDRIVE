// Glowing custom cursor with a trailing ring and magnetic buttons.
// Only enabled on desktop pointers and when the user has not asked for
// reduced effects, so keyboard and touch users keep their normal cursor.

export function createCursor({ enabled = true } = {}) {
  const dot = document.querySelector(".cursor-dot");
  const ring = document.querySelector(".cursor-ring");
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  if (!dot || !ring || !finePointer) {
    return { setEnabled() {}, destroy() {} };
  }

  let active = enabled;
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let dotX = targetX;
  let dotY = targetY;
  let ringX = targetX;
  let ringY = targetY;
  let rafId = null;
  const magneticElements = Array.from(document.querySelectorAll("[data-magnetic]"));

  function loop() {
    dotX += (targetX - dotX) * 0.45;
    dotY += (targetY - dotY) * 0.45;
    ringX += (targetX - ringX) * 0.16;
    ringY += (targetY - ringY) * 0.16;

    dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;

    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (!active || rafId !== null) return;
    document.body.classList.add("has-custom-cursor");
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    document.body.classList.remove("has-custom-cursor", "cursor-active");
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function onPointerMove(event) {
    targetX = event.clientX;
    targetY = event.clientY;

    const interactive = event.target.closest("a, button, [data-magnetic]");
    document.body.classList.toggle("cursor-active", Boolean(interactive));
  }

  function onPointerDown() {
    ring.style.width = "18px";
    ring.style.height = "18px";
  }

  function onPointerUp() {
    ring.style.width = "";
    ring.style.height = "";
  }

  function onLeave() {
    stop();
  }

  function onEnter() {
    start();
  }

  const magnetHandlers = magneticElements.map((element) => {
    function onMove(event) {
      const rect = element.getBoundingClientRect();
      const offsetX = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const offsetY = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
      element.style.setProperty("--mx", `${offsetX * 7}px`);
      element.style.setProperty("--my", `${offsetY * 5}px`);
    }

    function onLeave() {
      element.style.setProperty("--mx", "0px");
      element.style.setProperty("--my", "0px");
    }

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);

    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      element.style.removeProperty("--mx");
      element.style.removeProperty("--my");
    };
  });

  if (active) {
    start();
  }

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.documentElement.addEventListener("pointerenter", onEnter);

  return {
    setEnabled(next) {
      active = next;
      if (active) start();
      else stop();
    },
    destroy() {
      stop();
      magnetHandlers.forEach((remove) => remove());
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.documentElement.removeEventListener("pointerenter", onEnter);
    },
  };
}
