# ADR 0006: Official H20 Brand Typography and Elementor Design Tokens

Status: accepted (issue #18)

## Context

Issue #18 requires matching the H20 Event Assistant's visual design and typography to the official venue website (`https://eventlocatie.h20.gg/`). Previously, `src/app/event-assistant/brand.css` fell back to generic `Arial, Helvetica, sans-serif`, used fixed `px` heading sizes, and forced square `border-radius: 0` across buttons, cards, and inputs, leaving `'Visuele gelijkheid met officiële website en exact lettertype'` flagged as unverified in `scripts/check-requirements.cjs`.

Inspection of `https://eventlocatie.h20.gg/` (`post-5.css` Elementor global kit `.elementor-kit-5`, `post-26.css`, and `https://use.typekit.net/jcy4hly.css`) established the live brand specification:

1. **Official Typeface & Licensing**:
   - `eventlocatie.h20.gg` uses `"nudista-web"` (Suitcase Type Foundry) loaded via Adobe Fonts / Typekit kit `jcy4hly` in weights `300`, `400`, `500`, `600`, `700`, `900`.
   - Adobe Fonts kits are domain-restricted under Adobe's EULA and must not be hotlinked from unauthorized domains (such as the Firebase Hosting domain) without H20's explicit domain allowlisting.
2. **Official Elementor Kit Tokens (`.elementor-kit-5`)**:
   - Palette: Primary Black `#000000`, Surface White `#FFFFFF`, Secondary Cyan `#5FC2D2` (`#60C2D2` in Elementor), Accent/CTA Magenta `#E1014B` (`#E1014A` in Elementor), Dark Neutral `#333333`, Deep Blue `#364B9B`.
   - Type scale: desktop `h1` `50px` (`3.125rem`), `h2` `40px` (`2.5rem`), `h3` `30px` (`1.875rem`), bold geometric headings (`600`–`800`).
   - Buttons (`.elementor-kit-5 button, .elementor-button`): pill-shaped (`border-radius: 999px`), primary fill `#E1014B` with `#FFFFFF` bold (`700`) label, transitioning to H20 cyan `#5FC2D2` on hover.

## Decision

1. **Open-Licensed Webfont + Zero-Change Adobe Fonts Slot**:
   - Load **Barlow** (`400`, `500`, `600`, `700`, `800`, plus `400` italic, SIL Open Font License) from Google Fonts in `src/index.html` using `<link rel="preconnect">` hints (`https://fonts.googleapis.com` and `https://fonts.gstatic.com` with `crossorigin`) and `display=swap` (never CSS `@import`). Barlow is a slightly condensed, rounded-corner geometric-technical neo-grotesque closely matching Nudista's proportions and stroke contrast.
   - Define `--h20-font-sans: 'nudista-web', 'Barlow', Arial, Helvetica, sans-serif;` in `:root`. Listing `'nudista-web'` first means that if H20 later allowlists the Firebase Hosting / custom domain on their Adobe Fonts kit and adds `<link rel="stylesheet" href="https://use.typekit.net/<kit-id>.css" />` in `src/index.html`, `"nudista-web"` activates automatically with zero CSS changes.
2. **CLS-Safe Font Fallbacks & Accessible Fluid Type Scale**:
   - Set `font-size-adjust: from-font` on `:root` and `font-size-adjust: cap-height from-font` on `h1, h2, h3` so fallback system fonts scale to match the active webfont's x-height / cap-height and avoid Cumulative Layout Shift (CLS).
   - Replace fixed `px` heading rules with `rem`-bounded `clamp()` scales whose maximum never exceeds `2.5x` the minimum (`h1`: `1.875rem` → `3.125rem`, `.hero h1`: `2rem` → `3.125rem`, `h2` / `.event-intro h2`: `1.5rem` → `2.5rem`, `h3`: `1.15rem` → `1.5rem`), satisfying WCAG 1.4.4 Resize Text up to 200% zoom.
   - Use unitless `line-height` (`1.5` on `body`/`p`, `1.15`–`1.2` on headings), `text-wrap: balance` on bare headings (`h1, h2, h3`), `text-wrap: pretty` on paragraphs, and avoid fixed `height` on text containers (WCAG 1.4.12 Text Spacing).
3. **Elementor Pill CTAs with WCAG AAA Hover Contrast**:
   - Style primary and secondary action buttons as pills (`border-radius: 999px`) while keeping structural navigation/grid buttons (`.sidebar nav button`, `.event-types button`, `.calendar-day`, `.desktop-toggle`) crisp with `6px`–`8px` corners, cards/panels/inputs at `8px`, and badges/chips at `999px`.
   - On `.primary` hover (`background: #5fc2d2`), set `color: #000000` instead of `#ffffff`, raising text contrast from `2.07:1` to `10.13:1` (WCAG AAA). Use `--h20-deep-blue` (`#364b9b`, `7.7:1` on white) for `:focus-visible` outlines on light surfaces and `--h20-cyan` (`#5fc2d2`, `10.13:1` on black) inside `.sidebar` and `.hero`.

## Optional Future Adobe Fonts Activation

Once H20 adds the production domain to their Adobe Fonts kit allowlist:

1. Add `<link rel="preconnect" href="https://use.typekit.net" crossorigin />` and `<link rel="stylesheet" href="https://use.typekit.net/<kit-id>.css" />` in `src/index.html` `<head>` (at the placeholder comment).
2. No CSS edits are required because `'nudista-web'` is already first in `--h20-font-sans`.

## Rejected Alternatives

- **Hotlinking `https://use.typekit.net/jcy4hly.css` directly**: violates Adobe Fonts domain licensing and fails with `403` when Typekit referrer enforcement restricts unlisted domains.
- **Keeping `Arial, Helvetica, sans-serif` only**: noticeably wider, humanist/neo-grotesque proportions that diverge from H20's technical esports venue identity.
- **White text on `#5fc2d2` button hover**: fails WCAG 1.4.3 minimum contrast (`2.07:1` < `4.5:1`).

## Consequences

- Typography, button shapes, card radii, and palette tokens align closely with `eventlocatie.h20.gg` out of the box under an open font license, with a one-line `<link>` upgrade path to licensed `"nudista-web"`.
- `scripts/check-requirements.cjs` now verifies both the H20 palette and the webfont stack automatically.
