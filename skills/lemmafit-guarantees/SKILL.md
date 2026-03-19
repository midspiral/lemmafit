---
name: lemmafit-guarantees
description: Generate human-readable guarantees from proven Dafny code and verify them with claimcheck. Use after verification succeeds and SPEC.yaml is in sync with Dafny. Produces guarantees.json, claimcheck-mapping.json, runs claimcheck-multi, and generates guarantees.md report.
---

# Generate Guarantees and Run Claimcheck

You are generating human-readable guarantees from proven Dafny code and verifying them with claimcheck.

## Step 0: Make sure the state of the project is verified

Check your context for verification status of the project.

## Step 1: Read project data

Read these files:
- `lemmafit/.vibe/claims.json` — extracted proof obligations from Dafny (predicates with conjuncts, lemmas with requires/ensures, functions with contracts, axioms)
- `SPEC.yaml` — natural language requirements with spec entries
- `lemmafit/dafny/Domain.dfy` — the Dafny source code
- `lemmafit/.vibe/config.json` — project config (need `appCore` field for claimcheck domain)

If `claims.json` doesn't exist, tell the user to run the daemon first (`npm run daemon` or `npm run dev`) so Dafny verification produces claims.

## Step 2: Map claims to spec entries

Analyze the claims from `claims.json` and map them to spec entries from `SPEC.yaml`.

**How claims work:**
- **Predicate conjuncts** (in `predicates[].conjuncts`) are invariant properties proven by the `StepPreservesInv` lemma. Each conjunct in the `Inv` predicate is a separate proven property.
- **Lemma ensures** (in `lemmas[].ensures`) are standalone proven properties. The lemma name is in `lemmas[].name`.
- **Function contracts** (in `functions[].requires` and `functions[].ensures`) are proven pre/postconditions.
- **Axioms** (in `axioms[]`) are assumed, NOT proven — they represent the trust surface.

**Mapping rules:**
- A claim "covers" a spec entry if the Dafny expression proves the property described by that spec entry
- One claim can cover multiple spec entries
- Spec entries with `status: trusted` don't need covering claims
- Spec entries with `verifiable: false` should be skipped
- Identify **gaps**: spec entries with `status: verified` that have NO covering claim

## Step 3: Write guarantees.json

Write `reports/guarantees.json` with this format:

```json
{
  "generatedAt": "<ISO timestamp>",
  "guarantees": [
    {
      "specId": "spec-001",
      "requirement": "<title from SPEC.yaml>",
      "status": "proven",
      "coveredBy": [
        {
          "claimId": "inv:<Module>.<Predicate>:<conjunctIndex>",
          "type": "invariant-conjunct",
          "expression": "<the Dafny expression>",
          "lemmaName": "StepPreservesInv"
        }
      ],
      "reasoning": "<why this claim covers this spec entry>"
    }
  ],
  "gaps": [
    {
      "specId": "spec-005",
      "requirement": "<title>",
      "reason": "<why no claim covers this>"
    }
  ]
}
```

For `lemmaName`:
- Invariant conjuncts → `"StepPreservesInv"`
- Lemma ensures → the lemma's name (e.g. `"UndoReversesLast"`)
- Function contracts → the function's name

## Step 4: Handle multi-lemma requirements

If a single requirement is covered by **multiple** lemmas (e.g. an invariant conjunct AND a standalone lemma together prove one requirement), you must write a **new wrapper lemma** in the Dafny source that proves the full requirement in one place. The wrapper lemma should:
- Have a name that clearly describes the requirement (e.g. `Guarantee_UniqueUpvotes`)
- Call/use the individual lemmas as needed
- Have an `ensures` clause that directly expresses the full natural-language requirement

This is necessary because claimcheck needs exactly one lemma per requirement to verify faithfulness.

Wait for the daemon to re-verify after writing any new lemmas before proceeding.

## Step 5: Write claimcheck mapping

Write `lemmafit/.vibe/claimcheck-mapping.json` — an array of `{ requirement, lemmaName, file }` objects derived from the guarantees. The `file` field is a **path relative to the mapping file** (i.e. relative to `lemmafit/.vibe/`).

```json
[
  { "requirement": "Each user can only upvote once", "lemmaName": "Guarantee_UniqueUpvotes", "file": "../dafny/Domain.dfy" }
]
```

Each requirement should map to exactly one lemma. If you wrote wrapper lemmas in step 4, use those.

## Step 6: Run claimcheck

Run `claimcheck-multi` to verify that each lemma faithfully expresses its requirement.

**CRITICAL: claimcheck-multi MUST run in the background with output redirected to files.** It spawns `claude -p` as a subprocess, which will hang indefinitely if run in the foreground from a Claude Code session. Always use `&` and redirect stdout/stderr:

```bash
claimcheck-multi -m lemmafit/.vibe/claimcheck-mapping.json -d <appCore> --json --claude-code > lemmafit/.vibe/claimcheck.json 2> lemmafit/.vibe/claimcheck-err.log &
```

Replace `<appCore>` with the value from `lemmafit/.vibe/config.json`.

No `--dfy` flag needed — `claimcheck-multi` resolves file paths from the `file` field in each mapping entry (relative to the mapping file).

Wait for it to complete (poll with `cat lemmafit/.vibe/claimcheck.json` until it contains valid JSON), then read the results.

## Step 7: Report and iterate

Parse the claimcheck results and report:
- **Confirmed** — the lemma faithfully expresses the requirement. No action needed.
- **Disputed** — a discrepancy was found. Show the `discrepancy` text and `weakeningType` (tautology, weakened-postcondition, narrowed-scope, wrong-property).
- **Error** — lemma not found in source. Check the lemmaName.

**If any claims are disputed:** Suggest specific fixes to the Dafny code or the requirement text. If the user agrees, make the fixes, wait for re-verification, and re-run the guarantees process.

## Step 8: Ensure all files up to date

Once iteration is complete, compare `claimcheck-mapping.json` with `guarantees.json` to ensure they contain equivalent information. If there's a discrepancy, trace back to the Dafny code to find which is most accurate. Adjust the relevant file accordingly and re-run `/guarantees` command. Once confirmed, report that the files are in sync.

## Step 9: Generate guarantees.md via the script

Do this only after Step 8 confirms that `claimcheck-mapping.json` and `guarantees.json` are in sync.

Run the deterministic report generator:

```bash
npx lemmafit-generate-guarantees
```

This reads `reports/guarantees.json`, `reports/claimcheck.json`, and `SPEC.yaml` and writes `reports/guarantees.md`. Do NOT write this file manually — always use the script so the report matches the JSON exactly.

Report to the user: "A report of your app's guarantees has been generated in lemmafit/reports/guarantees.md"
