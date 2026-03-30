

## Plan: Orb Lives Between Days, Never Crosses Labels

### Problem
The orb currently moves from one day's center to the next, crossing over/under the day text. The user wants the orb to live strictly **between** day labels — never overlapping text — and fade into the next day label at midnight, then partially emerge from the other side at 12:01 like a horizontal sunrise.

### Mental Model
```text
  Mon  ·  Tue  ·  Wed  ·  Thu  ·  Fri  ·  Sat  ·  Sun
      ↑        ↑
      |  orb   |
      |  lives |
      |  here  |
```
The orb occupies the **gap** between two day labels. At midnight it fades into the right edge of the next day's text, then at 12:01 it emerges 1px to the right of that label, moving rightward toward the next gap.

### Position Logic

The 7 day labels are evenly spaced via `flex justify-between`. Each label is 28px wide. The orb range for a given day is:
- **Left bound**: right edge of today's label + 1px
- **Right bound**: left edge of tomorrow's label - 1px

At `orbPosition = 0` (midnight): orb is at the **left bound** (just emerged from today's label).  
At `orbPosition = 0.5` (noon): orb is at the **center** of the gap.  
At `orbPosition = 1` (next midnight): orb fades into tomorrow's label (right bound).

### Calculating Bounds

Labels are centered at `(i / 6) * 100%` of the container. Each label is 28px wide, so:
- Today's label right edge = `(i / 6) * 100% + 14px`
- Tomorrow's label left edge = `((i+1) / 6) * 100% - 14px`

The orb interpolates between these two edges + 1px gap on each side:
- `leftEdge = calc((0/6) * 100% + 14px + 1px)` → `calc(0% + 15px)`
- `rightEdge = calc((1/6) * 100% - 14px - 1px)` → `calc(16.667% - 15px)`
- `orbLeft = calc(leftEdge + orbPosition * (rightEdge - leftEdge))`

Using CSS calc: `left: calc(15px + ${orbPosition} * (16.667% - 30px))`

### Midnight Fade / Sunrise Emerge

- **Approaching midnight** (`orbPosition > 0.98`): orb opacity fades to 0 as it reaches the right edge (tomorrow's label).
- **After midnight** (`orbPosition < 0.02`): orb emerges from 1px right of today's label with opacity ramping up — like a sun rising horizontally.
- The label briefly glows during crossover (existing behavior, kept).

### Changes (single file: `src/pages/OdaraScreen.tsx`)

**Lines ~1702-1751** — Replace orb positioning:

1. Calculate `leftEdge` and `rightEdge` using label positions + 14px half-width + 1px gap
2. Interpolate orb `left` between these edges using `orbPosition`
3. Use CSS `calc()` for mixed %-and-px math
4. Keep fade/emerge opacity logic (adjust thresholds slightly for the new range)
5. Keep `transform: translate(-50%, -50%)` for centering the orb dot on its coordinate

### Result
- Orb never overlaps any day text
- Always 1px minimum separation from labels
- Noon = center of the gap between today and tomorrow
- Midnight = fade into label edge, then sunrise-emerge on the other side

