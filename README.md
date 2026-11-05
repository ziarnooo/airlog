# AIRLOG site — variant B (“jump arc”)

Static Astro landing page for AIRLOG, a kitesurf jump tracker for Garmin watches.
Target: `https://ziarnooo.github.io/airlog/` (`site` + `base: '/airlog'` in `astro.config.mjs`).

Hero concept: a cinematic 3D jump arc (hand-projected SVG, no libraries) drawn on load, with velocity
vectors, a height tape and apex marker, and a layered-SVG Garmin Forerunner 265 in the foreground showing the
measured height. Scrolling scrubs the jump (playhead + camera yaw); `prefers-reduced-motion` gives a static apex.

## Run

```sh
npm install
npm run dev        # http://localhost:4321/airlog/
npm run build      # → dist/
npm run preview    # serves dist/ under /airlog/
```

## Structure

- `src/scripts/jump-scene.ts` – shared 3D arc engine (projection, vectors, tape, kite); used by hero and replay
- `src/scripts/hero.ts` – load animation, scroll scrub, pointer parallax, watch readout
- `src/scripts/replay.ts` – 3D replay section (autoplay, drag-to-rotate, scrubber)
- `src/scripts/story.ts` – START → GPS → recording → SESSION SAVED scene on the watch screen
- `src/scripts/motion.ts` – IntersectionObserver reveal, tilt/magnet/spotlight (same techniques as Si-skin)
- `src/scripts/footer-dots.ts` – dot-grid AIRLOG wordmark with cursor light
- `src/components/Watch.astro` – layered SVG watch (strap, buttons, case, metal bezel, glass ring, AMOLED screen, status bar, glass + glint)
- `src/components/Phone.astro` – layered SVG phone with the activity feed
- `.github/workflows/deploy.yml` – GitHub Pages (withastro/action + actions/deploy-pages)

## TODO before publishing

- **Confirm the beta contact address.** `mailto:hello@airlog.app?subject=AIRLOG%20beta` is a placeholder used in
  `Header.astro`, `Hero.astro`, `Watches.astro`, `Footer.astro`. It must be replaced with a real, monitored address.
- All numbers on the page (one demo session: highest jump 4.4 m, AIR 2.9 s, distance 21 m, 12 jumps, average speed while moving 27 km/h) are **demo data** and are labelled as such.
  No accuracy numbers, user counts, ratings or partner logos are claimed (height accuracy is still being validated).
- `public/og.jpg` (<200 KB) is a screenshot of the hero; regenerate it if the hero changes.
- Watch → AIRLOG sync and the Strava connection are not built yet; the site says so (FAQ, Strava section). Strava is shown as “coming soon” (not a working button) and uses no Strava logo.
