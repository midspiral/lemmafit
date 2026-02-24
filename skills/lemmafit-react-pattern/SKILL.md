---
name: lemmafit-react-pattern
description: React integration pattern for lemmafit verified apps. Use when building React components that consume the verified Dafny API, wiring up state with Api.Init/Dispatch/Present, or creating new UI for a lemmafit app.
---

# React Pattern for Lemmafit

- Use the auto-generated TypeScript API from `src/dafny/app.ts` (never edit `app.ts` directly) 
- For any code that touches logic, check if it has been written in Dafny already and is available in the API
- Do not re-write logic in React that already exists in Dafny/API

## Modularity

Build modular React apps — never put everything in a single `App.tsx`. Organize `src/` by the same layers used in SPEC.yaml:

```
src/
├── dafny/app.ts        # Auto-generated verified API (DO NOT EDIT)
├── hooks/              # State layer — custom hooks that wrap the verified API
│   └── useAppState.ts  # Calls Api.Init, Api.Dispatch, Api.Present
├── components/         # Presentation layer — pure UI components
│   ├── WorkoutForm.tsx
│   └── SetList.tsx
├── utils/              # Utils layer — formatters, parsers, constants
│   └── format.ts
├── App.tsx             # Root — composes hooks + components, no logic
└── main.tsx            # Entry point
```

### Layer rules

- **Logic** (`dafny/`) — All business logic lives in Dafny. The React side never re-implements or duplicates what the verified API provides.
- **State** (`hooks/`) — Custom hooks are the *only* place that calls `Api.Init`, `Api.Dispatch`, and `Api.Present`. Components never import from `dafny/` directly.
- **Presentation** (`components/`) — Pure components that receive data and callbacks via props. No direct API calls, no `useState` for domain state.
- **Utils** (`utils/`) — Display helpers like formatters and constants. No side effects, no state.
- **Root** (`App.tsx`) — Wires hooks to components. Should be short — if it's growing, extract a component or hook.

### Why this matters
- Verified logic stays in one place (Dafny) — the React layer is just plumbing
- Components are testable and reusable without the verified API
- When the Dafny model changes, only `hooks/` needs updating — components stay stable

## Standard Pattern

```tsx
import * as Api from './dafny/app';

function App() {
  const [state, setState] = useState(() => Api.Init());

  const inc = () => setState(Api.Dispatch(state, Api.Inc()));
  const value = Api.Present(state);

  return <button onClick={inc}>{value}</button>;
}
```

## Key Rules
- Always initialize state with `Api.Init()`
- Dispatch actions through `Api.Dispatch(state, action)`
- Read display values through `Api.Present(state)`
- Never modify state directly — all transitions go through the verified Step function
