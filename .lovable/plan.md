

## Plan: Hard Set Forecast Bar Lane Gap to 5px

### Change
In `src/pages/OdaraScreen.tsx`, replace every `gap: "3px"` in the forecast bar lane containers with `gap: "5px"`. This affects ~2-3 locations where the forecast column flex containers define their vertical spacing.

Bar height, width, lane order, and all other styling remain untouched.

