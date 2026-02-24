---
name: lemmafit-post-react-audit
description: Audit workflow for lemmafit apps after React. Runs after writing React code to catch logic that slipped through. Performs audit and labels findings by severity and iterates until only minor findings remain.
---

# Lemmafit Post React Audit


## Audit: Logic-in-JS-post

Check whether any effect-free logic required for the current build phase is found written directly in JavaScript or TypeScript instead of Dafny.

### What to check

1. **State derivations in React** — Any computed value derived from state (filtering, sorting, calculations, conditional logic) that is not exposed through `Api.Present` or a Dafny function. These belong in Dafny.
2. **Validation in JS** — Input validation, constraint checks, or boundary enforcement done in React hooks or components instead of Dafny predicates.
3. **Business rules in event handlers** — Pure conditional guards on dispatching (e.g., "only allow X if Y" where Y is derivable from model state) that aren't enforced by Dafny preconditions or exposed as predicates. Exclude effect-gating logic (e.g., "only call Stripe API if active") — that belongs in JS.
4. **Formatting with logic** — Display formatting that encodes business rules (e.g., color based on threshold, status text based on state) rather than pure cosmetic formatting.
5. **Duplicated logic** — Logic that exists in Dafny and is available via API but is re-implemented in JS (even partially), creating a consistency risk.
6. **Utils with hidden logic** — Utility functions in `src/utils` that contain domain logic rather than pure display helpers.

## Severity Labels

Label each finding with one of:

| Severity | Meaning | Action |
|---|---|---|
| `critical` | Effect-free logic in JS that could produce wrong behavior if it diverges from Dafny, or logic duplicated between JS and Dafny | Must move to Dafny before shipping |
| `moderate` | Effect-free logic in JS that should be a Dafny function or predicate but isn't yet causing a correctness risk | Should move to Dafny |
| `minor` | Borderline case where JS logic is arguably pure formatting, or a trivial derivation not worth a Dafny round-trip | Can keep in JS, document why |

## Output Format

Present findings as a numbered list with severity tag and file location:

```
## Logic-in-JS Post-React Audit

1. [critical] src/hooks/useSubscription.ts:42 — computes prorated refund in JS, duplicates Dafny proration logic
2. [moderate] src/components/PlanCard.tsx:18 — derives "canUpgrade" from state fields, should be a Dafny predicate
3. [minor] src/utils/format.ts:10 — date formatting, pure display (OK)
```

## Pass Criteria

The audit passes when there are **zero critical and zero moderate findings**. If any remain, move the logic to Dafny (back to Step 2), re-verify, then re-run this audit.
