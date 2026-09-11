(function () {
  "use strict";

  var body = document.body;
  var scene = document.getElementById("scene");
  var robotRig = document.getElementById("robot-rig");
  var brand = document.querySelector(".brand");
  var contactArea = document.querySelector(".contact-area");
  var contactTrigger = document.getElementById("contact-trigger");
  var contactPanel = document.getElementById("contact-panel");
  var contactClose = document.querySelector(".contact-close");
  var contactBackdrop = document.querySelector(".contact-backdrop");
  var contactQr = document.querySelector(".wechat-qr img");
  var serviceButtons = Array.prototype.slice.call(document.querySelectorAll(".service-chip"));
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var buildVersion = "20260825.11";
  var timers = [];
  var robotTimer = 0;
  var contactLastFocused = null;

  function clearLegacyCaches() {
    var shouldClear = true;
    try {
      shouldClear = window.localStorage.getItem("botgo-build") !== buildVersion;
      window.localStorage.setItem("botgo-build", buildVersion);
    } catch (error) {
      shouldClear = true;
    }
    if (!shouldClear) return;
    if ("caches" in window) {
      window.caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) { return window.caches.delete(key); }));
      }).catch(function () {});
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) { registration.unregister(); });
      }).catch(function () {});
    }
  }

  function setPanelState(panel, open) {
    if (!panel) return;
    panel.setAttribute("aria-hidden", String(!open));
    if (open) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
  }

  function focusPanel(panel) {
    if (!panel) return;
    window.requestAnimationFrame(function () { panel.focus(); });
  }

  function loadDeferredImage(image) {
    if (!image) return;
    var source = image.getAttribute("data-src");
    if (!source) return;
    image.loading = "eager";
    image.src = source;
    image.removeAttribute("data-src");
  }

  function loadPrimaryMedia() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-deferred-picture]"), function (picture) {
      Array.prototype.forEach.call(picture.querySelectorAll("source[data-srcset]"), function (source) {
        source.srcset = source.getAttribute("data-srcset");
        source.removeAttribute("data-srcset");
      });
      loadDeferredImage(picture.querySelector("img[data-src]"));
      picture.removeAttribute("data-deferred-picture");
    });
  }

  function setContact(open, returnFocus) {
    if (open) {
      loadDeferredImage(contactQr);
      contactLastFocused = document.activeElement;
    }

    body.classList.toggle("contact-open", open);
    if (contactTrigger) contactTrigger.setAttribute("aria-expanded", String(open));
    setPanelState(contactPanel, open);

    if (open) focusPanel(contactPanel);
    if (!open && returnFocus) {
      var target = contactLastFocused && typeof contactLastFocused.focus === "function" ? contactLastFocused : contactTrigger;
      if (target) target.focus();
    }
  }

  function wakeRobot() {
    if (!robotRig || reducedMotion) return;
    window.clearTimeout(robotTimer);
    robotRig.classList.remove("is-listening");
    void robotRig.offsetWidth;
    robotRig.classList.add("is-listening");
    robotTimer = window.setTimeout(function () { robotRig.classList.remove("is-listening"); }, 760);
  }

  function trapFocus(event, panel) {
    if (!panel) return;
    var focusable = Array.prototype.slice.call(panel.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function clearTimeline() {
    timers.forEach(function (timer) { window.clearTimeout(timer); });
    timers = [];
  }

  function after(delay, callback) {
    timers.push(window.setTimeout(callback, delay));
  }

  function play() {
    clearTimeline();
    setContact(false, false);
    body.classList.remove("is-ready", "phase-one", "phase-shift", "phase-two");
    void body.offsetWidth;

    if (reducedMotion) {
      body.classList.add("is-ready", "phase-two");
      return;
    }

    after(60, function () { body.classList.add("is-ready"); });
    after(150, function () { body.classList.add("phase-one"); });
    after(1850, function () { body.classList.add("phase-shift"); });
    after(2200, function () { body.classList.add("phase-two"); });
  }

  function moveScene(event) {
    if (reducedMotion || window.innerWidth < 820) return;
    var nx = event.clientX / window.innerWidth - 0.5;
    var ny = event.clientY / window.innerHeight - 0.5;
    if (scene) {
      scene.style.setProperty("--scene-x", (nx * -6).toFixed(1) + "px");
      scene.style.setProperty("--scene-y", (ny * -4).toFixed(1) + "px");
    }
    if (robotRig) {
      robotRig.style.setProperty("--robot-x", (nx * 10).toFixed(1) + "px");
      robotRig.style.setProperty("--robot-y", (ny * 6).toFixed(1) + "px");
      robotRig.style.setProperty("--robot-turn", (nx * 1.1).toFixed(2) + "deg");
    }
  }

  if (brand) {
    brand.addEventListener("click", function (event) {
      event.preventDefault();
      play();
    });
  }

  if (contactTrigger) {
    contactTrigger.addEventListener("click", function () {
      setContact(!body.classList.contains("contact-open"), false);
    });
  }

  if (contactClose) contactClose.addEventListener("click", function () { setContact(false, true); });
  if (contactBackdrop) contactBackdrop.addEventListener("pointerdown", function () { setContact(false, true); });
  document.addEventListener("pointerdown", function (event) {
    if (body.classList.contains("contact-open") && contactArea && !contactArea.contains(event.target)) {
      setContact(false, false);
    }
  });

  document.addEventListener("keydown", function (event) {
    var contactOpen = body.classList.contains("contact-open");
    if (!contactOpen) return;

    if (event.key === "Escape") {
      setContact(false, true);
      return;
    }

    if (event.key === "Tab") trapFocus(event, contactPanel);
  });

  serviceButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var tool = button.getAttribute("data-workspace");
      if (tool) {
        var target = tool === "web"
          ? "./workspace.html?view=chat"
          : tool === "guide"
            ? "./workspace.html?view=tutorials"
            : "./workspace.html?view=agents";
        window.location.assign(target);
        return;
      }
    });
  });

  if (!reducedMotion) window.addEventListener("pointermove", moveScene, { passive: true });
  clearLegacyCaches();
  play();
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      loadPrimaryMedia();
    });
  });
})();
