---
name: workflow-git-cli
description: Practical Git CLI workflow conventions for branching, staging, diffing, committing, pushing, PR creation, and ignore hygiene.
---

# Git CLI Workflow

## Purpose

Use this skill when work should stay in native Git CLI instead of custom tools.

For GitHub remote operations (PR details, checks, comments, reviews, workflow dispatch, merges), prefer `github_*` tools when available.

## GitHub Execution Policy

- Use `github_*` tools for remote GitHub operations (create PR, merge PR, checks, comments, reviews, workflow dispatch).
- Use Git CLI / `gh` only for local git workspace operations (for example `gh pr checkout` to switch local branch).
- Do not mix equivalent remote operations across `github_*` tools and `gh` within the same flow.

## Daily Flow

1. Inspect current state.
2. Sync main, then create or switch branch.
3. Review changes with diff/status.
4. Stage intentionally.
5. Commit with focused message.
6. Push branch and set upstream.

## Branch Naming

```
feat/<ticket>
feat/<ticket-1>-<ticket-2>
feat/<feature-name>
```

Examples:

- `feat/ORG-245` - single ticket
- `feat/ORG-242-ORG-244` - multi-ticket
- `feat/quiz` - large feature spanning many tickets

Use `feat/` prefix for all branches. The ticket ID is sufficient - no need to repeat the description in the branch name.

## Branch Per Ticket

Use one branch per JIRA ticket by default.

Before starting work on a new ticket:

```bash
git checkout main
git pull
git checkout -b feat/ORG-123
```

If the repository has app-scoped migration scripts (for example `apps/api`), run the migration command from the owning app workspace:

```bash
cd apps/<app-owning-typeorm>
yarn migration:run
```

If the branch already exists because you are expanding existing work, switch to it instead of creating a new branch.

## Branch Per Pull Request

**Before any PR-related work - analysis, code review, or implementation - check out the PR branch first.**

This applies to:

- Reviewing a pull request (code review)
- Analyzing PR changes or answering questions about a PR
- Fixing issues raised in PR review comments
- Continuing work on an existing PR

Why: Tools like `codebase_find_definition`, `codebase_trace_calls`, and file reads operate on the local working tree. If you are on `main` while reviewing a PR branch, tool results will reflect `main` - not the code under review. This leads to incorrect analysis, missed changes, and invalid review comments.

Check out a PR by number:

```bash
gh pr checkout <PR_NUMBER>
```

Verify you are on the correct branch:

```bash
git branch --show-current
git log --oneline -n 3
```

After checkout, confirm the branch is up to date with the remote:

```bash
git pull
```

If the PR is from a fork or you only need to read (not push), `gh pr checkout` still works - it creates a local tracking branch automatically.

**Rule:** Never start PR review or PR-related analysis without first checking out the PR branch. If you catch yourself reading PR diffs while on `main`, stop and checkout the correct branch before continuing.

## Command Playbook

### 1) Inspect current state

```bash
git status
git branch --show-current
git log --oneline -n 5
```

### 2) Create or switch branch

```bash
git checkout main
git pull
git checkout -b feat/ORG-123
```

For app-scoped migrations:

```bash
cd apps/<app-owning-typeorm>
yarn migration:run
```

When continuing existing work:

```bash
git checkout feat/ORG-123
git pull
```

### 3) Review current work

```bash
git diff
git diff --staged
git status --short
```

Use `git diff` before staging and `git diff --staged` before committing.

### 4) Stage changes deliberately

Prefer path-based staging:

```bash
git add src/modules/github/github.plugin.ts
git add src/modules/github/services/github-pr.service.ts
```

Stage everything only when intentional:

```bash
git add --all
```

Notes:

- `git add --all` respects ignore rules.
- `git add .` also respects ignore rules, but is path-scoped from current directory.

### 5) Commit

```bash
git commit -m "feat: add pull request creation tool"
```

Before commit, verify exactly what is staged:

```bash
git diff --staged
```

### 6) Push

First push for a branch:

```bash
git push -u origin $(git branch --show-current)
```

Next pushes:

```bash
git push
```

## Gitignore Hygiene

### Check if a file is ignored

```bash
git check-ignore -v path/to/file
```

### Stop tracking a file that should be ignored

```bash
git rm --cached path/to/file
```

Then add the pattern to `.gitignore` and commit that change.

### Local-only ignore (do not commit)

Use `.git/info/exclude` for machine-specific entries.

## Workspace Noise Filtering

When summarizing `git status` or preparing commits, treat local-generated junk as noise unless explicitly requested.

Common examples:

- `**/node_modules/`
- build artifacts (`dist/`, `build/`, `.turbo/`, coverage outputs)
- IDE/editor files (`.idea/`, `.vscode/`, `.DS_Store`)

Rules:

- Do not stage or commit noise paths by default.
- In status summaries, call out noise once in a short note and keep focus on relevant source changes.
- If noise is repeatedly untracked and truly local, prefer `.git/info/exclude`.
- If noise should be ignored for the whole team, add/update `.gitignore` in a separate intentional change.

## Commit Messages

Follow Conventional Commits. Do NOT include the JIRA ticket ID in commit messages.

```
<type>: <description>
```

The type is required for semantic-release (determines semver bump). The scope is optional - use it when it improves changelog readability.

```
feat: add equipment filter to routines
fix: handle expired subscription edge case
feat(api): implement signup flow
ci: implement staging CI/CD pipeline
```

Common conventional commit types:

- `feat`: new feature (triggers minor version bump)
- `fix`: bug fix (triggers patch version bump)
- `docs`: documentation-only change
- `style`: formatting/style changes without logic impact
- `refactor`: code change without new feature or bug fix
- `perf`: performance improvement
- `test`: add or update tests
- `build`: build system or dependency/build pipeline changes
- `ci`: CI configuration or pipeline changes
- `chore`: maintenance changes not in src/test logic
- `revert`: revert a previous commit

Keep under 72 characters. Imperative mood ("add" not "added").

### Format Rules

- **Type is mandatory** - semantic-release uses it to determine version bumps (`feat` -> minor, `fix` -> patch). Commits without a valid type are ignored by changelog generation.
- **JIRA ticket ID must NOT appear in the commit message.** The ticket ID lives in the branch name and the PR title. The squash-merge commit takes the PR title, so the ticket lands in `main`'s history exactly once (on the merge commit), not duplicated across every WIP commit. Per-commit ticket prefixes produce noisy `git log` output and add no traceability the branch/PR don't already provide.
- **Scope is optional** - use for changelog readability (e.g., `api`, `auth`, `lambda-subscriptions`). Do not put the ticket ID in the scope.

### Commitlint Basics

Most repositories using conventional commits expect:

- Header format: `<type>: <description>`
- Short imperative description (`add`, `fix`, `refactor`)
- Blank line before the body when a body is present

Example:

```text
feat: add equipment filter to routines

Support filtering the routines list by equipment IDs.
```

If commitlint is enabled, verify your message follows the local config before retrying commit.

Quick header examples:

| Bad                                     | Good                                  |
| --------------------------------------- | ------------------------------------- |
| `[CHRP-123] add feature`                | `feat: add feature`                   |
| `feat: [CHRP-123] add equipment filter` | `feat: add equipment filter`          |
| `feat(CHRP-123): add filter`            | `feat: add filter`                    |
| `fixed bug in push`                     | `fix: handle push upstream correctly` |

Ticket traceability lives on the branch (`feat/CHRP-123`) and on the PR title (`feat: [CHRP-123] add equipment filter`), not on individual commits.

## PR Title

PR titles follow the same conventional commit format as commit messages - this ensures the squash-merge commit (which uses the PR title) is valid for semantic-release:

```
feat: [CHRP-245] rename generate endpoint
fix: [CHRP-456] handle subscription race condition
feat: [CHRP-242][CHRP-244] add equipment endpoint improvements
ci: [CHRP-617] implement staging CI/CD pipeline
```

Rules:

- Title must start with a conventional commit type (`feat:`, `fix:`, `ci:`, `refactor:`, etc.)
- Must include one or more bracketed JIRA ticket IDs (e.g., `[CHRP-123]`)
- Description is lowercase, imperative mood ("add" not "added")
- Keep it short - the description body carries the detail
- Use `feat:` for feature/story tickets, `fix:` for bug tickets

## PR Description

The description scales with PR size. Don't pad small PRs with empty sections.

### Template Discovery (Required Before Writing)

Before drafting PR body content, check for a repository template using repository-relative paths (not absolute machine paths).

1. Resolve repo root: `git rev-parse --show-toplevel`
2. Check template candidates in this order:
   - `.github/PULL_REQUEST_TEMPLATE.md`
   - `.github/pull_request_template.md`
   - `.github/PULL_REQUEST_TEMPLATE/*.md`

Rules:

- If a template exists, use it as the base structure and keep required headings.
- Fill only relevant sections; remove placeholder text.
- If multiple templates exist in `.github/PULL_REQUEST_TEMPLATE/*.md`, choose the best matching one for the change scope.
- If no template exists, use the size-based format rules below.

### Small PRs (< 50 lines changed)

Summary + Related Tickets. Skip everything else.

```markdown
## Summary

Change `POST /v1/quizzes/{quizId}/generate` to `GET /v1/quizzes/{quizId}/questions?profileId=uuid`. The endpoint is a read operation - not a create - so GET is semantically correct.

## Related Tickets / Issues

- [ORG-245](https://strvcom.atlassian.net/browse/ORG-245)
```

### Medium PRs (50–400 lines changed)

Add Changes (grouped by area) and How to Test.

```markdown
## Summary

Unify `dailyTimeCommitment` field naming across all DTOs and responses, correct enum values, move `goalId` from profile entity to routine generation request body.

## Changes

- Renamed `DailyGoal` enum to `DailyTimeCommitment` with values 5, 15, 25
- Unified field name to `dailyTimeCommitment` across create, update, and response DTOs
- Added `goalId` as required field in `POST /routines/generate` request body
- Removed `goalId` / `goal` relation from `ProfileEntity` (+ schema migration dropping the column)

## Related Tickets / Issues

- [ORG-194](https://strvcom.atlassian.net/browse/ORG-194)

## How to Test

- `yarn migration:run` to apply the migration
- `yarn test` - all 215 tests pass
```

### Large PRs (400+ lines changed)

Full template. Include Implementation Deviations when deviating from spec, and Notes for Reviewers for cross-cutting concerns or deferred scope.

```markdown
## Summary

[1-2 sentences - what changed and why]

## Changes

[Grouped by area with bold sub-headers. Each bullet is a concrete change, not a vague description.]

**Quiz entities**: `QuizEntity`, `QuestionEntity`, ...
**Quiz generate** (`POST /quizzes/:quizId/generate`): dynamically selects questions per category...

## Implementation Deviations from Spec

| Deviation                                | Rationale                                                        |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `GET /v1/subscription/offerings` removed | FE fetches offerings directly from RevenueCat SDK on-device      |
| `revenuecat_app_user_id` column omitted  | Spec defines it as `= account.id` - redundant copy adds no value |

## Related Tickets / Issues

- [ORG-151](https://strvcom.atlassian.net/browse/ORG-151) - GET /v1/subscription
- [ORG-153](https://strvcom.atlassian.net/browse/ORG-153) - feature_limits infrastructure and guards

## How to Test

- `yarn migration:run` then `yarn seed:run` to populate data locally
- `yarn test` - all tests pass
- Test endpoints via Swagger at `/api-docs`

## Notes for Reviewers

[Cross-cutting concerns, deferred scope with ticket links, decisions reviewers should weigh in on.]
```

## PR Rules

- One concern per PR - if the diff touches unrelated areas, split it
- Keep PRs reviewable - aim for under 400 lines of diff; if larger, explain why in Notes for Reviewers
- PR title must follow conventional commit format with JIRA ticket ID: `feat: [CHRP-123] description`
- Don't pad small PRs with empty template sections - Summary + Related Tickets is enough
- When deviating from spec, document the deviation AND the rationale in the table
- When deferring scope, link the follow-up ticket so reviewers know it's tracked
- Self-review the diff before requesting review
- For paginated database-backed query work, `How to Test` should include evidence that paginated/filtering behavior is verified through endpoint or repository tests

## Resolving Review Threads

When acting as the PR resolver after feedback has been left, follow this sequence for every review comment thread:

1. Process comments one-by-one (do not batch-resolve without per-thread replies).
2. Reply in-thread before resolving, with body prefixed exactly: `*resolver:* `.
3. Explicitly state disposition:
   - addressed (implemented now)
   - partially addressed (what changed vs what remains)
   - not addressed (clear rationale)
4. When addressed, include concrete proof (commit SHA, file path, or test command/results) so reviewers can verify quickly.
5. Resolve the thread only after the resolver reply is posted.
6. Leave the thread open if work is deferred, intentionally rejected, or still in progress.

Thread resolution message examples:

- `*resolver:* Addressed in 24271b8 by switching SessionService to constructor injection for consistency with module patterns. Re-ran lint and session/xp tests.`
- `*resolver:* Not addressed in this PR (out of scope). Tracked in ORG-999 for follow-up.`

## Authoring Rule

- Do not set or override git author/committer identity from the LLM workflow.
- Do not run `git commit --author ...`.
- Do not change git identity config during task execution.

## Never Commit

The following files must never be staged or committed:

- **Technical specifications** (`docs/backend-spec-*.md`, `docs/client-spec-*.md`, `docs/internal-spec-*.md`) - specs are reference documents maintained outside version control. They may be gitignored. Do not `git add -f` to bypass ignore rules.
- **Secrets** (`.env`, `credentials.json`, API keys, tokens) - verify these are in `.gitignore`.

If the user explicitly asks to commit a spec file, warn them that specs are excluded by convention and confirm before proceeding.

## Safe Defaults

- Prefer explicit path staging over blanket staging.
- Run both `git diff` and `git diff --staged` before commit.
- Keep one logical change per commit.
- Never commit secrets; verify `.env` and credential files are ignored.

## Anti-Patterns

- Committing without reviewing staged diff.
- Using `git add --all` in a dirty tree without checking `git status` first.
- Relying on `.gitignore` to untrack already tracked files.
- Force-pushing shared branches unless explicitly required.
- Committing technical specification files (`docs/*-spec-*.md`) - these are reference documents, not versioned source code.
- Using `git add -f` to bypass `.gitignore` rules without explicit user confirmation.

## Rules

- Branch before significant edits.
- Stage intentionally.
- Review unstaged and staged diffs.
- Commit small, focused changes.
- Prefer `type: description` commit headers with no scope.
- Push with upstream on first publish.

## Easter Eggs

These are silent, lightweight additions woven into normal PR output. Never announce them - they should feel like a discovery, not a feature.

### March 10 (Mario Day)

When creating or updating a PR on March 10 (local date), append a single italicised line to the very end of the PR description body:

```
_Happy Mario Day. Wahoo!_
```

Keep it subtle. One line only.

## Monorepo-Only Addendum (Turbo/workspaces + `apps/`/`packages/`)

Apply this section only when all are true:

- the target repository is a Turbo/workspace monorepo
- the repository has an `apps/` and/or `packages/` folder at root
- migration scripts are app-scoped

Run migrations from the app workspace, not from repo root unless root script exists:

```bash
cd apps/<app-owning-typeorm>
yarn migration:run
```

Example for Chirp API monorepo:

```bash
cd apps/api
yarn migration:run
```
