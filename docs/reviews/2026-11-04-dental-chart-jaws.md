# The dental chart as two jaws (2026-11-04)

The user, with a screenshot of «خريطة الأسنان» (a grid of numbered boxes): "ايه رايك لو نعملها شكل الاسنان زى الويب سايت
الى هو شكل فكين و لما ي هوفر عليه يحدد السنه او الضرس": draw it as teeth like the website (the landing page's arch of
teeth), as two jaws, and identify the tooth or molar under the pointer.

## What it is now

- **Two jaws**: the upper jaw a horseshoe with the front teeth at the top, the lower jaw its mirror image under it, a gap
  between them at the sides, each on a soft gum band in the clinic's pastel, as on the landing page. Still drawn as the
  dentist faces the patient (the patient's right on the viewer's left) with the FDI numbers beside the teeth.
- **Each tooth its own outline**: a flat-edged incisor, a pointed canine, a two-cusped premolar, the website's molar
  (`@dental/ui/arch`: INCISOR_PATH, CANINE_PATH, PREMOLAR_PATH next to TOOTH_PATH). A tooth's share of its arch follows
  its real width (molars broad, lower incisors slim); the crowns face out of the mouth, as on the website.
- **Pointing or focusing** lifts the tooth, outlines it in the clinic's colour, and names it in the middle of the mouth:
  number, Arabic name («الضرس الأول العلوي الأيسر») and current condition with its surfaces. A chosen tooth keeps a
  ring and its number in a pill; the tooth panel below is unchanged.
- **Conditions** keep the legend's colours: to treat (red), treated (the clinic's tint), healthy (green), other
  (amber), missing (a dashed ghost). Surfaces are written past the number.
- **Primary teeth** (the existing switch): a smaller arch inside each jaw, numbers inside it; the middle is then taken,
  so the tooth is named under the drawing.
- **Keyboard**: one tooth takes Tab; arrows walk along a jaw and up or down to the same place on the other jaw (16 ↓ 46;
  16 ↓ 55 with primary teeth); Home/End; Enter or Space chooses. Each tooth is announced with its number, name and
  condition.
- **Phones**: the drawing scales to the card; a container query writes the numbers larger when the chart is narrow and
  leaves the surfaces to the middle label.

Code: `jaw-model.ts` (pure geometry, names, key moves; 11 tests in `__tests__/jaw-model.test.ts`), the tooth names in
`labels.ts`, the chart in `screens/clinical/chart.tsx` (the grid's markup and styles are gone), styles in `styles.css`
(`.jaw-*`).

## Checks

Typecheck (dashboard and website: the shared arch file changed), lint, 198 tests, production build. In the browser: a
real patient's chart (27 caries with F), a sample chart rendered over the page with every condition, a chosen tooth, a
focused one and the primary arches (nothing saved), at 1536, 1440 and 390px; clicking a tooth opens its panel, arrows
move 27 → 28 → 38. `api-error-codes.test.ts` timed out again while the machine was busy and passed with a longer limit
(it reads the whole API source synchronously; a longer timeout for that one test would steady it).
