# ODARA / VESPER — 6/11 RC Smoke Checklist

This is a no-change verification checklist.

## Hard rules

- Do not modify files
- Do not apply migrations
- Do not alter SQL functions
- Do not create indexes
- Do not touch RLS/security policies
- Do not mutate data
- Do not run Direct Wild proof
- Do not tap Wild
- Do not run Apple Crumb proof loops
- Do not run queue refreshes
- Do not commit
- Do not push
- If `select 1` fails before testing, stop and report health only

## Preflight

- `git status` only expected drift: `M supabase/.temp/cli-latest`
- `select 1 as ok` passes

## Signed-in core

Verify:

- Today/Daily loads
- hero renders
- brand renders
- default layer renders
- alternates render
- no blank card
- no timeout
- no schema-cache error
- no `57014`

Record:

- date
- context
- hero
- brand
- default layer
- alternates

## Context / planner

Verify:

- daily -> work settles
- one future day loads
- no hang
- no timeout
- no schema-cache error
- no `57014`

## LayerCard

Verify:

- collapsed by default on first paint
- no mode row/details visible when collapsed
- tap expands
- expanded state shows mode row + details
- optional second tap collapses if supported

## Modes

Verify on editable current-day signed-in card:

- Balance works
- Bold works
- Smooth works
- selected chip matches active content
- layer/ratio/placement/why/spray guidance match active mode
- Wild visible and disabled with `Wild is being tuned.`
- no Wild backend call

## Layer copy audit

For each tested pairing, record:

- date/context
- hero
- selected mode
- layer
- ratio
- placement summary
- Why/reason text
- spray guidance if visible
- verdict: makes sense / generic acceptable / stale wrong

Blocked if:

- different modes/layers show exact same copy without reason
- copy mentions wrong behavior/mode/layer
- Wild copy leaks into non-Wild content
- selected chip does not match displayed content
- layer details missing after expand

## Read-only modes

Verify:

- past/history Balance/Bold/Smooth muted/disabled
- reason: `Past days are read-only`
- locked Balance/Bold/Smooth muted/disabled
- reason: `Unlock to adjust`
- blocked taps do not fire network requests

## Search preview

Verify:

- editable Today search add works
- first add previews hero/top
- second add previews layer if tested
- Back restores original hero/layer/alternates
- past-day search add disabled: `Past days are read-only`
- locked-card search add disabled: `Unlock to preview`
- guest search add: `SIGN IN TO ADD`

## Guest

Verify:

- guest loads
- guest stays guest
- guest home does not infinite load
- guest search does not mutate card
- guest modes are payload-backed
- no signed-in lazy mode RPCs

## Profile / Collection

Verify:

- Profile / Dossier loads
- tiles render: Saved, Liked, Favorites, Wishlist
- Collection loads
- wardrobe cards render
- no boxed-catalog regression

## Collection inline search

Verify:

- toolbar: Filter / Sort / + Add / Search icon
- Search icon to right of + Add
- search expands inline
- no modal/window/full-screen search
- query filters Collection cards in place
- no plus/add controls in filtered results
- clear X restores view
- Filter/Sort/+ Add still work

## Stability

Verify:

- `get_signed_in_card_contract_v7` under 15s
- no eager `get_signed_in_layer_mode_stacks_v2` first paint
- no `get_guest_oracle_home_v6` during signed-in mode
- no Wild `get_layer_for_card_mode_v1`
- no `57014`
- no schema-cache error
- no “Odara is taking longer than expected”
- no blank cards
- no new console errors
- post-check `select 1` passes
- no files changed
