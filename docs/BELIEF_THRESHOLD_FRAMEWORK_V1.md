# Belief Threshold Framework v1

## Doctrine

Vesper remembers everything but assumes nothing.

Memory stores facts. Beliefs are earned only through repeated, consistent evidence. This release defines how Vesper can evaluate evidence later, but it does not change Today, Layered, Solo, scoring, UI, or recommendation output.

## Architecture

Belief Threshold Framework v1 is a read-only analysis layer.

Current factual sources:

- `daily_layer_wear_memory_v1`: positive evidence that the user actually wore a layered recommendation.
- `layer_recommendation_feedback_v1`: negative correction evidence for a specific displayed layered recommendation.
- Existing `wear_events`: future supporting context, not consumed by production recommendations in this release.

Implementation surface:

- `src/lib/beliefThresholdFramework.ts` contains pure helper functions and internal types.
- It performs no Supabase calls.
- It has no UI imports.
- It is not imported by `OdaraScreen`, `LayerCard`, Today scoring, layer scoring, or memory write paths.
- No database migration is required for this release.

The framework evaluates evidence into an internal `BeliefState` shape:

- `belief_key`
- `evidence_count`
- `supporting_events`
- `contradicting_events`
- `confidence`
- `first_seen`
- `last_confirmed`
- `current_status`

These values are not user-facing and do not influence recommendations yet.

## Belief State Machine

Stage 0: Observation only

- Facts exist.
- No belief exists.
- One or two events are not enough.

Stage 1: Hypothesis

- There may be a pattern.
- Low confidence.
- Requires repeated support.

Stage 2: Emerging Pattern

- Evidence has repeated across time.
- Contradictions remain possible.
- Still not user-facing.

Stage 3: Established Pattern

- Repeated, consistent evidence.
- Eligible for future recommendation influence after a separate release.
- Still no production behavior changes in v1.

Stage 4: Trusted Preference

- Stable over time.
- Could eventually influence recommendations in a future release.
- No recommendation influence is implemented here.

## Evidence Model

Positive evidence:

- A row in `daily_layer_wear_memory_v1`.
- Represents "I wore this."
- Supports specific observations such as:
  - repeated mode success
  - repeated ratio success
  - repeated pair success
  - repeated context success
  - repeated role assignment success

Negative evidence:

- A row in `layer_recommendation_feedback_v1`.
- Represents "this displayed recommendation needed correction."
- It does not dislike either fragrance.
- It contradicts the specific presentation or pattern that was corrected.

Feedback interpretation:

- `too_strong`: the combination, ratio, roles, or resulting intensity was too strong in that context.
- `too_weak`: the combination lacked enough presence or impact in that context.
- `doesnt_work`: the specific pairing/presentation was rejected and should be the strongest contradiction.

Positive and negative evidence coexist. A contradiction weakens a belief candidate, but it does not erase earlier positive evidence. Likewise, one successful experiment cannot create a strong belief.

## Contradiction Model

Contradictions are weighted rather than binary.

The v1 helper applies a contradiction penalty to negative events. This means:

- Ten successful events followed by one correction should weaken confidence, not delete the pattern.
- One successful bold layer after many smooth layers should be treated as an observation, not a sudden identity shift.
- Repeated contradictions can demote or prevent a belief from advancing.

`doesnt_work` is modeled as a stronger contradiction than `too_strong` or `too_weak` because it rejects the displayed pairing more directly.

## Recency Model

Older evidence should eventually matter less.

The v1 helper includes a configurable recency half-life. Suggested internal default:

- 90 day half-life for evidence weight.

This is not a production tuning commitment. It simply defines where time enters the model:

- Newer supporting evidence raises confidence more.
- Newer contradictions weaken confidence more.
- Older facts remain part of history but carry less active weight.

## Context Model

Beliefs must be context-isolated.

Examples:

- `daily`
- `office`
- `date`
- `hangout`

The framework builds context-aware belief keys such as:

- `layer_mode:daily:smooth`
- `layer_mode:office:smooth`

Those are separate candidates. Vesper should not merge incompatible contexts automatically.

## Suggested Conservative Thresholds

These are internal starting recommendations, not production adaptation rules.

Stage 1: Hypothesis

- At least 3 supporting events.
- Moderate consistency.
- No required time span.

Stage 2: Emerging Pattern

- At least 5 supporting events.
- Evidence spread across at least 7 days.
- Higher consistency.

Stage 3: Established Pattern

- At least 8 supporting events.
- Evidence spread across at least 21 days.
- Strong consistency.

Stage 4: Trusted Preference

- At least 14 supporting events.
- Evidence spread across at least 60 days.
- Very strong consistency.

The defaults intentionally prefer false negatives over false positives.

## Future Integration Points

Future releases may add:

- A read-only database view that aggregates user evidence into internal belief candidates.
- A service-role-only analysis job that writes non-user-facing belief snapshots.
- Recommendation experiments that read Stage 3 or Stage 4 candidates only after a separate product approval.
- Separate thresholds per observation kind, such as ratio success versus pair success.

Any future recommendation influence must remain behind a separate release gate and must prove no isolated event creates durable belief.

## Risks

False positives:

- Overreacting to a small sample.
- Treating one worn layer as a broad preference.
- Merging contexts that should remain separate.

False negatives:

- Moving too slowly even when the user has a real pattern.
- Ignoring useful recent changes.

The v1 framework intentionally accepts more false negatives. Trust is earned slowly.

## Migration Strategy

Observation to production inference should happen in phases:

1. Keep collecting factual memory.
2. Run this read-only framework in tests and internal analysis.
3. Add an internal view or job only after thresholds are validated.
4. Store belief snapshots separately from raw memory.
5. Expose recommendation influence only in a later release.
6. Keep all user-facing labels out unless explicitly approved.

## Non-Goals

This release does not:

- alter Today’s Pick
- alter Layer recommendations
- alter Solo or Layered mode rules
- change scoring
- personalize recommendation weights
- modify UI
- expose confidence
- expose Smooth, Balanced, or Bold labels
- infer identity
- write database rows
