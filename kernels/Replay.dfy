abstract module {:compile false} Domain {
  type Model
  type Action

  ghost predicate Inv(m: Model)

  function Init(): Model
  function Apply(m: Model, a: Action): Model
    requires Inv(m)
  function Normalize(m: Model): Model

  lemma InitSatisfiesInv()
    ensures Inv(Init())

  lemma StepPreservesInv(m: Model, a: Action)
    requires Inv(m)
    ensures Inv(Normalize(Apply(m,a)))
}

abstract module {:compile false} Kernel {
  import D : Domain

  function Step(m: D.Model, a: D.Action): D.Model
  requires D.Inv(m)
  {
    D.Normalize(D.Apply(m, a))
  }

  function InitHistory(): History {
    History([], D.Init(), [])
  }

  datatype History =
    History(past: seq<D.Model>, present: D.Model, future: seq<D.Model>)

  function Do(h: History, a: D.Action): History
  requires D.Inv(h.present)
  {
    History(h.past + [h.present], Step(h.present, a), [])
  }

  // Apply action without recording to history (for live preview during drag)
  function Preview(h: History, a: D.Action): History
  requires D.Inv(h.present)
  {
    History(h.past, Step(h.present, a), h.future)
  }

  // Commit current state, recording baseline to history (for end of drag)
  function CommitFrom(h: History, baseline: D.Model): History {
    History(h.past + [baseline], h.present, [])
  }

  function Undo(h: History): History {
    if |h.past| == 0 then h
    else
      var i := |h.past| - 1;
      History(h.past[..i], h.past[i], [h.present] + h.future)
  }

  function Redo(h: History): History {
    if |h.future| == 0 then h
    else
      History(h.past + [h.present], h.future[0], h.future[1..])
  }

  lemma DoPreservesInv(h: History, a: D.Action)
    requires D.Inv(h.present)
    ensures  D.Inv(Do(h, a).present)
  {
    D.StepPreservesInv(h.present, a);
  }

  ghost predicate HistInv(h: History) {
    (forall i | 0 <= i < |h.past| :: D.Inv(h.past[i])) &&
    D.Inv(h.present) &&
    (forall j | 0 <= j < |h.future| :: D.Inv(h.future[j]))
  }

  lemma InitHistorySatisfiesInv()
    ensures HistInv(InitHistory())
  {
    D.InitSatisfiesInv();
  }

  lemma UndoPreservesHistInv(h: History)
    requires HistInv(h)
    ensures  HistInv(Undo(h))
  {
  }

  lemma RedoPreservesHistInv(h: History)
    requires HistInv(h)
    ensures  HistInv(Redo(h))
  {
  }

  lemma DoPreservesHistInv(h: History, a: D.Action)
    requires HistInv(h)
    ensures  HistInv(Do(h, a))
  {
    D.StepPreservesInv(h.present, a);
  }

  lemma PreviewPreservesHistInv(h: History, a: D.Action)
    requires HistInv(h)
    ensures  HistInv(Preview(h, a))
  {
    D.StepPreservesInv(h.present, a);
  }

  lemma CommitFromPreservesHistInv(h: History, baseline: D.Model)
    requires HistInv(h)
    requires D.Inv(baseline)
    ensures  HistInv(CommitFrom(h, baseline))
  {
  }

  // proxy for linear undo: after a new action, there is no redo branch
  lemma DoHasNoRedoBranch(h: History, a: D.Action)
  requires HistInv(h)
  ensures Redo(Do(h, a)) == Do(h, a)
  {
  }
  // round-tripping properties
  lemma UndoRedoRoundTrip(h: History)
  requires |h.past| > 0
  ensures Redo(Undo(h)) == h
  {
  }
  lemma RedoUndoRoundTrip(h: History)
  requires |h.future| > 0
  ensures Undo(Redo(h)) == h
  {
  }
  // idempotence at boundaries
  lemma UndoAtBeginningIsNoOp(h: History)
  requires |h.past| == 0
  ensures Undo(h) == h
  {
  }
  lemma RedoAtEndIsNoOp(h: History)
  requires |h.future| == 0
  ensures Redo(h) == h
  {
  }
}
