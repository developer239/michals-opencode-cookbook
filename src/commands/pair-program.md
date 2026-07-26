description: Spawn a thinking-partner via a local opencode run (GPT 5.5 by default, GLM 5.2 selectable), warm it up with "Hello 👋", and report the session id so follow-up consultations land in the same thread
agent: orchestrator

Dispatch a single local opencode run against the selected model (`openai/gpt-5.5` by default, or `zai-coding-plan/glm-5.2`) with "Hello 👋" to establish a stable session, then report the session id back to the user so they can dispatch follow-up challenge runs into the same thread for the rest of the task. The partner runs on the host (no Docker, no environments) using the orchestrator's own `~/.local/share/opencode/auth.json` credentials. Both models are available with no extra setup - the z.ai coding plan provider ships with the standard opencode install and shares the same credentials as every other provider. The partner is rooted in the working directory you resolve in Step 2 and pass on every dispatch via `cwd`.

## When to Use

Use this command at the start of a task when you expect to consult a second model repeatedly throughout the work (not a one-shot question). The session persists for the duration of the task, accumulates context organically across challenge runs, and is cheaper than spawning a fresh run per consultation.

Do not use this command for:

- A single one-shot question (just call `oc_run` directly)
- Adversarial multi-model consultation across 3+ providers (use the multi-model pattern with `oc_run mode=async`)
- Codebase research that does not need back-and-forth (use `codebase_*` tools directly in the primary agent)

## Constraints

- **Use the `oc_*` tools** for the opencode dispatch. Do not shell out to `opencode run` directly.
- **Always pass `model` explicitly** on every `oc_run` call - the CLI default is not stable.
- **Resolve the model from `$ARGUMENTS` before dispatch** (see Model Selection). If the user names a model that is not in the table, ask - do not substitute a "close enough" alternative.
- **Wait for the Hello run to complete** (sync mode) so the session id is available before reporting.
- **Do not invent a session id** - it comes back from the completed `oc_run` call.

## Model Selection

Resolve the partner model from `$ARGUMENTS` before dispatching. Both options are first-class and require no special setup.

| `$ARGUMENTS` token          | Resolved model            | Notes                      |
| --------------------------- | ------------------------- | -------------------------- |
| (none)                      | `openai/gpt-5.5`          | Default thinking-partner   |
| `gpt`, `gpt-5.5`            | `openai/gpt-5.5`          | OpenAI thinking-partner    |
| `glm`, `glm-5.2`, `glm 5.2` | `zai-coding-plan/glm-5.2` | GLM 5.2 (z.ai coding plan) |

If `$ARGUMENTS` names any other model that is not in the table, ask the user rather than guessing. Carry the resolved model id into Step 3 and echo it back in the Step 4 report.

## Step 1 - Load the agentic skill (Blocking Gate)

Load the `workflow-agentic` skill. It defines the thinking-partner pattern and the `oc_get_session` conventions you will use to read replies.

## Step 2 - Resolve the partner's working directory

Determine which repository the partner should be rooted in. The default is the repo containing the orchestrator's `$PWD`:

```bash
git rev-parse --show-toplevel
```

If the orchestrator is not inside a git tree, ask the user for the absolute path explicitly. Do not guess.

This path becomes the partner's `cwd` on the first dispatch. It sets the partner's **project root** - the directory opencode treats as the current project for `.opencode/` overrides (project-local commands, skills, agents), session bookkeeping, and the file-watcher. The partner can still read or edit files in any other repo via absolute paths in the prompt; `cwd` does not sandbox it. It only picks which project it's "in."

**`cwd` is per-call and not inherited from the session** - if you skip it here and pass it later, the partner will operate against the orchestrator's `cwd` until you remember to pass it. Setting it on the warm-up call is the easiest way to avoid that drift.

Common case worth naming: the orchestrator is started in repo A (because the user wants A's local commands and skills available to themselves), but the work the partner is meant to help with is in repo B. Pin `cwd` to B here; the partner will use B's `.opencode/` overrides and store the session against B, but can still read files in A if you mention them by absolute path in a later prompt.

## Step 3 - Warm the partner with "Hello 👋"

```
oc_run(
  prompt: "Hello 👋",
  model: "<resolved model from Model Selection>",
  cwd: "<absolute path from Step 2>"
)
```

This is a sync call - it blocks until the partner replies. First-call latency is the model latency only (a few seconds). The returned output contains the assistant reply inline and the `Session ID` field which is the stable handle.

If the dispatch fails (e.g. `opencode` not on PATH, model auth missing), surface the error to the user and stop. Do not retry blindly.

## Step 4 - Report

Quote the partner's reply text verbatim (one or two lines) to confirm it's oriented and ready, then report:

- **Session id** - the user passes `sessionId: <id>` on every follow-up consultation to keep the partner's accumulated context.
- **Working directory** - the absolute path the partner is rooted in. **The user must pass this same `cwd:` on every follow-up dispatch** or the partner will silently answer against whatever the orchestrator's `cwd` is at the time of the call.
- **Model** - the resolved model id (`openai/gpt-5.5` or `zai-coding-plan/glm-5.2`) and a one-line note that mid-thread model switches are supported (just pass a different `model` on a subsequent `oc_run` with the same `sessionId`).
- A copy-pasteable follow-up snippet the user can adapt:

  ```
  oc_run(
    sessionId: "<session id>",
    model: "<resolved model>",
    cwd: "<absolute path from Step 2>",
    prompt: "Read these files in full: ... Then challenge me on X. Three things to verify. Keep it tight, don't restate my plan."
  )
  ```

- A reminder that the session persists in `~/.local/share/opencode/opencode.db` and can be resumed later (or searched via `oc_search_sessions`) - there is no environment to release.

Final status: **DONE - partner ready** with the session id and reply summary, or **BLOCKED - <reason>** with the failing step named.
