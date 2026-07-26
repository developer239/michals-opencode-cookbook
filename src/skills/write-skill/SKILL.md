---
name: write-skill
description: Conventions for authoring SKILL.md files. Load before creating or reviewing any skill.
---

# Skill Writing

## Purpose

This skill defines how skills are structured, written, and maintained so they are consistent, complete, and effective.

## Loading Model

Two mechanical facts about how skills reach the model drive most rules in this document:

- **Descriptions are always in context.** The model sees every skill's description at all times and selects skills using descriptions alone. The description carries the entire load decision - the body is invisible until after selection.
- **The body loads once, in full, on selection.** There is no second fetch the model can be relied on to make. Whatever the skill needs to say must be inside SKILL.md.

Consequences:

- Write the description so the load decision can be made from it alone.
- Write the body self-contained: assume the reader has this file and its description, nothing else. Do not reference content outside the file as if it were present ("as covered in the review skill").
- Keep all content in SKILL.md. Never split material into companion files (`advanced.md`, `reference.md`) that require an additional load the model may not perform.

## Skill Scoping

Decide what one skill covers before writing it.

- **One skill per trigger context.** A skill covers one coherent domain or workflow - the set of guidance that is needed together. If two halves of a skill would load in different situations, split them into two skills.
- **Extend before creating.** When new content shares an existing skill's trigger context, add it there. Create a new skill only for a genuinely different trigger context.
- **Sibling descriptions must discriminate.** If two skills' descriptions could both match the same request, the model can load the wrong one. Write descriptions so any given request lands clearly on exactly one skill.
- **One owner per topic.** When domains touch, exactly one skill owns the topic and others defer to it by name: "Defers to `develop-tests` for test conventions." Never duplicate another skill's rules - duplicates drift apart.

## Frontmatter

**CRITICAL: Every SKILL.md must start with YAML frontmatter.** Without it, the skill tool cannot discover the skill - it will not appear in the available skills list and agents cannot load it. This is the most common mistake when creating new skills.

```yaml
---
name: my-skill-name
description: What the skill covers and when it should load.
---
```

Two required fields:

- **`name`**: Must match the directory name exactly. Lowercase letters, numbers, and hyphens only. Keep it short.
- **`description`**: What the skill covers and when it should load.

Optional fields:

- **`last_verified`**: ISO date (`'2025-03-04'`). Used on domain-specific skills that reference concrete file paths, entity names, or API shapes that may drift over time.

### Description Rules

The description is the primary trigger mechanism - the model chooses from all available skills using descriptions alone (see Loading Model).

- Write the scope in third person: "TypeORM migration workflow for..." - not "I help with" or "Use this to". An imperative load cue may follow the scope sentence: "Load before reviewing a pull request."
- Be specific: include the domain and scope.
- Match trigger coverage to how the skill gets invoked:
  - **Workflow-cued skills** have one obvious load moment. A scope sentence plus a short load cue is enough:
    - `Code review checklist and conventions. Load before reviewing a pull request.`
    - `Conventions for creating and evolving apps in Chirp-style Yarn/Turbo monorepos.`
  - **Request-cued skills** are triggered by varied user phrasings - file formats, task types, entity names. Their descriptions must enumerate the genuinely distinct situations that should trigger them. An under-triggering skill fails silently: it exists, never loads, and nobody notices.
- Some skills are hybrids: a language skill can name the language scope and still include a short "Load before..." cue.
- Distinct trigger situations earn their place in a description; synonym lists are padding. "Creating, editing, or extracting content from Word documents; converting other formats to .docx" names distinct situations. "Word docs, Word documents, docx files, Microsoft Word files" repeats one situation four times.
- Every description is in context all the time, so every line must pull weight - but when recall and brevity conflict, prefer the longer description.

Bad: `Helps with documents` / `Processes data` / generic descriptions without scope.

### Naming Conventions

Prefer descriptive compound names: `language-typescript`, `workflow-git-cli`, `develop-monorepo`.

Avoid: vague names (`helper`, `utils`), overly generic (`documents`, `data`), single words when a compound is clearer.

## Title and Section Ordering

### H1 Title

Use `# <Descriptive Name>` as the first line after frontmatter. Patterns from existing skills:

- `# TypeScript Skill`
- `# Code Review Conventions`
- `# Monorepo Development`

### Section Order

Skills follow this general structure (not every section is required):

1. **Purpose / Applicability** - What the skill does, when it applies
2. **Core Rules / Principles** - The non-negotiable constraints
3. **Detailed Sections** - Domain-specific guidance, patterns, examples, workflows
4. **Anti-Patterns** - What to avoid (flat bullet list)
5. **Rules / Checklist** - Final summary of do/don't rules

Not every skill needs every section. Small skills skip straight from conventions to rules. Large skills (like `language-terraform`) have many detailed sections. Scale the structure to the content.

## Applicability Gate

Skills that only apply in specific contexts must start with an applicability check. This pattern is used by monorepo-specific skills and domain-specific skills:

```markdown
## Applicability

Use this skill only when all are true:

- the target repository is a Turbo/workspace monorepo
- the repository has an `apps/` and/or `packages/` folder at root
- work is being done inside that monorepo repository

If these signals are missing, do not apply this skill.
```

Skills that are universally applicable (like `language-typescript`, `develop-tests`, `workflow-git-cli`) skip the gate and start with Purpose or Core Rules instead.

## Writing Principles

### Complete Over Compact

There is **no length limit** on a skill. A skill is exactly as long as its content requires - 60 lines or 1,000. Never cut, compress, or relocate required information to make the file shorter. The failure mode that matters is the model lacking information it needed, not a long file. All of a skill's content lives in SKILL.md itself (see Loading Model).

Length and noise are different problems. Still exclude content that carries no information:

- Explanations of what well-known libraries, frameworks, or concepts are - the model already knows.
- Restatements of tool descriptions that are injected automatically.
- Boilerplate sections added only for structural symmetry.

The test for every line is "does the model lack this?" - never "is the file getting long?". If the first answer is yes for a thousand lines, write a thousand lines.

### Concrete Over Abstract

Show actual code, actual templates, actual patterns from the codebase. Input/output examples are more effective than descriptions.

Good - actual pattern with real names:

```typescript
@Controller('feature')
@UseGuards(FirebaseAuthGuard)
@ApiBearerAuth()
export class FeatureController { ... }
```

Bad - abstract description: "Controllers should use appropriate guards and decorators."

### Match Constraint Level to Task Fragility

- **High freedom** (text instructions): Multiple valid approaches, context-dependent. Example: code review tone guidelines.
- **Medium freedom** (templates with variation): Preferred pattern exists but variation acceptable. Example: PR description templates by size.
- **Low freedom** (exact sequences): Fragile operations, consistency critical. Example: TypeORM migration workflow steps.

### Source of Truth Hierarchy

When a skill might conflict with other sources, state the priority explicitly:

```markdown
## Source of Truth Hierarchy

When rules conflict, apply in this order:

1. Repository lint + compiler rules
2. Existing local pattern in the nearest module/package
3. This skill's defaults
```

### Tool References

Reference tools by their bare name: `jira_create_issue`, `codebase_find_definition`, `github_get_pull_request`. Do not restate generic parameter documentation - the model already has tool descriptions injected automatically.

Do document project-specific parameter values, flags, and calling conventions the model cannot infer: required project keys, account IDs, environment names, package-manager flags, or API headers. Pinned values like these are exactly the kind of information skills exist to carry.

## Anti-Patterns

- Missing YAML frontmatter - skill becomes invisible to the skill tool and cannot be loaded
- `name` field doesn't match directory name
- Descriptions padded with synonymous trigger phrases - distinct trigger situations belong in the description, synonyms do not
- Request-cued skills with descriptions too sparse to trigger reliably - under-triggering fails silently
- Sibling skills whose descriptions both match the same request
- Duplicating another skill's rules instead of deferring to it by name
- Splitting skill content across companion files (SKILL.md → advanced.md → details.md) - the body loads once; everything belongs in SKILL.md
- Cutting required content to keep the file short - completeness wins over brevity
- Body text that assumes context outside the file ("as covered in the review skill")
- Explaining what well-known tools/frameworks are
- Restating generic tool parameter documentation the model already has (project-specific pinned values are not this - document those)
- Abstract advice without concrete examples from the codebase
- Time-sensitive content with date-based conditionals - use "current" / "legacy" sections instead
- Inconsistent terminology - pick one term and stick with it throughout
- Missing applicability gate on context-specific skills
- Horizontal rules (`---`) between sections - use headings alone for structure
- Magic numbers without explanation

## Rules

- `name` must match directory name exactly
- Description names the domain and scope in third person; an imperative load cue may follow
- The description alone must carry the load decision - enumerate distinct trigger situations for request-cued skills, never synonym padding
- One skill per trigger context; extend existing skills before creating new ones
- Sibling skill descriptions must not overlap on the same request
- One skill owns each topic; others defer to it by name instead of duplicating its rules
- SKILL.md is self-contained: all content in one file, no companion files, no assumed outside context
- No length limit - never trim required information for brevity; exclude only what the model already knows
- Use `last_verified` on domain-specific skills that reference concrete paths or APIs
- Start with Purpose or Applicability, end with Anti-Patterns or Rules
- Show concrete patterns from the actual codebase, not abstract advice
- Reference tools by bare name; don't restate generic parameter docs; do pin project-specific values and flags
- Scale structure to content - don't pad small skills with empty sections
- Use headings for structure - no horizontal rules (`---`) between sections
- Keep terminology consistent within and across related skills
