# ODARA / VESPER — Tiny Beta Launch Pack

Launch date: **June 11, 2026**

## Tester instructions

### Purpose

This beta is a small trust test for Odara’s daily fragrance experience.

We are testing whether you can open the app, understand Today’s Pick, inspect the layer suggestion, use Collection, search your wardrobe, and report anything confusing without needing guidance.

### What to do for 3 days

Each day:

1. Open Odara.
2. Check Today’s Pick.
3. Tap the layer card to expand it.
4. Try Balance, Bold, and Smooth.
5. Open Profile / Dossier.
6. Open Collection.
7. Use Collection search to find one fragrance.
8. Try the search feature on Today’s Pick.
9. Tell me what felt useful, confusing, slow, broken, or visually off.

### Known limitation

Wild is intentionally disabled right now and will say:

> Wild is being tuned.

Do not judge Wild yet.

### Feedback questions

1. Did Today’s Pick make sense?
2. Did the layer suggestion make sense?
3. Did Balance, Bold, and Smooth feel different?
4. Was Collection easy to understand?
5. Was search easy to find and use?
6. Did Profile / Dossier feel useful?
7. Did anything feel broken, frozen, or unclear?
8. Did any screen feel too crowded or too empty?
9. What was the single most confusing moment?
10. Would you open this again tomorrow?

### Bug report format

- Device:
- Browser:
- Signed in or guest:
- Screen:
- What you tapped:
- What happened:
- What you expected:
- Screenshot or screen recording:
- Can you repeat it:

## Internal launch checklist

Before launch:

- Confirm latest build deployed.
- Confirm signed-in Today’s Pick loads.
- Confirm guest mode loads.
- Confirm Wild is disabled for signed-in users.
- Confirm layer card starts collapsed and expands on tap.
- Confirm Balance / Bold / Smooth work.
- Confirm past/history cards are read-only.
- Confirm locked cards block layer adjustment and search preview.
- Confirm Collection loads.
- Confirm Collection inline search works.
- Confirm Today’s Pick search preview add/remove works.
- Confirm Profile / Dossier loads.
- Confirm no `57014`.
- Confirm no schema-cache error.
- Confirm no “Odara is taking longer than expected.”

## Emergency stop criteria

Pause beta if:

- signed-in users cannot enter Odara
- Today’s Pick crashes
- guest mode crashes
- Collection corrupts ownership or preference state
- past/history cards become editable
- locked cards become editable
- users hit the same blocking issue twice
- any privacy or cross-user data issue appears

## Rollback action

- Stop inviting testers.
- Preserve screenshots and logs.
- Revert only the last risky release if the issue is launch-blocking.
- Do not expand scope while debugging.

## 6/11 launch day

- Invite 1–3 trusted testers.
- Ask each tester to complete Day 1.
- Monitor auth, Today’s Pick, Collection, and search.
- Log issues in one place.
- Do not add new scope.

## 6/12

- Ask testers to open Odara again.
- Collect feedback answers.
- Check if any issue meets stop criteria.

## 6/13

- Ask testers to complete final daily use.
- Collect screenshots/recordings for any issue.
- Ask: “Would you open this again tomorrow?”

## 6/14

Sort feedback into:

- blockers
- polish
- post-launch ideas

Fix blockers first. Keep Wild, anti-repetition, and cache/precompute work post-launch unless they become true blockers.
