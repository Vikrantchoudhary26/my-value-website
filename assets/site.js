/* ==========================================================
   MyValue — site runtime.
   Everything is driven by window.MYVALUE_CONFIG (assets/config.js).

   Markup hooks:
     [data-announce]        top bar: waitlist progress (prelaunch) / app banner (live)
     [data-wl]              waitlist block; holds a static <form data-waitlist> that
                            also works without JS (posts to /api/waitlist)
     a[data-cta]            primary CTA links; prelaunch → #waitlist, live → store
     [data-beta-count]      filled with config.betaTesters (hidden when 0)
     [data-pchart]          interactive portfolio chart
     form[data-contact]     contact / support form
   ========================================================== */
(function () {
  'use strict';

  var cfg = window.MYVALUE_CONFIG || { mode: 'prelaunch', api: '/api' };
  var API = cfg.api || '/api';
  var params = new URLSearchParams(location.search);

  /* ---------------- small utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtInt(n) { return Number(n).toLocaleString('en-US'); }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ---------------- analytics ----------------
     Named events from the build brief. Provider-agnostic: pushes to
     window.dataLayer (GTM) and forwards to Plausible / gtag / PostHog if
     their snippet is on the page. Add ?debug=1 to log events. */
  function track(name, props) {
    props = props || {};
    try {
      (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: name }, props));
      if (typeof window.plausible === 'function') window.plausible(name, { props: props });
      if (typeof window.gtag === 'function') window.gtag('event', name, props);
      if (window.posthog && typeof window.posthog.capture === 'function') window.posthog.capture(name, props);
      if (params.get('debug') === '1') console.info('[track]', name, props);
    } catch (e) {}
  }
  window.mvTrack = track;

  /* ---------------- attribution ----------------
     First-touch UTMs + referral code, kept 30 days, sent with the waitlist
     signup and turned into App Store campaign tokens in live mode. */
  var ATTR_KEY = 'mv_attr';
  var attr = store.get(ATTR_KEY);
  if (!attr || Date.now() - (attr.t || 0) > 30 * 864e5) attr = { t: Date.now() };
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
    var v = params.get(k);
    if (v && !attr[k]) attr[k] = v.slice(0, 100);
  });
  var refParam = (params.get('ref') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (refParam) attr.ref = refParam;
  store.set(ATTR_KEY, attr);

  function utmString() {
    return ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
      .filter(function (k) { return attr[k]; })
      .map(function (k) { return k + '=' + attr[k]; }).join('&');
  }

  /* ---------------- device ---------------- */
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var isMobile = isIOS || isAndroid;
  var isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV|TikTok/.test(ua);

  // App Store URL with Custom Product Page + campaign tokens.
  function storeUrl() {
    if (!cfg.appStoreUrl) return '';
    var u;
    try { u = new URL(cfg.appStoreUrl); } catch (e) { return cfg.appStoreUrl; }
    var src = attr.utm_source || '';
    var ppid = cfg.customProductPages && cfg.customProductPages[src];
    if (ppid) u.searchParams.set('ppid', ppid);
    if (cfg.appleProviderToken) u.searchParams.set('pt', cfg.appleProviderToken);
    var ct = attr.utm_campaign || src || (attr.ref ? 'referral' : 'website');
    u.searchParams.set('ct', ct.slice(0, 40));
    u.searchParams.set('mt', '8');
    return u.toString();
  }

  // Live mode needs a store URL; without one, stay safely in prelaunch.
  var mode = cfg.mode;
  if (mode === 'live' && !cfg.appStoreUrl) {
    console.error('[MyValue] mode is "live" but appStoreUrl is empty — falling back to prelaunch.');
    mode = 'prelaunch';
    document.documentElement.setAttribute('data-site-mode', mode);
  }
  var LIVE = mode === 'live';

  /* ---------------- toast ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 6000);
  }

  /* ---------------- honest social proof ----------------
     The beta count comes from /api/waitlist (Redis key site:beta_testers, or the
     BETA_TESTERS env var). Lines stay hidden unless a real number is available. */
  function renderBeta(stats) {
    var n = stats && Number(stats.betaTesters || 0);
    if (!n) return;
    $$('[data-beta-count]').forEach(function (el) {
      el.textContent = fmtInt(n);
      var host = el.closest('[data-beta-line]');
      if (host) host.hidden = false;
    });
  }

  /* ---------------- announcement bar ---------------- */
  function renderAnnounce(stats) {
    var host = $('[data-announce]'), bar = host && $('.wrap', host);
    if (!bar) return;
    var target = $('#waitlist') ? '#waitlist' : '/#waitlist';
    if (LIVE) {
      var href = isIOS ? storeUrl() : target;
      bar.innerHTML = '<span>MyValue is on the App Store.</span> <a href="' + esc(href) + '" data-track="' + (isIOS ? 'badge_click_ios' : 'announce_click') + '">Get the app →</a>';
      host.hidden = false;
      return;
    }
    if (!stats) return; // keep the static fallback copy
    var goal = Number(cfg.waitlistGoal || 1000);
    var n = Number(stats.confirmed || 0);
    if (n < Number(cfg.waitlistMinToShow || 0)) return;
    var pct = Math.min(100, (n / goal) * 100);
    var text = n < goal
      ? '<span><b class="num">' + fmtInt(n) + '</b> of the first ' + fmtInt(goal) + ' founding members have joined.</span>'
      : '<span><b class="num">' + fmtInt(n) + '</b> collectors on the waitlist.</span>';
    bar.innerHTML = text +
      (n < goal ? '<span class="meter" role="progressbar" aria-label="Founding member spots filled" aria-valuemin="0" aria-valuemax="' + goal + '" aria-valuenow="' + n + '"><i></i></span>' : '') +
      ' <a href="' + target + '">Join the waitlist →</a>';
    host.hidden = false;
    var fill = $('.meter i', bar);
    if (fill) requestAnimationFrame(function () { fill.style.width = pct.toFixed(1) + '%'; });
  }

  /* ---------------- CTA routing ---------------- */
  function routeCtas() {
    var hasSlot = !!$('#waitlist');
    $$('a[data-cta]').forEach(function (a) {
      if (!hasSlot && a.getAttribute('href') === '#waitlist') a.setAttribute('href', '/#waitlist');
      if (!LIVE) return;
      // Pre-launch labels say "Join the waitlist"; live mode restores the product label.
      if (a.getAttribute('data-live-label')) a.textContent = a.getAttribute('data-live-label');
      if (isIOS) {
        a.href = storeUrl();
        a.setAttribute('data-track', 'badge_click_ios');
      } else if (isAndroid && cfg.playStoreUrl) {
        a.href = cfg.playStoreUrl;
        a.setAttribute('data-track', 'badge_click_android');
      }
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-track]');
    if (a) track(a.getAttribute('data-track'), { location: a.getAttribute('data-loc') || '' });
  });

  /* ---------------- waitlist ---------------- */
  var WL_KEY = 'mv_wl';
  var ERRORS = {
    invalid_email: 'Enter a valid email address.',
    rate_limited: 'Too many tries from this network — give it a few minutes.',
    not_configured: "We couldn't save your spot just now. Please try again in a moment.",
    server_error: "We couldn't save your spot just now. Please try again in a moment."
  };

  function wlBlocks() { return $$('[data-wl]'); }

  function initWaitlistForms() {
    wlBlocks().forEach(function (block) {
      block.setAttribute('data-original', block.innerHTML);
      bindForm(block);
    });
  }

  function bindForm(block) {
    var form = $('form[data-waitlist]', block);
    if (!form) return;
    var ref = $('input[name=ref]', form); if (ref) ref.value = attr.ref || '';
    var utm = $('input[name=utm]', form); if (utm) utm.value = utmString();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', form);
      var msg = $('.wl-msg', block);
      var email = $('input[type=email]', form).value.trim();
      msg.className = 'wl-msg'; msg.textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        msg.className = 'wl-msg err'; msg.textContent = ERRORS.invalid_email; return;
      }
      btn.disabled = true;
      fetch(API + '/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          ref: attr.ref || '',
          utm: utmString(),
          source: block.getAttribute('data-source') || '',
          company: ($('input[name=company]', form) || {}).value || ''
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; });
      }).then(function (d) {
        btn.disabled = false;
        if (d.existing) {
          msg.textContent = "You're already on the list — we've re-sent your referral link to your inbox.";
          return;
        }
        if (!d.ok) {
          msg.className = 'wl-msg err';
          msg.textContent = ERRORS[d.error] || ERRORS.server_error;
          return;
        }
        track('waitlist_submit', { source: block.getAttribute('data-source') || '' });
        if (attr.ref) track('referral_signup', { ref: attr.ref });
        store.set(WL_KEY, { code: d.code });
        showDone(d, { fresh: true, emailSent: d.emailSent !== false });
      }).catch(function () {
        btn.disabled = false;
        msg.className = 'wl-msg err';
        msg.textContent = ERRORS.server_error;
      });
    });
  }

  function showDone(d, opts) {
    opts = opts || {};
    var url = d.referralUrl || (location.origin + '/?ref=' + d.code);
    var shareText = "I'm on the MyValue waitlist — live market value for sneakers, watches & collectibles.";
    var pos = d.position ? '#' + fmtInt(d.position) : '';
    var head = d.confirmed ? "You're confirmed." : "You're on the list.";
    var confirmLine = d.confirmed ? '' :
      (opts.emailSent === false
        ? "<p>We couldn't send your confirmation email. Try again in a few minutes.</p>"
        : '<p>Check your inbox and confirm your email to lock in your spot.</p>');
    var refs = Number(d.refs || 0);
    var html =
      '<div class="wl-done" role="status" aria-live="polite">' +
        '<h3>' + head + '</h3>' +
        (pos ? '<div class="pos num">' + pos + (d.total ? ' <span>of ' + fmtInt(d.total) + '</span>' : '') + '</div>' : '') +
        confirmLine +
        '<p style="margin-top:10px">Move up ' + (d.boost || 10) + ' spots for every friend who joins with your link and confirms' +
          (refs ? ' — <b style="color:var(--text)">' + refs + '</b> so far.' : '.') + '</p>' +
        '<div class="ref-row"><input type="text" readonly value="' + esc(url) + '" aria-label="Your referral link">' +
          '<button type="button" class="btn btn-primary" data-copy>Copy</button></div>' +
        '<div class="share-row">' +
          (navigator.share ? '<button type="button" class="btn btn-outline" data-share="native">Share…</button>' : '') +
          '<a class="btn btn-outline" target="_blank" rel="noopener" data-share="x" href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(url) + '">Post on X</a>' +
          '<a class="btn btn-outline" target="_blank" rel="noopener" data-share="whatsapp" href="https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + url) + '">WhatsApp</a>' +
          '<a class="btn btn-outline" data-share="sms" href="sms:?&body=' + encodeURIComponent(shareText + ' ' + url) + '">Text</a>' +
        '</div>' +
        '<p class="small"><button type="button" class="linklike" data-reset style="background:none;border:0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0">Join with a different email</button></p>' +
      '</div>';

    wlBlocks().forEach(function (block) {
      block.innerHTML = html;
      var input = $('.ref-row input', block);
      $('[data-copy]', block).addEventListener('click', function (e) {
        var b = e.currentTarget;
        var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 2000); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { input.select(); document.execCommand('copy'); done(); });
        else { input.select(); document.execCommand('copy'); done(); }
        track('referral_share', { channel: 'copy' });
      });
      $$('[data-share]', block).forEach(function (s) {
        s.addEventListener('click', function (e) {
          var ch = s.getAttribute('data-share');
          track('referral_share', { channel: ch });
          if (ch === 'native') {
            e.preventDefault();
            navigator.share({ title: 'MyValue', text: shareText, url: url }).catch(function () {});
          }
        });
      });
      $('[data-reset]', block).addEventListener('click', function () {
        store.del(WL_KEY);
        wlBlocks().forEach(function (b) { b.innerHTML = b.getAttribute('data-original'); bindForm(b); });
        var first = $('[data-wl] input[type=email]'); if (first) first.focus();
      });
    });

    if (opts.fresh) {
      var here = $('#waitlist') || wlBlocks()[0];
      if (here && here.getBoundingClientRect().top > window.innerHeight) here.scrollIntoView({ block: 'center' });
    }
  }

  function fetchStatus(code) {
    return fetch(API + '/waitlist?code=' + encodeURIComponent(code))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function restoreWaitlist() {
    // Arrivals from the confirmation email / no-JS form redirect.
    var confirmed = params.get('confirmed');
    var joined = params.get('joined');
    var codeParam = (params.get('code') || joined || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (confirmed === '1') { track('waitlist_confirm'); toast("You're confirmed. Share your link to move up the list."); }
    if (confirmed === 'invalid') toast('That confirmation link is invalid or expired. Join again below and we will send a fresh one.');
    if (confirmed === 'error' || params.get('wl_error')) toast("Something went wrong on our side. Please try again in a moment.");
    if (params.get('wl_existing')) toast("You're already on the list — we've re-sent your referral link to your inbox.");
    if (codeParam) store.set(WL_KEY, { code: codeParam });
    if (confirmed || joined || params.get('wl_error') || params.get('wl_existing') || params.get('code')) {
      // Tidy the URL but keep ref/utm params and the hash.
      ['confirmed', 'joined', 'code', 'wl_error', 'wl_existing'].forEach(function (k) { params.delete(k); });
      var qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }

    var saved = store.get(WL_KEY);
    if (saved && saved.code) {
      fetchStatus(saved.code).then(function (d) {
        if (d && d.code) showDone(d);
        else if (d === null) { /* network/API issue: leave the form in place */ }
      });
    }
  }

  /* ---------------- live mode: app handoff ---------------- */
  var qrLib;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLib) return qrLib;
    qrLib = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.async = true;
      s.onload = function () { resolve(window.qrcode); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return qrLib;
  }

  function badgeHtml(loc) {
    var inner = cfg.appStoreBadgeSrc
      ? '<img src="' + esc(cfg.appStoreBadgeSrc) + '" alt="Download on the App Store" height="48">'
      : '<span><small>Download on the</small>App Store</span>';
    return '<a class="store-badge' + (cfg.appStoreBadgeSrc ? ' img' : '') + '" href="' + esc(storeUrl()) + '" data-track="badge_click_ios" data-loc="' + esc(loc) + '">' + inner + '</a>';
  }

  function sendLinkForm(id) {
    return '<form class="wl-form" data-sendlink novalidate>' +
      '<label class="sr-only" for="' + id + '">Email address</label>' +
      '<input id="' + id + '" type="email" name="email" autocomplete="email" required placeholder="you@example.com">' +
      '<input type="text" name="company" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="btn btn-primary" type="submit">Email me the link</button></form>' +
      '<p class="wl-msg" role="status" aria-live="polite"></p>';
  }

  function renderLive() {
    wlBlocks().forEach(function (block, i) {
      var loc = block.getAttribute('data-source') || 'block' + i;
      if (isIOS) {
        block.innerHTML = '<div class="store-cta">' + badgeHtml(loc) + '</div>';
      } else if (isAndroid) {
        block.innerHTML = cfg.playStoreUrl
          ? '<div class="store-cta"><a class="store-badge img" href="' + esc(cfg.playStoreUrl) + '" data-track="badge_click_android" data-loc="' + esc(loc) + '"><img src="' + esc(cfg.playStoreBadgeSrc || 'assets/badges/google-play.png') + '" alt="Get it on Google Play" height="52"></a></div>'
          : '<div class="store-cta"><div class="store-side"><p class="store-note">MyValue is iPhone-only for now. Send the link to your iPhone:</p>' + sendLinkForm('sl-' + i) + '</div></div>';
      } else {
        block.innerHTML = '<div class="store-cta"><div class="qr" data-qr aria-label="QR code linking to MyValue on the App Store" role="img"></div>' +
          '<div class="store-side"><p class="store-note">Scan with your iPhone camera to download — or get the link by email.</p>' + sendLinkForm('sl-' + i) + '</div></div>';
      }
    });

    var qrs = $$('[data-qr]');
    if (qrs.length) {
      loadQr().then(function (qrcode) {
        var qr = qrcode(0, 'M');
        qr.addData(storeUrl());
        qr.make();
        var svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        qrs.forEach(function (el) { el.innerHTML = svg; });
      }).catch(function () { qrs.forEach(function (el) { el.hidden = true; }); });
      var seen = false;
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting && !seen) { seen = true; track('qr_view_desktop'); io.disconnect(); }
          });
        }, { threshold: 0.6 });
        qrs.forEach(function (el) { io.observe(el); });
      }
    }

    $$('form[data-sendlink]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = form.nextElementSibling;
        var btn = $('button', form);
        var email = $('input[type=email]', form).value.trim();
        msg.className = 'wl-msg';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.className = 'wl-msg err'; msg.textContent = ERRORS.invalid_email; return; }
        btn.disabled = true;
        fetch(API + '/send-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, company: $('input[name=company]', form).value })
        }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (d) {
          btn.disabled = false;
          if (d.ok) { track('sendlink_submit'); msg.textContent = 'Sent. Open the email on your iPhone.'; form.reset(); }
          else { msg.className = 'wl-msg err'; msg.textContent = d.error === 'rate_limited' ? ERRORS.rate_limited : "We couldn't send that just now. Try scanning the QR code instead."; }
        }).catch(function () { btn.disabled = false; msg.className = 'wl-msg err'; msg.textContent = "We couldn't send that just now. Try scanning the QR code instead."; });
      });
    });

    smartBanner();
  }

  // iOS Safari shows Apple's native Smart App Banner (meta tag in <head>).
  // Everyone else on mobile gets this dismissible fallback.
  function smartBanner() {
    if (!isMobile || isIOSSafari) return;
    var href = isIOS ? storeUrl() : cfg.playStoreUrl;
    if (!href) return;
    var dismissed = store.get('mv_banner_x');
    if (dismissed && Date.now() - dismissed < 14 * 864e5) return;
    var logo = $('.logo-mark');
    var el = document.createElement('div');
    el.className = 'smartbar';
    el.innerHTML = '<button class="x" type="button" aria-label="Dismiss">×</button>' +
      '<span class="ico">' + (logo ? logo.outerHTML : '') + '</span>' +
      '<span class="txt"><b>MyValue</b><span>' + (isIOS ? 'Free on the App Store' : 'Free on Google Play') + '</span></span>' +
      '<a class="btn btn-primary" href="' + esc(href) + '" data-track="' + (isIOS ? 'badge_click_ios' : 'badge_click_android') + '" data-loc="smartbar">View</a>';
    document.body.appendChild(el);
    document.body.style.paddingBottom = '72px';
    $('.x', el).addEventListener('click', function () {
      store.set('mv_banner_x', Date.now());
      el.remove();
      document.body.style.paddingBottom = '';
    });
  }

  /* ---------------- LaunchList waitlist ----------------
     embed.getlaunchlist.com mounts each [data-launchlist-form] into an open
     shadow root once its script loads. Submit events don't cross the shadow
     boundary, so attach the analytics listener inside each root. */
  function launchList() {
    var hosts = $$('[data-launchlist-form]');
    if (!hosts.length) return;
    var tries = 0;
    (function attach() {
      var pending = 0;
      hosts.forEach(function (h) {
        if (h.__mvTracked) return;
        if (!h.shadowRoot) { pending++; return; }
        h.__mvTracked = true;
        var block = h.closest('[data-wl]');
        // Fit the embed to the site: no visible "Email *" label (the input keeps
        // aria-label="Email"), left-aligned outside centred sections, and a white
        // button on the dark bands, where LaunchList's #0a0a0a button disappears.
        var dark = !!h.closest('.invert, .ctaband, .dark-band');
        var centred = !!h.closest('.center, .final, .invert, .ctaband, .solo');
        var st = document.createElement('style');
        st.textContent =
          '[class*="--ll-label"]{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}' +
          '.ll-root{max-width:500px!important;' + (centred ? '' : 'margin-left:0!important;margin-right:0!important;') + '}' +
          '.ll-input{border-radius:12px!important;font-size:15px!important;height:48px!important;}' +
          'button[type=submit]{border-radius:12px!important;height:48px!important;font-size:15px!important;}' +
          (dark ? '.ll-root{--primary:#ffffff!important;--ring:#ffffff!important;--primary-foreground:#0a0a0a!important;}' : '');
        h.shadowRoot.appendChild(st);
        h.shadowRoot.addEventListener('submit', function () {
          track('waitlist_submit', { source: block ? block.getAttribute('data-source') : '', provider: 'launchlist' });
        }, true);
      });
      if (pending && ++tries < 40) setTimeout(attach, 250); // up to ~10s for the async embed
    })();
  }

  /* ---------------- store badges (hero) ----------------
     Official badges; they turn into links once the URLs exist in config. */
  function storeBadges() {
    $$('[data-store-badges]').forEach(function (box) {
      var links = { ios: storeUrl(), android: cfg.playStoreUrl || '' };
      ['ios', 'android'].forEach(function (k) {
        var a = $('[data-store=' + k + ']', box);
        if (!a || !links[k]) return;
        a.href = links[k];
        a.removeAttribute('aria-disabled');
        a.setAttribute('data-track', k === 'ios' ? 'badge_click_ios' : 'badge_click_android');
        a.setAttribute('data-loc', 'hero_badges');
      });
      var soon = $('[data-store-soon]', box);
      if (soon) soon.hidden = !!(links.ios && links.android);
    });
  }

  /* ---------------- page-level events ---------------- */
  function pageEvents() {
    var path = location.pathname;
    if (/pricing/.test(path)) track('pricing_view', { location: 'pricing_page' });
    else if ($('#pricing') && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting) { track('pricing_view', { location: 'home_section' }); io.disconnect(); }
      }, { threshold: 0.35 });
      io.observe($('#pricing'));
    }
    if (/asset-classes/.test(path)) track('category_page_view', { category: 'all' });
    $$('.faq details').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (d.open) track('faq_expand', { question: ($('summary', d) || {}).textContent || '' });
      });
    });
  }

  /* ---------------- contact / support form ---------------- */
  function contactForm() {
    var form = $('form[data-contact]');
    if (!form) return;
    var msg = $('.form-msg', form.parentNode);
    function state(kind, text) { msg.className = 'form-msg ' + kind; msg.textContent = text; }
    var topic = $('select[name=topic]', form), want = params.get('topic');
    if (topic && want && $('option[value="' + want.replace(/[^a-z-]/g, '') + '"]', topic)) topic.value = want;
    if (params.get('sent') === '1') state('ok', "Thanks — your message is on its way. We'll reply by email.");
    if (params.get('error')) state('err', "We couldn't send that just now. Email support@getmyvalue.app instead.");
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', form);
      var data = {};
      $$('input,textarea,select', form).forEach(function (f) { if (f.name) data[f.name] = f.value; });
      msg.className = 'form-msg'; msg.textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((data.email || '').trim())) { state('err', ERRORS.invalid_email); return; }
      if (!(data.message || '').trim()) { state('err', 'Add a message so we know how to help.'); return; }
      btn.disabled = true;
      fetch(API + '/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          btn.disabled = false;
          if (d.ok) { state('ok', "Thanks — your message is on its way. We'll reply by email."); form.reset(); track('contact_submit', { topic: data.topic || '' }); }
          else state('err', d.error === 'rate_limited' ? ERRORS.rate_limited : "We couldn't send that just now. Email support@getmyvalue.app instead.");
        })
        .catch(function () { btn.disabled = false; state('err', "We couldn't send that just now. Email support@getmyvalue.app instead."); });
    });
  }

  /* ---------------- interactive portfolio chart ----------------
     Scrub to any point in time; the whole chart turns red when the
     selected range is down (Robinhood-style). Demo data, deterministic. */
  function portfolioChart() {
    var root = $('[data-pchart]');
    if (!root) return;
    var area = $('[data-pc-area]', root), svg = $('svg', area);
    var line = $('.pl-line', svg), base = $('.pl-base', svg), cursor = $('.pl-cursor', svg), dot = $('.pl-dot', area);
    var elValue = $('[data-pc-value]', root), elChange = $('[data-pc-change]', root), elLabel = $('[data-pc-label]', root), elWhen = $('[data-pc-when]', root);
    var W = 520, H = 190, PAD = 12;
    var END = 24850.00, COST = 19695.26; // END matches the total shown in the app screens (P1-5)
    var RANGES = {
      '1W': { n: 42, start: 24301.10, vol: 0.004, step: 4 * 3600e3, label: 'Portfolio · 1W', seed: 7 },
      '1M': { n: 30, start: 25432.75, vol: 0.009, step: 864e5, label: 'Portfolio · 1M', seed: 11 },
      '3M': { n: 45, start: 22870.40, vol: 0.012, step: 2 * 864e5, label: 'Portfolio · 3M', seed: 5 },
      '1Y': { n: 52, start: COST, vol: 0.018, step: 7 * 864e5, label: 'Portfolio · 1Y', seed: 3 },
      'ALL': { n: 60, start: 12480.00, vol: 0.024, step: 14 * 864e5, label: 'Portfolio · All time', seed: 19 }
    };
    function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function series(r) {
      var rand = rng(r.seed), walk = [0];
      for (var i = 1; i < r.n; i++) walk.push(walk[i - 1] + (rand() - 0.5) * 2 * r.vol);
      var last = walk[r.n - 1], out = [];
      var lnStart = Math.log(r.start), lnEnd = Math.log(END);
      for (var j = 0; j < r.n; j++) {
        var f = j / (r.n - 1);
        // Brownian bridge: pin both ends, keep the texture.
        out.push(Math.exp(lnStart + (lnEnd - lnStart) * f + walk[j] - last * f));
      }
      return out;
    }
    function money(v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function change(v, from) {
      var d = v - from, pct = (d / from) * 100;
      return (d >= 0 ? '+ ' : '− ') + money(Math.abs(d)) + ' (' + Math.abs(pct).toFixed(2) + '%)';
    }
    function when(i, r) {
      var t = new Date(Date.now() - (r.n - 1 - i) * r.step);
      var o = r.step < 864e5 ? { month: 'short', day: 'numeric', hour: 'numeric' } : r.step >= 14 * 864e5 ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
      return t.toLocaleString('en-US', o);
    }

    var cur, data, min, max, idx = null;
    function y(v) { return PAD + (max - v) / (max - min) * (H - 2 * PAD); }
    function x(i) { return i / (data.length - 1) * W; }

    function draw(key) {
      cur = RANGES[key]; data = series(cur);
      min = Math.min.apply(null, data); max = Math.max.apply(null, data);
      var showBase = COST >= min * 0.98 && COST <= max;
      if (showBase) min = Math.min(min, COST);
      var span = max - min; min -= span * 0.04; max += span * 0.04;
      line.setAttribute('d', data.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(''));
      base.style.display = showBase ? '' : 'none';
      if (showBase) { base.setAttribute('x1', 0); base.setAttribute('x2', W); base.setAttribute('y1', y(COST)); base.setAttribute('y2', y(COST)); }
      root.classList.toggle('is-down', data[data.length - 1] < data[0]);
      elLabel.textContent = cur.label;
      area.setAttribute('aria-label', cur.label + ': ' + money(data[0]) + ' to ' + money(END) + ', ' + change(END, data[0]) + '. Use the arrow keys to move through time.');
      $$('.ranges button', root).forEach(function (b) { b.setAttribute('aria-pressed', b.textContent === key ? 'true' : 'false'); });
      reset();
    }
    function show(i) {
      idx = Math.max(0, Math.min(data.length - 1, i));
      var v = data[idx], px = x(idx), py = y(v);
      cursor.setAttribute('x1', px); cursor.setAttribute('x2', px); cursor.setAttribute('y1', 0); cursor.setAttribute('y2', H);
      cursor.removeAttribute('hidden'); dot.hidden = false;
      dot.style.left = (px / W * 100) + '%'; dot.style.top = (py / H * 100) + '%';
      elValue.textContent = money(v);
      elChange.textContent = change(v, data[0]);
      elWhen.textContent = when(idx, cur);
    }
    function reset() {
      idx = null; cursor.setAttribute('hidden', ''); dot.hidden = true;
      elValue.textContent = money(END);
      elChange.textContent = change(END, data[0]);
      elWhen.innerHTML = '&nbsp;';
    }
    function fromEvent(e) {
      var r = area.getBoundingClientRect();
      return Math.round((e.clientX - r.left) / r.width * (data.length - 1));
    }
    area.addEventListener('pointermove', function (e) { show(fromEvent(e)); });
    area.addEventListener('pointerdown', function (e) { show(fromEvent(e)); });
    area.addEventListener('pointerleave', reset);
    area.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); show((idx == null ? data.length - 1 : idx) + (k === 'ArrowLeft' ? -1 : 1)); }
      else if (k === 'Home') { e.preventDefault(); show(0); }
      else if (k === 'End') { e.preventDefault(); show(data.length - 1); }
      else if (k === 'Escape') reset();
    });
    area.addEventListener('blur', reset);
    $$('.ranges button', root).forEach(function (b) {
      b.addEventListener('click', function () { draw(b.textContent); track('chart_range', { range: b.textContent }); });
    });
    draw('1Y');
  }

  /* ---------------- scroll reveal ---------------- */
  function reveal() {
    var els = $$('.rv');
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---------------- feature carousel (homepage) ----------------
     Cards on the right drive the phone on the left; auto-advances,
     pauses on hover/focus, and stops for reduced-motion users. */
  function featureCarousel() {
    var root = $('[data-feats]');
    if (!root) return;
    var cards = $$('.feat', root), shots = $$('.device img.swap', root), dots = $$('.feat-dots i', root);
    var MS = 6000, i = 0, timer = null;
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.style.setProperty('--feat-ms', MS + 'ms');
    function go(n, user) {
      i = (n + cards.length) % cards.length;
      cards.forEach(function (c, k) {
        var on = k === i;
        c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        // restart the progress bar animation
        var bar = $('.bar i', c); if (bar && on) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      });
      shots.forEach(function (s, k) { s.classList.toggle('on', k === i); });
      dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
      if (user) track('feature_view', { feature: i + 1 });
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (still || root.classList.contains('paused')) return;
      timer = setTimeout(function () { go(i + 1); }, MS);
    }
    cards.forEach(function (c, k) { c.addEventListener('click', function () { go(k, true); }); });
    ['mouseenter', 'focusin'].forEach(function (ev) { root.addEventListener(ev, function () { root.classList.add('paused'); clearTimeout(timer); }); });
    ['mouseleave', 'focusout'].forEach(function (ev) { root.addEventListener(ev, function () { root.classList.remove('paused'); schedule(); }); });
    if (still) root.classList.add('paused');
    // only run while on screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { if (en[0].isIntersecting) schedule(); else clearTimeout(timer); }).observe(root);
    } else schedule();
  }

  /* ---------------- legacy anchors ----------------
     Privacy and terms used to live on contact.html#privacy / #terms. */
  (function legacyLegalAnchors() {
    if (!/contact/.test(location.pathname)) return;
    var h = location.hash;
    if (/^#privacy/.test(h)) location.replace('/privacy' + (h === '#privacy' ? '' : h));
    else if (h === '#terms') location.replace('/terms');
  })();

  /* ---------------- boot ---------------- */
  function boot() {
    window.mvBooted = true;
    reveal();
    featureCarousel();
    $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
    routeCtas();
    initWaitlistForms();
    if (LIVE) { renderLive(); renderAnnounce(); }
    // The built-in waitlist form only restores its "you're on the list" panel when
    // it is actually on the page; LaunchList blocks manage their own state.
    else if ($('form[data-waitlist]')) restoreWaitlist();
    if (!LIVE) launchList();
    if ((!LIVE && $('[data-announce]')) || $('[data-beta-count]')) {
      fetch(API + '/waitlist').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (stats) { if (!LIVE) renderAnnounce(stats); renderBeta(stats); })
        .catch(function () {});
    }
    storeBadges();
    pageEvents();
    contactForm();
    portfolioChart();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
