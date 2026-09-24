/* ==========================================================
   MyValue site config — the ONE place to flip the site.
   Loaded synchronously in <head> on every page, before paint,
   so the mode applies with no flash.

   mode: 'prelaunch' → every primary CTA collects waitlist emails.
         'live'      → every primary CTA routes to the App Store
                       (iOS = badge, desktop = QR + email-me-the-link).

   QA shortcut: append ?preview=live (or ?preview=prelaunch) to any
   URL to see the other mode without changing this file.
   ========================================================== */
window.MYVALUE_CONFIG = {
  mode: 'prelaunch',

  // Waitlist progress bar: "X of the first 1,000 founding members".
  waitlistGoal: 1000,
  // Hide the number until the real confirmed count reaches this, so the
  // bar never advertises "3 of 1,000". Below it, the bar shows copy only.
  waitlistMinToShow: 50,

  // Honest social proof. Must be literally true (FTC 16 CFR Part 465).
  // Set to 0 to hide the line.
  betaTesters: 42,

  // ---- Live mode (fill in before flipping `mode` to 'live') ----
  appStoreUrl: '',          // e.g. 'https://apps.apple.com/app/myvalue/id6470000000'
  appStoreBadgeSrc: '',     // official Apple badge SVG, e.g. 'assets/app-store-badge.svg'
  playStoreUrl: '',         // leave empty while the app is iOS-only
  appleProviderToken: '',   // App Store Connect → App Analytics → Campaigns → "pt"
  // utm_source → Custom Product Page id (ppid). Unknown sources use the default page.
  customProductPages: {
    // 'tiktok-sneakers': '00000000-0000-0000-0000-000000000000',
  },

  // Where the serverless API lives (same origin on Vercel).
  api: '/api'
};

(function () {
  var c = window.MYVALUE_CONFIG;
  try {
    var p = new URLSearchParams(location.search).get('preview');
    if (p === 'live' || p === 'prelaunch') c.mode = p;
  } catch (e) {}
  document.documentElement.setAttribute('data-site-mode', c.mode);
})();
