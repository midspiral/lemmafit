---
name: lemmafit-pre-react-audits
description: Audit workflow for lemmafit apps before React. Run before writing React code to catch proof gaps and unverified logic. Performs two audits — Proof Strength (are proofs complete and tight?) and Logic-in-JS (is any logic missing from Dafny?). Labels findings by severity and iterates until only minor findings remain.
---

# Lemmafit Audits

Run both audits below in order. Report findings in a structured table. Iterate with the lemmafit-proofs skill (Step 4) until only minor findings remain.

## Audit 1: Proof Strength Audit

Check the strength of every proof in the Dafny codebase against the corresponding SPEC.yaml entries.

### What to check

1. **Missing lemmas** — Every `verifiable: true` entry in SPEC.yaml with `type: postcondition` must have a corresponding lemma with a matching `ensures` clause. Invariant-only coverage is not sufficient for postcondition entries.
2. **Weak postconditions** — Are `ensures` clauses as strong as the property stated in SPEC.yaml? A proof that verifies but proves less than the spec claims is a gap. Look for postconditions that are trivially true or weaker than the stated property.
3. **Axiom debt** — Flag every `assume {:axiom}` statement. Each one is unverified trust. Check whether a real proof is feasible.
4. **Invariant tightness** — Every code guard or clamp (e.g., `if x > MAX then MAX else x`) must have a matching bound in `Inv` at full strength (e.g., `0 <= x <= MAX`). Loose invariants hide bugs.
5. **Missing biconditionals** — For every "if X then Y" lemma, check whether the converse "if not X then not Y" is also proven (or document why it's unnecessary).
6. **Composition gaps** — If two features interact, is there a lemma proving their combined properties? Implicit composition is a proof gap.
7. **Normalize reliance** — Check if `StepPreservesInv` only holds because of `Normalize`. If removing `Normalize` would break the proof, flag it — the `Apply` function should ideally preserve the invariant on its own for each action.
8. **Input validation** — Every trust-boundary datatype should have a `Valid_*` predicate, and `Step` should `requires Valid_*(input)` for external inputs. Missing validation predicates are gaps.

## Audit 2: Logic-in-JS

Check whether any effect-free logic required for the current build phase is expected to be implemented in JavaScript/TypeScript directly instead of Dafny.

### What to check

1. **State derivations in React** — Any computed value derived from state (filtering, sorting, calculations, conditional logic) that is not exposed through `Api.Present` or a Dafny function. These belong in Dafny.
2. **Validation in JS** — Input validation, constraint checks, or boundary enforcement done in React hooks or components instead of Dafny predicates.
3. **Business rules in event handlers** — Pure conditional guards on dispatching (e.g., "only allow X if Y" where Y is derivable from model state) that aren't enforced by Dafny preconditions or exposed as predicates. Exclude effect-gating logic (e.g., "only call Stripe API if active") — that belongs in JS.
4. **Formatting with logic** — Display formatting that encodes business rules (e.g., color based on threshold, status text based on state) rather than pure cosmetic formatting.
5. **Duplicated logic** — Logic that exists in Dafny but is re-implemented in JS (even partially), creating a consistency risk.
6. **Utils with hidden logic** — Utility functions that contain domain logic rather than pure display helpers.

## Severity Labels

Label each finding with one of:

| Severity | Meaning | Action |
|---|---|---|
| `critical` | Unverified logic that could produce wrong behavior, or a SPEC.yaml postcondition with no corresponding proof | Must fix before proceeding to React |
| `moderate` | Weak proof that verifies but doesn't fully cover the spec property, or JS logic that should move to Dafny | Should fix before proceeding |
| `minor` | Style issue, missing biconditional for an edge case, or axiom with clear justification | Can proceed, fix later |

## Output Format

Present findings as a numbered list grouped by audit, with severity tag:

```
## Proof Strength Audit

1. [critical] spec-003 "Total weight is sum of sets" — no lemma found, only covered by Inv
2. [moderate] StepPreservesInv — only holds due to Normalize for AddSet action
3. [minor] UndoRedoRoundTrip — missing biconditional (converse not meaningful here)

## Logic-in-JS Audit

1. [critical] src/hooks/useWorkout.ts:24 — filters completed sets using JS logic, should be a Dafny function
2. [minor] src/utils/format.ts:10 — date formatting, pure display (OK)
```

## Pass Criteria

The audit passes when there are **zero critical and zero moderate findings**. If any critical or moderate findings remain, return to Step 4 (proofs) to address them, then re-run audits.
