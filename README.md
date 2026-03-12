# lemmafit

Make agents **prove** that their code is correct. 

Read our launch post: [Introducing lemmafit: A Verifier in the AI Loop](https://midspiral.com/blog/introducing-lemmafit-a-verifier-in-the-ai-loop/). 

Lemmafit integrates [Dafny](https://dafny.org/) formal verification into your development workflow via [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Business logic, state machines, and other logic are written in Dafny, mathematically verified, then auto-compiled to TypeScript for use in your React app.

## Quick Start

```bash
# Install lemmafit globally
npm install -g lemmafit

# Create a new project
lemmafit init PROJECT_NAME
cd PROJECT_NAME

# Install deps (downloads Dafny automatically)
npm install

# In one terminal, start the verification daemon
npm run daemon

# In another terminal, start the Vite dev server
npm run dev

# In a third terminal, open Claude Code
claude
```

## Use Cases / Considerations

- lemmafit works with greenfield projects. You typically begin a project with `lemmafit init` though `lemmafit add` provides rudimentary support for existing codebases.

- lemmafit compiles Dafny to Typescript which then hooks into a React app. In the future, we will support other languages and frameworks. 

- lemmafit is optimized to work with Claude Code. In the future, lemmafit will be agent-agnostic. 

## How It Works

1. Prompt Claude Code as you normally would. You may use a simple starting prompt or a structured prompting system. 
**Example: "Create a pomodoro app I can use personally and locally."** 
2. The agent will write a `SPEC.yaml` and write verified logic in `lemmafit/dafny/Domain.dfy`
3. The **daemon** watches `.dfy` files, runs `dafny verify`, and on success compiles to `src/dafny/Domain.cjs` + `src/dafny/app.ts`
4. The agent will hook the generated TypeScript API into a React app — the logic is proven correct
5. After proofs complete, run custom command in Claude Code `/guarantees` to activate claimcheck and generate a guarantees report

## Project Structure

```
my-app/
├── SPEC.yaml                    # Your requirements
├── lemmafit/
│   ├── dafny/
│   │   └── Domain.dfy           # Your verified Dafny logic
│   │   └── Replay.dfy           # Generic Replay kernel
│   ├── .vibe/
│   │   ├── config.json           # Project config
│   │   ├── status.json           # Verification status (generated)
│   │   └── claims.json           # Proof obligations (generated)
│   └── reports/
│       └── guarantees.md         # Guarantee report (generated)
├── src/
│   ├── dafny/
│   │   ├── Domain.cjs            # Compiled JS (generated)
│   │   └── app.ts                # TypeScript API (generated - DO NOT EDIT)
│   ├── App.tsx                   # Your React app
│   └── main.tsx
├── .claude/                      # Hooks & settings (managed by lemmafit)
└── package.json
```

## CLI

```bash
lemmafit init [dir]                # Create project from template
lemmafit sync [dir]                # Re-sync system files (.claude/, hooks)
lemmafit daemon [dir]              # Run verification daemon standalone
lemmafit logs [dir]                # View daemon log
lemmafit logs --clear [dir]        # Clear daemon log
```

## Updating

System files sync automatically on install:

```bash
npm update lemmafit
# postinstall re-syncs .claude/settings.json, hooks, and instructions
```

## Requirements

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

Dafny and dafny2js are downloaded automatically during `npm install` to `~/.lemmafit/`.
