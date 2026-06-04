# ODARA / VESPER — Recent Launch-Hardening Changelog

## Current launch hardening status

Only expected local drift:

- `M supabase/.temp/cli-latest`

Do not commit that file.

## Recent accepted fixes

### Signed-in home timeout containment

`get_signed_in_card_contract_v7` was made fast by deferring full layer mode stacks on first paint.

Home now returns default layer and deferred mode metadata.

### Direct Wild failed optimization recovery

Failed direct Wild optimization was restored to known-good baseline.

Direct Wild remains post-launch work.

### Wild signed-in guard

Signed-in Wild is visible but disabled with:

> Wild is being tuned.

### Diagnostics cleanup

Temporary Oracle diagnostics removed/dev-gated.

### Auth/search state stability

Sticky guest override and request hygiene preserved.

### Search add read-only parity

Past-day search add disabled with:

> Past days are read-only

Locked-card search add disabled with:

> Unlock to preview

### Search preview Back restore

Search preview now captures a durable pre-preview snapshot and restores original Today card on Back.

### Read-only layer mode chips

Past/history Balance/Bold/Smooth disabled with:

> Past days are read-only

Locked Balance/Bold/Smooth disabled with:

> Unlock to adjust

### Wild copy leak fix

Wild disabled copy no longer leaks into Balance/Bold/Smooth content.

### LayerCard collapsed default

LayerCard restored to compact-by-default behavior. Details appear on tap.

### Collection inline search

Collection toolbar now includes Search icon to the right of + Add.

Collection search filters existing wardrobe cards in place and does not show plus/add controls.
