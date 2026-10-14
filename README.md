# getmyvalue.app — marketing site

Static HTML on Vercel, plus zero-dependency serverless functions in `api/` for the waitlist.
No build step: push to `main` and Vercel deploys.

```
index.html … pricing.html   pages (each keeps its own inline base stylesheet)
privacy / terms / support    standalone legal + support URLs (App Store requirement)
start.html                   link-in-bio / creator campaign page (noindex)
assets/config.js             ← the one switch: pre-launch ⇄ live
assets/site.js               waitlist, referrals, CTA routing, app handoff, analytics, chart
assets/site.css              shared components (loaded after each page's inline CSS)
api/                         waitlist, confirm, unsubscribe, send-link, contact
```

## Pre-launch ⇄ live switch

Edit `mode` in `assets/config.js` and deploy. Every primary CTA (links marked `data-cta` and blocks marked `data-wl`) changes with it:

| | `prelaunch` (now) | `live` |
|---|---|---|
| Top bar | Hidden until the confirmed count reaches `waitlistMinToShow`, then a progress bar: "X of the first 1,000 founding members" | "MyValue is on the App Store" |
| CTA labels | "Join the waitlist" | The product label stored in `data-live-label` (e.g. "Start free", "Go Plus — $5.99/month") |
| Hero and closing CTAs | Email → waitlist, referral link, queue position | iPhone: App Store badge · desktop: QR code + "Email me the link" · Android: send the link to an iPhone |
| Header, pricing CTAs | Scroll to the waitlist | iPhone: straight to the App Store |
| Mobile banner | none | Safari: native Smart App Banner · other browsers: fallback banner |

To preview either mode without changing anything, add `?preview=live` or `?preview=prelaunch` to any URL. If `mode` is `live` but `appStoreUrl` is empty, the site stays in pre-launch and logs an error.

### Launch-day checklist
1. In `assets/config.js`, set `appStoreUrl`, `appleProviderToken` (App Store Connect → Analytics → Campaigns), and `customProductPages` (utm_source → ppid). Then set `mode: 'live'`.
2. Download the official badge from Apple Marketing Tools to `assets/app-store-badge.svg` and set `appStoreBadgeSrc`. Apple's guidelines require the official artwork; the text badge is only a placeholder.
3. In every page's `<head>`, uncomment `<meta name="apple-itunes-app" content="app-id=…">` and add the real id. Safari only reads this tag from the HTML, so it can't be set from JS.
4. Set the `APP_STORE_URL` env var (used by `/api/send-link`).
5. Send the launch email to confirmed waitlist members who haven't unsubscribed (`wl:u:*` where `confirmed=1` and `unsub` is not set).

## Store badges (hero)
The hero shows the official App Store and Google Play badges under the waitlist form. To make them links, paste the store URLs (referral or campaign links are fine) into `appStoreUrl` and `playStoreUrl` in `assets/config.js`. Until both are set, the badges aren't clickable and a "Coming soon" line shows underneath. Badge artwork comes from Apple and Google (`assets/badges/`); don't recolour or redraw it.

## Domain switch (brief D1 / P0-1)
Until getmyvalue.app points at this Vercel project, it still serves the old Framer site. Until then:
- `og:image`, `twitter:image` and the JSON-LD logo point at `https://myvalue-nine.vercel.app/…` so link previews work today (P0-7). Canonicals and `og:url` still point at getmyvalue.app, pending D1.
- `vercel.json` sends `X-Robots-Tag: noindex` on the `myvalue-nine.vercel.app` host only, so the preview host never competes with the real domain in search.
- `vercel.json` already 308-redirects the old Framer routes: `/privacy-policy`, `/terms-of-service` and `/contact-page`. They take effect once the domain points here.

On switch day: add getmyvalue.app to the Vercel project, then run
`sed -i '' 's#https://myvalue-nine.vercel.app/#https://getmyvalue.app/#g' *.html` so the images come from the real domain.

## Private-beta count
The "In private beta with N collectors" lines load N from `GET /api/waitlist`. Set it in the Upstash console with `SET site:beta_testers 42`, which takes effect within a minute and needs no deploy. `BETA_TESTERS` in the environment also works as a fallback. With no value set, the lines stay hidden, so a stale number never shows.

## Waitlist (LaunchList)
Every "Join the waitlist" form is the LaunchList embed (`frm_nqkpffdnjhf4`): `<div data-launchlist-form="…">` inside each `[data-wl]` block, plus `embed.getlaunchlist.com/v1/embed.js` in the `<head>` of pages that have a form. Signups, confirmation emails, referrals and queue positions are all handled in the LaunchList dashboard, and the form's fields and copy are edited there too.

- `site.js` injects a small stylesheet into each form's shadow root. It hides the visual "Email" label (the input keeps `aria-label`), left-aligns the form in the hero, and turns the button white on dark bands. Everything else comes from the LaunchList theme.
- Submissions are tracked as `waitlist_submit` with `provider: "launchlist"`.
- In live mode, the form slots are still replaced by the App Store CTA / QR code.
- The top-bar progress bar reads its count from our own `/api/waitlist`, so it stays hidden while signups go to LaunchList.

The self-hosted engine below is kept in `api/` but no page uses it for signups. `GET /api/waitlist` still serves the beta count.

## Waitlist engine (`api/`)

- `POST /api/waitlist` takes an email. The response includes the queue position and a unique referral link, and the person gets a double opt-in email. The endpoint also accepts a plain form post, so signup still works without JS.
- `GET /api/confirm?token=` confirms the address. Only at that point does the referrer move up `REFERRAL_BOOST` places, so fake emails can't be used to jump the queue. Clicking the link twice has no extra effect.
- `GET /api/waitlist` returns the confirmed count shown in the progress bar (CDN-cached for 60s). The number stays hidden until it reaches `waitlistMinToShow`.
- `GET /api/unsubscribe?token=` gives one-click unsubscribe (RFC 8058). Every email has a List-Unsubscribe header and the postal address in the footer (CAN-SPAM).
- Rate limits per IP: 8 signups, 5 contact messages, and 5 send-link requests per hour. Forms also have a honeypot field.

### Environment variables (Vercel → Settings → Environment Variables)
| Name | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Storage. The Vercel Marketplace Upstash/KV integration sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`, and those work too. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email. Verify the getmyvalue.app domain in Resend first. |
| `MAIL_POSTAL_ADDRESS` | Physical address for the email footer. CAN-SPAM requires it. |
| `SITE_URL` | `https://getmyvalue.app` |
| `CONTACT_TO` | Inbox for the contact form |
| `APP_STORE_URL` | Live mode only |
| `REFERRAL_BOOST` | Optional. Places gained per confirmed referral (default 10). |

If Redis or email isn't configured, signup returns `503 not_configured` and the form shows a retry message. Signups are never silently dropped.

## Analytics
`site.js` sends the brief's named events (`waitlist_submit`, `waitlist_confirm`, `referral_share`, `referral_signup`, `badge_click_ios`, `badge_click_android`, `qr_view_desktop`, `sendlink_submit`, `pricing_view`, `category_page_view`, `faq_expand`) to `window.dataLayer`. It also forwards them to Plausible, gtag, or PostHog if one of those snippets is on the page. No provider is installed yet. Add `?debug=1` to any URL to log events to the console. If the provider you add sets cookies, you'll also need a consent banner.

## Logo
The mark is a vector trace of the supplied PNG. It's inlined as SVG in every header and footer (`fill: currentColor`). Standalone files: `assets/logo-mark.svg`, `favicon.svg` (adapts to light and dark mode), `favicon-32.png`, `apple-touch-icon.png`, `logo.png` (JSON-LD), and `og-image.png`.
