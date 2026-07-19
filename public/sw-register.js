// Service-worker registrar, served as a plain static file so it
// doesn't need `script-src 'unsafe-inline'` in the CSP. Loaded from
// the root layout via `<script src="/sw-register.js" defer>`.
//
// See public/service-worker.js for what the SW itself does; this
// file only exists to register it at page load.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    // updateViaCache: 'none' bypasses the HTTP cache for the SW
    // script itself, so a bumped service-worker.js is picked up on
    // the next reload instead of after 24h. .update() then asks the
    // browser to check for a byte-difference right now — cheap when
    // unchanged.
    navigator.serviceWorker
      .register("/service-worker.js", { updateViaCache: "none" })
      .then(function (reg) {
        reg.update().catch(function () {});
      })
      .catch(function () {});
  });
}
