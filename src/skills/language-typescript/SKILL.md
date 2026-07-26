---
name: language-typescript
description: TypeScript conventions with generic guidance plus a monorepo-specific addendum.
---

# TypeScript Skill

## Purpose

This skill codifies preferred TypeScript practices based on:

- repository-enforced conventions (ESLint, tsconfig, package structure)
- recurring refactor preferences
- architecture patterns across TypeScript services and modules

Use this as the default rulebook before writing, refactoring, or reviewing TypeScript code.

## Source of Truth Hierarchy

When rules conflict, apply in this order:

1. Repository lint + compiler rules
2. Existing local pattern in the nearest module/package
3. This skill's defaults

Do not invent a new local style when an existing style is already established.

## Language and Formatting Baseline

- TypeScript strict mode is expected (`strict` family enabled).
- 2-space indentation.
- single quotes.
- no semicolons.
- trailing commas where formatter applies.
- arrow functions only; do not use `function` declarations.

### Vertical Paragraphing

Blank lines separate paragraphs, and a paragraph is a run of statements sharing one structural role: setup, a homogeneous list of like operations, an unconditional finalization, a result handoff. Break on a role change; pack statements that share a role. Group by role, not surface form: three near-identical optional `if`-adds are one packed paragraph (a list), while two `if`s that do structurally different things are separate paragraphs. A guard clause's own `return` stays glued to its guard; the terminal `return` that concludes the function is its own paragraph.

- Apply the role axis end to end. Name each paragraph's role; if two packed lines have different roles the missing break misrepresents structure, and if two separated lines share a role the break is noise. Quick test: delete a blank line, and if the two adjacent statements still serve the same immediate role, it was noise.
- Apparent inconsistency almost always means grouping by surface ("these are all config checks") instead of role. One blank line per role change, never two; if a function needs heavier separation to stay readable, reduce nesting or extract rather than adding blank lines.

## Naming Conventions

### General

- Files: kebab-case with purpose suffix where applicable.
- Classes: PascalCase with role suffix (`Service`, `Controller`, `Module`, `Repository`).
- Methods/variables: camelCase.
- Private members: camelCase, no leading underscore.

### Interfaces and Type Parameters

- Interface names start with `I` and use PascalCase.
- Generic type parameters start with `T` and are descriptive (`TItem`, `TResponse`, `TData`).

### Booleans

- Prefix booleans with intent-bearing verbs:
  - `is`, `has`, `can`, `should`, `did`, `will`, `does`, `expected`
- Prefer semantic names over ambiguous forms.

### Single-Purpose App Naming

When an app has a single domain (e.g., `lambda-image-processing`, `lambda-subscriptions`), drop the domain prefix from class names - the app scope already provides context:

- `ProcessingService` not `ImageProcessingService`
- `TransformerService` not `ImageTransformerService`
- `RepositoryService` not `ImageEntityRepository`

Keep action-descriptive words (`Processing`, `Transformer`, `Repository`) - only drop the redundant domain qualifier.

This rule does NOT apply to multi-domain apps like `apps/api/` where the domain prefix disambiguates between modules (e.g., `RoutineService` vs `ExerciseService`).

### Naming Operations and Classes by Intent

Name methods by the domain action, not create/get/set mechanics: `connectToServer`, not `createServerConnection`. Drop class-name suffixes that carry no meaning: `Manager`, `Handler`, `Proxy`, `Factory`, `Abstract` are padding unless they distinguish two genuinely different variants. A class named `ThingControllerManagerProxy` signals abstraction without providing any.

### Domain Terms

- Prefer canonical domain names over legacy/vendor names.
- Keep terms consistent across route, DTO, service, repository, entity, tests, and docs.

### Constants and Enums

- Use `SCREAMING_SNAKE_CASE` for module-level constants that represent fixed configuration or magic values (`MAX_RETRIES`, `CACHE_PREFIX_USER`, `DEFAULT_PAGE_SIZE`).
- Use PascalCase string enums for domain values visible in APIs and serialization (`UserRole.Admin`, `GoalType.Relief`).
- Keep enum members in a single canonical file per domain; do not scatter related enum values across multiple files.

## File and Module Organization

- Keep folders purpose-driven and predictable within the local project conventions.
- Match the nearest existing module layout before introducing new structure.
- Prefer direct imports over unnecessary local barrels.
- Delete barrel files (`index.ts`) when all consumers already import directly from source files; a barrel with zero consumers is dead code.
- Do not create wrapper interfaces, adapter layers, or helper methods unless they reduce real complexity; each layer of indirection adds navigation cost.
- Do not create passthrough methods where a public method only packs parameters into a single-use interface to forward to a private method; merge into one method and delete the wrapper interface.
- Co-locate related types: config schema types and runtime data types consumed by the same pipeline belong in one file, not split across multiple type files with re-exports between them.
- Do not split error classes across multiple files within the same app/module when they share a common base; one `errors.ts` is sufficient.
- Do not create 1-method wrapper services around single infrastructure calls (e.g., a service that only wraps `redis.del()` or `readFile()` + YAML parse); inline into the consuming service.
- Avoid creating new files unless there is a clear structural reason.

### Import Organization

Imports within a file follow a consistent group order separated by blank lines:

1. Node built-ins (`node:fs`, `node:path`)
2. External packages (`@nestjs/*`, `class-validator`, `zod`, `bullmq`)
3. Workspace packages (`@workspace/auth`, `@workspace/database`)
4. Relative imports - parent first (`../`), then sibling (`./`)

Within each group, sort alphabetically. Never mix groups on a single line. Tooling (ESLint `import/order` or similar) enforces this; when adding imports manually, match the pattern.

## Types and Modeling

### interface vs type

- Use `interface` for object shapes and contracts.
- Use `type` for unions, intersections, mapped/utility aliases, and discriminators.

### Arrays

- Use `TItem[]`, not `Array<TItem>`.

### Inference

- Avoid redundant primitive annotations when inference is obvious.
- Keep explicit annotations where they improve cross-file readability.

### Return Types

- Explicit return types are preferred on public methods/functions and exported symbols.
- Keep service/controller/repository boundaries explicitly typed.

### Nullability and Optionality

- Model nullability intentionally (`T | null` when explicitly nullable).
- Use `?` for optional fields.
- In DTO Swagger metadata, reflect optional vs nullable precisely.

### `any` vs `unknown`

- Never use `any`; use `unknown` and narrow with type guards or validation (e.g., Zod `.parse()`).
- If an external API returns untyped data, receive it as `unknown` and validate before use.

### Derived Types

- Prefer `Pick`, `Omit`, `Partial`, and other utility types over manually redeclaring fields.
- When a subset of an existing type is needed, derive it: `type UserSummary = Pick<User, 'id' | 'name'>`.

### Non-null Assertions

- Acceptable for framework/ORM initialized fields (`id!`, entity fields).
- Acceptable in tests where fixture guarantees existence.
- Do not use `!` to bypass real uncertainty in application logic.

### Type Safety

- Do not widen existing domain enums or named type aliases to anonymous `string`/`number` types; use the exact existing type (e.g., `Gender`, `MeasurementSystem`, `DailyTimeCommitment`).
- Enforce interface alignment with the canonical source type (e.g., align response interface fields with `IProfile` enum-typed fields).

### TypeScript 5.x Features

Adopt these features where they add clarity; do not adopt them for novelty.

**`satisfies` operator** - Use to validate that a value conforms to a type while preserving the narrower inferred type. Preferred over `as` for config objects, lookup tables, and constant definitions where you want both type checking and literal inference:

```typescript
// ✅ satisfies - validates shape, preserves literal inference
const CACHE_KEYS = {
  equipment: 'lookups:equipment',
  phases: 'lookups:phases',
  bodyAreas: 'lookups:body-areas:all',
} satisfies Record<string, string>
// typeof CACHE_KEYS.equipment is 'lookups:equipment', not string

// ❌ as - widens to Record<string, string>, loses literal types
const CACHE_KEYS = {
  equipment: 'lookups:equipment',
} as Record<string, string>
```

**`const` type parameters** - Use on generic functions where callers need literal type inference without `as const` at call sites. Primarily useful in config builders, typed event emitters, and schema factories:

```typescript
const defineRoutes = <const TRoutes extends readonly string[]>(routes: TRoutes): TRoutes => routes

// Inferred as readonly ['generate', 'ping'] - not string[]
const routes = defineRoutes(['generate', 'ping'])
```

**`using` declarations (Explicit Resource Management)** - Adopt for deterministic cleanup of resources like file handles, database connections, temporary files, and locks. Requires `Symbol.dispose` / `Symbol.asyncDispose` implementation. Disposal happens in reverse declaration order (LIFO):

```typescript
const acquireLock = async (key: string): Promise<AsyncDisposable> => {
  await redis.set(`lock:${key}`, '1', 'EX', 30, 'NX')
  return {
    [Symbol.asyncDispose]: async () => {
      await redis.del(`lock:${key}`)
    },
  }
}

// Lock is automatically released when scope exits (including on throw)
await using lock = await acquireLock('cache-rebuild')
const data = await expensiveComputation()
await cache.set(key, data, ttl)
```

**Inferred type predicates (5.5+)** - `.filter()` now narrows types automatically when the predicate is obvious. Remove explicit type predicate helper functions (like `isNonNull`, `isDefined`) that only exist to satisfy the type system when the built-in inference covers the case:

```typescript
// ✅ 5.5+ infers the narrowing automatically
const valid = items.filter((item) => item !== null)
// type: NonNullable<TItem>[]

// ❌ Remove this utility if only used for .filter()
const isNonNull = <T>(item: T | null): item is T => item !== null
```

**`NoInfer<T>` (5.4+)** - Use to prevent TypeScript from using a parameter position for inference when that position should only receive an already-inferred type. Useful in fallback/default parameters:

```typescript
const getOrDefault = <T>(value: T | undefined, fallback: NoInfer<T>): T => value ?? fallback
```

**Features to avoid or defer:**

- **Decorator metadata (5.2)** - runtime support still requires polyfills outside NestJS. NestJS already handles its own decorator metadata via `reflect-metadata`. Do not adopt the TC39 decorator metadata API separately unless the runtime environment natively supports it.

### Branded Types for Domain Safety

Use branded types to prevent accidental interchange of structurally identical primitives that represent different domain concepts (e.g., `UserId` vs `EquipmentId` vs `GoalId`). This catches misuse at compile time with zero runtime overhead.

```typescript
declare const __brand: unique symbol
type Brand<TBase, TBrand extends string> = TBase & { readonly [__brand]: TBrand }

type UserId = Brand<string, 'UserId'>
type EquipmentId = Brand<string, 'EquipmentId'>
type GoalId = Brand<string, 'GoalId'>

// Creation via validated factory (pairs well with Zod)
const UserId = (id: string): UserId => id as UserId
```

When to use branded types:

- UUID-based entity IDs passed across service boundaries (prevents swapping `userId` and `goalId` arguments).
- Currency amounts that must not be mixed (cents vs dollars, different currencies).
- Validated strings (email addresses, URLs) where the brand signals "this has been validated".

When NOT to use:

- Module-internal types where only one ID type exists and confusion is unlikely.
- Types that are already discriminated by structure (different shapes are already distinct).

Combine with Zod for runtime validation at trust boundaries (API input, queue job payloads) and let the branded type propagate through the domain layer:

```typescript
const UserIdSchema = z
  .string()
  .uuid()
  .transform((id) => id as UserId)
```

### Discriminated Unions

Prefer discriminated unions with a `type` (or `kind`) string literal field for representing states, events, or polymorphic domain objects. The discriminant field must be a string literal, not a computed value:

```typescript
type JobResult =
  | { type: 'success'; data: IRoutineData }
  | { type: 'failure'; error: string; retryable: boolean }
  | { type: 'skipped'; reason: string }
```

Exhaustive `switch` on the discriminant; no `default` clause - let TypeScript enforce completeness via `never`:

```typescript
const handleResult = (result: JobResult): string => {
  switch (result.type) {
    case 'success':
      return result.data.name
    case 'failure':
      return result.error
    case 'skipped':
      return result.reason
  }
  // No default - adding a new variant forces a compile error here
  const _exhaustive: never = result
  return _exhaustive
}
```

### Template Literal Types

Use for type-safe string patterns in cache keys, route paths, event names, and configuration keys where the set of valid strings follows a pattern:

```typescript
type CacheKeyPrefix = 'lookups' | 'routine-builder'
type CacheKey = `${CacheKeyPrefix}:${string}`

const buildKey = (prefix: CacheKeyPrefix, suffix: string): CacheKey => `${prefix}:${suffix}`
```

Do not over-engineer template literal types for internal strings where a plain `string` or union is sufficient. The cost of type-level complexity must be justified by real bug-prevention value.

## Runtime Validation (Zod)

### Schema-First at Trust Boundaries

Validate with Zod at every trust boundary where data enters the system:

- API request bodies, query params, headers
- Queue job payloads (BullMQ)
- Webhook payloads from external services
- Environment variables at startup
- YAML/JSON config files loaded from disk
- Deserialized Redis cache values (cache corruption happens)

Internal function calls between trusted modules do NOT need Zod validation - TypeScript's static types are sufficient within the trust boundary.

### Schema Organization

- Define Zod schemas in the same file as (or co-located with) the types they validate.
- Derive TypeScript types from Zod schemas with `z.infer<>` - do not duplicate the type definition manually.
- Name schemas with a `Schema` suffix: `GenerationRequestSchema`, `BodyAreaSymptomSchema`.
- For DTOs in NestJS, keep `class-validator` on the DTO classes (NestJS pipes require them). Use Zod for non-NestJS validation contexts (workers, webhooks, config loading).

### Patterns

```typescript
// ✅ Schema as single source of truth
const BodyAreaSymptomSchema = z.object({
  bodyAreaId: z.string().uuid(),
  symptomId: z.string().uuid(),
  severity: z.number().int().min(1).max(10),
})
type IBodyAreaSymptom = z.infer<typeof BodyAreaSymptomSchema>

// ✅ Environment validation at startup - fail fast
const EnvSchema = z.object({
  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().default(5432),
  PGDATABASE: z.string().default('api_chirp_db'),
  REDIS_ENABLED: z.coerce.boolean().default(true),
})
const env = EnvSchema.parse(process.env)

// ✅ safeParse for expected-failure paths (user input, webhooks)
const result = GenerationRequestSchema.safeParse(body)
if (!result.success) {
  return { error: 'Invalid request', details: result.error.flatten() }
}

// ✅ parse for programmer-error paths (config, env) - crash is correct behavior
const config = ConfigSchema.parse(rawConfig)
```

### Anti-Patterns

- Do not `.parse()` the same data twice in different layers - validate once at the boundary, then trust the typed result downstream.
- Do not define Zod schemas inside functions - define at module level and reuse.
- Do not use `.transform()` for complex business logic - keep transforms limited to coercion (string → number, ISO string → Date). Business logic belongs in services.
- Do not mix Zod and `class-validator` on the same object - pick one per context.

## API Layer Conventions (NestJS)

### Controllers

- Keep controllers thin: parse/validate/route only.
- Delegate business logic to services.
- Keep explicit return types.
- Use route semantics intentionally (GET read-only, POST mutations, etc.).
- Private controller methods that implement non-trivial business logic are a hard review failure; extract that logic into a service.

### Authentication and Authorization

Controllers must use the established guard and decorator patterns:

**Public endpoints (authenticated user):**

```typescript
@ApiTags('feature')
@Controller('feature')
@UseGuards(FirebaseAuthGuard)
@ApiBearerAuth()
export class FeatureController {
  @Get()
  public async list(@GetUser() user: IUserPayload): Promise<FeatureListResponse> {
    return this.featureService.list(user.userId)
  }
}
```

**Admin-only endpoints:**

```typescript
@ApiTags('admin')
@Controller('admin/feature')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class FeatureAdminController { ... }
```

Key patterns:

| Decorator/Guard                 | Source            | Purpose                                                            |
| ------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `@UseGuards(FirebaseAuthGuard)` | `@workspace/auth` | Validates Firebase Bearer token                                    |
| `@UseGuards(RolesGuard)`        | `@workspace/auth` | Enforces role-based access (used with `@Roles`)                    |
| `@Roles(UserRole.ADMIN)`        | `@workspace/auth` | Declares required role                                             |
| `@GetUser()`                    | `@workspace/auth` | Extracts `IUserPayload` from request (has `userId`, `uid`, `role`) |
| `@ApiBearerAuth()`              | `@nestjs/swagger` | Swagger auth metadata                                              |

### Admin/Public Controller Split

When a module needs both user-facing and admin endpoints, create two controllers in the same module:

- `<feature>.controller.ts` - public, `@Controller('feature')`, `@UseGuards(FirebaseAuthGuard)` only
- `<feature>-admin.controller.ts` - admin, `@Controller('admin/feature')`, `@UseGuards(FirebaseAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)`

Both registered in the module's `controllers: [FeatureController, FeatureAdminController]`.

### DTOs

- Names should describe transport role: `*QueryDto`, `*Request`, `*Response`.
- Use class-validator for request validation.
- Use class-transformer where conversion is needed.
- Swagger decorators must match runtime shape (`ApiPropertyOptional`, `nullable: true`, `isArray`, `enumName`, `type`).
- **Use named command/input types for service methods** - when a service method accepts 4+ parameters, introduce a named interface (e.g., `ICreateReportInput`) instead of positional args. This is different from the single-use-parameter anti-pattern: command types represent a domain concept (the "create" input) at a boundary crossing, not a forwarding wrapper for a private method. See "Single-use parameter wrapper interfaces" for the disambiguator and worked example.
- **No booleans over API boundaries.** Do not return bare `boolean` fields in response DTOs when a string enum would be clearer and more extensible. Instead of `{ eligible: true, reason: null }` use a single status enum: `{ status: 'AVAILABLE' }`. This avoids the boolean + nullable companion anti-pattern and makes the contract self-documenting. When a boolean seems needed, ask whether a discriminant enum with two or more named values would serve the consumer better.
- **Boolean query parameters require explicit `@Transform` + strict comparison.** HTTP query params arrive as strings. `"false"` is truthy in JavaScript, so `if (selectable)` passes when the client sends `selectable=false`. Always use `@Transform` with explicit `=== 'true'` / `=== 'false'` conversion on boolean query DTO fields, and guard conditionals with `!== undefined` instead of truthiness checks.

```typescript
// ❌ boolean + nullable reason - ambiguous, not extensible
export class EligibilityResponse {
  public eligible: boolean
  public reason: string | null
}

// ✅ single status enum - self-documenting, extensible
export enum EligibilityStatus {
  AVAILABLE = 'AVAILABLE',
  DAILY_LIMIT_REACHED = 'DAILY_LIMIT_REACHED',
  SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED',
}
export class EligibilityResponse {
  public status: EligibilityStatus
}
```

- **No client-computable fields in responses.** Do not include fields the client can derive from other fields already in the response. If the response contains a `date` field and the client knows what "today" is, do not add an `isToday` boolean - the client computes `date === today` trivially. Each redundant field adds serialization cost, contract surface, and a staleness risk if the derivation logic ever diverges between server and client.

### Module-Scoped Config

Do not use raw `ConfigService.get<T>('ENV_VAR')` in feature module services. The correct pattern is a validated config class registered via `ConfigModule.forFeature()` and injected with `@Inject(config.KEY)`.

Bad - raw access, no validation, duplicated across services:

```typescript
constructor(private readonly configService: ConfigService) {
  this.arn = this.configService.get<string>('LAMBDA_ARN', '')
}
```

Good - validated, typed, single source of truth:

```typescript
// config/feature.config.ts
export class FeatureConfig {
  @IsString()
  @IsOptional()
  public LAMBDA_ARN?: string
}
export const featureConfig = registerAs('featureConfig', () => load(FeatureConfig))

// feature.service.ts
constructor(@Inject(featureConfig.KEY) private readonly config: FeatureConfig) {}
```

Infrastructure-level configs from `@workspace/*` packages (e.g., `databaseConfig`, `storageConfig`, `redisConfig`) use the same `registerAs` + `load` pattern but are registered globally in the root module's `ConfigModule.forRoot({ load: [...] })`.

### NestJS Interceptors, Pipes, and Guards - Composition Rules

- Apply guards at the controller class level (not per-method) unless a single method has different auth requirements.
- Use global pipes (`ValidationPipe`) via `app.useGlobalPipes()` for DTO validation - do not repeat `@UsePipes()` on individual endpoints.
- Use interceptors for cross-cutting concerns (logging, response transformation, timeout). Keep interceptor logic stateless; inject services if needed.
- When composing multiple guards, order matters - authentication guards run before authorization guards: `@UseGuards(FirebaseAuthGuard, RolesGuard)`.
- Do not put business logic in interceptors or pipes. These are infrastructure concerns only.
- **Prefer explicit opt-in over global registration** for feature-level interceptors. Wrap in a composite decorator and apply at the controller class level. Global interceptor registration is appropriate only for true infrastructure (logging, error handling), not feature behavior.

## Service and Repository Boundaries

### Services

- Own business rules, orchestration, and response shaping.
- Use guard clauses to reduce nesting.
- Keep method names action-oriented.

### Service Decomposition

When a service grows beyond 5-6 constructor dependencies or mixes read/write/presentation concerns, split by responsibility:

| Pattern                    | When to use                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Command/Query split**    | Service mixes read-only queries with write mutations. Separate into a write service and a query service.                              |
| **Lifecycle split**        | Service handles multiple state transitions (create, complete, cancel) plus sub-entity management. Separate by state-transition scope. |
| **Side-effect extraction** | Service mixes core logic with side effects (analytics, notifications). Extract or decouple via events.                                |

Rules:

- Each split service should have a clear, non-overlapping responsibility.
- The orchestration service (if one remains) delegates to split services - it does not duplicate their logic.
- After splitting, verify constructor dependency count decreases. If it doesn't, the split wasn't the right boundary.

### Entity → Response Mapping

The response DTO owns its own mapping. Give the response class a constructor (or a static `fromEntity` / `fromProjection` when entity-specific parsing must happen before assignment) that takes the entity/projection and assigns fields. The controller calls `new FeatureResponse(entity)`. Services return entities/projections, never response DTOs; repositories return entities/projections, never response DTOs.

Do not introduce presenter/mapper services or standalone mapper functions for ordinary entity-to-response mapping. The DTO constructor is the mapping; a separate service is indirection that earns its place only when the identical mapping is reused across very different outputs with injected dependencies (rare).

```typescript
// ✅ response DTO maps itself
export class FeatureResponse {
  public id: string
  public name: string
  constructor(entity: FeatureEntity) {
    this.id = entity.id
    this.name = entity.name
  }
}
// controller
return new FeatureResponse(entity)

// ✅ static factory when parsing is required before assignment
public static fromEntity(entity: PartEntity): PartResponse { /* parse, then new PartResponse({...}) */ }

// ❌ repository returning a response DTO - repositories return entities/projections
public findAll(): Promise<FeatureResponse[]> { ... }
```

Pick one construction convention and keep it: prefer `new X(entity)`; use `X.fromEntity(entity)` only when a transform is unavoidable, and do not mix both for the same DTO.

### Repository Boundaries

- Repositories return entities or typed projections - never API response DTOs.
- Repositories never inject services. If mapping logic requires a service, it belongs in the service layer.
- Repositories never cross aggregate boundaries (e.g., an XP repository should not query a profiles table directly).
- Two categories: **aggregate repositories** (writes + aggregate loading) and **query/projection repositories** (read models, list projections).

### Redis Caching Pattern

Services that cache data follow a read-through pattern:

```typescript
public async getData(id: string): Promise<TData> {
  const cacheKey = CACHE_KEYS.RESOURCE(id)
  const cached = await this.redisService.get<TData>(cacheKey)

  if (cached !== null) {
    return cached
  }

  const data = await this.repository.findById(id)
  await this.redisService.set(cacheKey, data, CACHE_TTL_SECONDS)
  return data
}
```

Cache keys are defined in `apps/api/src/shared/cache.constants.ts`. Workers and webhooks invalidate these keys after writes.

### Cache Invalidation Strategies

For write-through invalidation (data changes in DB, cache must reflect it):

- Delete the cache key immediately after a successful write transaction commits - do not update the cached value (delete + let next read repopulate avoids stale partial updates).
- When a write affects multiple cache keys (e.g., updating a body area affects `lookups:body-areas:all`), enumerate all affected keys and delete them in a single pipeline call.
- Cache invalidation from workers/webhooks must reference the same key constants as the API to prevent key drift.

### Cache Stampede Prevention

For high-traffic cache keys with expensive regeneration (e.g., lookup tables fetched by every request):

- **Mutex lock pattern** - on cache miss, acquire a short-lived Redis lock (`SET lock:${key} 1 EX 5 NX`). If lock acquired, regenerate and cache. If lock not acquired, wait briefly and retry (or return stale data if available).
- **Stale-while-revalidate** - store data with a physical TTL longer than the logical TTL. On read, if logical TTL has expired but physical TTL has not, serve stale data and trigger async background refresh.
- Reserve stampede protection for keys that are both frequently accessed AND expensive to regenerate. Simple key-value lookups with fast DB queries do not need it.

### Repositories

- Keep persistence-focused and predictable.
- Prefer typed return shapes.
- Keep API response mapping in services unless repository contract is intentionally API-oriented.
- For paginated database-backed reads, apply filtering and pagination in the database query, never in memory.
- Ensure deterministic ordering at query level before pagination (`ORDER BY` + `LIMIT/OFFSET` or cursor predicate).

## Error Handling

- Prefer typed/domain-specific errors over generic `Error`.
- Convert low-level errors to stable application-facing errors at boundaries.
- Keep messages actionable and specific.

### Domain Error Classes

Define a base error class per app/module with a `code` discriminant. Keep all related error classes in a single `errors.ts`:

```typescript
// errors.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class GoalNotFoundError extends AppError {
  constructor(goalId: string) {
    super('GOAL_NOT_FOUND', `Goal ${goalId} not found`, 404)
  }
}

export class NoExercisesPassedFilterError extends AppError {
  constructor() {
    super('NO_EXERCISES_PASSED_FILTER', 'No exercises passed the filter criteria', 422)
  }
}
```

### Error Handling at Boundaries

Controllers and queue processors are the error boundary - they catch domain errors and translate to HTTP status codes or queue retry decisions. Services should throw domain errors; they should not catch-and-rethrow without adding information.

### Result Types (Optional - Evaluate for New Projects)

> **Industry note:** The `neverthrow` library provides a `Result<T, E>` type that makes errors explicit in function signatures, preventing forgotten error handling. This is gaining traction in production TypeScript codebases (as of 2025). It aligns well with the existing codebase's C++ pattern of `std::expected<T, E>`. Consider adopting for new services or modules where typed error propagation across service boundaries would reduce error-handling bugs. Do not retrofit into existing NestJS services that already use throw-based patterns - the migration cost is high and NestJS exception filters expect thrown errors.

If adopting `neverthrow`, wrap third-party calls (DB, Redis, HTTP) in `try/catch` at the infrastructure boundary and return `Result` from there:

```typescript
import { ok, err, Result } from 'neverthrow'

const findGoal = async (goalId: string): Promise<Result<IGoal, AppError>> => {
  try {
    const goal = await repository.findOne({ where: { id: goalId } })

    if (!goal) {
      return err(new GoalNotFoundError(goalId))
    }

    return ok(goal)
  } catch (e) {
    return err(new DatabaseError(e))
  }
}
```

## Async and Concurrency

- No floating promises.
- Use `void` for intentional fire-and-forget.
- Do not mark function `async` when it does not await.
- Use `Promise.all` for independent operations.
- Keep sequential `await` when order matters.

### `Promise.all` vs `Promise.allSettled`

- Use `Promise.all` when all operations must succeed for the overall operation to be valid (default choice).
- Use `Promise.allSettled` when partial success is acceptable and you need to inspect individual results (e.g., sending notifications to multiple users where some may fail).
- Never use `Promise.allSettled` as a lazy way to ignore errors - always inspect and handle the `rejected` entries.

### Parallelization across short-circuits

Before replacing sequential `await`s with `Promise.all`, check whether the second call is gated by a downstream early return on the first. Eager parallelization is correct only when both results are always needed.

When the first call's result can short-circuit the second, parallelizing pays for work the caller never needed AND converts a no-op path into a new failure point. The DB or network call that used to never run can now fail and propagate.

```typescript
// ❌ unsafe: when Tier 1 fills the result, Tier 2 was never needed,
// but it now runs unconditionally and any failure surfaces to the caller
const [tier1, tier2] = await Promise.all([
  this.repo.findPersonal(profileId),
  this.repo.findCommunityBodyAreas(profileId),
])
const result = personalize(tier1)
if (result.length >= max) {
  return result // tier2 work was wasted, and a tier2 failure would have killed this path
}

// ✅ keep sequential: tier2 only runs when tier1 did not fill the result
const tier1 = await this.repo.findPersonal(profileId)
const result = personalize(tier1)
if (result.length >= max) {
  return result
}
const tier2 = await this.repo.findCommunityBodyAreas(profileId)
```

Rule of thumb: if there is an `if (...) return` between the two `await`s in the sequential version, do not parallelize. The early return is communicating that tier 2 is conditional, and `Promise.all` erases that information.

### Avoiding Unnecessary `async`/`await`

When a function returns a single promise without needing to `await` intermediate results, return the promise directly instead of making the function `async`:

```typescript
// ❌ unnecessary async wrapper
const getData = async (id: string): Promise<IData> => {
  return await this.repository.findById(id)
}

// ✅ return promise directly
const getData = (id: string): Promise<IData> => {
  return this.repository.findById(id)
}
```

Exception: keep `async` when you need `try/catch` around the awaited call, or when the function has multiple `await` statements.

## Queue and Worker Patterns (BullMQ)

### Job Design

- Job payloads must be JSON-serializable - no class instances, no functions, no circular references.
- Keep payloads minimal - include IDs and metadata, not full entity objects. Let the worker fetch fresh data.
- Use a stable `jobId` for natural idempotency keys (e.g., `welcome-email:${userId}`) to prevent duplicate processing.

### Idempotency

Workers and webhook handlers must be idempotent. The same job or event processed twice must produce the same outcome:

- Check for completion before performing side effects (e.g., DB flag `emailSent` checked before sending).
- Use database transactions with unique constraints to guard against duplicate writes.
- Design external API calls to be idempotent (use idempotency keys where available).
- **The duplicate check must gate the entire processing pipeline.** If idempotency is enforced via `ON CONFLICT DO NOTHING` on an events table, that check must happen before any other writes in the same transaction. If the event is a duplicate, ALL side effects must be skipped - not just the event log insert. Partial idempotency (guarding one table but unconditionally upserting another) allows stale event replays to overwrite current state.
- **Webhook handlers must not reject unknown event types with 4xx.** Most webhook providers (RevenueCat, Stripe, etc.) treat 4xx as permanent client errors and stop retrying. If the provider introduces new event types not yet in your enum, a 400 from DTO validation permanently drops those events with no recovery path. Instead: validate structure (auth header, JSON shape) strictly, but handle unknown `event.type` values gracefully - return 200, log to a failures/audit table, and skip processing.

### Retry and Backoff

- Use exponential backoff for retries: `{ attempts: 3, backoff: { type: 'exponential', delay: 1000 } }`.
- Set reasonable `attempts` limits - infinite retries flood the queue.
- Route permanently failed jobs to a dead letter queue (DLQ) via `@OnWorkerEvent('failed')` after max retries exhausted.
- Use `removeOnComplete` and `removeOnFail` options to prevent Redis memory bloat from completed/failed job records.

### Graceful Shutdown

- Use `onModuleDestroy` lifecycle hook to close worker connections cleanly.
- Listen for `SIGINT` and `SIGTERM`; let in-flight jobs complete before exiting.
- Do not use `SIGKILL` in orchestration (Kubernetes, PM2) - give workers a grace period.

### Separation of Concerns

- API apps enqueue jobs only - no processing logic in the API process.
- Worker apps process jobs - they import queue definitions and register processors.
- Shared job types and queue names live in a shared location (e.g., `apps/<app>/src/shared/`) with cross-app duplication documented.

## Commenting and Documentation

- Keep code mostly self-documenting.
- Add comments only for non-obvious constraints and side-effect ordering.
- Comments explain "why", not "what". Avoid comments that restate code.
- Complex logic has explanatory comments or is broken into named steps.
- No `@ts-ignore` or `@ts-expect-error`; fix the underlying type issue instead.
- No `oxlint-disable` unless there is a documented, unavoidable reason inline.

## Testing Alignment

- Use the project's shared setup helpers and factories when they exist.
- Keep assertions strict and aligned with contract.
- Keep tests deterministic and isolated.

## Architecture Principles

- Appropriate separation of concerns - no god functions, no mixed layers.
- No unnecessary coupling between modules.
- No premature abstraction - abstraction must be earned by real duplication.
- Keep service/repository/controller boundaries clean.
- No over-modularization in single-purpose apps - lambdas/workers with one pipeline should use flat module structure, not `core/` + `feature/` hierarchies.
- No 3-layer service chains where the intermediate adds no branching logic - collapse to 2 layers (orchestrator + specialized).
- No standalone helper files with functions used in exactly one place - inline as private methods.

### Module Boundaries in NestJS

- A module should represent a cohesive domain concept (users, routines, equipment), not a technical layer (all repositories in one module, all services in another).
- Cross-module imports are normal and expected - `FeatureModule` importing `MediaModule` is fine.
- Export only what other modules need. If a provider is only used internally, do not export it.
- When two modules develop tight bidirectional coupling (each importing from the other), merge them or extract a shared third module.
- Lazy-load modules (dynamic imports) only when startup time is measurably impacted - NestJS `LazyModuleLoader` adds complexity that is rarely justified.

### Event-Driven Patterns

Choose the right tool for the job:

- **Direct method call** (default) - for synchronous, in-process communication between services within the same module.
- **BullMQ queues** - for async fire-and-forget work that needs retry, backoff, rate limiting, or must survive process restarts. Use for image processing, email sending, webhook delivery.
- **Redis Pub/Sub** - for real-time fan-out notifications where message loss is acceptable (e.g., cache invalidation broadcasts across API instances).
- **NestJS `EventEmitter2`** (`@nestjs/event-emitter`) - for in-process event-driven decoupling where you want multiple listeners to react to a single action without the producer knowing about them. Appropriate for analytics tracking, audit logging, secondary effects.

#### In-Process Event Conventions

Domain events decouple core business logic from side effects (analytics, notifications, audit logging). The pattern:

1. **Define typed events** with `as const` event name constants and typed payload interfaces
2. **Emit from domain services** after core state transitions - emitting service does NOT import side-effect services
3. **Listen in side-effect modules** - `@OnEvent()` handlers react independently, using their own infrastructure (analytics APIs, Redis, etc.)
4. **Event-emitter is a decoupling mechanism**, not a replacement for existing infrastructure. Listeners still use the same services and databases.

```typescript
// Domain service - emits event, does NOT know about analytics
this.eventEmitter.emit(DOMAIN_EVENTS.ORDER_COMPLETED, { orderId, customerId, total })

// Analytics listener - reacts to event, uses real infrastructure
@OnEvent(DOMAIN_EVENTS.ORDER_COMPLETED)
public handleOrderCompleted(event: IOrderCompletedEvent): void {
  this.analyticsService.track(event.customerId, 'order_completed', { ... })
}
```

**Critical constraint: do NOT use events for transactional side effects.** If a side effect must be part of a DB transaction (e.g., awarding points, updating balances, creating linked records inside `dataSource.transaction()`), keep it as a direct method call. Events are fire-and-forget - they cannot participate in transaction rollback.

Avoid EventEmitter for anything that must survive a process crash - use queues instead.

### Graceful Shutdown

All long-lived Node.js processes (API servers, workers) must handle shutdown cleanly:

```typescript
// main.ts
app.enableShutdownHooks()
```

The shutdown sequence:

1. Stop accepting new requests/jobs.
2. Wait for in-flight requests/jobs to complete (with a timeout).
3. Close database connection pools.
4. Close Redis connections.
5. Exit.

NestJS `OnModuleDestroy` and `BeforeApplicationShutdown` lifecycle hooks handle steps 2-4 when `enableShutdownHooks()` is called. Ensure every provider that holds a connection implements the appropriate hook.

### Health Checks

- Expose `/ping` (or `/health`) for load balancer probes - return 204 with no body.
- For richer health checks, verify connectivity to critical dependencies (database, Redis, queue broker) and return a structured response with per-dependency status.
- Keep health check handlers fast - they are called frequently. Do not run expensive queries.

## Code Quality Principles

1. Behavior-preserving by default.
2. Apply YAGNI: do not add features that are not needed now.
3. Prefer WET over unnecessary abstraction (Rule of Three: write it once - just write it; write it twice - notice but resist abstracting; write it a third time - now evaluate whether the cases share the same reason to change; if yes abstract, if no keep separate).
4. Keep implementations smaller: reduce real logic surface, not cosmetic one-liners/comment removal.
5. Do not extract code into one-off helpers/methods by default; only extract when it clearly reduces real complexity (including linter-driven complexity/size limits), materially improves readability with a well-defined responsibility, and has a strong likelihood of reuse.
6. Treat functions/methods with many seemingly unrelated parameters as a code smell; investigate whether responsibilities should be clarified or split by concern (without splitting for the sake of splitting).
7. Eliminate unnecessary indirection: every layer of wrapping (trivial methods, single-use wrapper interfaces, barrel files, parameter objects used at one call site) adds navigation cost; remove wrappers that do not reduce real complexity.
8. Avoid verbose data transformations: when a source structure already matches the target type, assign directly instead of copying field-by-field; field-by-field mapping is only justified when transformation, validation, or field subsetting occurs.
9. Avoid redundant work: when an expensive operation (IO, parsing, computation) has already been performed and its result is available, pass the result down instead of re-executing the operation.
10. No magic strings or numbers; extract into named constants.
11. Wrap multi-write operations in transactions.
12. No `any`; use `unknown` and narrow with type guards or validation.
13. Derive types from existing ones (`Pick`, `Omit`, `Partial`) instead of copy-pasting fields.
14. Remove dead code aggressively - unused methods/types/exports/tests/config keys/dependencies.
15. Do not keep compatibility shims unless explicitly requested.
16. Do not add backwards compatibility layers unless explicitly requested by the user. If there is strong reasoning to add backwards compatibility, pause and ask user clarification before implementing.

## Query and Data Access

- No SQL/ORM N+1 query patterns; verify query efficiency on touched paths.
- Fetch only needed columns; avoid over-fetching; paginate large result sets.
- HARD FAIL: for database-backed paginated results, perform both filtering and pagination in the database query layer; never filter/slice in memory.
- Define deterministic ordering for any user-visible list, pagination, queue, or time-sequenced processing.
- HARD FAIL: when `ORDER BY` is combined with `LIMIT`, the final sort key must be unique (typically a primary key like `id ASC`). Without it, equal-ranked rows can shuffle between calls, producing user-visible drift, flaky tests, and non-deterministic pagination. Worked example: `ORDER BY p.profile_count DESC, qo.text ASC LIMIT 5` is unsafe when `(profile_count, text)` can tie - add `qo.id ASC` as the last key. The same rule applies to in-memory `.sort()` followed by `.slice()` and to ORM `find({ order: {...}, take: N })`.
- Verify supporting indexes exist for new/changed query paths (including composites matching `WHERE` + `ORDER BY`); remove redundant indexes.
- No injection-prone patterns (SQL/NoSQL/command/template); use parameterization/safe APIs.
- No multi-write operations without a transaction boundary.

### TypeORM Patterns

- Prefer QueryBuilder over raw SQL for type-safe, composable queries. Use raw SQL only for performance-critical queries where QueryBuilder overhead is measurable.
- Use `.select()` to fetch only needed columns in read-heavy paths.
- For relations, use explicit `leftJoinAndSelect` or `loadRelationCountAndMap` - do not rely on `eager: true` entity configuration (it causes implicit N+1 on every query).
- Wrap multi-entity writes in `queryRunner.startTransaction()` / `commitTransaction()` / `rollbackTransaction()`. Use `try/finally` to ensure `queryRunner.release()`.
- For migrations: one logical change per migration, write both `up` and `down`, keep migrations backward-compatible (add columns as nullable first, then backfill, then add NOT NULL in a follow-up migration).
- **Soft-delete cascading requires explicit ORM configuration.** DB-level `ON DELETE CASCADE` constraints only fire on hard deletes - TypeORM `softDelete(id)` does not trigger them. To cascade soft-deletes to child entities: (1) add `@DeleteDateColumn` to every child entity, (2) add `cascade: ['soft-remove', 'recover']` to the parent's `@OneToMany` relation, (3) load the parent with all relations via `findOne({ relations: [...] })`, then call `softRemove(entity)` instead of `softDelete(id)`.
- **Uniqueness with soft-deletes requires a partial unique index.** A plain `UNIQUE` constraint on a column prevents reuse of names/slugs after soft-delete because the deleted row still satisfies the constraint. Use a partial index `CREATE UNIQUE INDEX ... ON table (column) WHERE deleted_at IS NULL` so uniqueness is enforced only among active records. Enforce uniqueness at the application level too (query before write) for user-facing error messages - the DB index is a safety net, not a substitute for proper 409 responses.
- **Soft-delete bypasses DB-level FK constraints (`ON DELETE RESTRICT`).** TypeORM `softDelete`/`softRemove` sets `deleted_at` without triggering DB FK checks. An entity referenced by active children can be soft-deleted without error, leaving dangling references. The application layer must check for active references before soft-deleting and return 409 if any exist. Additionally, TypeORM's automatic `WHERE deleted_at IS NULL` filter does NOT apply to eagerly joined relations - a `leftJoinAndSelect` on a soft-deleted child will return `null`, causing DTO constructors that access `child.id` to throw TypeError → 500. Guard DTO constructors against null joined relations or filter soft-deleted rows in the query.
- **TOCTOU (Time-of-Check vs Time-of-Use) on unique constraints.** When a service checks for existence before inserting (e.g., `hasVotedToday()` → `save()`), a concurrent request can pass the check before the first request's insert commits. The application-level check provides a fast user-facing 409, but the DB unique index is the real safety net. Always handle both: (1) check first for a clean error message, (2) catch the unique constraint violation (`error.code === '23505'` in PostgreSQL) at the `save()` call and convert it to a `ConflictException`. Without the catch, the DB violation bubbles as a 500 instead of 409. This applies to any check-then-write pattern guarded by a unique index - dedup checks, idempotency keys, slug uniqueness, daily limits.

```typescript
// ✅ handle both the fast check and the DB constraint race
const hasVoted = await this.repository.hasVotedToday(profileId, label, today)
if (hasVoted) {
  throw new ConflictException('Already voted today')
}

try {
  await manager.save(VoteEntity, { profileId, label, votedDate: today })
} catch (error: unknown) {
  if (error instanceof QueryFailedError && (error as any).code === '23505') {
    throw new ConflictException('Already voted today')
  }
  throw error
}
```

- **Use `EntityManager` type for transaction manager parameters.** When a private method receives a manager from `dataSource.transaction()`, type the parameter as `EntityManager` - not a hand-rolled interface like `{ query: (sql: string, parameters: unknown[]) => Promise<unknown[]> }`. The custom interface masks eslint's `no-unsafe-assignment` checks and loses access to `EntityManager` methods like `findOne`, `save`, and `createQueryBuilder`.
- **Use `manager.query<T[]>(...)` generic instead of `as` cast.** `EntityManager.query()` returns `Promise<any>`. Always pass a generic type parameter to get typed results without `as` casts:

```typescript
// ❌ as cast - bypasses type safety, triggers no-unsafe-assignment
const rows = (await manager.query(`SELECT ...`, [id])) as { id: string }[]

// ✅ generic - typed at the call site
const rows = await manager.query<{ id: string }[]>(`SELECT ...`, [id])
```

- **Never catch unique constraint violations inside a transaction and continue.** When an `INSERT` fails with a unique violation (`23505`) inside a PostgreSQL transaction, the transaction enters an aborted state - all subsequent commands fail with `current transaction is aborted, commands ignored until end of transaction block`. The TOCTOU `try/catch` pattern above is safe because the catch re-throws or the transaction ends. But if you catch the violation and try to continue with more writes in the same transaction (e.g., catch a duplicate event insert and still commit the subscription upsert), the entire transaction rolls back silently. Use `ON CONFLICT DO NOTHING` (via QueryBuilder `.orIgnore()`) instead - it does not abort the transaction:

```typescript
// ❌ catch inside transaction - poisons the transaction, rolls back prior writes
try {
  await manager.save(EventEntity, { eventId, ... })
} catch (error: unknown) {
  if (isUniqueViolation(error)) {
    return true // transaction is already aborted - this "succeeds" but prior writes are lost
  }
  throw error
}

// ✅ orIgnore() - ON CONFLICT DO NOTHING, transaction stays healthy
const result = await manager.createQueryBuilder()
  .insert()
  .into(EventEntity)
  .values({ eventId, ... })
  .orIgnore()
  .execute()

return result.identifiers.length === 0 // true = duplicate (no insert happened)
```

## Preferred Patterns

### One-off extraction policy

- default to inline code when extracted helpers would be called only once
- extract only when one of these is true: complexity/size reduction (including lint constraints), clearly better readability with a well-defined responsibility, or likely near-term reuse
- rationale: avoid deep one-time call chains that force readers to jump across multiple functions and reduce navigability

### Algorithm preservation when extracting pure functions

When extracting a pure function whose output is observable downstream (deterministic shuffle seeds, hash-derived bucket assignments, ID-encoding schemes, ordering tiebreakers, anything backed by a fixed-seed PRNG), copy the body byte-for-byte. The function looks tidyable, but its output is part of an implicit contract: tests pin a specific permutation, users have a stable per-day card order, downstream caches key off the encoded value.

Things that look like cleanup but silently flip the contract:

- swapping a hand-rolled LCG for `Math.random()` or `crypto.randomBytes()`
- replacing bitwise twiddling (`| 0`, `& 0xff`) with arithmetic equivalents - they look identical until a 32-bit overflow case differs
- replacing a manual djb2 hash with `crypto.createHash('sha256')`
- swapping `Math.abs((x * 1664525 + 1013904223) | 0)` with `Math.floor(...)` because the bitwise OR "looks odd"
- changing the loop direction or the index used to compute the swap partner

If any of these would change the output for a given input, the extraction is no longer behaviour-preserving and the test suite that pins downstream order has to change with it. That is acceptable but it is no longer a refactor - it is a behavioural change in disguise.

Rule: copy the body, keep the `// oxlint-disable` comments that flagged the intentional-bit-twiddling, do not "tidy." If a cleaner algorithm is genuinely better, propose it as a separate behavioural-change commit with the test suite updated to match the new permutation.

### Inline one-call wrappers

```typescript
// ❌
const getUsers = async () => fetchData('/api/users')
const users = await getUsers()

// ✅
const users = await fetchData('/api/users')
```

### Trivial wrapper methods - inline the delegation

```typescript
// ❌ wrapper that only hardcodes one argument
private async cleanupTempFile(key: string): Promise<void> {
  await this.cleanupFile(key, 'temp file')
}
await this.cleanupTempFile(tempKey)

// ✅ call the real method directly
await this.cleanupFile(tempKey, 'temp file')
```

### Single-use parameter wrapper interfaces - use direct params

```typescript
// ❌ interface used at exactly one call site for a private method
interface IProcessInput {
  buffer: Buffer
  entityId: string
  config: IConfig
}
private async process(input: IProcessInput): Promise<void> {
  const { buffer, entityId, config } = input
  // ...
}

// ✅ direct parameters (consistent with sibling methods)
private async process(
  buffer: Buffer,
  entityId: string,
  config: IConfig,
): Promise<void> {
  // ...
}
```

**Allowed (and recommended): typed input objects at module boundaries.** The
anti-pattern above targets _private passthrough wrappers_ whose only job is to
forward args to another internal method. It does NOT cover the legitimate use
of a typed input where the method is a real contract boundary.

A typed input is the right call when ALL of these hold:

1. The method is a boundary crossing (repository query, service entry point,
   queue consumer entry, webhook handler) - not an internal helper.
2. The parameter list is heterogeneous: a mix of IDs, dates, arrays, numeric
   thresholds, and option flags. Same-typed positional args (e.g. three `string`
   IDs) are the trap a typed input prevents.
3. The internal positional binding is non-obvious. The two community-tier
   queries in `activity-card` are the worked example: same TypeScript argument
   list, but each method binds those args to _different_ SQL `$N` placeholder
   positions internally. A renamed positional call site silently passes the
   wrong value; a named input cannot.

```typescript
// ✅ typed input at a repository boundary - heterogeneous params,
//    same shape feeds two methods that bind positions differently
export interface ICommunityActivitiesInput {
  currentProfileId: string
  expandedBodyAreaIds: string[]
  lookbackDate: Date
  loggedToday: string[]
  excludeOptionIds: string[]
  minProfiles: number
  limit: number
}

public findCommunityPopularActivities(
  input: ICommunityActivitiesInput,
): Promise<ICommunityPopularProjection[]> {
  // SQL keeps positional $N; the public boundary is named.
}
```

The rule of thumb: if dropping the wrapper would force you to add
`// oxlint-disable-next-line max-params` to call sites, the typed input is
not a wrapper - it is the contract. Keep it.

### Passthrough methods - merge when public only packs params for a private method

```typescript
// ❌ public method does nothing except pack params into an object and forward
interface ITranscodeOptions {
  inputPath: string
  outputDir: string
  probeResult: IProbeResult
  presets: string[]
}
public transcode(
  inputPath: string,
  outputDir: string,
  probeResult: IProbeResult,
  presets: string[],
): Promise<IResult> {
  return this.transcodeVariants({ inputPath, outputDir, probeResult, presets })
}
private async transcodeVariants(options: ITranscodeOptions): Promise<IResult> {
  const { inputPath, outputDir, probeResult, presets } = options
  // actual logic here
}

// ✅ merge into one method; delete the wrapper interface
public async transcode(
  inputPath: string,
  outputDir: string,
  probeResult: IProbeResult,
  presets: string[],
): Promise<IResult> {
  // actual logic here (no forwarding, no wrapper interface)
}
```

### Verbose field-by-field copy - assign directly when shapes match

```typescript
// ❌ manual copy when source already matches target type
this.configs = new Map(
  Object.entries(raw.entities).map(([name, cfg]) => [
    name,
    {
      tableName: cfg.tableName,
      s3Prefix: cfg.s3Prefix,
      outputFormat: cfg.outputFormat,
      sizes: Object.fromEntries(
        Object.entries(cfg.sizes).map(([k, v]) => [
          k,
          {
            maxWidth: v.maxWidth,
            maxHeight: v.maxHeight,
          },
        ])
      ),
    },
  ])
)

// ✅ direct assignment - source shape matches IEntityImageSchema
this.configs = new Map(Object.entries(raw.entities).map(([name, cfg]) => [name, cfg]))
```

### Redundant expensive calls - pass results down

```typescript
// ❌ metadata fetched in outer method, then re-fetched on same buffer in inner
const metadata = await this.getMetadata(buffer) // outer
// ... later:
private async processOriginal(buffer: Buffer): Promise<void> {
  const metadata = await this.getMetadata(buffer) // duplicate call
}

// ✅ pass the already-computed metadata
private async processOriginal(buffer: Buffer, metadata: IMetadata): Promise<void> {
  // uses metadata directly - no duplicate IO
}
```

### No `any` - use `unknown` + narrowing

```typescript
// ❌
const data: any = await response.json()
data.name.toUpperCase()

// ✅
const data: unknown = await response.json()
const parsed = UserSchema.parse(data)
parsed.name.toUpperCase()
```

### Derive types instead of copy-pasting fields

```typescript
// ❌
interface UserSummary {
  id: string
  name: string
}

// ✅
type UserSummary = Pick<User, 'id' | 'name'>
```

### No barrel exports (except package entry files)

```typescript
// ❌ services/index.ts re-exporting siblings
export { UserService } from './user.service'
export { OrderService } from './order.service'

// ✅ import directly from source
import { UserService } from './services/user.service'
```

### Magic values → named constants

```typescript
// ❌
if (retries > 3) { ... }
const key = `cache:user:${id}`

// ✅
const MAX_RETRIES = 3
const CACHE_PREFIX_USER = 'cache:user'

if (retries > MAX_RETRIES) { ... }
const key = `${CACHE_PREFIX_USER}:${id}`
```

### Guard clause bracing (hard fail)

```typescript
// ❌ single-line return is not allowed
if (!user) return null

// ✅ always use braces + multiline
if (!user) {
  return null
}

if (!user.isActive) {
  return null
}

if (!hasPermission(user)) {
  return null
}
```

### No escape hatches

```typescript
// ❌
// @ts-ignore
// @ts-expect-error
// oxlint-disable-next-line typescript/no-unused-vars
const data: any = value

// ✅ fix the actual problem
const data: unknown = value
if (isUser(data)) { ... }
```

## Security Patterns

### Input Sanitization

- Validate and constrain all user input at the API boundary (Zod / class-validator).
- Use strict Zod schemas: prefer `.strict()` or default stripping behavior on object schemas to prevent unexpected fields from reaching business logic.
- Limit string lengths, array sizes, and numeric ranges in schemas to prevent resource exhaustion.

### Injection Prevention

- Never interpolate user input into SQL strings - use parameterized queries (TypeORM handles this by default).
- Never interpolate user input into shell commands - use `child_process.execFile` (not `exec`) with argument arrays.
- Never interpolate user input into template strings that become HTML - use a templating engine with auto-escaping.

### JWT and Auth Token Handling

- Never log JWTs or auth tokens.
- Validate JWT expiry, issuer, and audience on every request (Firebase Auth guard handles this).
- Do not store tokens in Redis or database unless absolutely necessary (and with encryption at rest).

### SSRF Prevention

- When accepting URLs from user input (webhooks, image URLs), validate against an allowlist of domains or reject private/internal IP ranges.
- Use a library or middleware that resolves DNS and checks the resulting IP before making the request.

### Rate Limiting

- Apply rate limiting at the API gateway or middleware layer (NestJS `@nestjs/throttler`).
- Use sliding window rate limiting per authenticated user ID (not just IP) to prevent abuse from authenticated users.

## Refactor-Oriented Rules

1. Rename completely across DTOs/imports/tests/docs.
2. Preserve contracts unless behavior change is explicit.
3. Remove dead types instead of keeping compatibility stubs.
4. Do not add backwards compatibility layers unless explicitly requested by the user.
5. If there is strong reasoning to add backwards compatibility, pause and ask user clarification before implementing.
6. Keep schema/entity alignment.
7. Keep required vs optional semantics truthful across layers.
8. Remove unnecessary indirection: inline trivial wrappers, replace single-use parameter objects with direct parameters, delete unused barrels.
9. Simplify data transformations: when source and target types match structurally, assign directly instead of field-by-field copying.
10. Eliminate redundant work: pass already-computed results (metadata, validation outcomes, parsed data) to callees instead of re-computing.

## Refactor Playbooks

### Indirection reduction

- identify trivial wrapper methods that only delegate to another method with a hardcoded argument; inline the call at all call sites and remove the wrapper
- identify single-use parameter wrapper interfaces/types (an interface created only to bundle arguments for one private method call); replace with direct parameters, especially when parallel methods in the same class already use direct parameters (consistency matters)
- identify barrel files (`index.ts`) that merely re-export siblings without adding value; if all consumers already import directly from the source files, delete the barrel
- identify wrapper objects or adapter layers that pass data through without transformation; remove the layer and let consumers use the source directly
- identify passthrough methods where a public method's only job is to pack its parameters into a single-use interface and forward to a private method; merge into one method (the private method becomes the public one) and delete the wrapper interface

### Verbose transformation reduction

- when loading config, deserializing data, or mapping between layers, check whether the source shape already matches the target type
- if it does, assign directly instead of copying field-by-field; field-by-field mapping is only warranted when fields are renamed, transformed, validated, or subsetted
- watch for mapping code that expands as new fields are added but never actually transforms anything - this is a maintenance surface with no value

### Redundant work elimination

- when a method calls an expensive operation (IO, parsing, metadata extraction) and then passes the raw input to a sub-method that repeats the same operation, pass the result down instead
- common pattern: metadata/validation fetched in an outer method, then re-fetched in an inner method on the same input - add a parameter for the already-computed result

### Module flattening (single-purpose apps)

When a lambda or worker app has multiple NestJS modules (`core/`, `feature/`) but only one pipeline:

1. Identify whether the `core/` module contains any service with more than one consumer across modules.
2. If every `core/` service is consumed only by the feature module, merge all files into a single flat `module/` directory.
3. Inline standalone helper files (functions used in exactly one place) as private methods.
4. Merge thin wrapper services (1-method services around infrastructure calls like `redis.del()`, `readFile()`) into the consuming service.
5. Consolidate multiple type files into a single schema file when all types serve the same pipeline.
6. Merge multiple error files into a single `errors.ts`.
7. Drop redundant domain prefix from class names when the app scope already implies it (e.g., `ProcessingService` not `ImageProcessingService` inside `lambda-image-processing`).
8. Update the root module to a flat providers list - no sub-module imports.

### Service chain collapse

When a service chain has 3+ layers (orchestrator → intermediate → specialized) and the intermediate service adds no branching logic or independent state:

1. Identify what the intermediate service actually contributes - if it only forwards calls and aggregates results, it's a passthrough layer.
2. Move the intermediate service's logic into the orchestrator.
3. Let the orchestrator call the specialized service directly.
4. Delete the intermediate service and update module providers.

Example: `ImageProcessingService` → `ImageProcessorService` → `ImageTransformerService` collapsed to `ProcessingService` → `TransformerService` - the orchestrator now owns the full pipeline (download, validate, blurhash, resize, upload).

### Re-export and type alias cleanup

- Identify `export type { X }` re-exports where the consuming files could import directly from the source.
- Identify type files that exist solely to hold 1-2 interfaces consumed by one other file - merge into the consumer's schema file.
- When config types (e.g., `IEntityConfig`) and runtime data types (e.g., `IMediaItemData`) are consumed by the same pipeline, co-locate them in one schema file.

### Dead code removal

- remove unused methods/types/exports/tests/config keys/dependencies
- do not keep compatibility shims unless explicitly requested

### Post-change dead code verification

After removing a dependency, import, or injection from a service/module, run `codebase_find_unused_symbols` scoped to the affected module to detect methods or symbols that became dead as a side effect. Either clean them up in the same PR or log a follow-up ticket. Do not leave newly-dead code unacknowledged.

### Refactor-session unused symbol sweep

At least once during every refactor session, run `codebase_find_unused_symbols` on the touched scope (module/package or whole project, depending on blast radius). For each candidate, determine whether it is truly dead code or an exported symbol potentially used externally. If the list is large or ambiguous, use `codebase_trace_calls` per candidate to classify before removal - exported symbols with zero in-tree callers are still potentially consumed externally and need a wider check.

## Validation Matrix

- module-local: targeted tests + typecheck + lint
- route/contract change: endpoint integration tests + status/payload verification
- quality gate: zero ESLint errors and zero TypeScript errors

## Deployment and Operations

### Database Schema Evolution

- One logical change per migration. Do not bundle unrelated schema changes.
- Always write `down` migrations - they must cleanly reverse the `up`.
- Backward-compatible changes: add nullable columns first, backfill data, then add constraints in a follow-up migration. This allows rollback without data loss.
- Never rename columns in a single migration - add new column, backfill, update application code, remove old column in a subsequent release.
- Feature-flag schema changes when the new schema serves a feature that may be rolled back.

### Zero-Downtime Deploys

- Use rolling deployments (Kubernetes or ECS rolling update).
- Ensure database schema is backward-compatible with both old and new application versions during the rollout window.
- Drain connections before terminating old instances - NestJS `enableShutdownHooks()` combined with a readiness probe transition handles this.
- Queue workers: use `worker.close()` to stop accepting new jobs while finishing in-flight work, then exit.

## Anti-Patterns

- compatibility shims for removed APIs
- backwards compatibility added without explicit user request
- partial domain renames
- broad lint-disable blocks with no reason
- unnecessary local barrels
- stale TODOs after refactor completion
- putting admin endpoints on the public controller
- omitting `@UseGuards(FirebaseAuthGuard)` on controller classes
- omitting `@GetUser()` when the service needs the authenticated user's ID
- magic strings or numbers; extract into named constants
- using `any` instead of `unknown` + narrowing
- `function` declarations instead of arrow functions
- `@ts-ignore` or `@ts-expect-error` instead of fixing the type issue
- copy-pasting type fields instead of deriving with `Pick`/`Omit`/`Partial`
- in-memory filtering/slicing for paginated results backed by database queries
- unnecessary indirection: trivial wrapper methods that only delegate with a hardcoded argument, single-use parameter wrapper interfaces for private methods, barrel files with no consumers, adapter layers that pass through without transforming
- verbose field-by-field data mapping when source structure already matches target type (assign directly instead)
- inconsistent parameter style across sibling methods in the same class (e.g., one method uses direct params, another uses a wrapper object for the same pattern)
- redundant expensive operations: calling the same IO/parsing/metadata operation twice on the same input when the result could be passed down
- passthrough methods: a public method whose only job is to pack its parameters into a single-use interface and forward to a private method (merge into one method)
- exported symbols with zero consumers anywhere in the project (dead exports)
- speculative properties/parameters: fields declared on error classes, config objects, or DTOs that nothing in the codebase reads (YAGNI - remove unless there is evidence of external consumption)
- multi-module hierarchies (`core/` + `feature/`) in single-purpose apps (lambdas, workers) that have only one pipeline; use a flat module structure instead
- redundant domain prefix in class names when the app scope already implies the domain (e.g., `ImageProcessingService` inside `lambda-image-processing`)
- 1-method wrapper services around infrastructure calls (`CacheInvalidationService` wrapping `redis.del()`, `ConfigLoaderService` wrapping `readFile` + YAML parse)
- standalone helper files with functions used in exactly one place; inline as private methods
- re-export type aliases that add no transformation (e.g., `export type { IBlurhashSchema }` from a file that imports it from another type file)
- 3-layer service chains (orchestrator → intermediate → specialized) where the intermediate adds no branching logic; collapse to 2 layers
- split type files for one pipeline: config types, data types, and error types for the same domain scattered across 3+ files when they could be 1-2 files
- widening existing domain enums or named type aliases to anonymous `string`/`number` types
- no single-line `if` statements (including `return`, `throw`, `continue`, `break`); always use braces and multiline blocks
- no escape hatches: no `@ts-ignore`, no `@ts-expect-error`, no `oxlint-disable`, no `any`
- no SQL/ORM N+1 query patterns
- no multi-write operations without a transaction boundary
- no injection-prone patterns (SQL/NoSQL/command/template)
- no orphan imports
- no stale test names/routes/docs
- no API doc drift
- no hidden behavior changes
- no unnecessary file splits
- no unsorted user-visible lists or paginated endpoints
- no newly-dead symbols left behind after dependency removal (verify with `codebase_find_unused_symbols`)
- using `as` assertions to cast types when `satisfies` or proper narrowing would preserve safety
- defining Zod schemas inside functions instead of at module level
- validating the same data multiple times across different layers
- using `eager: true` on TypeORM relations (causes implicit N+1)
- logging sensitive data (tokens, passwords, PII)
- using `console.log` instead of structured logger in production code
- fire-and-forget queue jobs without idempotency guarantees
- using `Promise.allSettled` to silently swallow errors without inspecting results
- scattering shared constants (cache keys, time boundaries, event names) across module-local files instead of a single shared constants file
- duplicating time/date boundary logic inline instead of centralizing in shared helpers
- transactional side effects (point awards, balance updates, linked record creation) behind fire-and-forget event handlers - these must remain direct method calls inside transactions
- repositories that inject services or return API response DTOs - repositories are persistence-focused
- circular module dependencies - if Module A imports Module B and B imports A, restructure before adding features
- bare `boolean` fields in API response DTOs when a status/state enum is clearer and more extensible (e.g., `{ eligible: true, reason: null }` → `{ status: 'AVAILABLE' }`)
- client-computable fields in API responses - do not send data the client can trivially derive from other fields in the same response (e.g., `isToday` when `date` is already present)
- passing optional DTO fields directly to constructors or converters without handling `undefined` - `new Date(undefined)` produces `Invalid Date` (not a throw), which persists as a NaN timestamp and crashes the DB; always guard with `dto.field ? new Date(dto.field) : defaultValue`

## Monorepo-Only Addendum (Turbo/workspaces + `apps/`/`packages/`)

Apply this section only when all are true:

- the target repository is a Turbo/workspace monorepo
- the repository has an `apps/` and/or `packages/` folder at root
- TypeScript work targets code inside that monorepo repository

### Apps (Feature Modules)

Use predictable module layout:

- `dto/`
- `entities/`
- `repositories/`
- `services/`
- `<feature>.controller.ts`
- `<feature>-admin.controller.ts` (when admin endpoints exist)
- `<feature>.module.ts`
- `<feature>.enums.ts` (or shared types)
- `_tests/`

### Feature Module Wiring

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Entity1, Entity2]), // Entity registration
    ConfigModule.forFeature(featureConfig), // Module-scoped config (optional)
    StorageModule.forRootAsync(), // Infrastructure (when needed)
    QueueModule.forRootAsync({ queues: [QUEUES.NAME] }), // Queue (when enqueuing jobs)
    MediaModule, // Shared utility modules
    PeerModule, // Cross-module imports are normal
  ],
  controllers: [FeatureController, FeatureAdminController],
  providers: [FeatureService, FeatureRepository, AdminFeatureService],
  exports: [FeatureService, FeatureRepository], // Only what others need
})
export class FeatureModule {}
```

### Shared Types Across Apps

Some types are manually duplicated between apps (API + worker, API + webhook) with a comment:

```typescript
// This file must be identical in:
// - apps/api/src/shared/image-job.types.ts
// - apps/worker-image/src/shared/image-job.types.ts
```

When modifying shared types, update **all copies**. These live in `apps/<app>/src/shared/`.

Known duplicated type files:

- `apps/api/src/shared/image-job.types.ts` ↔ `apps/worker-image/src/shared/image-job.types.ts`
- `apps/api/src/shared/subscription-event.types.ts` ↔ `apps/webhook-revenue-cat/src/shared/subscription-event.types.ts`

> **Industry note:** The industry standard for cross-app type sharing in monorepos is a shared `packages/shared-types` (or similar) workspace package. This eliminates manual duplication and ensures type drift is caught at compile time. Consider migrating when the number of duplicated type files exceeds 3-4 or when drift-related bugs occur.

### Cache Key Contracts

Cache keys defined in `apps/api/src/shared/cache.constants.ts` are referenced by:

- Worker apps (YAML config `cacheKey` values must match)
- Webhook apps (Redis key patterns in cache invalidation code must match)

When renaming cache keys, verify all three surfaces: API constants, worker YAML config, webhook invalidation code.

### Packages Exports and Imports

- Keep package public surface in `src/index.ts`.
- Barrel exports are banned everywhere else.
- Allowed exception: package entry file barrels (`packages/<n>/src/index.ts`) only.
- Prefer direct imports inside apps/modules over local barrels.

### Monorepo Build and Dependencies

- Keep `dependencies` in each app's `package.json` - do not hoist all dependencies to the root.
- Use `devDependencies` at the root only for shared tooling (ESLint, TypeScript, Prettier).
- When a shared package changes, run its own tests plus key downstream consumer tests before merging.
- Turborepo caching is based on file inputs - ensure `turbo.json` `inputs` patterns cover all relevant source files and configs to avoid stale caches.

### Additional Validation

- shared package touched: package tests + workspace typecheck/lint + key downstream tests
