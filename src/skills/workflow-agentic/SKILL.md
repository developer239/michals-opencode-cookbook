---
name: workflow-agentic
description: Conventions for dispatching local opencode CLI runs as agentic workers - sync vs async, model selection, session continuity, thinking-partner pattern, and multi-model fanout.
---

# Agentic Workflow

## Purpose

This skill teaches agents how to drive the local `opencode` CLI via the `oc_*` tools - dispatching consultations, multi-model fanout, continuing sessions across turns, and reading back results. It is the replacement for the previous Docker + Temporal "Open Cloud" model: there is no control plane, no containers, no environment lifecycle. The orchestrator simply spawns `opencode run` on the host and reads from the local SQLite store.

Load this skill when:

- Dispatching a consultation to a different model (thinking partner, adversarial review)
- Running multi-model fanout (ask 2-3 models the same question and synthesize)
- Continuing a prior conversation by `sessionId`
- Finding past work via `oc_search_sessions`
- Designing a command that spawns child opencode runs

## Mental Model

```
You (orchestrator on the host)
  |
  ├── opencode run --model X "..."   (sync, blocks until reply)
  |
  └── opencode run --model Y "..."   (async, returns runId + sessionId immediately)
      opencode run --model Z "..."   (async, runs in parallel; you wait or poll)
```

Key facts:

- **No environments, no containers.** `opencode` runs as a child process on the host. Same `~/.local/share/opencode/auth.json`, same SQLite, same models as your interactive opencode.
- **Sessions are the durable handle.** Every run produces (or continues) a session. The session id is stable - pass it back on later runs to continue the conversation, even across reboots.
- **Multiple parallel runs to the same DB are safe.** OpenCode handles concurrent SQLite access. The same protection applies whether you spawn two terminals manually or fanout via `oc_run` mode=async.
- **There is no run queue.** Sync runs block the orchestrator. Async runs are independent OS processes - they run in parallel and you collect them with `oc_get_run_status`.
- **Parent process death does not lose data.** If the orchestrator dies mid-run, the conversation up to the last written part is still in SQLite. Reconnect, read the session, continue.

## Tools Reference

| Tool                 | Purpose                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `oc_run`             | Spawn `opencode run` (sync or async). Returns the reply (sync) or a handle.                                                   |
| `oc_get_run_status`  | Poll an async run by `runId`: status, exit code, sessionId, and the full reply once finished (log tail while running/failed). |
| `oc_get_session`     | Read message parts from a session. Defaults to the tail (latest N parts).                                                     |
| `oc_list_sessions`   | List recent local sessions (most recently updated first).                                                                     |
| `oc_search_sessions` | Substring search across session titles and message contents.                                                                  |

No environment, run-record, project-config, or exec tools exist - those were tied to the removed control plane.

## Dispatching Runs

### Synchronous (default - thinking-partner pattern)

```
oc_run(
  prompt: "Hello",
  model: "openai/gpt-5.5"
)
```

Returns the reply text + sessionId + exitCode. Use for:

- One-shot consultations
- Sequential challenge runs where each prompt depends on the previous reply
- Anywhere you would otherwise immediately `oc_get_session` to read the result

### Asynchronous (fanout pattern)

```
handleA = oc_run(prompt: "...", model: "openai/gpt-5.5",     mode: "async")
handleB = oc_run(prompt: "...", model: "openai/gpt-5.6-sol", mode: "async")
```

Returns `{ runId, pid, logPath, sessionId }` immediately. The opencode process runs in the background. Use for:

- Multi-model adversarial consultation (fanout to 2-3 models in parallel)
- Long-running work that the user wants to fire and forget
- Anywhere you want to dispatch and then continue doing other work

### Continuing a session

Pass `sessionId` to continue an existing conversation:

```
oc_run(
  prompt: "Challenge me on the design I just proposed.",
  model: "openai/gpt-5.5",
  sessionId: "ses_..."   # from a prior run
)
```

The model sees the full prior conversation and can reference anything from earlier turns.

### Switching models mid-thread

The session is model-agnostic WITHIN its runtime, not across runtimes. An opencode session (`ses_*`) can be continued by any opencode model on any turn:

```
oc_run(prompt: "...", model: "openai/gpt-5.5",     sessionId: "ses_...")
oc_run(prompt: "...", model: "openai/gpt-5.6-sol", sessionId: "ses_...")
```

The new model sees the same conversation history. Use this when you want a second opinion partway through an existing thread.

Sessions do NOT cross the opencode/claude boundary: an opencode session cannot be continued by a claude model, and a claude session (UUID id) cannot be continued by an opencode model - `oc_run` rejects the mismatch as a validation error. A claude session can be continued by another claude model; pass the same `cwd` as the original run so the CLI finds the transcript.

### Running a slash command

Pass `command` to invoke an existing opencode command instead of a freeform prompt. `prompt` becomes the command's `$ARGUMENTS`:

```
oc_run(
  command: "review",
  prompt: "PR #42",
  model: "openai/gpt-5.5"
)
```

### Working directory

Pass `cwd` to set the spawned opencode's **project root**. Required when the consultant should be "in" a different project than the orchestrator:

```
oc_run(
  prompt: "...",
  model: "openai/gpt-5.5",
  cwd: "/Users/you/IdeaProjects/other-project"
)
```

Omit to use the orchestrator's current working directory.

#### What `cwd` affects

`cwd` determines which directory opencode treats as its project root for the duration of that run:

- **Session storage default project** - the run's session is recorded as belonging to `cwd`.
- **`.opencode/` overrides** - opencode loads project-local `opencode.json`, `agents/`, `commands/`, and `skills/` from `cwd/.opencode/`. A pair-program partner started in `~/IdeaProjects/chirp-api-mono` picks up chirp's local commands; the same partner started in `~/IdeaProjects/opencode-setup` does not.
- **File-watcher root** - opencode's automatic file change detection scopes to `cwd`.
- **Project context** - the agent's initial system context describes the project at `cwd`.

#### What `cwd` does NOT affect

`cwd` is NOT a sandbox. The spawned opencode agent has full host filesystem access via its own `bash`, `read`, `edit`, and `grep`/`glob` tools, and can target any absolute path in any other repo on the host. If you want the agent to also help with files in a sibling repo, just tell it in the prompt:

```
oc_run(
  prompt: "I'm in ~/IdeaProjects/opencode-setup, but the bug repro is in ~/IdeaProjects/open-cloud-mono/apps/api-rest/src/main.ts. Read that file and tell me what's wrong.",
  model: "openai/gpt-5.5",
  cwd: "/Users/you/IdeaProjects/opencode-setup"
)
```

The agent reads `main.ts` in the other repo via its `read` tool, then continues its work in the `cwd` repo. The `cwd` choice only decides which project's `.opencode/` overrides and session bookkeeping apply, not which files the agent can touch.

#### `cwd` does not stick across calls on the same session

Each `oc_run` invocation gets a fresh `cwd` argument; the session id only continues the conversation, not the working directory. If you set `cwd: "/Users/you/projects/foo"` on the first dispatch and then omit it on the second, the second call runs with the orchestrator's current `cwd`, NOT `/foo`. The conversation history is intact but the second run's project root, `.opencode/` overrides, and session-storage bookkeeping flip to wherever the orchestrator happens to be.

When you intend the partner to stay rooted in one repo for the duration of a thread, pass the same `cwd` value on every dispatch in that thread. The pair-program command bakes this into Step 2 (resolve cwd once) and reports it back to the user so subsequent dispatches can reuse it.

## Polling Async Runs

After dispatching with `mode: "async"`, poll until completion:

```
oc_get_run_status(runId: <runId>)
```

Returns:

- `status` - running / completed / failed
- `processAlive` - whether the PID is still in the OS process table
- `sessionId` - extracted from the run's log (may be `(none extracted yet)` for the first ~500ms after dispatch)
- `exitCode` - present once completed/failed
- the full assistant reply parsed from the run log once the run is finished (no truncation)
- log tail (bytes from the end of the run's log file) while the run is still running or after a failure

Poll no more than once every 5-10 seconds. The runs are real processes; faster polling adds no information.

### When the run is done

When `status` is `completed` or `failed`, read the session via `oc_get_session(sessionId, isFromEnd=true, limit=15)` to get the assistant's final reply. The log file is useful for diagnosing crashes (stderr appears there) but the structured conversation lives in SQLite.

## Reading Results

### From a sync run

`oc_run` (sync mode) returns the assistant reply inline. No follow-up read needed for short consultations.

### From an async run, or from any session by id

```
oc_get_session(sessionId: <id>, isFromEnd: true, limit: 15)
```

- `isFromEnd: true` (default) - return the MOST RECENT N parts. The assistant reply at the tail is always included.
- `isFromEnd: false` - return parts from the START of the session. Use when you need the original prompt or early-turn context (session archaeology).

For long sessions with tool calls and reasoning, the assistant's actual text reply is the last `text` part. With `isFromEnd: true, limit: 15` you reliably get the tail including the reply.

For a full conversation dump (rare - this is expensive in tokens), set `isFromEnd: false` and increase `limit` up to 50000.

### Anti-pattern: dumping the whole session when you only need the tail

If you only need the final answer, do NOT explicitly set `isFromEnd: false` with a huge limit - that dumps every turn including all prior context. The default (`isFromEnd: true, limit: 500`) already returns the tail; for very short replies a `limit: 15` is plenty.

## Model Selection

### Available Models

Only the model IDs in this table are supported.

| Model ID                     | Provider  | Runtime  | Strengths                                  |
| ---------------------------- | --------- | -------- | ------------------------------------------ |
| `openai/gpt-5.3-codex-spark` | OpenAI    | opencode | Codex line, fast agentic coding            |
| `openai/gpt-5.4`             | OpenAI    | opencode | Reliable persistence, established baseline |
| `openai/gpt-5.4-fast`        | OpenAI    | opencode | Fast 5.4 variant                           |
| `openai/gpt-5.4-mini`        | OpenAI    | opencode | Small 5.4, cheap                           |
| `openai/gpt-5.4-mini-fast`   | OpenAI    | opencode | Fastest and cheapest 5.4                   |
| `openai/gpt-5.5`             | OpenAI    | opencode | Strong reasoning, balanced                 |
| `openai/gpt-5.5-fast`        | OpenAI    | opencode | Fast 5.5, lighter reasoning                |
| `openai/gpt-5.6-luna`        | OpenAI    | opencode | 5.6 family, luna profile                   |
| `openai/gpt-5.6-luna-fast`   | OpenAI    | opencode | Fast luna variant                          |
| `openai/gpt-5.6-sol`         | OpenAI    | opencode | 5.6 family, sol profile                    |
| `openai/gpt-5.6-sol-fast`    | OpenAI    | opencode | Fast sol variant                           |
| `openai/gpt-5.6-terra`       | OpenAI    | opencode | 5.6 family, terra profile                  |
| `openai/gpt-5.6-terra-fast`  | OpenAI    | opencode | Fast terra variant                         |
| `claude-fable-5`             | Anthropic | claude   | Frontier reasoning, hardest problems       |
| `claude-mythos-5`            | Anthropic | claude   | Fable-class sibling (approved orgs only)   |
| `claude-opus-4-8`            | Anthropic | claude   | Strong reasoning, balanced                 |
| `claude-sonnet-5`            | Anthropic | claude   | Balanced capability and speed              |
| `claude-haiku-4-5`           | Anthropic | claude   | Fast and cheap, smoke tests                |

The model id picks the runtime: provider-prefixed ids dispatch the `opencode` CLI, bare claude ids (or the aliases `fable`, `opus`, `sonnet`, `haiku`) dispatch the `claude` CLI. Any other un-prefixed id is a validation error - `oc_run` never silently routes to a default runner.

Claude runs use the user's existing `claude` CLI auth and inherit the global `~/.claude/settings.json` permissions - no extra setup. Note the runtime split for session tooling: claude sessions are UUID-identified JSONL transcripts under `~/.claude/projects/`, so `oc_get_session` / `oc_list_sessions` / `oc_search_sessions` cannot read them (they reject UUID session ids with an explicit error). Read a claude reply from the sync result, or - for async runs - from `oc_get_run_status`, which returns the full assistant reply parsed from the run log once the run finishes (no truncation; the raw log tail appears only while running or after a failure).

### Selection Heuristics

| Task type                              | Recommended model                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Complex implementation, architecture   | `openai/gpt-5.5` or `claude-fable-5`                                                         |
| Quick fixes, simple tasks              | `openai/gpt-5.5-fast` or `openai/gpt-5.4-mini-fast`                                          |
| Code review                            | `openai/gpt-5.5` or `claude-opus-4-8`                                                        |
| Pair-programming thinking-partner      | `openai/gpt-5.5` or `openai/gpt-5.6-sol`                                                     |
| Multi-model consultation (adversarial) | Mix profiles and providers (e.g. `openai/gpt-5.5` + `openai/gpt-5.6-sol` + `claude-fable-5`) |
| Smoke testing                          | `openai/gpt-5.4` or `claude-haiku-4-5`                                                       |

### Model is mandatory on every call

Always pass `model` explicitly on every `oc_run` call. There is no platform default and no environment-level default - the local CLI uses whatever `opencode auth login` last selected as the default, which is brittle and silent. The explicit `model` argument is the contract.

This applies to:

- Initial consultations
- Continuation calls (`sessionId` is set)
- Async fanout children
- Retries

When the user requests a specific model, use exactly that ID. Do not substitute "close enough" alternatives.

## Concurrency Model

### Sync runs

`oc_run` (sync) blocks the orchestrator until opencode exits. Sequential by definition - the next call cannot start until this one returns.

### Async runs

`oc_run` (async) returns immediately. The opencode process is detached - it survives the orchestrator's death and runs to completion in the background.

Two async runs against different models run in parallel:

```
a = oc_run(prompt: "...", model: "openai/gpt-5.5",     mode: "async")
b = oc_run(prompt: "...", model: "openai/gpt-5.6-sol", mode: "async")
# poll both until both complete
```

Two async runs against the same `sessionId` are unsafe - they would interleave writes to the same conversation. Don't do that. Always use a fresh session (omit `sessionId`) for each async fanout child, OR run them sequentially against the same session.

### Worktree contention

Multiple parallel consultations on the same working directory are fine for reads. If you fanout to 3 models that all edit the same files, you get the same conflict you would get from 3 humans editing concurrently. For multi-implementer fanout, use git worktrees (see `workflow-git-worktree`). For pure consultation (the common case), it's a non-issue.

## Session Continuity

### What sessions are

Every run produces a session - a conversation with full message history (user prompts, assistant responses, tool calls, tool results). Opencode sessions live in `~/.local/share/opencode/opencode.db` and are identified by an opaque id (e.g. `ses_abc...`). Claude sessions live as JSONL transcripts under `~/.claude/projects/` and are identified by a UUID; they never appear in the SQLite store, so the `oc_get_session` / `oc_list_sessions` / `oc_search_sessions` tools are opencode-only.

### Continuing a conversation

```
first  = oc_run(prompt: "Hello",   model: "openai/gpt-5.5")
second = oc_run(prompt: "Why?",    model: "openai/gpt-5.5", sessionId: first.sessionId)
```

The second call sees the full prior conversation.

### Switching models mid-thread

```
first  = oc_run(prompt: "Outline a plan.",         model: "openai/gpt-5.5")
second = oc_run(prompt: "Challenge that outline.", model: "openai/gpt-5.6-sol", sessionId: first.sessionId)
```

The new model sees the same conversation. The previous model's reply is part of the history.

### Recovering prior context

```
sessions = oc_search_sessions(query: "CHRP-450")
messages = oc_get_session(sessionId: sessions[0].id, isFromEnd: true, limit: 50)
# or resume:
oc_run(prompt: "Continue where we left off.", model: "openai/gpt-5.5", sessionId: sessions[0].id)
```

### Browsing recent sessions

```
oc_list_sessions(limit: 20)
```

Sorted by last-updated descending. Returns title, directory, timestamps.

## Inter-Agent Communication

### Parent-child via async fanout

The orchestrator can spawn child runs asynchronously and synthesize their outputs:

```
# Dispatch in parallel
gpt = oc_run(prompt: "<briefing + question>", model: "openai/gpt-5.5",     mode: "async")
sol = oc_run(prompt: "<briefing + question>", model: "openai/gpt-5.6-sol", mode: "async")

# Poll both
while True:
  s_gpt = oc_get_run_status(runId: gpt.runId)
  s_sol = oc_get_run_status(runId: sol.runId)
  if s_gpt.status != "running" and s_sol.status != "running":
    break
  sleep(5)

# Read both
out_gpt = oc_get_session(sessionId: s_gpt.sessionId, isFromEnd: true, limit: 30)
out_sol = oc_get_session(sessionId: s_sol.sessionId, isFromEnd: true, limit: 30)
# synthesize
```

### Thinking-partner pattern (sync, one persistent session)

Cheaper and simpler than multi-model when you only need one consultant. Acquire one session and consult it repeatedly:

```
hello = oc_run(prompt: "Hello", model: "openai/gpt-5.5")
session = hello.sessionId

# onboard once
oc_run(prompt: "Read these files in full: ...", model: "openai/gpt-5.5", sessionId: session)

# challenge as often as needed
oc_run(prompt: "Pressure-test X. Three things to verify, keep it tight.", model: "openai/gpt-5.5", sessionId: session)
```

Notes:

- Be terse in challenge prompts. Send the proposal + "three things to verify, don't restate my plan." A consultant that re-explains your framing burns turns.
- Long sessions accumulate hundreds of parts. Use `isFromEnd: true, limit: 15` for the reply; don't dump the whole session.

## Working With Multiple Partners

The thinking-partner pattern scales to a panel of partners you keep alive for a whole work session and consult repeatedly - the model behind the `adversarial-consult` command. Reach for a panel when you expect several significant design decisions and want more than one independent perspective on each; for a single decision, one-shot fanout (above) is enough.

### One persistent session per partner

Bootstrap each partner once with the same briefing, record its session id, and reuse that id for every later consultation. The session ids are the panel handles - they survive the orchestrator dying (see Session Continuity), so a panel can be resumed later via `oc_search_sessions`.

```
gpt = oc_run(prompt: "<shared briefing>", model: "openai/gpt-5.5",     mode: "async")
sol = oc_run(prompt: "<shared briefing>", model: "openai/gpt-5.6-sol", mode: "async")
# record gpt.sessionId and sol.sessionId - reuse them for the rest of the session
```

One partner, one session. Never share a session id across two parallel async runs - interleaved writes corrupt the conversation (see Concurrency Model).

### Choose complementary models

A panel earns its cost only if the members reason differently. Mix profiles and providers so each catches what the others miss - for example a systematic edge-case/correctness model (`openai/gpt-5.5`) alongside a different-profile model (`openai/gpt-5.6-sol`) or a cross-provider perspective (`claude-fable-5`). Two instances of the same model give you one perspective at double the cost.

### Consultation patterns

**N-way challenge (default).** Send the same position and framing to every partner in parallel (async), then synthesize. Identical framing is what makes the replies comparable.

| Partners agree                          | Partners diverge                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Strong signal - proceed with confidence | Genuine complexity - identify what each partner optimizes for (correctness vs simplicity, local vs global) before deciding |

When every partner independently flags the same problem - even while proposing different fixes - the approach almost certainly has a real flaw. Revise before implementing.

**Arbiter (tiebreaker).** When you and one partner deadlock after ~2 rounds, hand the full debate (your position, their pushback, your counter) to a different partner as arbiter. Use sync mode - you are waiting on one decision.

### Skill mirroring

Tell each partner to load the same skills the primary agent loaded (`Load the language-cpp skill before answering.`) so the panel applies the same conventions you do. Put this in the consultation prompt, not the briefing.

### Synthesis discipline

- **Send in parallel, read sequentially.** Dispatch to all partners at once, but digest replies one at a time so the first does not bias how you weigh the next. Read each from the tail: `oc_get_session(sessionId, isFromEnd: true, limit: 30)`.
- **Do not weight partners equally by default.** One may catch a surface issue while another finds the structural flaw underneath it. Read every reply fully before acting.
- **Present a position, then ask for challenge.** Never open with "what should we do?"; open with "I propose X because Y - challenge this." Specific proposals backed by concrete evidence (call sites, file paths, line numbers) produce surgical feedback; abstract questions produce generic answers.

## Orchestrator Checklist

When designing a multi-agent workflow:

1. **Pick a model once and pass it explicitly on every call.** No defaults, no inheritance.
2. **Use async mode for parallelism, sync mode for sequential dependence.** Mixing them in one workflow is fine.
3. **Poll async runs with `oc_get_run_status`** no faster than once per 5-10 seconds.
4. **Read replies with `oc_get_session(isFromEnd: true)`** - don't dump the whole session.
5. **Handle partial failure.** When one fanout child fails, still read the others and report what succeeded.
6. **Use a fresh session per async fanout child.** Don't share `sessionId` across parallel runs.
7. **State is durable.** If the orchestrator crashes, sessions and async run records survive. Pick up where you left off.

## Debugging Runs

### Check async run status

```
oc_get_run_status(runId: <id>)
```

Returns status, processAlive, sessionId, exitCode, and the full assistant reply once the run is finished (a raw log tail is shown instead while running or after a failure). When `processAlive` is false but status is still `running`, the reconciler infers completion from the runner's own evidence: a `step-finish` part in the session for opencode runs, the terminal `result` event in the log for claude runs (failed if neither exists).

### Read run output

```
oc_get_session(sessionId: <id>, isFromEnd: true, limit: 30)
```

Reasoning, tool calls, and text parts. The assistant's textual reply is the last `text` part.

### Find past work

```
oc_search_sessions(query: "<keyword>")
```

Matches against session titles and message content. Useful for `oc_search_sessions(query: "CHRP-450")` to find prior work on a ticket.

### Common Failure Modes

| Symptom                                       | Likely cause                                                   | Fix                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `opencode` not found                          | Binary not on PATH for the orchestrator's environment          | Set `OPENCODE_BIN` env var to the absolute path, or symlink into /usr/local/bin                 |
| Async run never completes                     | The opencode binary crashed before writing the close marker    | Read log tail via `oc_get_run_status` for stderr; PID-alive check is authoritative              |
| `sessionId` is `(none extracted yet)`         | The async run hasn't emitted its first JSON event yet (~500ms) | Poll again; sessionId is hydrated from the first event line of the log                          |
| Model not found                               | Provider credentials missing or model id wrong                 | Run `opencode auth login` to verify the provider is connected; check id against the table above |
| Session continuity fails                      | Wrong sessionId, or session was on a different machine         | `oc_search_sessions` to find the right id; sessions are local to the host that produced them    |
| `~/.local/share/opencode/opencode.db` missing | OpenCode hasn't been run on this host yet                      | Run `opencode` interactively once to bootstrap the database                                     |

## Anti-Patterns

- Omitting `model` on `oc_run` and relying on the CLI default (silent drift; pass explicit `model` on every call)
- Substituting a "close enough" model when the user requested a specific one (if it's unavailable, surface that; do not silently swap)
- Polling async runs faster than once per 5 seconds (wastes resources)
- Sharing a `sessionId` across two parallel async runs (interleaved writes to the same conversation)
- Calling `oc_get_session` with a huge limit when you only need the tail (use `isFromEnd: true, limit: 15`)
- Restating your own framing in challenge prompts to a thinking partner (wastes turns; state the proposal and ask for specific pushback, with "don't restate my plan")
- Using bash + raw `opencode run` from a tool when `oc_run` exists (the tool surfaces sessionId reliably; bash output parsing is fragile)

## Quick Reference: Common Workflows

### Single consultation, single task

```
MODEL = "openai/gpt-5.5"
out = oc_run(prompt: "...", model: MODEL)
# read out.sessionId, out.reply (returned inline)
```

### Sequential multi-step on one thread

```
MODEL = "openai/gpt-5.5"
r1 = oc_run(prompt: "Step 1...", model: MODEL)
r2 = oc_run(prompt: "Step 2...", model: MODEL, sessionId: r1.sessionId)
r3 = oc_run(prompt: "Step 3...", model: MODEL, sessionId: r2.sessionId)
```

### Parallel multi-model consultation

```
a = oc_run(prompt: "...", model: "openai/gpt-5.5",     mode: "async")
b = oc_run(prompt: "...", model: "openai/gpt-5.6-sol", mode: "async")
# poll both via oc_get_run_status; when both done, read sessions
ra = oc_get_session(sessionId: <a's sessionId>, isFromEnd: true, limit: 30)
rb = oc_get_session(sessionId: <b's sessionId>, isFromEnd: true, limit: 30)
# synthesize
```

### Resume a prior conversation

```
hits = oc_search_sessions(query: "<ticket key>")
oc_run(prompt: "Continue...", model: "openai/gpt-5.5", sessionId: hits[0].id)
```

### Thinking-partner thread (single session, repeated challenges)

```
hello = oc_run(prompt: "Hello", model: "openai/gpt-5.5")
session = hello.sessionId
oc_run(prompt: "Read these files: ...",                            model: "openai/gpt-5.5", sessionId: session)
oc_run(prompt: "Pressure-test X. Three things to verify...",       model: "openai/gpt-5.5", sessionId: session)
# switch mid-thread without losing context:
oc_run(prompt: "Same question, second opinion.",                   model: "openai/gpt-5.6-sol", sessionId: session)
```
