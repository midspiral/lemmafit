# Lemmafit Project

This project uses lemmafit to formally verify ALL logic in the codebase. You help users build web apps with mathematically verified state machines, business logic, and any other logic-based code.

Before writing code, ask yourself: "Is any part of this code verifiable?" Verifiable means that it contains logic that CAN be written in Dafny. If the answer is "yes," write the code in Dafny. Do not write directly in JavaScript or Typescript, anything that can be verified.  

## How It Works

1. Users describe an app or individual features in natural language
2. You write Dafny specifications in `dafny/` directory
3. Verification and compilation happen automatically (you'll see the results)
4. The React app in `src/` uses the verified API

## Key Files

- `SPEC.yaml` - Natural language requirements (source of truth for all specs)
- `lemmafit/dafny/*.dfy` - Dafny specifications (all logic should be written in Dafny)
- `src/dafny/app.ts` - Auto-generated TypeScript API (do not edit directly)
- `src/App.tsx` - React app that uses the verified API
- `lemmafit/.vibe/status.json` - Current verification status
- `lemmafit/.vibe/logic-surface.json` - Logic interface/API
- `lemmafit/.vibe/modules.json` - Multi-module configuration (optional, see below)

## Multi-Module Projects

By default, lemmafit uses a single Dafny module with the Replay kernel pattern (Domain.dfy → app.ts). For projects that need multiple independent verified modules, create `lemmafit/.vibe/modules.json`:

```json
[
  {
    "entry": "lemmafit/dafny/Workflow.dfy",
    "appCore": "Workflow",
    "outputName": "Workflow",
    "jsonApi": true
  },
  {
    "entry": "lemmafit/dafny/Validation.dfy",
    "appCore": "Validation",
    "outputName": "Validation",
    "jsonApi": true,
    "nullOptions": true,
    "target": "node"
  }
]
```

When `modules.json` exists:
- Each module is compiled independently to `src/dafny/{outputName}.cjs` and `src/dafny/{outputName}.ts`
- Each module is its own AppCore (no separate AppCore module needed)
- `jsonApi: true` enables full JSON marshalling (plain types in/out, no Dafny runtime types)
- `nullOptions: true` maps `Option<T>` to `T | null` at the boundary
- `target` sets the dafny2js compilation target (default: `"client"`). Valid values: `"client"` (browser/React), `"node"` (Node.js, uses `fs.readFileSync`), `"inline"` (universal, inlines .cjs code), `"deno"` (Deno adapter), `"cloudflare"` (Cloudflare Workers adapter)
- Modules don't know about each other — write a thin TypeScript glue file to connect them
- The glue file is unverified but should be minimal and auditable
- Prefer returning result types with verified error messages over boolean predicates — the UI can display them directly without duplicating logic

## Available Skills

 - `lemmafit-dafny`: Load this skill before writing or editing .dfy files
 - `lemmafit-proofs`: Load this skill before writing or editing lemmas
 - `lemmafit-react-pattern`: Load this skill before writing React 
 - `lemmafit-spec`: Load this skill when user asks to add or edit feature, and before writing or editing the spec.yaml file 
 - `lemmafit-guarantees`: Load this skill to generate a human-readable guarantees report from proven Dafny code and verify claims with claimcheck
 - `lemmafit-pre-react-audits`: Load this skill before writing React to audit proof strength and catch unverified logic
 - `lemmafit-post-react-audit`: Load this skill after writing React to catch effect-free logic that should be in Dafny


If you try to read any of these files and they are missing, alert the user. 

## WORKFLOW
Follow these steps in order every time the user asks for a feature or change that involves any logic.

Step-by-step development workflow for building apps and features with lemmafit. Use when the user asks for a new feature, describes functionality, or when spec changes need to be addressed. Covers the full loop from spec.yaml to verified React code.

Report in the chat which step you are on as you move through the steps.

## Step 0: Check for pending spec changes

Read `.vibe/status.json`. If `specQueue` has items, address those first before doing anything else. Each item is a requirement that was added/changed/removed in SPEC.yaml but not yet reflected in Dafny code.

## Step 1: Write SPEC.yaml entries
Load lemmafit-spec skill before writing or editing the spec.yaml

Translate the user's request into structured entries in `SPEC.yaml`. A hook runs automatically after you write SPEC.yaml — it diffs your changes and creates a spec queue. You'll see the pending items in the output.

## Step 2: Write Dafny specifications
Load lemmafit-dafny skill before writing or editing any Dafny.

Write `.dfy` files in `lemmafit/dafny/` that formalize the verifiable spec entries. 

A hook runs automatically after you write any `.dfy` file — it verifies and compiles immediately. You must wait for a response from the daemon before moving forward. The response will be one of two:
- `✓ Verified and compiled` — success, spec queue auto-cleared, wrappers regenerated (`src/dafny/app.ts` or per-module `src/dafny/{name}.ts`)
- `✗ Verification failed` — fix the errors shown and write the file again

Do not move to the next step until verification passes (verified and compiled).

## Step 3: Check Dafny against SPEC.yaml
Always keep SPEC.yaml and Dafny in sync — if you change one, update the other. 

## Step 4: Write proofs
Load the lemmafit-proofs skill before writing any lemmas.

## Step 5: Run Pre-React Audits
Load the lemmafit-audits skill before proceeding. 

Run 2 audits:
**Proof Strength Audit**: Check the strength of the actual proofs against the specs. Any gaps? Any weak proofs?
**Logic-in-Js Audit**: Is there any logic that the app or feature will require (for this build phase) that is not being implemented in Dafny? 

Label each finding as `minor`, `moderate`, or `critical`. 

Iterate on Steps 4 and 5 until audit returns only minor findings. 

## Step 6: Write React code
Load lemmafit-react-pattern skill before writing React code. 

Only after verification passes. The auto-generated API is at `src/dafny/app.ts` (single-module) or `src/dafny/{name}.ts` (multi-module). Never edit generated files.

- Create hooks in `src/hooks/` that wrap `Api.Init`, `Api.Dispatch`, `Api.Present`
- Create components in `src/components/` that receive data/callbacks via props
- Keep `App.tsx` as a thin composition root

Never re-implement logic in React that already exists in the verified API.

## Step 7: Run Post-React Audit
Load the lemmafit-post-react-audit skill

Ensure that effect-free logic is implemented primarity in Dafny rather than directly in JavaScript/TypeScript. 

## Step 8: Verify guarantees

After proofs are solid and React is wired, check that claims actually cover the spec requirements. Ask the user if they want to run `/guarantees` command to generate a report. If they say yes, run the command. 

## Step 9: Iterate

If the user asks for changes, start by editing SPEC.yaml (Step #1), then move through each step again until full loop is complete. 





