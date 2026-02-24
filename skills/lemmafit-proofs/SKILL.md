---
name: lemmafit-proofs
description: Proof-maximizing workflow for writing Dafny lemmas, postconditions, and invariants. Load this skill before writing any lemmas, ensures clauses, or when deciding between axioms and lemmas. Covers postcondition-first development, scaffolding, biconditional completeness, and input validation patterns.
---

# Lemmafit Proofs

## Proof-Maximizing Workflow

1. **Postconditions first** — Write `ensures` clauses before function bodies. The postcondition is the contract; the body is the implementation. This forces you to think about what a function guarantees before how it works.

2. **Scaffold before proving** — Create lemma signatures with empty bodies (`lemma Foo() ensures P() {}`) so the Claims panel tracks them as "scaffolded". Fill in proofs afterward. This ensures no claim is forgotten.

3. **Biconditional completeness** — For every "if X then Y" claim, also prove "if not X then not Y" (or document why the converse is unnecessary). One-directional implications leave blind spots.

4. **Input validation predicates** — Every trust-boundary datatype gets a `Valid_*` predicate (e.g., `predicate Valid_SetWeight(w: int) { w > 0 && w <= 1000 }`). The `Step` function should `requires Valid_*(input)` for external inputs.

5. **Invariant tightness** — Every code guard or clamp (e.g., `if x > MAX then MAX else x`) should have a matching bound in `Inv` at full strength (e.g., `0 <= x <= MAX`). Loose invariants hide bugs.

6. **Standalone lemmas for compositions** — Don't rely on implicit composition. If feature A and feature B interact, write a lemma proving their combined properties explicitly (e.g., `lemma UndoRedoRoundTrip`).

7. **Prefer lemmas over axioms** — `[verified]` = lemma with proof body, `[assumed]` = axiom with justification comment. Every axiom is technical debt. When you add an axiom, add a comment explaining why a proof is infeasible and what would need to change to prove it.

8. **Prove application-specific lemmas beyond the general requirements** — For the step `Apply` function, you should prove something specific for each action. Prove strong properties about your program, both generic and domain-specific. *Example*: proving the Replay kernel `StepPreservesInv` (after Normalization) is a weak property. Try to prove that applying more specific actions results in desired properties (e.g. Inv even without Normalization)
