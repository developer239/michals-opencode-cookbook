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

- `Spawn a thinking-partner via a local opencode run and report its session id`
- `Review the current codebase and report findings ranked by severity`
- `Generate a project onboarding summary from the codebase structure`

Bad:

- `This command helps you review code` (first person, vague)
- `Review` (noun, no information)
- `Use this to review the codebase and report findings` (instructional, not descriptive)

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

Examples:

```
Review code. Work directly in the current project directory. Use `codebase_*` tools for research and read selectively to keep the context window healthy.
```

```
Dispatch a single local opencode run against the selected model with "Hello 👋" to establish a stable session, then report the session id back to the user so they can dispatch follow-up challenge runs into the same thread for the rest of the task.
```

The opening paragraph often states the execution model and context-window discipline (e.g. "work directly in the current project directory" + "use `codebase_*` tools and read selectively").

## When to Use

Include this section when:

- The command is expensive or long-running (multi-model consultation, full execution pipeline)
- The command has non-obvious trigger conditions
- The command overlaps with other commands and needs differentiation

Write as a brief paragraph followed by a bullet list of specific triggers. Skip for commands with obvious invocation context.

## Constraints Section

Almost every command has a `## Constraints` or `## Constraints (Never Violate)` section. This is the most important section after the steps - it defines what the agent must NOT do.

### Structure

Bold bullet points. Each constraint starts with `**NEVER**` or a strong directive verb.

### Common constraint patterns

**Tool routing** - which tool families to use and which to avoid:

```markdown
- **NEVER shell out to `opencode run` directly.** Always use the `oc_*` tools - they surface `sessionId` reliably; bash output parsing is fragile.
```

**Scope boundaries** - what the command must not do:

```markdown
- **NEVER implement without reading the source material first.** Acceptance criteria and context drive scope.
- **NEVER commit without running tests.** Fix failures before proceeding.
```

**Execution model** - how the command operates:

```markdown
- Do not modify code, create commits, or push. This workflow is read-only.
```

**Tool family declarations** - positive tool routing (what TO use):

```markdown
- Use `oc_*` tools for dispatching consultations and reading session replies.
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

Good: `Step 1 - Load Skills`, `Step 2 - Resolve the Working Directory`, `Step 3 - Warm the Partner`

Bad: `Step 1 - Preparation`, `Step 2 - Setup`, `Step 3 - Finish Up`

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
## Step 2 - Resolve the Working Directory (Blocking Gate)

This must complete before any dispatch.
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
- `workflow-git-cli`

Load additional skills as needed based on task scope.
```

The blocking gate annotation prevents the agent from starting analysis or implementation before conventions are loaded.

### Tool calls

Show concrete tool invocations with real parameter names. Use the bare tool name - do not document parameters the model already knows.

Good:

```markdown
Use `oc_get_session` with `isFromEnd: true, limit: 15`. Extract:

- the assistant's final reply
- the session id for follow-up dispatches
```

```markdown
Use `codebase_project_structure` with `maxDepth: 2` to detect the layout.
```

Bad:

```markdown
Call the session tool to read the conversation. The tool accepts a session id parameter and an optional limit.
```

### Shell commands

Use fenced code blocks with actual runnable commands. Include the working directory context when it matters:

```markdown
Resolve the repository root, not the current subdirectory:

\`\`\`bash
git rev-parse --show-toplevel
\`\`\`
```

### Decision tables

Use markdown tables for routing decisions, classification, and conditional branching:

```markdown
| Run state     | How to identify                     | Action                 |
| ------------- | ----------------------------------- | ---------------------- |
| Still running | `status: "running"`                 | Poll again later       |
| Completed     | Terminal status, exit code 0        | Read the session reply |
| Failed        | Terminal status, non-zero exit code | Surface the log tail   |
```

Tables are preferred over nested if/else prose for decisions with 3+ branches.

### Conditional branching

When a step has 2-3 branches, use bold headers within the step:

```markdown
**If the run completed cleanly - skip straight to Step 4.**

**Only if the run failed**, read the log tail and diagnose:

1. ...
```

For more complex branching, use sub-headings (`### Branch A - ...`).

## $ARGUMENTS Handling

Commands that accept user input document how to parse `$ARGUMENTS`.

### Simple case - single expected input

```markdown
If `$ARGUMENTS` is provided, resolve it as the partner model token. Otherwise use the default model.
```

### Complex case - multiple tokens with classification

Use a parsing table:

```markdown
| Token shape   | Classification        | Examples                       |
| ------------- | --------------------- | ------------------------------ |
| Model alias   | **model**             | `fable`, `gpt-5.6-sol`         |
| Session id    | **session**           | `ses_abc123...`                |
| Absolute path | **working directory** | `/Users/you/IdeaProjects/repo` |
```

Always include a fallback when arguments are missing or ambiguous: "If not provided, ask the user."

### Default inference

When the command can infer the sub-command from the argument shape, document the inference rules:

```markdown
If no known sub-command is found, infer from context:

- Model alias -> use as the partner model
- `ses_*` id -> continue that session
- Absolute path -> use as the working directory
- Nothing recognizable -> ask the user
```

## Report Section

Almost every command ends with a Report step. This tells the agent what to communicate back to the user.

### Structure

A bullet list of items to report, covering:

- What was done (artifacts created, actions taken)
- External references (session ids, file paths, branch names)
- Status of each component (pass/fail, sent/skipped)
- Warnings or blockers that need user attention

```markdown
## Step 4 - Report

Report to the user:

- session id
- working directory the partner is rooted in
- resolved model id
- Final status: DONE with partner ready, or BLOCKED with blocker details
```

### Final status pattern

End the report with a binary final status: `DONE with <success state>` or `BLOCKED with <blocker details>`. This gives the caller (user or pipeline) a clear signal.

## Troubleshooting Section

Include for commands with known failure modes that recur. Each entry has:

- **Bold heading** describing the symptom
- Explanation of why it happens
- **Fix:** concrete steps to resolve

```markdown
### Dispatch fails with an unknown model error

`oc_run` rejects un-prefixed model ids that are not claude models - nothing routes to a default runner silently.

**Fix:** Pass a provider-prefixed id (e.g. `openai/gpt-5.5`) or a bare claude id (e.g. `claude-fable-5`).
```

Troubleshooting sections are living documentation - update them when new failure modes are discovered in practice.

## Lessons from Practice

Include for commands that have been iterated through real use. Each lesson is a concrete observation with practical advice.

### Structure

Bold heading describing the pattern, followed by 2-4 sentences of explanation.

```markdown
### Warm the partner before the first real question

A short "Hello" warm-up run establishes the session id cheaply. Dispatching the full briefing as the first call couples session creation with a long-running reply, so a dispatch failure costs the whole briefing instead of a two-second retry.
```

This section is explicitly marked as a living document that gets updated during retrospectives.

## Parallelization Guidance

Complex commands that involve multiple async operations include an explicit parallelization table:

```markdown
| Operation                               | Parallel? | Notes                                  |
| --------------------------------------- | --------- | -------------------------------------- |
| Fanout consultations to multiple models | Yes       | Independent async runs, fresh sessions |
| Sequential challenges on one session    | No        | Same `sessionId` must never interleave |
| Codebase reads while a run is in flight | Yes       | Local reads are fully independent      |
```

Include this when the command involves 5+ operations and the parallel/sequential distinction is non-obvious.

## Reference Data

When a command needs static reference data (test accounts, project IDs, environment URLs), put it in a clearly labeled table or section near the top - before the steps - so the agent has the data loaded before it needs it. Never inline real credentials - point at the secret store.

```markdown
## Test Accounts

| Email                    | Password                | Role  |
| ------------------------ | ----------------------- | ----- |
| `demo-admin@example.com` | in the password manager | Admin |
```

## Webhook/Pipeline Commands

Commands invoked by hooks (not directly by users) need extra care:

### Explain the execution context

State explicitly how the command is triggered and what implicit context it receives:

```markdown
This command is triggered automatically by the webhook listener when a tracked event fires.
```

### Document side-effect boundaries

When a command's output IS the side effect (e.g., the text response becomes a comment posted by the hook), explain the mechanism and warn against bypassing it:

```markdown
Your text response IS the comment. The hook posts it for you with proper formatting. If you post directly, the comment will lack the bot marker and cause the hook to process its own output.
```

### Tool prohibition for safety

Commands in automated pipelines often need explicit tool blacklists to prevent infinite loops or unintended side effects:

```markdown
- **NEVER post to the external service directly.** Do not call any tool that writes to the service the hook manages - the hook owns that side effect.
- **NEVER create, merge, or dispatch anything the pipeline itself is responsible for.**
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
