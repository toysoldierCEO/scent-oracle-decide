

## Plan: Add Orb Radius to Gap Buffer

### Problem
The current buffer (`LABEL_HALF + GAP_BUFFER = 15px`) positions the orb's **center** 15px from each label center. But the orb is 5px wide (2.5px radius), so its edge is only 12.5px from label center — which is 1.5px **inside** the 14px label half-width. The orb visually overlaps text.

### Fix (single file: `src/pages/OdaraScreen.tsx`)

**Lines ~1712-1718** — Account for orb radius in the offset calculation:

```
const LABEL_HALF = 14;       // half of 28px label
const ORB_RADIUS = 2.5;      // half of 5px orb dot  
const GAP_BUFFER = 1;        // 1px visual separation
const leftOffsetPx = LABEL_HALF + ORB_RADIUS + GAP_BUFFER;  // 17.5px
const rightOffsetPx = LABEL_HALF + ORB_RADIUS + GAP_BUFFER; // 17.5px
const totalOffsetPx = leftOffsetPx + rightOffsetPx;          // 35px
```

This ensures the orb's visible edge is exactly 1px away from every day label's text edge. No other changes needed — the `calc()` formula downstream already uses these values correctly.

