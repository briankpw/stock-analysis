// Service-worker registrar, served as a plain static file so it
// doesn't need `script-src 'unsafe-inline'` in the CSP. Loaded from
// the root layout via `<Script src="/sw-register.js">`.
//
// See public/service-worker.js for what the SW itself does; this
// file only exists to register it at page load.
//
// Diagnostic story
// ----------------
// Historically this file swallowed every register/update failure with
// an empty catch handler to keep the console clean. That hid the exact
// reason push was silently non-functional on users' devices (CSP
// blocking the fetch, an offline mode with no fallback, permission
// weirdness, etc.). We now log every step + failure to the console AND
// mirror the state into `caches.open('sw-diag') → '/__sw-register-*'`
// so the /bot page's diagnostics panel can render "Service Worker:
// active|installing|failed(<reason>)" without waiting for the user to
// open devtools.
(function () {
  if (!("serviceWorker" in navigator)) {
    _swDiag({ state: "unsupported", reason: "serviceWorker missing from navigator" });
    return;
  }
  window.addEventListener("load", function () {
    _swDiag({ state: "registering" });
    // updateViaCache: 'none' bypasses the HTTP cache for the SW
    // script itself, so a bumped service-worker.js is picked up on
    // the next reload instead of after 24h. .update() then asks the
    // browser to check for a byte-difference right now — cheap when
    // unchanged.
    navigator.serviceWorker
      .register("/service-worker.js", { updateViaCache: "none" })
      .then(function (reg) {
        var current =
          (reg.active && "active") ||
          (reg.installing && "installing") ||
          (reg.waiting && "waiting") ||
          "unknown";
        _swDiag({ state: "registered", scope: reg.scope, phase: current });
        try {
          // eslint-disable-next-line no-console
          console.log("[sw-register] registered", { scope: reg.scope, phase: current });
        } catch (_) {}
        reg.update().catch(function (err) {
          try {
            // eslint-disable-next-line no-console
            console.warn("[sw-register] update() failed:", err);
          } catch (_) {}
        });
      })
      .catch(function (err) {
        var reason = (err && err.message) ? String(err.message) : String(err);
        _swDiag({ state: "failed", reason: reason });
        try {
          // eslint-disable-next-line no-console
          console.error("[sw-register] register() failed:", err);
        } catch (_) {}
      });
  });

  // Write the diagnostic marker to the same sw-diag cache the SW uses
  // for its own resub-failed marker, so both live under one grep-able
  // namespace. The client-side push hook reads this to render a status
  // row alongside the capability probes.
  function _swDiag(info) {
    try {
      if (typeof caches === "undefined") return;
      var payload = new Response(
        JSON.stringify(Object.assign({ at: Date.now() }, info)),
        { headers: { "content-type": "application/json" } },
      );
      caches
        .open("sw-diag")
        .then(function (c) {
          return c.put("/__sw-register-status", payload);
        })
        .catch(function () {});
    } catch (_) {}
  }
})();
