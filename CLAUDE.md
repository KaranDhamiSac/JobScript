# JobScript

## Commit rules

- Commit after every new function or logical change, not just at the end of a feature. Each commit should do one thing
- Use Conventional Commits style:
  - feat: new feature or function
  - fix: bug fix
  - refactor: code change with no behavior change
  - style: CSS or formatting only
  - docs: README, PRIVACY.md, or comments
  - test: tests or test tools in dev/
  - chore: config, manifest, build scripts, dependencies
- Format: type(scope): short summary in present tense, under 72 characters. Scope is the area, like tracker, autofill, tailor, options, popup, or ai
  - Example: feat(tracker): extract Greenhouse job ID from URL
  - Example: fix(autofill): skip hidden react-select inputs
- Add a short body explaining why when the change isn't obvious
- Never commit broken code. Make sure each commit loads and runs
- Push after finishing each feature
- Keep the Co-Authored-By line
