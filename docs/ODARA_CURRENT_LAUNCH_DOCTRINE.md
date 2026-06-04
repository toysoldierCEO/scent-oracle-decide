# ODARA / VESPER — Current Launch Doctrine

Target launch: **6/11 tiny trusted beta**

## Product posture

Odara/Vesper is not a fragrance catalog.

It is:

- a daily scent decision engine
- a layering intelligence system
- a one-card ritual experience

Primary question:

> What should I wear today?

Secondary question:

> How should I layer it?

## Design doctrine

- opulescent minimalism
- dark glassmorphism
- strong hierarchy
- no over-explaining
- fast decision first
- detail on demand
- main surface stays clean
- no fake-interactive controls
- no silent no-ops

## Current beta scope

Ship:

- Today’s Pick
- default layer
- Balance
- Bold
- Smooth
- signed-in Wild disabled
- guest mode
- Profile / Dossier
- Collection
- Collection inline search
- home search preview
- search preview Back restore
- past-day read-only protections
- locked-card protections
- compact LayerCard with visible mode chips and tap-to-expand Placement/Why details

## Known beta limitations

- signed-in Wild is intentionally disabled with `Wild is being tuned.`
- Direct Wild backend optimization is post-launch
- adaptive anti-repetition engine is post-launch
- cache/precompute performance architecture is post-launch
- deeper source/enrichment/classifier work is post-launch
- broad RLS/security sweeps are post-launch unless a true blocker appears

## Do not touch before 6/11 unless it is a true blocker

- Direct Wild backend
- cache/precompute architecture
- anti-repetition engine
- broad RLS/security cleanup
- taxonomy/enrichment/classifier data
- family_key rewrite logic
- broad UI redesign
- new onboarding
- new mode doctrine
- new engine scoring

## True launch blockers

Only stop launch for:

- app does not load
- blank card
- timeout
- Postgres `57014`
- schema-cache error
- Balance/Bold/Smooth wrong on editable current card
- signed-in Wild callable
- layer details wrong/missing after expand
- search Back restore broken
- past/locked states editable
- guest/sign-in broken
- Collection/Profile broken
- privacy or cross-user data issue
