---
name: lemmafit-spec
description: Lemmafit development workflow for managing SPEC.yaml and Dafny specifications. Use when the user describes a new feature, asks to add or update features or specs, or when spec changes need to be addressed. Handles SPEC.yaml entries, Dafny code sync, and spec queue processing. Follow these instructions whenever your workflow touches the spec.yaml file
---

# Lemmafit Spec

## Instructions
1. When the user describes an app, a requirement, or a new feature, add entries to SPEC.yaml first
2. Then write Dafny specs that formalize entries where `verifiable: true`
3. Mark UI-only or non-provable entries as `verifiable: false, status: trusted`
4. Keep SPEC.yaml in sync with Dafny code — if you change one, update the other
5. When the user edits SPEC.yaml directly, you will be notified via the daemon — update code to match

## RULES YOU MUST FOLLOW
- ALL logic-related and state machine entries must be set as `verifiable: true`
- ONLY EXCEPTIONS: API calls, parsing, and any other external effect

## Checking for Spec Changes
At the start of every conversation, read `.vibe/status.json`. If `specQueue` has items, these are spec changes that haven't been addressed yet. Each item has a type (`added` or `removed`) and the text. Added items include a line number in the current SPEC.yaml. Update Dafny code and/or React code to reflect these requirements before doing anything else.

The queue auto-clears when you write `.dfy` files and verification passes. For trusted-only changes, writing SPEC.yaml with updated tags will also clear the queue.

Prove strong properties about your program, both generic and domain-specific. 
**Example**: proving the Replay kernel `StepPreservesInv` (after Normalization) is a weak property. Try to prove that applying more specific actions results in desired properties (e.g. Inv even without Normalization)

Every SPEC.yaml entry with type: postcondition and verifiable: true MUST have a corresponding lemma in Dafny with an ensures clause that matches the property field. Invariant-only proofs are NOT sufficient for postcondition entries.

### Format
SPEC.yaml is a structured YAML file with an `entries` list. Each entry has:
- `id` — unique spec ID (e.g. `spec-001`)
- `req_id` — linked requirement ID (or `null`)
- `title` — human-readable description of the property
- `group` — logical grouping (e.g. Business Logic, Presentation, Data, Utils)
- `layer` — architecture layer (`logic`, `presentation`, `state`, `data`, `utils`)
- `type` — property type (`invariant`, `postcondition`, `precondition`, `datatype`, `function`, `constraint`)
- `property` — formal property expression. **MUST be quoted** if it contains special characters (`:`, `>`, `!`, `#`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `?`, `|`, `-`, `=`). When in doubt, always quote with double quotes.
- `module` — target Dafny module (or `null` for non-verifiable)
- `depends_on` — list of spec IDs this entry depends on
- `verifiable` — whether this can be proven in Dafny 
- `guarantee_type` — `verified`, `assumed`, or `trusted`
- `state` - `DRAFT`, `ADDRESSED`, `null` — only use `ADDRESSED` if the corresponding Dafny module or property have been verified. Use `null` for `verifiable: false`

### Example
```yaml
entries:
  - id: spec-001
    req_id: null
    title: The counter value is always non-negative
    group: Business Logic
    layer: logic
    type: invariant
    property: "model.value >= 0"
    module: AppCore
    depends_on: []
    verifiable: true
    guarantee_type: verified
    state: ADDRESSED
  - id: spec-002
    req_id: null
    title: The increment button displays the current count
    group: Presentation
    layer: presentation
    type: invariant
    property: "display == Present(state).value"
    module: null
    depends_on: []
    verifiable: false
    guarantee_type: trusted
    state: null
```
 
