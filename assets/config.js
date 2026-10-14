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

  // The private-beta count is NOT set here (it went stale). It is served by
  // /api/waitlist from the Redis key `site:beta_testers` (update it in the Upstash
  // console, no deploy needed) or the BETA_TESTERS env var. No number → line hidden.

  // ---- Live mode (fill in before flipping `mode` to 'live') ----
  // Store links. The hero's App Store / Google Play badges become live links as soon
  // as these are filled in (works in either mode); until then they show "coming soon".
  // Paste the plain store URL — referral/campaign params can be included.
  appStoreUrl: '',          // e.g. 'https://apps.apple.com/app/myvalue/id6470000000'
  playStoreUrl: '',         // e.g. 'https://play.google.com/store/apps/details?id=app.myvalue'
  appStoreBadgeSrc: 'assets/badges/app-store.svg',   // official Apple badge
  playStoreBadgeSrc: 'assets/badges/google-play.png', // official Google badge
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
  // Scroll-reveal hook. If site.js never runs, reveal everything anyway.
  document.documentElement.classList.add('js');
  setTimeout(function () {
    var els = document.querySelectorAll('.rv:not(.in)');
    if (!window.mvBooted) for (var i = 0; i < els.length; i++) els[i].classList.add('in');
  }, 2500);
})();
