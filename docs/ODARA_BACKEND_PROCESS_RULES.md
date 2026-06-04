# ODARA / VESPER — Backend Process Rules

## Git hygiene

Never commit:

- `supabase/.temp/cli-latest`

Do not use:

- `git add .`

Do not force push.

If repo is diverged, inspect before syncing.

## Health gates

Before live database work:

- run `select 1 as ok`
- if it fails, stop
- do not run proof loops while DB is flapping

## Queue refresh sequencing

Writes first.  
Source verification second.  
Queue refresh third.  
Snapshot verification fourth.

Do not:

- start queue refresh in parallel with a write
- start queue refresh before source statuses are visible
- run multiple refreshes “just in case”
- refresh blind
- refresh early

If a refresh runs too early:

1. report the race
2. verify source writes are complete
3. run at most one corrective refresh
4. verify final snapshot
5. mark task as successful with refresh-discipline violation, not clean one-pass

## Backend write lanes

Before any write task:

- dry-run if available
- use explicit IDs
- verify source rows
- write only scoped rows
- verify writes
- refresh queue only if task requires it
- run exactly one queue refresh after verification

## Before 6/11

Do not run:

- Direct Wild optimization
- cache/precompute work
- broad RLS/security sweeps
- taxonomy/enrichment/classifier work
- source backfills
- performance refreshes
- queue refreshes

unless it is a true blocker and explicitly approved.
