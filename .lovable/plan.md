
### Goal
Fix the forecast orb so it **never overlaps Monday (or any weekday text)** while still moving by local time and keeping the midnight fade/emerge behavior.

### Root Cause
Current orb math assumes weekday centers are at exact `%` points (`0%, 16.667%, ...`) plus fixed px offsets.  
But the labels are laid out by `flex justify-between` with fixed label widths, so their real positions are not those exact centers. This mismatch puts the orb too far left and lets it overlap “Mon”.

### Implementation Plan (single file: `src/pages/OdaraScreen.tsx`)

1. **Measure real label geometry**
   - Add refs for:
     - the weekday row container
     - each weekday label element (`Mon`, `Tue`, etc.).
   - In `useLayoutEffect` (and on resize), measure:
     - `monRight` = right edge of label 0
     - `tueLeft` = left edge of label 1
     - all relative to the row container.

2. **Build a safe “no-overlap corridor”**
   - Define:
     - `ORB_RADIUS = 2.5` (for 5px orb)
     - `TEXT_BUFFER = 1`
   - Compute:
     - `trackStart = monRight + TEXT_BUFFER + ORB_RADIUS`
     - `trackEnd = tueLeft - TEXT_BUFFER - ORB_RADIUS`
   - Clamp if needed to avoid invalid ranges on tiny widths.

3. **Position from time only (not day centers)**
   - Keep `orbPosition` as daily progress (`0..1` from midnight to next midnight).
   - Compute orb center X in pixels:
     - `orbX = trackStart + orbPosition * (trackEnd - trackStart)`
   - Set orb style:
     - `left: ${orbX}px`
     - `top: 50%`
     - `transform: translate(-50%, -50%)`
   - This guarantees the orb stays between labels and never crosses text.

4. **Preserve sunrise-style midnight transition**
   - Keep existing fade-out near day end and fade-in near day start.
   - Apply opacity only (no position jump), so it appears to fade toward next day at midnight and re-emerge just after midnight while still respecting the 1px readability buffer.

5. **Keep weekday/date separation intact**
   - Orb remains in weekday row container (`position: relative` parent).
   - Date numbers stay in their separate row below (unchanged).

### Expected Result
- Orb no longer overlaps “Mon”.
- Orb remains on the weekday text line, in the gap between days.
- Noon lands at the midpoint of the usable Mon–Tue gap.
- Movement stays smooth and strictly local-time driven.
