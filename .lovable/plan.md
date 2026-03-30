

## Plan: Fix Orb Position to Divide Day Gap by 24 Hours

### Problem
The orb currently uses `todayCenter = 0%` and `tomorrowCenter = 16.67%` with a `+20px` offset, making it sit too far from today's label. The user wants the orb to be near Monday at midnight and only reach the midpoint at noon — with the gap between days divided into 24 equal hourly notches.

### Changes (single file: `src/pages/OdaraScreen.tsx`)

**Lines ~1709-1731** — Replace orb position calculation:

1. **Remove the `+20px` offset** — the orb should move naturally within the gap between day labels, not be artificially pushed right.

2. **Keep the interpolation but use label positions correctly:**
   - `todayCenter = (0 / 6) * 100` → position of today's label (0%)
   - `tomorrowCenter = (1 / 6) * 100` → position of tomorrow's label (~16.67%)
   - The gap between them represents 24 hours
   - `orbPct = todayCenter + orbPosition * (tomorrowCenter - todayCenter)`
   - At `orbPosition = 0` (midnight) → orb is at today's label position
   - At `orbPosition = 0.5` (noon) → orb is exactly halfway between today and tomorrow
   - Each hour = 1/24th of the gap

3. **Position with `transform: translate(-50%, -50%)`** so the orb is centered on its calculated point rather than offset to the right.

This means at midnight the orb sits right on top of Monday, at 6 AM it's 25% of the way to Tuesday, at noon it's exactly centered between the two days, and at 6 PM it's 75% toward Tuesday.

### Technical Detail
- Remove `+ 20px` from `left` calc
- Change transform back to `translate(-50%, -50%)` 
- The math `orbPosition * (1/6 * 100)` already divides the gap into continuous progress — each hour naturally corresponds to `1/24` of the gap width

