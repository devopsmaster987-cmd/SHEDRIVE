import * as THREE from "three";
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";
import Lenis from "lenis";

import { createCursor } from "./cursor.js";
import {
  isWebGLAvailable,
  detectQuality,
  createRenderer,
  createScene,
  createCamera,
  resizeStage,
} from "./three/scene.js";
import { createCity } from "./three/city.js";
import { createHoverCar } from "./three/car.js";
import { createPostProcessing } from "./three/postprocessing.js";

gsap.registerPlugin(ScrollTrigger);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const dom = {
  html: document.documentElement,
  body: document.body,
  nav: $("#site-nav"),
  navLinks: $("#nav-links"),
  navToggle: $("#nav-toggle"),
  reduceButton: $("#reduce-effects"),
  preloader: $("#preloader"),
  preloaderBar: $("#preloader-bar"),
  preloaderPercent: $("#preloader-percent"),
  preloaderLabel: $("#preloader-label"),
  canvas: $("#city-canvas"),
};

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function readStoredPreference() {
  try {
    return localStorage.getItem("shedrive:reduce-effects");
  } catch {
    return null;
  }
}

const storedPreference = readStoredPreference();
let effectsReduced = storedPreference === null ? prefersReducedMotion : storedPreference === "1";

dom.html.classList.toggle("reduce-effects", effectsReduced);
if (dom.reduceButton) {
  dom.reduceButton.setAttribute("aria-pressed", String(effectsReduced));
  dom.reduceButton.title = effectsReduced ? "Enable visual effects" : "Reduce visual effects";
}

/* ------------------------------------------------------------
   Preloader
   ------------------------------------------------------------ */

let progressValue = 0;

function setProgress(value, label) {
  const next = Math.max(progressValue, Math.min(100, Math.round(value)));
  progressValue = next;
  if (dom.preloaderBar) dom.preloaderBar.style.width = `${next}%`;
  if (dom.preloaderPercent) dom.preloaderPercent.textContent = `${next}%`;
  if (label && dom.preloaderLabel) dom.preloaderLabel.textContent = label;
}

function hidePreloader() {
  if (!dom.preloader) return;
  dom.preloader.classList.add("is-done");
  dom.preloader.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    dom.preloader.style.display = "none";
  }, 900);
}

/* ------------------------------------------------------------
   Navigation, settings, cursor and cards
   ------------------------------------------------------------ */

let lenis = null;
let cursor = null;

function closeNav() {
  if (!dom.nav) return;
  dom.nav.classList.remove("nav-open");
  if (dom.navToggle) {
    dom.navToggle.setAttribute("aria-expanded", "false");
    const label = $(".sr-only", dom.navToggle);
    if (label) label.textContent = "Open menu";
  }
}

function initNavigation() {
  const updateScrolled = () => {
    if (!dom.nav) return;
    dom.nav.classList.toggle("is-scrolled", window.scrollY > 24);
  };

  updateScrolled();
  window.addEventListener("scroll", updateScrolled, { passive: true });

  if (dom.navToggle) {
    dom.navToggle.addEventListener("click", () => {
      const open = !dom.nav.classList.contains("nav-open");
      dom.nav.classList.toggle("nav-open", open);
      dom.navToggle.setAttribute("aria-expanded", String(open));
      const label = $(".sr-only", dom.navToggle);
      if (label) label.textContent = open ? "Close menu" : "Open menu";
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNav();
  });

  // In-page links use Lenis when available, otherwise native scrolling.
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;

      event.preventDefault();
      closeNav();

      if (lenis && !effectsReduced) {
        lenis.scrollTo(target, { offset: -12, duration: 1.25 });
      } else {
        target.scrollIntoView({ behavior: effectsReduced ? "auto" : "smooth", block: "start" });
      }
    });
  });

  if (dom.reduceButton) {
    dom.reduceButton.addEventListener("click", () => {
      const next = !effectsReduced;
      try {
        localStorage.setItem("shedrive:reduce-effects", next ? "1" : "0");
      } catch {
        /* still reload with the current in-memory choice */
      }
      effectsReduced = next;
      // A reload keeps the Three.js setup honest without complex live teardown.
      window.location.reload();
    });
  }
}

function initCursor() {
  if (effectsReduced) return;
  cursor = createCursor({ enabled: true });
}

function initCardSpotlights() {
  if (effectsReduced || !window.matchMedia("(pointer: fine)").matches) return;

  $$(".tilt-card").forEach((card) => {
    card.addEventListener(
      "pointermove",
      (event) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--px", `${event.clientX - rect.left}px`);
        card.style.setProperty("--py", `${event.clientY - rect.top}px`);
      },
      { passive: true }
    );
  });
}

function initSmoothScroll() {
  if (effectsReduced) return;

  lenis = new Lenis({
    duration: 1.1,
    smoothWheel: true,
    syncTouch: false,
  });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ------------------------------------------------------------
   Motion: intro and scroll reveals
   ------------------------------------------------------------ */

function playHeroIntro() {
  if (effectsReduced) return;

  const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  tl.from(".hero-title .word", {
    yPercent: 118,
    rotate: 2.5,
    duration: 1.15,
    stagger: 0.055,
  })
    .from(
      ".hero .eyebrow",
      { autoAlpha: 0, y: 14, duration: 0.7 },
      "-=0.75"
    )
    .from(".hero-sub", { autoAlpha: 0, y: 22, duration: 0.8 }, "-=0.5")
    .from(".hero-actions .btn", { autoAlpha: 0, y: 18, duration: 0.65, stagger: 0.08 }, "-=0.5")
    .from(".hero-stats li", { autoAlpha: 0, y: 16, duration: 0.6, stagger: 0.07 }, "-=0.45")
    .from(".scroll-cue", { autoAlpha: 0, duration: 0.6 }, "-=0.2");
}

function initScrollReveals() {
  if (effectsReduced) return;

  $$("[data-reveal]")
    .filter((element) => !element.closest(".hero"))
    .forEach((element) => {
      gsap.from(element, {
        autoAlpha: 0,
        y: 30,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: {
          trigger: element,
          start: "top 88%",
          once: true,
        },
      });
    });
}

/* ------------------------------------------------------------
   The Neon Midnight City
   ------------------------------------------------------------ */

let cleanupCity = () => {};

function buildCameraPaths() {
  const cameraPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 8, 34),
      new THREE.Vector3(2, 7.4, 24),
      new THREE.Vector3(6.5, 6.6, 12),
      new THREE.Vector3(2, 8.6, 0),
      new THREE.Vector3(-3, 11, -12),
      new THREE.Vector3(1, 15, -26),
      new THREE.Vector3(0, 20, -42),
    ],
    false,
    "centripetal"
  );

  const targetPath = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 6.5, 8),
      new THREE.Vector3(0, 6, -2),
      new THREE.Vector3(0, 5.5, -16),
      new THREE.Vector3(0, 5, -32),
      new THREE.Vector3(0, 5.5, -50),
      new THREE.Vector3(0, 6, -66),
      new THREE.Vector3(0, 7, -84),
    ],
    false,
    "centripetal"
  );

  return { cameraPath, targetPath };
}

function initCity() {
  if (!isWebGLAvailable()) {
    dom.html.classList.add("no-webgl");
    initScrollReveals();
    playHeroIntro();
    setProgress(100, "City ready");
    hidePreloader();
    return;
  }

  try {
    setProgress(16, "Surveying the streets");

    const quality = detectQuality();
    const renderer = createRenderer(dom.canvas, quality.maxPixelRatio);
    const scene = createScene();
    const camera = createCamera();

    setProgress(34, "Raising the skyline");
    const city = createCity(scene);
    const car = createHoverCar(scene);

    setProgress(58, "Wiring the neon");
    const post = createPostProcessing(renderer, scene, camera, {
      strength: quality.bloomStrength,
    });

    const { cameraPath, targetPath } = buildCameraPaths();
    const lookAt = targetPath.getPointAt(0);
    const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const scrollState = { progress: 0 };
    const finePointer = window.matchMedia("(pointer: fine)").matches;

    camera.position.copy(cameraPath.getPointAt(0));
    camera.lookAt(lookAt);

    const onPointerMove = (event) => {
      if (!finePointer || effectsReduced) return;
      mouse.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.targetY = -((event.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const onResize = () => {
      resizeStage(renderer, camera, post.composer);
      city.setPixelRatio(renderer.getPixelRatio());
      if (effectsReduced) {
        city.update(0);
        car.update(0);
        post.render();
      }
    };
    window.addEventListener("resize", onResize);

    const clock = new THREE.Clock();
    let rafId = null;

    function updateCamera(snap = false) {
      const progress = effectsReduced ? 0 : scrollState.progress;
      const position = cameraPath.getPointAt(THREE.MathUtils.clamp(progress, 0, 1));
      const target = targetPath.getPointAt(THREE.MathUtils.clamp(progress, 0, 1));

      mouse.x += (mouse.targetX - mouse.x) * 0.045;
      mouse.y += (mouse.targetY - mouse.y) * 0.045;

      if (!effectsReduced) {
        position.x += mouse.x * 1.5;
        position.y += mouse.y * 0.85;
        target.x += mouse.x * 0.9;
        target.y += mouse.y * 0.5;
      }

      if (snap) {
        camera.position.copy(position);
        lookAt.copy(target);
      } else {
        camera.position.lerp(position, 0.09);
        lookAt.lerp(target, 0.09);
      }

      camera.lookAt(lookAt);
    }

    function renderFrame() {
      const elapsed = clock.getElapsedTime();
      const time = effectsReduced ? 0 : elapsed;

      city.update(time);
      car.update(time);
      updateCamera();
      post.render();
    }

    function loop() {
      renderFrame();
      rafId = requestAnimationFrame(loop);
    }

    if (effectsReduced) {
      city.update(0);
      car.update(0);
      updateCamera(true);
      post.render();
    } else {
      updateCamera(true);
      rafId = requestAnimationFrame(loop);

      gsap.to(scrollState, {
        progress: 1,
        ease: "none",
        scrollTrigger: {
          trigger: "#hero",
          start: "top top",
          end: "bottom bottom",
          scrub: 1.2,
        },
      });

      // Fade the hero copy slightly as the camera flies through the city.
      gsap.to(".hero-content", {
        yPercent: -16,
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: "#hero",
          start: "top top",
          end: "55% top",
          scrub: true,
        },
      });

      gsap.to(".scroll-cue", {
        autoAlpha: 0,
        ease: "none",
        scrollTrigger: {
          trigger: "#hero",
          start: "top top",
          end: "18% top",
          scrub: true,
        },
      });
    }

    // Only reveal the canvas once there is a rendered frame behind the loader.
    requestAnimationFrame(() => {
      dom.html.classList.add("webgl-ready");
      setProgress(82, "Lighting the last windows");
      window.setTimeout(() => {
        setProgress(100, "Welcome to SheDrive");
        hidePreloader();
        initScrollReveals();
        playHeroIntro();
        ScrollTrigger.refresh();
      }, 220);
    });

    cleanupCity = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      city.dispose();
      car.dispose();
      post.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    };
  } catch (error) {
    console.warn("[SheDrive] 3D scene failed, showing the styled fallback.", error);
    dom.html.classList.add("no-webgl");
    initScrollReveals();
    playHeroIntro();
    setProgress(100, "City ready");
    hidePreloader();
  }
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */

function boot() {
  initNavigation();
  initCursor();
  initCardSpotlights();
  initSmoothScroll();

  setProgress(8, "Booting the neon");
  // Give the browser one frame to paint the preloader before building geometry.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => initCity());
  });

  window.addEventListener(
    "pagehide",
    () => {
      cleanupCity();
      cursor?.destroy();
      lenis?.destroy();
    },
    { once: true }
  );
}

boot();
