# ODARA / VESPER — Data Trust Lanes

## Core rule

Source evidence is not the same as final taxonomy truth.

## Trust ladders

### Official brand source lane

official brand source
→ audited official-source backfill
→ targeted performance refresh
→ queue recognition
→ controlled classifier proposal
→ proposal acceptance
→ queue refresh
→ already_complete

Official notes/source may update approved source fields through explicit helpers, but final taxonomy still requires proposal and acceptance.

### Provider / Fragrella lane

Provider evidence is useful but not official source truth.

Fragrella is the first enrichment lane for missing-scent intake, before official-source verification and before retailer/professional/community fallback lanes. The legacy `Fragella` spelling may still appear in API hostnames or secret names for compatibility, but user-facing product language should use `Fragrella`.

Provider lanes may stage evidence and promote notes through scoped helpers, but must preserve provenance and limitations.

Provider evidence must not silently overwrite official source truth.

### Provenance lane

manual_review / insufficient_evidence
→ provenance review
→ provenance decision
→ controlled classifier proposal
→ proposal acceptance
→ queue refresh
→ already_complete

### Classifier proposal lane

Proposal-only until explicitly accepted.

Proposal lane must not directly write:

- `public.fragrance_facets_v1`
- `public.fragrance_wardrobe_roles_v1`
- `public.fragrance_taxonomy_review_v1`
- `public.fragrances`
- frontend surfaces
- recommendation logic
- layer logic
- performance refresh

## Family classification rule

Family classification is review-assisted, confidence-aware, and non-destructive.

Do not:

- bulk auto-apply family suggestions
- silently rewrite `public.fragrances.family_key`
- replace production family routing from accord overlap
- treat ambiguous accords as certainty

## Before 6/11

No taxonomy/enrichment/classifier/data trust work unless it is a true blocker.
