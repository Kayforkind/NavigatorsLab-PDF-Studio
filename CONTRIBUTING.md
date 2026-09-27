# Contributing to PDF Studio

Thanks for wanting to make PDF Studio better. This is a 100%-client-side PDF editor — every contribution keeps it that way.

## Ground rules

- **No servers, no uploads, no trackers.** Any PR that sends document bytes anywhere off-device will be rejected. The only network call the app itself may make is the one-time, user-initiated download of public AI model weights from Hugging Face (already disclosed in the UI).
- **Privacy claims are load-bearing.** If your change touches the "files never leave this device" promise, say so explicitly in the PR.
- Keep the bundle lean. New dependencies need a justification in the PR description.

## Setup

```bash
npm install
npm run dev      # local dev server
npm test         # 42 tests, all must pass
npm run build    # production build
```

## How to contribute

1. **Issues first.** Check [open issues](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/issues) — `good first issue` is the on-ramp. If none fit, open an issue describing the problem before writing code.
2. **Fork, branch, PR.** Branch from `main`, keep PRs focused (one change per PR).
3. **Tests.** Bug fixes should include a regression test. New features should include tests where the logic is testable.
4. **Discuss.** Design questions and support live in [Discussions](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/discussions) — use issues for actionable bugs and features only.

## Good first issues

Look for the [`good first issue`](https://github.com/Kayforkind/NavigatorsLab-PDF-Studio/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) label. They're scoped small on purpose.

## Code style

- TypeScript, strict. No `any` without a comment explaining why.
- Match the existing file structure under `src/` — ask in Discussions if unsure where something belongs.

## License

By contributing you agree your work is released under the [MIT License](LICENSE).
