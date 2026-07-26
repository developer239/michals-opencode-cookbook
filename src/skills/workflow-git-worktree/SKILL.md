---
name: workflow-git-worktree
description: Git worktree conventions for orchestrations that fan out work across multiple agents editing the same repo concurrently. Load before dispatching parallel write-mode agents.
---

# Git Worktree Workflow

## Purpose

When an orchestrator dispatches N agents to write to the same repository concurrently, every agent must edit in its own isolated working directory. Two agents writing to the same checkout corrupts the working tree: stage races, partial edits, and last-writer-wins on overlapping files.

Git worktrees solve this. One repository, many working directories, one branch checked out per worktree. Every agent gets its own filesystem path; all worktrees share the same `.git` object database so commits, merges, and history are coherent across them.

Load this skill before any orchestration that:

- Dispatches multiple agents in parallel with `--mode write`
- Uses `/divide-and-conquer` (or any similar divide-and-conquer command) with write mode and `--execution parallel`
- Needs N agents to edit the same repository simultaneously

Do not load this skill for:

- Read-only audits (no writes = no contention)
- Single-agent workflows (one checkout is sufficient)
- Workflows where each agent edits a clone of the repo instead of a worktree (clones have separate `.git` databases and need manual sync; worktrees do not)

## Applicability

Use this skill only when all are true:

- A parent orchestrator is dispatching multiple agents that will all edit the same git repository
- The work involves writes (file edits, not just reads)
- The agents will run concurrently (parallel mode), not strictly sequential

If agents run strictly sequentially in write mode, they can share one checkout (commit between dispatches). Worktrees are only required when concurrency + writes overlap.

## Core Rules

- **Agents NEVER create branches.** The orchestrator creates one worktree (and the branch underneath it) per agent before dispatch. The agent sees a pre-prepared working directory checked out to a pre-prepared branch and just edits files. Agent prompts must explicitly forbid `git checkout -b`, `git branch`, `git switch -c`, and any other branch-creation operation.
- **Agents NEVER commit, push, merge, rebase, or stash.** They edit files. The orchestrator owns every git operation. Agent prompts must explicitly forbid `git commit`, `git push`, `git merge`, `git rebase`, `git stash`, `git reset`, and `git checkout` (except as a read-only inspection).
- **One agent per worktree, one worktree per agent.** Never share a worktree across agents. Never give one agent two worktrees.
- **Each agent's `oc_run` uses `cwd: <worktree path>`, not the main repo path.** This is the central wiring rule. If the agent's `cwd` is the main repo, the agent edits files in the main repo - defeating the entire purpose of worktrees.
- **The parent branch must be checked out in the main repo, not in a worktree.** Git enforces this (one branch, one checkout) but it bears stating: the orchestrator keeps the main repo on the parent branch (`feat/CHRP-815`, `main`, whatever), and the worktrees branch off from that.
- **Worktrees are throwaway.** Create them at orchestration start, merge their branches back into the parent at orchestration end, then remove the worktrees. Do not let worktrees accumulate.

## When to Use Worktrees vs Alternatives

| Situation                                               | Use                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| One agent editing one repo                              | No worktree; agent edits the main checkout directly         |
| Multiple agents editing one repo, strictly sequential   | No worktree; commit between dispatches in the main checkout |
| Multiple agents editing one repo, parallel write mode   | **Worktree per agent**                                      |
| Multiple agents reviewing/auditing one repo (read-only) | No worktree; all agents mount the same checkout             |
| Multiple agents editing **different** repos             | No worktree; each agent mounts its own repo                 |

## Worktree Path Convention

Worktrees live in a sibling directory to the main repo, under a `.worktrees/` subdirectory named for the parent task. The convention:

```
<main-repo-parent-dir>/
├── chirp-api-mono/                          # main checkout, on the parent branch
└── .worktrees/
    └── chirp-api-mono-<task-tag>/
        ├── slot-1/                           # agent 1's worktree
        ├── slot-2/                           # agent 2's worktree
        └── slot-N/                           # agent N's worktree
```

`<task-tag>` is a short identifier derived from the orchestration (e.g. `chrp-815-comment-hygiene`, `chrp-815-forwardref`). It must be unique across concurrent orchestrations on the same repo.

Concrete example for the chirp-api-mono repo:

```
/Users/michal.jarnot/IdeaProjects/chirp-api-mono                                      # main
/Users/michal.jarnot/IdeaProjects/.worktrees/chirp-api-mono-chrp-815-comment-hygiene/slot-1
/Users/michal.jarnot/IdeaProjects/.worktrees/chirp-api-mono-chrp-815-comment-hygiene/slot-2
/Users/michal.jarnot/IdeaProjects/.worktrees/chirp-api-mono-chrp-815-comment-hygiene/slot-3
```

The `.worktrees/` directory is at the same level as the repo, not inside it, so it never shows up in `git status` and never accidentally gets committed.

## Branch Naming Convention

Each worktree's branch is a child of the parent branch, named with the task tag and slot number:

```
<parent-branch>-dc-<task-tag>-slot-<N>
```

Example, with parent branch `feat/CHRP-815` and task tag `comment-hygiene`:

- `feat/CHRP-815-dc-comment-hygiene-slot-1`
- `feat/CHRP-815-dc-comment-hygiene-slot-2`
- `feat/CHRP-815-dc-comment-hygiene-slot-3`

The `-dc-` infix marks the branch as a divide-and-conquer worktree branch so it is recognisable in `git branch -a` output and so cleanup scripts can target it safely.

## Worktree Lifecycle (Orchestrator-Owned)

### Step 0 - Load workflow-git-cli (Blocking Gate)

**The orchestrator owns every git operation in this lifecycle (worktree create, per-slot commit, merge back, branch cleanup).** Before any of Steps 1-7, the orchestrator must have `workflow-git-cli` loaded so it follows the repo's conventional-commit rules. The most common failures in practice are:

- Putting the JIRA ticket ID in the commit message (the skill says: ticket ID lives in the branch name and PR title only, NOT in commit messages).
- Using a non-conventional type like `merge:` for merge commits (commitlint will reject; use `chore:` for merges).
- Skipping the `git diff --staged` review before commit.

Load `workflow-git-cli` once at the start of the orchestration, before Step 1. Without it, the commits and merges this skill creates will violate the host repo's commitlint config and fail the husky hook, which forces a rework loop.

### Step 1 - Prepare main checkout

Before creating any worktree, the main repo must be on the parent branch with a clean working tree:

```bash
cd <main-repo-path>
git status --porcelain   # must be empty
git branch --show-current  # must equal <parent-branch>
```

If the tree is dirty, stop and ask the user to commit or stash. If the branch is wrong, switch first.

### Step 2 - Create one worktree per agent

For each slot `N` in the partition plan:

```bash
git -C <main-repo-path> worktree add \
  -b <parent-branch>-dc-<task-tag>-slot-<N> \
  <worktrees-dir>/<repo-name>-<task-tag>/slot-<N> \
  <parent-branch>
```

The `-b` flag creates a new branch at the same commit as `<parent-branch>`. The new worktree path is checked out to that new branch immediately.

Verify the result:

```bash
git -C <main-repo-path> worktree list
```

You should see the main repo plus N new worktree entries, one per slot.

### Step 3 - Dispatch one async opencode run per worktree

Each agent runs as a local `opencode run` process via `oc_run`. The agent's working directory is the worktree path:

```
oc_run(
  prompt: "<onboarding prompt or first work prompt>",
  model: "openai/gpt-5.5",
  cwd: "<worktrees-dir>/<repo-name>-<task-tag>/slot-<N>",
  mode: "async"
)
```

Capture the returned `sessionId` (poll via `oc_get_run_status` once the run reaches `completed`). Every subsequent work run for this slot reuses that `sessionId` so the onboarding cost is paid once.

### Step 4 - Dispatch work runs

Standard work-run dispatch. The agent sees the worktree as its working directory and edits files normally. No additional git instructions needed in the prompt beyond the hard forbid:

```
HARD GIT CONSTRAINTS:
- Do NOT create branches. Do NOT run `git checkout -b`, `git branch`, `git switch -c`, or any other branch-creation command.
- Do NOT commit. Do NOT run `git commit`, `git add`, `git stash`, `git push`, `git merge`, `git rebase`, or `git reset`.
- Edit files in place using the `read` and `edit` tools. The orchestrator owns all git operations.
- Read-only git inspection (`git status`, `git diff`, `git log`) is fine if you want to confirm the working tree state.
```

### Step 5 - Commit per worktree after agent completes

After each agent's work run terminates and the orchestrator has validated its output:

```bash
git -C <worktrees-dir>/<repo-name>-<task-tag>/slot-<N> add -A
git -C <worktrees-dir>/<repo-name>-<task-tag>/slot-<N> diff --staged --stat
git -C <worktrees-dir>/<repo-name>-<task-tag>/slot-<N> commit -m "<type>(<scope>): <description>"
```

Commit per worktree (not per orchestration), so if one slot fails the others' commits are preserved on their own branches.

**Commit message format must follow the repo's commitlint config.** Per `workflow-git-cli` (loaded in Step 0):

- Must start with a conventional commit type: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Pick `chore` for hygiene/cleanup orchestrations, `refactor` for structural cleanup, `feat`/`fix` for actual feature/bug work.
- Optional scope in parens (e.g. `chore(api): ...`). Use the slot's scope name when it improves changelog readability.
- **Do NOT include the JIRA ticket ID in the commit message.** The ticket lives on the branch name and the PR title only. A commit message like `chore(api): apply CHRP-815 comment hygiene to apps/api` is wrong; the correct form is `chore(api): apply comment hygiene to apps/api`.
- Husky's commit-msg hook rejects malformed messages. If it does, fix and recommit; do not bypass.

### Step 6 - Merge worktree branches back into parent

After all slots have committed, merge each slot branch into the parent branch from the main checkout:

```bash
cd <main-repo-path>
git checkout <parent-branch>

# Merge each slot in sequence. Use chore: (or another valid conventional type),
# never "merge:" - commitlint will reject "merge:" because it is not in the
# conventional-commit type allowlist. Husky's commit-msg hook runs on merge commits.
git merge --no-ff <parent-branch>-dc-<task-tag>-slot-1 -m "chore: merge slot-1 <scope description>"
git merge --no-ff <parent-branch>-dc-<task-tag>-slot-2 -m "chore: merge slot-2 <scope description>"
git merge --no-ff <parent-branch>-dc-<task-tag>-slot-N -m "chore: merge slot-N <scope description>"
```

Use `--no-ff` so each merge creates a merge commit. This preserves the divide-and-conquer history (you can see which files came from which slot via `git log --first-parent`).

If a merge conflicts, stop and surface the conflict to the user. Do not auto-resolve. The partition plan was supposed to make scopes disjoint; a conflict means the partition was wrong.

### Step 7 - Remove worktrees and delete branches

After successful merge:

```bash
# Remove each worktree (this also unregisters it from the main repo's worktree list):
git -C <main-repo-path> worktree remove <worktrees-dir>/<repo-name>-<task-tag>/slot-1
git -C <main-repo-path> worktree remove <worktrees-dir>/<repo-name>-<task-tag>/slot-2
git -C <main-repo-path> worktree remove <worktrees-dir>/<repo-name>-<task-tag>/slot-N

# Delete the merged branches:
git -C <main-repo-path> branch -d <parent-branch>-dc-<task-tag>-slot-1
git -C <main-repo-path> branch -d <parent-branch>-dc-<task-tag>-slot-2
git -C <main-repo-path> branch -d <parent-branch>-dc-<task-tag>-slot-N

# Optional: remove the parent <repo-name>-<task-tag>/ directory if it's empty:
rmdir <worktrees-dir>/<repo-name>-<task-tag>/ 2>/dev/null || true
```

If a merge failed and a slot branch wasn't merged, do not delete that branch - leave it for the user to inspect.

### Step 8 - Cleanup async run records

There are no environments to release - each slot was just a local `opencode run` process. The async run records persist in the registry for diagnosis; they are pruned automatically over time. The sessions themselves persist in `~/.local/share/opencode/opencode.db` and remain searchable via `oc_search_sessions` after the orchestration completes.

## Agent Prompt Boilerplate (Hard Forbid Block)

Every agent dispatched into a worktree gets this boilerplate inserted into its prompt (in addition to the orchestration's normal worker prompt):

```
WORKING DIRECTORY:
- Your working directory is `<worktree-path>`. This is a git worktree, not a clone.
- The branch is already checked out for you (`<parent-branch>-dc-<task-tag>-slot-<N>`).
- Edit files in place using the `read` and `edit` tools.

HARD GIT CONSTRAINTS:
- Do NOT create branches. No `git checkout -b`, `git branch`, `git switch -c`, no creation command of any kind.
- Do NOT commit, stage, push, merge, rebase, stash, or reset.
- Do NOT switch branches. The branch you start on is the branch you finish on.
- Read-only git commands (`git status`, `git diff`, `git log`, `git show`) are fine.
- The orchestrator owns all git operations. Your job is to edit files; the orchestrator commits, merges, and cleans up.
```

The double mention (forbidding branch creation AND branch switching) is deliberate. Models sometimes interpret "no `git checkout -b`" as permission for plain `git checkout`. State both bans.

## Failure Modes and Recovery

### Agent created a branch despite the forbid block

Symptom: `git -C <worktree-path> branch --show-current` returns a name other than the slot branch.

Recovery:

1. Identify what the agent did with `git -C <worktree-path> reflog`.
2. If the agent's edits are on the rogue branch, cherry-pick them onto the slot branch.
3. Delete the rogue branch.
4. Strengthen the forbid block in the prompt for next time.

### Two worktrees ended up with the same branch checked out

Symptom: `git worktree add` fails with "branch is already checked out".

Recovery: One of the worktrees from a prior orchestration leaked. Clean up:

```bash
git -C <main-repo-path> worktree list   # find the orphan
git -C <main-repo-path> worktree remove <orphan-path>
```

If the orphan worktree path no longer exists on disk, prune the worktree registry:

```bash
git -C <main-repo-path> worktree prune
```

### Merge conflicts during Step 6

Symptom: `git merge` reports conflicts.

Diagnosis: The partition plan put two slots on files that overlap. This is a partition bug, not a merge bug. Recovery:

1. Abort the merge: `git merge --abort`
2. Inspect what each slot changed: `git diff <parent-branch>..<slot-N-branch> --stat`
3. Decide whether to (a) re-run one of the slots with a tighter scope, (b) manually resolve the conflict, or (c) drop one slot's changes.
4. Update the partition plan in the orchestration's report so the partition rubric improves for next time.

### Worktree exists but `.git/worktrees/<name>/` is stale

Symptom: `git worktree list` shows a worktree at a path that doesn't exist.

Recovery: `git -C <main-repo-path> worktree prune`. This is the standard cleanup for partially-removed worktrees.

## Integration with `/divide-and-conquer`

This skill defines the lifecycle. The `/divide-and-conquer` command's Step 5 (Prepare Per-Slot Working Directories) and Step 11 (Commit, Merge, Cleanup, Report) reference this skill when `--mode write` and `--execution parallel`. The wiring is:

- Step 3 (build partition plan) populates the `slot-<N>` names that become worktree path components
- Step 5 (prepare per-slot working directories) creates one worktree per slot (Step 2 of this skill)
- Step 6 (onboard slots) dispatches `oc_run` with `cwd: <worktree path>` and `mode: "async"` per slot (Step 3 of this skill)
- Step 7 (dispatch work runs) includes the hard-forbid boilerplate above in every prompt and dispatches work runs into the onboarded session (Step 4 of this skill)
- Step 8 (collect outputs) is followed by Step 5 of this skill (commit per worktree)
- Step 11 (commit, merge, cleanup) executes Steps 5-7 of this skill

For read-only mode, this skill does not apply. All read-only slots can use the same `cwd: <main checkout>` safely (no writes = no contention).

For write-mode + sequential execution, this skill does not apply either. The single sequential pipeline uses `cwd: <main checkout>` and commits between dispatches.

## Anti-Patterns

- Agents creating their own branches. Branches belong to the orchestrator. Strip any branch-creation operation from agent prompts and forbid it explicitly.
- One worktree shared by two agents. Defeats the entire isolation guarantee.
- Worktrees inside the main repo (`<repo>/.worktrees/`). They show up in `git status` and may be committed accidentally. Worktrees live as siblings to the repo, not inside it.
- Skipping the merge step and just pulling commits back manually. Loses the merge-commit history that lets you see which slot did what.
- Removing worktrees with `rm -rf` instead of `git worktree remove`. Leaves stale entries in the worktree registry that block future `git worktree add` calls.
- Reusing the same `<task-tag>` across concurrent orchestrations on the same repo. The branch names collide and `git worktree add` fails.
- Forgetting that each slot's `oc_run` must use `cwd: <worktree path>`, not the main repo path. If `cwd` is the main repo, the agent edits the main repo - and worktrees are pointless.
- Deleting a slot branch before merging it. Loses the agent's work. Always merge first, then delete.

## Rules

- Agents never create branches; orchestrator creates one branch per slot before dispatch
- Agents never commit, push, merge, rebase, stash, or reset
- One worktree per agent, one agent per worktree
- Worktrees live in `<repo-parent-dir>/.worktrees/<repo-name>-<task-tag>/slot-<N>/`
- Branch naming: `<parent-branch>-dc-<task-tag>-slot-<N>`
- Each slot's `oc_run` uses `cwd: <worktree path>`, not the main repo path
- Commit per worktree before merging
- Merge with `--no-ff` so each slot has a visible merge commit
- Remove worktrees with `git worktree remove`, never `rm -rf`
- Prune the worktree registry (`git worktree prune`) if a worktree directory was removed manually
