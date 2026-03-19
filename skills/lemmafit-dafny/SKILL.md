---
name: lemmafit-dafny
description: Dafny code patterns and reference for lemmafit apps. Use when writing or editing .dfy files, defining state machines (Model, Action, Inv, Init, Step), or when Dafny verification fails and you need to fix errors. Covers the AppCore module pattern and common mistakes.
---

# Lemmafit Dafny

## When to Write Code in Dafny
- ALL `verifiable:true` entries in the spec MUST be written in Dafny (do not write verifiable code directly in JavaScript or TypeScript)

## Dafny Pattern Example

Given the `Replay` kernel, a simple counter app with inherited undo/redo could be written like this

```dafny
include "Replay.dfy"

module CounterDomain refines Domain {
  // The model is the state of your application
  type Model = int

  // Actions are the ways the state can change
  datatype Action = Inc | Dec

  // Invariant: what must always be true about the state
  predicate Inv(m: Model) {
    m >= 0
  }

  // Initial state
  function Init(): Model {
    0
  }

  // How actions transform the state
  function Apply(m: Model, a: Action): Model {
    match a
    case Inc => m + 1
    case Dec => m - 1
  }

  // Normalization: fix invalid states (called after Apply)
  function Normalize(m: Model): Model {
    if m < 0 then 0 else m
  }

  // Proof that Init satisfies the invariant
  lemma InitSatisfiesInv()
    ensures Inv(Init())
  {
  }

  // Proof that every step preserves the invariant
  lemma StepPreservesInv(m: Model, a: Action)
    // requires Inv(m) is inherited and should not be repeated
    ensures Inv(Normalize(Apply(m, a)))
  {
  }
}

module CounterKernel refines Kernel {
  import D = CounterDomain
}

module AppCore {
  import K = CounterKernel
  import D = CounterDomain

  function Init(): K.History { K.InitHistory() }

  function Inc(): D.Action { D.Inc }
  function Dec(): D.Action { D.Dec }

  function Dispatch(h: K.History, a: D.Action): K.History requires K.HistInv(h) { K.Do(h, a) }
  function Undo(h: K.History): K.History { K.Undo(h) }
  function Redo(h: K.History): K.History { K.Redo(h) }

  function Present(h: K.History): D.Model { h.present }
  function CanUndo(h: K.History): bool { |h.past| > 0 }
  function CanRedo(h: K.History): bool { |h.future| > 0 }
}
```


## Common Mistakes to Avoid

- It is an error to repeat inherited `requires` clauses.
- It is OK to have `assume {:axiom} false` in _proofs_, temporarily, as the pieces are put together. Strive for zero such axioms eventually.
- Nested pattern matching _is_ allowed, but needs to be properly parenthesized. Example (out of context):
```
function optimize(e: exp): exp
{
    match e
    case EInt(v) => e
    case EVar(x) => e
    case EAdd(e1, e2) => (match (optimize(e1), optimize(e2))
        case (EInt(0), e2) => e2
        case (e1, EInt(0)) => e1
        case (e1, e2) => EAdd(e1, e2))
}
```
