---
name: write-jira-ticket
description: JIRA ticket creation and management conventions. Load before creating or updating tickets.
last_verified: '2026-09-09'
---

# JIRA Ticket Conventions

## Summary Format

Technical, scannable, no filler. Use endpoint paths, package paths, or feature names:

- `GET /admin/accounts`
- `GET /admin/accounts/:id/profiles/:profileId`
- `GET /v1/subscription`
- `/packages/webhook`
- `Implement XP gamification system`
- `Unify dailyTimeCommitment field naming and move goalId to routine request`
- `Add feature usage limits for routine generation and curated routines`

Rules:

- Match the target project's existing summary convention first. If the project consistently uses discipline prefixes with a hierarchy separator (e.g. `[BE] Articles :: category`, `[FE] Angel gender settings`), preserve them - they usually map to team, assignee, or an FE/BE/DS split and are load-bearing, not noise.
- When the project has no consistent convention, pick by what the ticket is about:
  - endpoint: HTTP method + path (e.g. `GET /admin/accounts`, `POST /v1/routines/generate`)
  - package or app: the directory path
  - feature: a verb phrase describing the outcome
- Either way, keep it scannable with no filler words.

## Description

Choose the ticket's shape from its **deliverable type** first, then scale the detail to its size.

- **Implementation** (new endpoint, guard, service, module) - scope, integration tests, acceptance criteria; scale by the size templates below.
- **Contract change** - a Before vs after section is required regardless of size (see Before/After Examples).
- **Validation / investigation** - existing behavior to confirm; use the validation template, not the size templates.
- **Refactor / infrastructure** - QA-first acceptance criteria with a defer-to ticket for functional validation.
- **Architectural decision** - inline the reasoning and the tradeoffs (see Design Forks).

Then scale to size, and keep every ticket to the point: state what is expected and how to verify it, and little else. Don't pad small tickets with empty sections. Run both compression passes from `workflow-human-like-writing` over the finished description; tickets stay self-contained (see Rules), so never replace inlined domain detail with a link.

### The opening paragraph

The opening states the problem (for a feature, the outcome), the cause when the ticket is a bug, and at most one distinction that prevents a predictable mistake. Then it stops. The two openings below are complete as written; if yours runs past a paragraph, the surplus belongs in a headed section or nowhere. Developers skip descriptions whose opening runs long, and the parts they act on (Requirements, Acceptance Criteria) sit under it. The limit is on the unheaded opening only: Requirements, Integration Tests, and Acceptance Criteria keep whatever detail the developer or QA needs to act.

```markdown
Let users choose the AI coach (Angel) persona's gender, male or female, defaulting to male. This is the coach persona's gender. It is not the user's own `gender` (which the profile already stores and uses for age and health math), so keep the two separate.
```

```markdown
The daily-streak achievement reads daily check-ins through a query that, unlike the calendar's daily-progress read, is not clamped to the quest's active range. Completing or expiring a quest mid-duration does not delete its later check-ins (only cancellation does), so check-ins remain on days after the quest ended, and the streak counts them. [AA-453](https://strvcom.atlassian.net/browse/AA-453) clamped the calendar read and deferred the streak read here, since clamping shifts when streak achievements are earned.
```

Both tickets originally ran on for another paragraph or two. Every extra sentence was one of the following, and each belongs somewhere else or nowhere:

- **Current-state narration.** "Today there is no such concept: not in the profile, and not in any request the backend sends to the Python AI service." The requirement that adds the concept already says it did not exist. If the absence is the point of the ticket, it fits in one clause of the problem statement, not a sentence of its own.
- **How a neighboring system works.** "The persona is assembled inside that service, so the backend's job is to give it a stable gender to speak as." The developer does not need another service's internals to build the field, and the ticket is not where they would look for them.
- **The ticket graph.** "That stable value is also what unblocks the Czech consistency fix in AA-443. The Python side that consumes it is AA-447 (which this ticket blocks); it exposes the value as a top-level `coach_gender` field (see ask-angel-ai#76)." What this ticket unblocks and who consumes its output is what the structured links panel already shows, and the field name and external PR were already in the requirement that uses them. The one ticket reference that earns a sentence is provenance, the ticket this one was split off or deferred from (the AA-453 sentence above), because it explains why this ticket exists.
- **Previewing the change and its consequences.** "This ticket gives the streak read the same active-range clamp, so both reads agree on which days a quest owned. It changes behavior on purpose: a day the quest was not active no longer feeds its streak. Timing can move either way ... Dropping such a failure can earn an achievement earlier; dropping a successful out-of-range check-in can earn it later." Requirements state the change and Acceptance Criteria state what is observable afterwards; the opening does not rehearse either.
- **Out-of-scope disclaimers.** Covered next; almost always cut.

### Keep out-of-scope notes rare and earned

Only spell out what is NOT expected when the developer would plausibly make that change while implementing this ticket, most often by applying the same fix to a sibling they will see next to the code they are changing. Code proximity alone does not qualify: applying the same range clamp to a sibling read does; changing an independent counting rule inside the touched query does not, because nothing about implementing the clamp leads there. When a note is earned, it is one sentence naming the boundary and linking the ticket that owns the other work, not a paragraph explaining the other bug.

- Earned: a ticket fixing a date-scoping bug on a shared read notes "do not also clamp the streak query - that changes when achievements are earned and is a separate change," because the developer touching that read would plausibly clamp it too.
- Noise: a ticket whose whole job is a copy audit does not need a line promising it will not refactor the localization type.
- Noise: the streak-clamp ticket above closed with a paragraph on how "the streak counts each check-in row, not each calendar day, so multiple daily tasks on one day, and the order of same-day rows, already sway the result regardless of this clamp. That is a separate, older bug ... tracked on its own." Implementing the clamp never touches how rows are counted, so it would not lead a developer to change the counting unit; the paragraph guarded against nothing.

### Small Tickets (config change, rename, field move)

Context paragraph explaining _why_ → Requirements → Acceptance Criteria. The first section has no header - JIRA already displays "Description" as the field title above the text.

```markdown
Team discussions identified three issues with the current profile API:

1. **Inconsistent field naming** - the daily time commitment field uses different names across DTOs
2. **Wrong enum values** - the enum values were 10/20/30 but designs specify 5/15/25

## Requirements

- Rename the daily commitment field to `dailyTimeCommitment` with corrected values: 5, 15, 25
- Unify the field name across all create, update, and response DTOs
- Update all related tests

## Acceptance Criteria

- Create and update profile DTOs both use `dailyTimeCommitment` as the field name
- Routine generation no longer reads `goalId` from the profile
```

### Medium Tickets (new endpoint, new guard, new service)

Opening paragraph stating the outcome and at most one mistake-preventing architectural distinction → Scope (grouped by area) → Integration Tests (scenarios to cover) → Acceptance Criteria (QA/PM-verifiable, always last). The first section has no header - start directly with the opening paragraph.

```markdown
This ticket establishes the foundational data model and API that all other subscription features depend on. Subscriptions are tracked at the **account level** (not profile level) because a single paying customer may have multiple profiles (e.g., family members).

## Scope

**Database:**

- `subscriptions` table (account-level subscription state)
- `subscription_events` table (audit trail with trigger-based logging)

**API:**

- `GET /v1/subscription` - returns current user's subscription status. Authorization guards call it on most requests, so it must stay fast.

## Integration Tests

- 401 without auth
- returns `hasSubscription: false` for user without subscription
- returns subscription details for active subscriber

## Acceptance Criteria

**Postman:**

- `GET /v1/subscription` returns `hasSubscription: false` for user with no subscription record
- `GET /v1/subscription` returns `hasSubscription: true`, `plan`, `daysRemaining` for active subscriber

**Database:**

- `subscriptions` table exists with `account_id`, `product_id`, `store`, `is_active`, `expiration_date` columns
```

### Large Tickets (new module, new package, multi-table feature)

Opening paragraph → Numbered sections or bold sub-headers describing what each area needs to do (not how) → Acceptance Criteria grouped by verification method. The first section has no header - start directly with the feature description.

When the feature involves domain logic (scoring algorithms, computation hierarchies, business rules with specific thresholds), inline the relevant high-level details directly in the ticket. Do not link to spec files or external documents - the ticket must be self-contained. Anyone reading it should understand the domain model, key parameters, and behavior without chasing references.

```markdown
Implement the XP (experience points) gamification system that tracks XP earned per profile.

## 1. Database

- New `xp_events` table (append-only XP log per profile per activity)
- Add `points` column to `routines` table (default 20)

## 2. API

**New endpoint: GET /v1/xp/daily?profileId=uuid**

Response:

- `lastXpEarned` - XP from most recent activity today (null if none)
- `dailyXp` - total XP earned today
- `dailyGoal` - target based on commitment level

## 3. Business Rules

- Daily goal is derived from the profile's time commitment setting
- XP is awarded when a routine session is completed or a quiz is submitted
- Duplicate awards for the same session must be prevented (idempotency)

## Acceptance Criteria

**Database:**

- `xp_events` table exists with correct columns
- `routines` table has `points` column

**Postman:**

- `GET /v1/xp/daily` returns correct dailyXp, dailyGoal, dailyGoalMet
- Completing a routine awards XP equal to routine's points value
- Completing the same session twice does not award duplicate XP
```

### Validation / Investigation Tickets

Some tickets confirm existing behavior rather than build something. The deliverable is a written confirmation on the ticket, not a code change. Shape:

- State up front what is being validated, and that no code change is expected when that is the case.
- **Prerequisites** - what must be running, and how to get access. Include auth or token-acquisition steps only when authentication is part of running the validation.
- **Steps** - runnable and in order (curl, Postman, or Swagger). They must work exactly as written (see Runnable Examples).
- **Quirks to record** - specific things to observe and note, so the write-up shows whether any deserve their own follow-up ticket.
- **Acceptance Criteria** - observation-based: the steps produced the expected output, and the observations are written up in a comment.

No implementation scope and no integration-test section - there is nothing to implement.

### Runnable Examples

When a ticket includes commands meant to be run (validation steps, repro steps, curl in acceptance criteria), they must work exactly as written. Verify against source or current project docs:

- the full route including the global prefix (e.g. `/v1`)
- required headers and the request body shape
- the real authentication sequence - never replace a multi-step token flow with an invented shorthand

A request that 404s or 401s as written is worse than plain prose.

## Architectural Reasoning

Always explain _why_ inline, not in a separate section. Embed reasoning next to the decision it explains. Focus on the domain/data model justification, not internal class names:

- _"Subscriptions are tracked at the **account level** (not profile level) because a single paying customer may have multiple profiles."_
- _"Categories are denormalized (`text[]` on quizzes) because they're static seed data with 9 fixed values. This eliminates join tables with no downside."_
- _"Options store a stable `id` for answer tracking and a separate `position` for display order - this lets us reorder options without breaking historical answers."_

## Before/After Examples for Contract Changes

When the ticket changes an existing API contract (request shape, response shape, validation behavior, error code, persisted column shape), include a **Before vs after** section with concrete JSON examples. Prose explaining "the response now includes a new field" is weaker than two side-by-side payloads showing exactly what changed.

When to use:

- Adding/removing/renaming a request or response field
- Changing validation behavior (what was 400 becomes 201, or vice versa)
- Changing the meaning of an existing field
- Changing an error code or error message contract

When NOT to use:

- Pure backend refactors with no external surface change
- New endpoints where there is no "before" to compare against
- Internal data model changes that do not leak to consumers

### Structure

Use H3 sub-headings under a `## Before vs after` section. Pair every "before" with the matching "after" so the diff is obvious:

```markdown
## Before vs after

### Generate response - tag question today

\`\`\`json
{
"id": "q2-uuid",
"type": "tag_selection",
"options": [
{ "id": "tag-1", "text": "Sitting too long", "isDefault": true }
]
}
\`\`\`

### Generate response - tag question after

Every option carries `isNoneOfTheAbove`. Exactly one option per tag-selection question has it set to `true`.

\`\`\`json
{
"id": "q2-uuid",
"type": "tag_selection",
"options": [
{ "id": "tag-1", "text": "Sitting too long", "isDefault": true, "isNoneOfTheAbove": false },
{ "id": "tag-none", "text": "None of these trigger my pain", "isDefault": true, "isNoneOfTheAbove": true }
]
}
\`\`\`

### Submit - "nothing applies" today

\`\`\`json
{ "answers": [{ "questionId": "q2-uuid", "selectedTagOptionIds": [] }] }
\`\`\`

\`\`\`
400 INVALID_ANSWER - Question q2-uuid requires at least one tag
\`\`\`

### Submit - "nothing applies" after

\`\`\`json
{ "answers": [{ "questionId": "q2-uuid", "selectedTagOptionIds": ["tag-none"] }] }
\`\`\`

\`\`\`
201 Created
\`\`\`
```

### Vocabulary alignment

When the affected endpoint is already documented in a user-flow doc, concept doc, or similar reference inside the repo (e.g. `apps/docs/src/user-flows-app/quiz-flow.md`), adopt the **exact same JSON field names, error codes, and shape conventions** that doc uses. The ticket should read as a delta against the existing documented contract, not a parallel definition.

Quick rules:

- Use real field names from the codebase, not invented placeholder names
- Use real error codes (e.g. `INVALID_ANSWER`, `MISSING_TRIGGER`) when the codebase has named them
- Use the same status code conventions the rest of the API uses
- Keep examples minimal - one or two options/fields are enough to illustrate the shape, full payloads bloat the ticket

## Formatting in Descriptions

Two conventions make descriptions navigable and scannable. Apply both whenever the description references another ticket or an endpoint.

- **Link every ticket reference to its browse URL.** A bare `CHRP-123` in the description body does not auto-link in the generated ADF, so write it as a markdown link: `[CHRP-123](https://strvcom.atlassian.net/browse/CHRP-123)`. This is separate from JIRA's structured issue-link panel created by `jira_link_issues` - do both: the structured link records the relationship, the inline link makes the prose clickable. Use the workspace base `https://strvcom.atlassian.net/browse/<KEY>`.
- **Wrap endpoint method + path in inline backticks.** Write `` `GET /v1/xp/daily` ``, `` `PATCH /v1/profile` `` in prose, Scope, Before/after, and Acceptance Criteria so endpoints render as code and stand out. This is the same treatment already used for table, column, and field names.

## Design Forks

When a ticket depends on a genuinely unresolved design decision, do not pre-decide it. Present the options with the tradeoff that distinguishes them (cost, blast radius, client impact) and name the decision itself as a deliverable. Guardrails:

- Use this only when the decision is genuinely open, not to dodge taking a defensible position.
- Branches must be exhaustive - every option a reader would seriously consider.

Acceptance criteria may be conditional on the decision (e.g. "If stored in the database: ...") while it is unresolved. Each branch's criteria must still be independently verifiable, and no criterion may be skippable merely because nobody decided yet. Once the decision is made, update the ticket to unconditional criteria.

## Acceptance Criteria

Acceptance criteria are for **QA and PM** - they must be verifiable without reading code. Group by verification method. Be concrete - use actual endpoint paths, status codes, and expected values.

| Verification Method | When to use                                             |
| ------------------- | ------------------------------------------------------- |
| **Postman**         | Endpoint responses, status codes, error cases           |
| **Database**        | Table/column existence, row counts, constraint behavior |
| **Seed Service**    | Idempotency, data correctness after seeding             |

Each criterion must be independently verifiable - no "and" joining two assertions.

Do not include code-structure checks (`Code Structure`) in acceptance criteria - those belong in integration tests or code review.

### QA-First Criteria for Refactors and Infra Tickets

Before writing each acceptance criterion, ask: can a QA engineer verify this without specialised tooling, infrastructure access, or code knowledge? If the answer is no, replace it with an externally observable proxy or defer it explicitly.

Prefer observable checks:

- deployment success (workflow/job status)
- service health (`/ping`, readiness, no restart loop)
- API behavior via Postman/Swagger
- data outcomes visible through existing endpoints

If a ticket is mostly internal or infrastructure work and all criteria require tooling QA doesn't have access to, use the defer pattern explicitly:

```markdown
**QA Validation (this ticket):**

- Deployment to target environment succeeds
- Service is healthy after deploy (`/ping` returns 200)

**Note:** This is an infrastructure-only change. No API-level behaviour changes.
Functional impact is validated in <linked ticket>.
```

This tells QA exactly what to check and explicitly signals no deeper investigation is needed - preventing the ticket from stalling in QA Ready waiting for verification that isn't coming.

## Integration Tests

Integration tests are a **separate section** from Acceptance Criteria. They describe **what scenarios** the developer should cover - not how to structure the test files, which describe blocks to use, or where to put the test file. The implementing agent determines file structure and test organization from existing codebase patterns.

List test scenarios as bullet points:

```markdown
## Integration Tests

- 403 for non-admin users
- paginated list of accounts with primary profile
- respects pagination params
- includes role field in response
```

For changes to existing endpoints, mention which endpoint's tests need updating and the new scenarios:

```markdown
## Integration Tests

Update routine generate tests:

- 400 when dailyTimeCommitment is invalid
- uses updated enum values 5, 15, 25
```

When the test scope is obvious from the requirements, a one-liner is sufficient:

```markdown
## Integration Tests

Cover the renamed `dailyTimeCommitment` field in create and update profile response assertions.
```

## Error Handling & Edge Cases

When the ticket involves error handling, document the strategy explicitly:

```markdown
## Error Handling Strategy

- **Transient errors** (DB connection, Redis timeout): return 500 → provider retries
- **Non-transient errors** (validation, business logic): log to `webhook_failures`, return 200 → prevents infinite retries
```

## Updating Existing Tickets

Update tickets one at a time. The markdown is converted to ADF, and a few constructs make `jira_update_issue` fail with `INVALID_INPUT`:

- inline code nested inside a bold span (e.g. a bold heading containing `` `GET /v1/...` ``) - keep code outside bold
- a `|` or `@` character inside inline code (e.g. `` `A | null` ``, `` `@IsOptional()` ``) - rephrase to plain text
- fenced code blocks, including JSON, are fine

If a clean update still fails, fall back to simpler markdown (plain bullets, fewer nested lists), and if needed confirm a minimal description update lands first, then apply the full content.

### Labels and Structured Links

Before assigning labels or links, inspect related tickets in the same project. Reuse the established labels and link types for that work stream - do not invent new labels or link every nearby ticket indiscriminately. Structured links (`jira_link_issues`) are separate from the inline browse links in the body; for a relationship that matters, create both.

`jira_link_issues` has two behaviors to guard against:

- it may return a client-side JSON parse error on `add` even when the link was created, so treat that error as inconclusive
- it can create a directional link (e.g. `Blocks`) with source and target reversed

After any directional link, re-fetch both issues and verify the link type and direction. Retry with corrected source and target only when the fetched relationship is absent or reversed.

## Rules

- Always search for related tickets before creating a new one
- Always check for an existing epic and link to it when applicable
- Summaries must be scannable - no filler words
- **Describe the WHAT, not the HOW.** Tickets define the problem, the scope boundaries (which app, which module, which endpoints), the expected behavior, and how to verify it. They do not prescribe service class names, file paths, module structure, caching strategies, or internal implementation choices - the implementing agent determines those from the codebase. It is fine to mention table names, column names, and endpoint paths because those are the product contract, not implementation decisions. Include an implementation constraint only when correctness depends on it: an atomic write, an idempotency guard, or the authoritative source for a data backfill are requirements, not implementation trivia, and belong in the ticket.
- Acceptance criteria are for QA/PM - must be verifiable without reading code, grouped by verification method, independently testable, and always the last section in the description
- Integration tests list scenarios to cover as bullet points - do not prescribe test file paths, describe block structure, or test framework patterns. The implementing agent determines file organization from existing codebase conventions.
- Prefer QA-observable acceptance criteria; avoid code-structure checks in acceptance criteria
- For refactor-only tickets with no direct functional surface, add a clear defer-to ticket for end-to-end validation
- Architectural reasoning goes inline next to the decision, not in a separate section
- **Never link to spec files, spreadsheets, or external documents as a substitute for describing the domain.** Tickets must be self-contained. Inline the relevant high-level information (score hierarchies, algorithm summaries, threshold values, business rules) directly in the description so readers understand the feature without chasing references.
- **For any change to an existing API contract, include a Before vs after section with concrete JSON examples** rather than prose-only description of the delta. Adopt vocabulary (field names, error codes) from the matching user-flow or concept doc in the repo when one exists.
- **Link ticket references to their browse URL** in the description body (`[CHRP-123](https://strvcom.atlassian.net/browse/CHRP-123)`) - bare keys do not auto-link. This is in addition to the structured `jira_link_issues` relationship, not a replacement for it.
- **Wrap endpoint method + path in inline backticks** in the description (`` `GET /v1/xp/daily` ``), the same way table, column, and field names are formatted.
- One concern per ticket - if you're writing "and" in the summary, consider splitting
- The first section of the description must NOT have a header (no `## Context`, `## Description`, etc.) - JIRA already displays "Description" as the field label above the text. Start directly with the opening paragraph.
- The opening states the problem (and its cause for a bug) plus at most one mistake-preventing distinction, then stops. No current-state narration, no neighboring-system internals, no ticket-graph narrative beyond the ticket this one was split or deferred from, no preview of the change or its consequences. Headed sections keep the detail they need
- Mention deferred scope only when the developer would plausibly do it in this ticket (see Keep out-of-scope notes rare and earned): one sentence, linking the ticket that owns it

## Tool Limitations

- **Sprint assignment**: Sprint is assigned via the JIRA agile API after issue creation, not during the create call itself. If `sprintId` fails, use `jira_move_to_sprint` as a follow-up.
- **Epic linking**: The tool handles epic linking automatically as a two-step process (create → update with parent). This is reliable.
- **Description update failures**: see Updating Existing Tickets above for the specific `INVALID_INPUT` causes and the fallback sequence.
