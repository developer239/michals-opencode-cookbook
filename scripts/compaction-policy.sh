# Compaction policy shared by both installers, one entry per provider:
# <provider>=<tokens> compacts that provider's models at that many tokens,
# and <provider>=max compacts each of them as late as its own window allows.
# A model whose window is smaller than the count also compacts at its own
# window, and a provider not listed is not limited. Each harness applies the
# entries of the providers it runs: Claude Code only anthropic, as
# autoCompactWindow (which it caps at each model's context); OpenCode every
# entry, as a per-model input-limit override.
COMPACT_AT_TOKENS_BY_PROVIDER=(anthropic=750000 openai=max)

# Handoff compaction (Claude Code only): the model the PreCompact hook runs
# headlessly to write a handoff before compaction, that model's context window
# in tokens (change the two together: the session record is sized to fit the
# window, dropping the tool results cheapest to recover first when a session
# is larger), and the hook's own timeout in seconds, raised above Claude
# Code's 600s default because a large session record can take a while for the
# writer to read and summarize. The writer
# call itself is bounded further below, via --writer-timeout-seconds, by the
# margin below, so a hanging writer fails inside the CLI with a failure
# handoff before the hook's own deadline could kill it with nothing written.
COMPACTION_WRITER_MODEL='claude-opus-4-8[1m]'
COMPACTION_WRITER_CONTEXT_TOKENS=1000000
PRE_COMPACT_TIMEOUT_SECONDS=900
WRITER_TIMEOUT_MARGIN_SECONDS=60
