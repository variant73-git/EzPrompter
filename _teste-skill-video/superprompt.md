# Superprompt — produced by the video-to-superprompt skill (video-only input)

Produced strictly from `out-farm/site.webm` (72s scroll recording, 1280×720).
No DOM, CSS, or asset URLs were inspected. Everything below was inferred from
video frames alone, per the skill's workflow.

```text
Build a single-page marketing site for an agricultural product called CropTab™
by the brand "Farm Minerals", based on the supplied reference video. Treat the
video as an exact recreation target: same section order, same copy, same motion
language. The result should feel premium, calm and organic — an earthy
editorial design with photoreal 3D product renders, generous whitespace, and
smooth scroll-driven storytelling.

ASSET MAP (all placeholders — generate or substitute)
- hero-bg.mp4: slow, defocused organic green gradient video (blurred grass/leaf
  shapes drifting, dark olive vignette at top). Fallback: animated CSS gradient.
- product-tab.mp4 (or 36-frame sprite): photoreal black square tablet with
  rounded corners and an embossed 5-petal leaf mark, rotating 360° on its Y
  axis, floating on transparent/green background.
- water-drop.mp4: macro shot, the same black tablet dropping into water seen
  exactly at the waterline — splash crown, then it sinks with bubbles,
  green background. ~8s, designed to be scrubbed (not autoplayed).
- corn-illustration.svg: flat olive-green illustration of a corn plant with
  grass tufts, drawn with strokes suitable for a line-draw-then-fill effect.
- world-map.svg: light minimal world map, some countries filled olive
  (USA, Mexico, UK, Spain, Uzbekistan, Vietnam, South Africa, Bolivia).
- photo-potatoes.jpg: warm photo, farmer's hands holding fresh potatoes,
  field bokeh behind.
- photo-cabbage.jpg: macro of a green cabbage/lettuce leaf with water drops.
- pasture-sheep.mp4: rolling green pasture with grazing sheep at golden hour.
- pasture-cows.jpg: wide pasture with cows walking toward camera, blue sky,
  two farmers on a quad bike in the foreground.
- box-npk.png: olive-green product box render, back side with icon grid and
  barcode, label "CropTab™ NPK".
- box-nutripeak.png: same box in off-white, label "Nutripeak™ Base".
- package-hero.png: the olive box front, "CropTab™ NPK" + embossed tablet.
- seedling.mp4: single young seedling on olive-green studio background,
  designed to "grow" when the user clicks the watering CTA (two states).
- logo.svg: "Farm Minerals" — small 5-petal leaf/flower mark above the
  wordmark; also used huge as a cutout mask shape.

BRAND AND CONTENT
- Brand: Farm Minerals. Product: CropTab™.
- Navigation (fixed, transparent, on every section): left "✕ MENU", center
  logo + "Farm Minerals", right "CONTACT US". Text ~11px uppercase tracked.
- Hero headline: "CropTab™" + right-aligned pill button "• REQUEST ACCESS •".
- Hero sub-row under a hairline rule: left "FERTILIZER, REINVENTED." — right
  "100 KG OF FERTILIZER — REIMAGINED AS A 13 G TABLET."
- Hero bottom-left: "For Your Crops. For the Planet." + small caps paragraph
  "CARBON-CAPSULE TECHNOLOGY THAT DELIVERS NUTRIENTS WITH ZERO WASTE AND ZERO
  EMISSIONS."
- All remaining copy is specified per section below. Keep it verbatim.

GLOBAL DESIGN SYSTEM
- Colors: beige paper #F0EAE3 (sections), deep olive #4A5526 (dark blocks and
  headline text on beige), muted sage green #8A9B57→#5E6B33 gradients (hero and
  green sections), cream #F2ECE1 (text on green), near-black tablet product.
- Typography: a single grotesque sans (Helvetica-Now/Inter-like) everywhere.
  Display sizes are huge (hero ~9vw; section statements 56–72px), weight
  regular — never bold-heavy. Labels/paragraphs are ~11-12px UPPERCASE with
  +4% letter-spacing. No serifs, no italics.
- Layout: full-viewport sections; a 5-column hairline grid (1px lines in a
  slightly darker beige) is VISIBLE on beige sections as a design element.
  12-24px outer margins; content usually pinned to far left/right edges.
- Small ✕-shaped flower glyphs used as decorative markers next to captions.
- Buttons: pill-shaped, small caps label between two dots "• LABEL •";
  variants: translucent frosted on photos/green, solid olive on beige,
  solid white for the final CTA.
- Image treatment: photography is warm, sun-lit, agricultural; product renders
  are studio-clean. Full-bleed media sits edge to edge, no rounded corners.
- Anti-patterns: no drop shadows, no rounded cards (except pills), no bright
  saturated colors, no stock-photo collages, no decorative blobs.

MOTION SYSTEM
- Feel: slow, heavy ease-outs (cubic-bezier(.2,.7,.2,1), 0.8–1.2s), long
  scroll-driven scenes. Nothing bounces.
- Page uses smooth/lerped scrolling (Lenis-style) — wheel input glides.
- Text reveals: headlines enter as words/lines rising from below a clip mask
  (translateY(110%) → 0, staggered ~80ms). Some section titles instead fade
  letters in RANDOM order (scramble-in) — used on "You don't get many chances
  to be early" and the "Meet CropTab™" title.
- Section transitions: the beige sections wipe IN over the previous section as
  a column grid — 5 vertical panels slide up with slight per-column offset,
  covering the outgoing section (the outgoing hero stays fixed behind).
- Illustration draw-on: the corn SVG first appears as thin outlines, then
  fills bottom-up as you scroll through the section.
- Pinned scenes scrub with scroll (see below).
- Reduced motion: disable smooth scroll, scrubbing and staggered reveals;
  show final states; keep the water video as a static poster.

PRELOADER
- Beige screen, centered concentric squares in alternating olive tones that
  zoom/step inward toward the leaf logo, ~1.5s, then the whole loader fades
  and the hero text rises in.

SECTION 1 — HERO (100vh, sticky behind next section)
- Background: hero-bg.mp4 blurred green, darker at top.
- Fixed nav as specified. "CropTab™" ~9vw cream, top-left, rises in on load.
- Right: "• REQUEST ACCESS •" frosted pill, aligned with the rule.
- Hairline rule full-width under the headline; the two caption rows beneath.
- Center: product-tab rotating slowly (Y-axis 360° loop, ~8s), ~40% viewport
  wide, floating with a soft ambient bob.
- Bottom-left: "For Your Crops. For the Planet." + caps paragraph.
- Scroll behavior: hero stays fixed while Section 2's beige columns wipe up
  over it.

SECTION 2 — PROBLEM STATEMENT (beige, visible 5-column hairline grid)
- Statement, two staggered lines, olive, centered-left offset:
  "Most fertilizers never make it to your plants" (line-rise reveal).
- Small paragraph, bottom-right cell: "Nutrients evaporate, wash away, or get
  locked in the soil — leaving you with fewer yields, more spraying, and
  higher costs."

SECTION 3 — NITROGEN STAT (beige, grid)
- Top-left: "Up to 70% of nitrogen is lost" (olive, 2 lines).
- Center: corn-illustration.svg with line-draw → fill-on-scroll effect.
- Bottom-right: "before crops can use it".

SECTION 4 — SOLUTION (green gradient, 100vh)
- Right column: "We found a better way" cream, 2 lines, line-rise; caps
  paragraph: "MEET CROPTAB™. POWERED BY PRECISION-ENGINEERED CARBON CAPSULES,
  IT MARKS THE FIRST MAJOR INNOVATION IN FERTILIZERS IN OVER 35 YEARS." +
  "• LEARN MORE •" pill.
- Center: the same rotating tablet, larger, textured close-up.
- On scroll, three beige cards slide up in stagger across the width:
  1) "Smaller than a plant cell" — "ENGINEERED TO PASS THROUGH THE SURFACE
     AND DELIVER NUTRIENTS FROM WITHIN."
  2) "Effortlessly integrative" — "NO NEW TOOLS. NO LEARNING CURVE. JUST A
     SMARTER WAY TO GET THE SAME JOB DONE — WITH LESS WASTE AND ZERO
     EMISSIONS."
  3) "Zero manufacturing emissions" — "WE COMPLETELY BYPASS THE HABER-BOSCH
     PROCESS — NO CO₂, NO NOₓ, ZERO COMPROMISE."
  Each card carries the ✕ flower glyph top-left.

SECTION 5 — WATER DROP (pinned ~300vh, scroll-scrubbed video)
- Title "Meet CropTab™" (cream, scramble-in) appears as the waterline rises
  into view; a glass-refraction band crosses the screen at the boundary.
- Pin the section and map scroll progress to water-drop.mp4 currentTime
  (splash at the top → tablet sinking with bubbles at the bottom).
- Four captions fade in/out in sequence at fixed anchors, each with a hairline
  rule and the ✕ glyph:
  1) left-middle "Just drop it" — "NO NEW EQUIPMENT NEEDED. JUST DROP IT INTO
     WATER — IT DISSOLVES EVENLY ON ITS OWN."
  2) right-lower "0 run-off" — "EVENTS RECORDED IN 12 MONTHS OF MONITORING.
     WASTE ELIMINATED."
  3) left "Reinventing delivery" — "1.000 TABLETS (2.500 ACRES) – JUST
     29 LB / 13 KG. FITS IN A COURIER BOX. SHIPS WITH FEDEX, DHL, EVEN
     AMAZON. THOUSANDS OF ACRES, DELIVERED OVERNIGHT."
  4) right "Zero emissions" — "WE SKIP ENERGY-INTENSIVE PROCESSES ENTIRELY,
     CUTTING CO₂ AT THE SOURCE. CLEANER TO MAKE, BETTER FOR THE PLANET".

SECTION 6 — RESULTS TABLE (beige)
- Right-aligned ledger of four rows separated by hairlines, big olive figures
  left of each row, small caps label right-aligned:
  "4 — CONTINENTS TESTED", "100x — LOWER TRANSPORT COST",
  "0.5 ton — CO₂ SAVED PER ACRE – AT NO EXTRA COST",
  "≥5× — RETURN* ON EVERY DOLLAR INVESTED".
- Footnote: "*EQUAL TO OR BETTER THAN THE ROI PUBLISHED FOR LEADING NPK
  PROGRAMS; BASED ON SIDE-BY-SIDE TRIAL ECONOMICS AND LOWER FREIGHT +
  ZERO-EMISSION PRACTICES."
- Numbers count up / rise in as the section enters.

SECTION 7 — OFFSET SPLIT (beige left / photo right)
- Right half: photo-potatoes.jpg full-bleed.
- Left: caps copy "MOST AG COMPANIES PAY TO OFFSET THEIR EMISSIONS. WITH FARM
  MINERALS, YOU DON'T HAVE TO. OUR FERTILIZERS ARE MADE CLEAN FROM THE START —
  SO YOU CAN LOWER YOUR FOOTPRINT WITHOUT BUYING CREDITS OR PAYING COMPLIANCE
  FEES." + "• LEARN MORE •" olive pill.

SECTION 8 — MARQUEE + LOGO MASK (beige → green)
- Infinite horizontal marquee, one line between two full-width hairlines:
  "For Better Plants. For Healthier Animals. For Better Planet." moving left,
  huge (~8vw). It starts olive-on-beige; the section behind transitions to
  olive green and the SAME marquee continues cream-on-green over the mask
  scene (the marquee is sticky across the color change).
- Behind the marquee on green: the 5-petal Farm Minerals logo as a giant
  CUTOUT MASK revealing pasture-sheep.mp4 playing inside the shape. The mask
  scales up gradually with scroll (from ~40% to filling most of the frame).

SECTION 9 — PACKAGE OVER PASTURE (video full-bleed)
- pasture-sheep video expands to full-bleed. Headline scrubs by as you enter:
  "…reserves cut the nutrient demand per acre without cutting yield" (cream).
- Center: package-hero.png (CropTab™ NPK box) floating/rotating slightly.
- Two frosted stat chips float at left/right:
  "½ ton of CO₂e saved per acre — LIFE-CYCLE ANALYSIS SHOWS ~500–600 LB CO₂E
  SAVINGS PER ACRE." and "1000x lighter logistics — ONE 13 KG BOX REPLACES
  25 TONS OF FERTILIZER — COURIER-SHIPPABLE, PALLET-FREE."

SECTION 10 — FIELD TRIALS (split)
- Left (beige): "Field Trials in Progress" olive headline + caps copy: "OUR
  TECHNOLOGY IS IN THE FIELD TODAY, ACROSS MULTIPLE CONTINENTS. THE GOAL — A
  SINGLE FERTILIZER PLATFORM FARMERS CAN TRUST, ANYWHERE IN THE WORLD." +
  world-map.svg with olive-filled countries.
- Right: photo-cabbage.jpg full-bleed with beige overlay cards: "Why we share
  this" — "REAL DATA BEATS MARKETING CLAIMS. FOLLOW THE RESULTS AS THEY COME
  IN." and "Next update" — "AUGUST 2026 — FULL-SEASON BIOMASS AND ROI DATA."
- Over the photo: "Be first to try CropTab™. Early-access slots open for 2027
  season." + frosted "• CHECK ELIGIBILITY •" pill.

SECTION 11 — INTERACTIVE DEMO (green, 100vh)
- "See the Difference for Yourself" cream headline top-left; caps note top-
  right: "TRY IT ON YOUR FIELD. NO COMMITMENT, NO RISK — JUST A CHANCE TO SEE
  HOW MUCH BETTER YOUR FERTILIZER CAN WORK."
- Center: seedling.mp4. A frosted glass card sits at bottom-center: title
  "Add more water", caption "It seems that a plant needs a little help." and a
  circular button with a water-drop icon. Clicking plays the growth state.

SECTION 12 — FORMATS & ACCESS (beige, carousel)
- Left: "Formats & Access" olive headline; caps copy "WE'RE LIMITING EARLY
  ACCESS TO SELECT GROWERS AND AGRONOMY PARTNERS." + solid-olive
  "• REQUEST ACCESS •" pill; round arrow buttons ← → lower-left.
- Cards (beige panels): box-npk.png "CropTab™ NPK — PERFECT FOR COMPLETE
  NUTRIENT REPLACEMENT — 0.13KG / 1.3 KG — SHELF LIFE – 2 YEARS — X 10/100
  TABLETS" and box-nutripeak.png "Nutripeak™ Base — PERFECT FOR CROPS
  DEMANDING MICRONUTRIENTS — same specs".

SECTION 13 — FINAL CTA (photo full-bleed, end of page)
- pasture-cows.jpg full-bleed. Top-left olive headline (scramble-in):
  "You don't get many chances to be early".
- Right-center, white: "To lead, not follow" large + caps lines "TO SHAPE WHAT
  FARMING BECOMES — NOT JUST ADAPT TO IT." / "CROPTAB™ IS ALREADY IN THE HANDS
  OF PROGRESSIVE GROWERS REWRITING THE RULES. IF YOU'RE READY, WE'LL MAKE ROOM
  FOR YOU."
- Buttons: solid white pill "• REQUEST A SAMPLE •" + frosted pill
  "• TALK TO OUR TEAM •".

VIDEO AND SCROLL IMPLEMENTATION
- Use GSAP ScrollTrigger (+ Lenis smooth scroll). Pin Section 5 for ~3
  viewports and drive water-drop.mp4 via video.currentTime mapped to progress
  (video muted, playsInline, preload auto, no controls).
- Column-wipe transitions: 5 absolutely-positioned panels per incoming
  section, translateY 100%→0, stagger 60-90ms, previous section pinned under.
- Marquee: duplicated track, translateX loop, linear, ~80s; sticky across the
  beige→green boundary.
- Logo mask: SVG clip-path or mask-image over the pasture video; scale driven
  by scroll progress.
- Rotating tablet: video loop or 36-frame image sequence; do NOT attempt
  real-time 3D.

RESPONSIVE
- Desktop-first (the reference is 1280×720). Tablet: grid drops to 3 columns,
  stats stack. Mobile: single column, headlines ~11vw, split sections stack
  photo-under-text, pinned water scene shortens to ~200vh, carousel becomes
  swipe. Never let fixed nav labels overlap the center logo.

ACCESSIBILITY AND PERFORMANCE
- prefers-reduced-motion: kill Lenis, pins, scrubbing, scramble and stagger;
  static posters for videos.
- Keyboard: all pills focusable with visible outline; carousel arrows are
  buttons.
- Lazy-load below-fold media; poster images for all videos; pause offscreen
  videos via IntersectionObserver.
- Videos ≤ 1080p, compressed; total page under ~15 MB.

SUCCESS CHECK
- First viewport: preloader → CropTab™ hero with rotating black tablet over
  blurred green, nav in place, caption rows under a hairline.
- During scroll: beige column-wipe over the hero; line-rise text reveals;
  corn draw-on; three staggered cards on green; a pinned, scroll-scrubbed
  water-drop scene with 4 sequential captions; stats ledger; marquee that
  survives a beige→green flip; giant leaf-logo mask revealing sheep footage;
  packaging carousel; interactive "Add more water" card.
- Final section: cows photo, "To lead, not follow", white + frosted pills.
- The build fails if: sections snap without wipes, the water video autoplays
  instead of scrubbing, the marquee stutters, the mask is a plain circle, any
  headline uses a serif or bold-heavy weight, or colors drift from the
  beige/olive/sage palette.
```
