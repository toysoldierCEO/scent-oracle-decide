# ODARA / VESPER — Backend Contracts

## Frontend-facing contract rules

The frontend should rely on stable RPC contracts and should not infer backend state by guessing.

## Key RPCs

### `public.get_signed_in_card_contract_v7`

Signed-in home contract.

Current launch behavior:

- must return quickly
- must not eagerly build full layer mode stacks on first paint
- returns enough payload for Today card, default layer, queue/alternates
- returns deferred layer mode metadata

Expected containment fields:

- `layer_modes_deferred = true`
- `provider_meta.preview_depth = 0`
- `provider_meta.overlap_policy = deferred_signed_in_home_initial_load`

Must not call on first paint:

- `public.get_signed_in_layer_mode_stacks_v2(..., 3)`

### `public.get_guest_oracle_home_v6`

Guest home contract.

Guest mode must stay guest and must not call signed-in lazy mode RPCs.

### `public.get_layer_for_card_mode_v1`

Direct mode endpoint for enabled modes.

Signed-in Wild is disabled before launch, so this endpoint should not be called with `p_mode = 'wild'` from the signed-in UI.

Balance/Bold/Smooth may call this when needed.

### `public.get_fragrance_profile_v1`

Fragrance profile/detail hydration.

## Layer payload fields

Layer card detail fields may include:

- `ratio_hint`
- `placement_hint`
- `why_it_works`
- `reason`
- `spray_guidance`
- `spray_pattern_name`

Frontend should normalize these fields before rendering.

## Performance rules

- signed-in home must remain under 15 seconds
- target signed-in card contract should remain comfortably below 1–2 seconds where possible
- full mode stacks remain deferred
- Direct Wild backend optimization is post-launch
- no cache/precompute architecture before 6/11
