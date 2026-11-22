# Development Workflow

The **exact process** for every meaningful change. It keeps `main` always
deployable: nothing ships without being built, tested, and reviewed first.

## Golden rules

- ✅ `main` is the production branch. It is always deployable.
- 🚫 Never commit or push directly to `main`.
- 🚫 Never skip the quality gate.
- 🚫 Never merge a pull request while any check is red.

## The change process

1. **Branch** off `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feature/short-description
   ```
2. **Change the code.** Keep rules in `src/game.js`, wiring in `src/main.js`.
3. **Add/update tests.** New rules → `src/game.test.js`. New on-screen behavior
   → `e2e/smoke.spec.js`.
4. **Run the full local gate** and fix anything red:
   ```bash
   npm run check   # format → lint → unit → build → e2e
   ```
5. **Commit & push**, then open a pull request into `main`.
6. **Wait for CI** (it re-runs the whole gate). Merge only when green.

## The quality gate

| Step          | Command                | Purpose                            |
| ------------- | ---------------------- | ---------------------------------- |
| Format check  | `npm run format:check` | Consistent code style              |
| Lint          | `npm run lint`         | Catch likely mistakes              |
| Unit tests    | `npm run test:unit`    | Game rules are correct             |
| Build         | `npm run build`        | Production build succeeds          |
| Browser tests | `npm run test:e2e`     | Real game loads & plays, no errors |

All five run together with **`npm run check`**.
