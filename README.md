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
| Top bar | Waitlist progress: "X of the first 1,000 founding members" | "MyValue is on the App Store" |
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
