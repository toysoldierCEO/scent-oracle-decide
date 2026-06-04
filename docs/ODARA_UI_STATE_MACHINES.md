# ODARA / VESPER — UI State Machines

## LayerCard

### Default/collapsed state

On first paint, LayerCard is collapsed.

Collapsed card may show:

- layer fragrance
- brand
- family/tags
- bottle/image
- Balance / Bold / Smooth / Wild mode row

Collapsed card must not show:

- placement
- Why it works

### Expanded state

User taps the layer card.

Expanded card shows:

- Balance / Bold / Smooth / Wild mode row
- placement
- Why it works

Ratio is folded into Placement.

Spray guidance is folded into Why it works.

If collapse behavior exists, tapping again collapses.

### Signed-in Wild

- visible
- disabled
- copy: `Wild is being tuned.`
- Wild copy is scoped to Wild only
- Wild must not leak into Balance/Bold/Smooth content
- Wild must not call `get_layer_for_card_mode_v1`

### Editable signed-in current/future cards

Balance/Bold/Smooth are enabled.

Tapping an enabled mode updates:

- selected chip
- layer fragrance
- placement
- Why/reason text
- practical guidance folded into the Why/Placement copy

### Past/history cards

Past/history cards are read-only.

Balance/Bold/Smooth:

- visually muted/disabled
- reason: `Past days are read-only`
- blocked taps do not fire mode fetches
- no fake clickable no-op

### Locked cards

Balance/Bold/Smooth:

- visually muted/disabled
- reason: `Unlock to adjust`
- blocked taps do not fire mode fetches

Wild remains separately disabled with `Wild is being tuned.`

### Guest cards

Guest mode chips are payload-backed.

Guest must not call signed-in lazy mode RPCs.

## Home / Today search

Home search is for previewing scents into Today’s card.

Rules:

- first add = hero/top preview
- second add = layer preview
- Back restores original pre-preview Today card
- preview is temporary unless explicitly saved/accepted
- guest add = `SIGN IN TO ADD`
- past-day add disabled = `Past days are read-only`
- locked-card add disabled = `Unlock to preview`

## Collection search

Collection search is only an inline filter for existing wardrobe cards.

Rules:

- toolbar: Filter / Sort / + Add / Search icon
- Search icon sits to the right of + Add
- search expands inline in toolbar
- no modal
- no new window
- no full-screen search
- no public catalog lookup
- no plus/add controls in filtered search results
- clear X restores Collection view
- active filters combine with search
- empty state: `No scents found in your collection`
