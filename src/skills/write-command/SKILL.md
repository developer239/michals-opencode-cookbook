---
name: write-command
description: Conventions for authoring OpenCode command files - frontmatter, structure, step design, tool routing, and constraint patterns.
---

# Command Writing

## Purpose

This skill defines how OpenCode command files (`.md` in `src/commands/`) are structured, written, and maintained. Commands are system prompts injected into an agent session when a user invokes a slash command. They must be precise, concrete, and operable - the agent executes them literally.

## Frontmatter

Every command file starts with YAML frontmatter followed by a `---` separator.

### Required fields

- **`description`**: One sentence, imperative mood, describing what the command does. This appears in the command list and helps the model route to the correct command.
- **`agent`**: Which agent runs this command. Almost always `orchestrator`.

### Optional fields

- **`disable-model-invocation`**: `true` when the command should not allow the agent to invoke sub-models. Useful when the command does heavy structured analysis and the orchestrator should not silently spawn extra model calls mid-workflow.
- **`user-invocable`**: `true` when the command can be invoked directly by the user (vs. only by hooks/pipelines).

### Description rules

Write in imperative mood, third person implied. Describe the end state, not the process.

Good:

- `Implement a JIRA ticket end-to-end from branch to PR`
- `Merge a PR, wait for CI, deploy to dev, and update JIRA ticket status`
- `Review a pull request or the current codebase and submit a GitHub review`

Bad:

- `This command helps you implement tickets` (first person, vague)
- `Implementation` (noun, no information)
- `Use this to review PRs and submit reviews on GitHub` (instructional, not descriptive)

## File Structure

Commands do NOT have an H1 title. The filename is the command name. The structure after frontmatter is:

1. **Opening paragraph** - 1-3 sentences establishing what the command does and the core mental model. No heading.
2. **When to Use** (optional) - concrete trigger conditions for complex or multi-purpose commands.
3. **Constraints** - non-negotiable rules, tool routing, scope boundaries.
4. **Numbered Steps** - the core workflow as `## Step N - <Name>`.
5. **Troubleshooting** (optional) - known failure modes with diagnosis and fix.
6. **Lessons from Practice** (optional) - patterns discovered through actual use.
7. **Notes** (optional) - supplementary context that doesn't fit elsewhere.

Not every command needs every section. Scale structure to complexity.

## Opening Paragraph

Immediately after frontmatter. No heading. Establishes:

- What the command does (one sentence)
- The mental model or framing (how to think about the task)
- Scope boundary (what this is NOT for, if non-obvious)

Examples from existing commands:

```
Implement a JIRA ticket. Work directly in the current project directory. Use `codebase_*` tools for research and read selectively to keep the context window healthy.
```

```
Review code. Work directly in the current project directory. Use `codebase_*` tools for research and read selectively to keep the context window healthy.
```

```
Work through one or more tasks autonomously from intake to deployed and QA-ready. Tasks are worked sequentially but all reads and background operations (CI polling, reviews, JIRA updates, Slack) run in parallel wherever possible.
```

The opening paragraph often states the execution model and context-window discipline (e.g. "work directly in the current project directory" + "use `codebase_*` tools and read selectively").

## When to Use

Include this section when:

- The command is expensive or long-running (adversarial consultation, full execution pipeline)
- The command has non-obvious trigger conditions
- The command overlaps with other commands and needs differentiation

Write as a brief paragraph followed by a bullet list of specific triggers. Skip for commands with obvious invocation context (review a PR, implement a ticket).

## Constraints Section

Almost every command has a `## Constraints` or `## Constraints (Never Violate)` section. This is the most important section after the steps - it defines what the agent must NOT do.

### Structure

Bold bullet points. Each constraint starts with `**NEVER**` or a strong directive verb.

### Common constraint patterns

**Tool routing** - which tool families to use and which to avoid:

```markdown
- **NEVER use `gh` CLI for remote GitHub operations** (PR creation, PR reads, checks, reviews, merges, workflow dispatch). Always use `github_*` MCP tools. The only acceptable use of `gh` is local workspace operations like `gh pr checkout` to switch branches.
```

**Scope boundaries** - what the command must not do:

```markdown
- **NEVER implement without reading the source material first.** Acceptance criteria and context drive scope.
- **NEVER commit without running tests.** Fix failures before proceeding.
```

**Execution model** - how the command operates:

```markdown
- Do not modify code, create commits, or push. This workflow is read-only (except for submitting the GitHub review).
```

**Tool family declarations** - positive tool routing (what TO use):

```markdown
- Use `github_*` tools for PR reads, comments, and thread resolution.
- Use `jira_*` tools for ticket reads and status updates.
- Use `codebase_*` tools for codebase discovery and impact analysis.
- Read selectively - prefer `codebase_find_definition` / `codebase_trace_calls` over broad file reads to keep the context window healthy.
```

**Skill loading directive:**

```markdown
- Load relevant skills proactively throughout the workflow - skills are cheap context and define conventions.
```

Place constraints before the numbered steps so the agent internalizes boundaries before executing.

## Numbered Steps

The core of every command. Each step is `## Step N - <Name>`.

### Naming

Step names are short, concrete, and describe the action - not the outcome.

Good: `Step 1 - Load Skills`, `Step 3 - Branch Prep`, `Step 7 - Resolve All Threads`

Bad: `Step 1 - Preparation`, `Step 3 - Setup`, `Step 7 - Finish Up`

### Step internal structure

Each step follows this pattern (not all parts required):

1. **Purpose sentence** - what this step accomplishes and why
2. **Preconditions** - what must be true before this step runs (blocking gates)
3. **Actions** - concrete tool calls, shell commands, or decisions
4. **Decision logic** - tables or conditionals for branching
5. **Verification** - how to confirm the step succeeded
6. **Error handling** - what to do when it fails

### Blocking gates

When a step must complete before the next can start, mark it explicitly:

```markdown
## Step 3 - Branch Prep (Blocking Gate)

This must complete before any codebase analysis.
```

Or inline:

```markdown
**Hard rule:** Do not run any code analysis until this step is fully completed.
```

Use blocking gates sparingly - only when parallel execution would cause real problems (wrong branch analyzed, missing dependencies, stale state).

### Skill loading as Step 1

Complex commands that involve code changes start with a skill loading step:

```markdown
## Step 1 - Load Skills (Blocking Gate)

**This step must complete before any other step begins.**

Load the baseline skills:

- `language-typescript`
- `develop-tests`
- `workflow-git-cli`
- `develop-monorepo`

Load additional skills as needed based on ticket scope.
```

The blocking gate annotation prevents the agent from starting analysis or implementation before conventions are loaded.

### Tool calls

Show concrete tool invocations with real parameter names. Use the bare tool name - do not document parameters the model already knows.

Good:

```markdown
Use `jira_get_issue` with `includeComments: true`. Extract:

- acceptance criteria
- technical scope
- risks / breaking changes
```

```markdown
Use `github_get_pr_checks` to check CI status on the PR.
```

Bad:

```markdown
Call the JIRA tool to read the ticket. The tool accepts an issue key parameter and an optional flag for comments.
```

### Shell commands

Use fenced code blocks with actual runnable commands. Include the working directory context when it matters:

```markdown
Run tests from the app directory, not the monorepo root:

\`\`\`bash
cd apps/<app>
NODE_ENV=test npx vitest run
\`\`\`
```

### Decision tables

Use markdown tables for routing decisions, classification, and conditional branching:

```markdown
| Thread state            | How to identify                     | Action         |
| ----------------------- | ----------------------------------- | -------------- |
| New - no resolver reply | Only reviewer comments              | Process as new |
| Resolved - accepted     | Has resolver reply, thread resolved | Skip           |
| Re-opened by reviewer   | Resolver reply + reviewer follow-up | Must address   |
```

Tables are preferred over nested if/else prose for decisions with 3+ branches.

### Conditional branching

When a step has 2-3 branches, use bold headers within the step:

```markdown
**If the PR is clean (mergeable, no conflicts) - skip straight to Step 4.**

**Only if the PR is dirty/conflicted**, rebase to resolve:

1. ...
```

For more complex branching, use sub-headings (`### Branch A - ...`).

## $ARGUMENTS Handling

Commands that accept user input document how to parse `$ARGUMENTS`.

### Simple case - single expected input

```markdown
If `$ARGUMENTS` is provided, use it as the JIRA ticket key. Otherwise ask the user for the ticket key (e.g. `CHRP-291`).
```

### Complex case - multiple tokens with classification

Use a parsing table:

```markdown
| Token shape        | Classification   | Examples                          |
| ------------------ | ---------------- | --------------------------------- |
| Known command name | **sub-command**  | `review`, `implement`, `resolve`  |
| GitHub PR URL      | **PR reference** | `https://github.com/.../pull/233` |
| Bare number        | **PR number**    | `233`                             |
| JIRA ticket key    | **ticket key**   | `CHRP-534`                        |
```

Always include a fallback when arguments are missing or ambiguous: "If not provided, ask the user."

### Default inference

When the command can infer the sub-command from the argument shape, document the inference rules:

```markdown
If no known sub-command is found, infer from context:

- PR number or PR URL -> default to `review`
- GitHub issue URL -> default to `comment`
- JIRA ticket key -> default to `implement`
- Nothing recognizable -> ask the user
```

## Report Section

Almost every command ends with a Report step. This tells the agent what to communicate back to the user.

### Structure

A bullet list of items to report, covering:

- What was done (artifacts created, actions taken)
- External references (PR URLs, JIRA ticket keys, deployment tags)
- Status of each component (pass/fail, sent/skipped)
- Warnings or blockers that need user attention

```markdown
## Step 11 - Report

Report to the user:

- JIRA ticket key
- Feature branch name
- PR URL
- JIRA status transition result
- Final status: DONE with PR ready, or BLOCKED with blocker details
```

### Final status pattern

End the report with a binary final status: `DONE with <success state>` or `BLOCKED with <blocker details>`. This gives the caller (user or pipeline) a clear signal.

## Troubleshooting Section

Include for commands with known failure modes that recur. Each entry has:

- **Bold heading** describing the symptom
- Explanation of why it happens
- **Fix:** concrete steps to resolve

```markdown
### Migration picks up unintended column changes

TypeORM's diff compares the entity model to the live DB. If entities were updated without a corresponding migration...

**Fix:** Review every statement in the generated migration. Remove unrelated changes.
```

Troubleshooting sections are living documentation - update them when new failure modes are discovered in practice.

## Lessons from Practice

Include for commands that have been iterated through real use. Each lesson is a concrete observation with practical advice.

### Structure

Bold heading describing the pattern, followed by 2-4 sentences of explanation.

```markdown
### Slack context is often richer than the ticket

JIRA tickets are written before the conversation is fully resolved. The Slack thread that produced the ticket often clarifies scope...
```

This section is explicitly marked as a living document that gets updated during retrospectives.

## Parallelization Guidance

Complex commands that involve multiple async operations include an explicit parallelization table:

```markdown
| Operation                          | Parallel? | Notes                             |
| ---------------------------------- | --------- | --------------------------------- |
| Reading tickets + Slack + GitHub   | Yes       | All reads, fully independent      |
| Implementing multiple tickets      | No        | Sequential - one branch at a time |
| Running review + implementing next | Yes       | Review is async, keep working     |
```

Include this when the command involves 5+ operations and the parallel/sequential distinction is non-obvious.

## Reference Data

When a command needs static reference data (test accounts, project IDs, environment URLs), put it in a clearly labeled table or section near the top - before the steps - so the agent has the data loaded before it needs it.

```markdown
## Test Accounts

| Email                  | Password         | Role  |
| ---------------------- | ---------------- | ----- |
| `demo-admin@chirp.app` | `ChirpDemo2026!` | Admin |
```

## Webhook/Pipeline Commands

Commands invoked by hooks (not directly by users) need extra care:

### Explain the execution context

State explicitly how the command is triggered and what implicit context it receives:

```markdown
This command is triggered automatically by the webhook listener when a `*resolver:*` comment is posted on a tracked PR.
```

### Document side-effect boundaries

When a command's output IS the side effect (e.g., `comment.md` where the text response becomes a GitHub comment posted by the hook), explain the mechanism and warn against bypassing it:

```markdown
Your text response IS the comment. The hook posts it for you with proper formatting. If you post directly, the comment will lack the bot marker and cause the hook to process its own output.
```

### Tool prohibition for safety

Commands in automated pipelines often need explicit tool blacklists to prevent infinite loops or unintended side effects:

```markdown
- **NEVER post comments on GitHub directly.** Do not use `github_add_pr_comment`, `github_reply_to_review_comment`, or any tool that posts to GitHub.
- **NEVER create PRs, merge, or dispatch workflows.**
```

## Anti-Patterns

- Missing frontmatter `description` - command becomes invisible in the command list
- Abstract step names like "Preparation" or "Setup" - use action verbs
- Steps without concrete tool calls or shell commands - the agent guesses instead of executing
- Documenting tool parameters the model already has from tool descriptions
- Missing error/failure handling - the agent stops or hallucinates when things go wrong
- Missing `$ARGUMENTS` fallback - the agent fails silently when arguments are absent
- Constraints placed after steps instead of before - the agent may violate them before reading
- Vague report section ("summarize what happened") - the agent produces inconsistent output
- No blocking gate annotation on steps that truly require sequential execution
- Using horizontal rules (`---`) between sections - use headings alone
- Over-prescribing parallelization for simple commands with 3-4 sequential steps
- Hardcoded project details that drift over time - build context dynamically at runtime when possible

## Rules

- Every command file starts with YAML frontmatter containing at least `description` and `agent`
- Description is one imperative sentence describing the end state
- No H1 title - the filename is the command name
- Opening paragraph (no heading) establishes what, how, and scope boundary
- Constraints section comes before numbered steps
- Steps use `## Step N - <Name>` format with concrete action verbs
- Blocking gates are explicitly annotated when parallel execution would cause problems
- Tool calls use bare tool names with real parameter examples - no parameter re-documentation
- Shell commands are fenced code blocks with working directory context
- Decision logic with 3+ branches uses markdown tables
- `$ARGUMENTS` parsing is documented with fallback behavior
- Report section ends with binary `DONE` or `BLOCKED` final status
- Troubleshooting and Lessons from Practice are living sections updated during retrospectives
- Webhook/pipeline commands document their trigger context, side-effect boundaries, and tool prohibitions
- Scale structure to complexity - simple commands skip optional sections
