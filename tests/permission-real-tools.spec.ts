import { existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computePermissionScope, PTC_TRANSPORT_RUN_CODE } from '../src/tool-contract.ts'
import { SIDECHAT_PERSONA_PREFIX, SIDECHAT_PERSONA_PREFIX_SECTION, SIDECHAT_PERSONA_SUFFIX_SECTION } from '../src/persona.ts'
import { SideChatService } from '../src/service.ts'
import type { SideChatRecord } from '../src/types.ts'

/**
 * Real controlled Tools harness.
 *
 * Loads the REAL published `@deepseek-ai/dsh-tools` 0.2.1-alpha.2 (plus the
 * real `@deepseek-ai/cordis`, `@deepseek-ai/dsh-system-prompt` and
 * `@deepseek-ai/dsh-scope`) from an installed fixture via computed file URLs —
 * the same pattern as tests/usage-real-helper.unit.spec.ts — so the plugin's
 * actual permission computation runs against the upstream registry, guard,
 * restrict, and PTC dispatch machinery instead of the repository shims.
 *
 * Package roots are probed in order; when NO candidate root exists at all the
 * suite skips (portable `pnpm test` on machines without an installed DSH
 * runtime). A PRESENT root that lacks the required packages is a FAILURE, not
 * a skip: the fixture is registered in the pnpm workspace and
 * `pnpm verify` depends on it, so a broken fixture must fail loudly (see the
 * fixture-integrity gate in bootRealTools below).
 *
 * PTC runtime note: the harness mounts PTC mode through the REAL `run_code`
 * transport with a minimal `ctx.ptcRuntime` that implements the real
 * PtcRuntime contract (`language`/`resolve`/`run`). The program host is a
 * stub: it interprets a trivial JSON-array program by invoking the REAL
 * binding functions, so every nested dispatch still flows through the real
 * staged scheduler (pre-execute, approval, guards) exactly as a compiled
 * program's sub-calls would. Only TypeScript compilation/execution of the
 * program text is not exercised (no PTC node runtime is bundled with the
 * plugin's test fixtures).
 */
const CANDIDATE_ROOTS = [
  new URL('../tests/contracts/alpha2-fixture/node_modules/', import.meta.url),
  new URL('../.smoke-dsh-alpha2/runtime/node_modules/', import.meta.url),
]

function rootHas(root: URL, pkgPath: string): boolean {
  return existsSync(fileURLToPath(new URL(pkgPath, root)))
}

const TOOLS_ROOT = CANDIDATE_ROOTS.find(root =>
  rootHas(root, '@deepseek-ai/dsh-tools/lib/index.js') && rootHas(root, '@deepseek-ai/dsh-scope/lib/index.js'))

const PRESENT_ROOTS = CANDIDATE_ROOTS.filter(root => existsSync(fileURLToPath(root)))

/**
 * Fixture-integrity gate: a present candidate root (the workspace-registered
 * alpha.2 fixture, or the local smoke runtime) that lacks the required
 * packages must FAIL every test with an actionable message — never skip.
 */
function requireRoot(): URL {
  if (TOOLS_ROOT !== undefined) return TOOLS_ROOT
  throw new Error(
    `a candidate package root exists (${PRESENT_ROOTS.map(String).join(', ')}) but lacks the required packages `
    + '(@deepseek-ai/dsh-tools + @deepseek-ai/dsh-scope + @deepseek-ai/dsh-system-prompt + @deepseek-ai/cordis). '
    + 'A present-but-broken fixture is a failure, not a skip: run `pnpm install` inside tests/contracts/alpha2-fixture '
    + 'to restore the exact 0.2.1-alpha.2 dependency set.',
  )
}

const describeReal = PRESENT_ROOTS.length === 0 && TOOLS_ROOT === undefined ? describe.skip : describe

interface ToolSchema {
  readonly name: string
}

interface ExecutionResult {
  readonly isError?: boolean
  readonly error?: { readonly message?: string }
  readonly value?: unknown
}

interface ToolRegistry {
  register(definition: Record<string, unknown>): () => void
  guard(guard: (execution: { readonly name: string }) => string | undefined): () => void
  restrict(filter: { readonly allow?: readonly string[] }): () => void
  schemas(scope?: object): readonly ToolSchema[]
  execute(input: {
    readonly name: string
    readonly arguments: unknown
    readonly agent?: object
    readonly signal: AbortSignal
  }): Promise<ExecutionResult>
  presentAs(mode: 'native' | 'ptc'): () => void
}

interface ScopeFactory {
  createScope(ctx: unknown, key: object, options?: { readonly parent?: object }): { readonly ctx: unknown }
  bindScopeParent(key: object, parent: object): void
}

/** Real `@deepseek-ai/dsh-persona` row config (packages/preset/persona/src/index.ts). */
interface PersonaRowConfig {
  readonly prefix: string
  readonly suffix?: string
  readonly complete?: boolean
  readonly includeRuntimeContext?: boolean
}

interface AgentScope {
  readonly agent: object
  readonly ctx: {
    readonly tools: ToolRegistry
  }
}

interface Harness {
  readonly registry: ToolRegistry
  readonly makeTool: (name: string) => Record<string, unknown>
  readonly makeAgentScope: (options?: { readonly mode?: 'native' | 'ptc'; readonly parentKey?: object }) => Promise<AgentScope>
  /**
   * Mint one REAL preset-revision scope exactly like the upstream preset
   * registry's activate() (packages/preset/agent-preset-registry/src/index.ts:
   * ~103-121): a separate `createScope(owner, key)` scope in which a preset
   * row (here the real `@deepseek-ai/dsh-persona` apply) registers its
   * contributions. The agent scope later joins it as a CHILD via
   * `bindScopeParent` (registry join(), ~265-266) — the real
   * preset-parent/agent-child layering, not a same-layer reproduction.
   */
  readonly createPresetScope: (applyRow?: (ctx: unknown, config: PersonaRowConfig) => void, row?: PersonaRowConfig) => Promise<{ readonly key: object }>
  readonly personaApply: (ctx: unknown, config: PersonaRowConfig) => void
  readonly executed: string[]
  readonly systemPrompt: {
    section(section: { readonly name: string; readonly order: number; readonly text: string }): () => void
    getSectionOrder(name: string): number
    assemble(context?: { readonly scope?: unknown }): Promise<{ readonly sections: readonly unknown[] }>
  }
  readonly context: unknown
}

async function bootRealTools(): Promise<Harness> {
  const root = requireRoot() as URL
  const load = async (path: string): Promise<Record<string, unknown>> =>
    await import(pathToFileURL(fileURLToPath(new URL(path, root))).href) as Record<string, unknown>
  const toolsPkg = await load('@deepseek-ai/dsh-tools/lib/index.js')
  const cordisPkg = await load('@deepseek-ai/cordis/lib/index.js')
  const systemPromptPkg = await load('@deepseek-ai/dsh-system-prompt/lib/index.js')
  const scopePkg = await load('@deepseek-ai/dsh-scope/lib/index.js') as unknown as ScopeFactory
  const personaPkg = await load('@deepseek-ai/dsh-persona/lib/index.js')
  const personaApply = personaPkg.apply as (ctx: unknown, config: PersonaRowConfig) => void

  const ContextCtor = cordisPkg.Context as new () => { get(name: string): unknown; provide(name: string, value: unknown): unknown; plugin(plugin: unknown, config?: unknown): Promise<unknown> }
  const SystemPrompt = systemPromptPkg.SystemPrompt as new (ctx: unknown, config: Record<string, unknown>) => unknown
  const ToolRuntime = toolsPkg.ToolRuntime as new (ctx: unknown, config: Record<string, unknown>) => unknown
  const defineTool = toolsPkg.defineTool as (options: Record<string, unknown>) => Record<string, unknown>

  const ctx = new ContextCtor()
  new SystemPrompt(ctx, {})
  // run_code with an Agent resolves a working directory; the stub runtime
  // declares no sandbox mode, so no sandboxPolicy is consulted.
  ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
  const executed: string[] = []
  ctx.provide('ptcRuntime', {
    language: 'typescript',
    resolve(request: Record<string, unknown>) { return request },
    async run(spec: { readonly program: string; readonly bindings: readonly { readonly functions: Record<string, (args: unknown) => Promise<unknown>> }[] }) {
      // Trivial program host: a JSON array of [toolName, args] pairs, run
      // through the REAL binding functions (real staged scheduler, real
      // per-agent guards on every nested dispatch).
      const calls = JSON.parse(spec.program) as readonly [string, unknown][]
      const namespace: Record<string, (args: unknown) => Promise<unknown>> = Object.create(null)
      for (const binding of spec.bindings) {
        for (const [name, fn] of Object.entries(binding.functions)) namespace[name] = fn
      }
      const values: unknown[] = []
      for (const [name, args] of calls) values.push(await namespace[name](args))
      return { logs: [], value: values }
    },
  })
  await ctx.plugin(ToolRuntime, { mode: 'ptc' })
  const registry = ctx.get('tools') as ToolRegistry

  const makeTool = (name: string): Record<string, unknown> => defineTool({
    name,
    description: `real-tools harness tool ${name}`,
    parameters: { value: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { readonly value: string }) {
      executed.push(`${name}:${args.value}`)
      return `ok-${name}`
    },
  })

  const makeAgentScope = async (options?: { readonly mode?: 'native' | 'ptc'; readonly parentKey?: object }) => {
    const agent: {
      readonly id: string
      readonly session: { append(type: string, data: unknown): void }
    } = { id: `child-${Math.random()}`, session: { append: () => undefined } }
    let scopeCtx: unknown
    // Real agent scopes are minted by a service that holds the inject grants;
    // mirror that so the scoped context inherits the tools AND systemPrompt
    // dependency APIs (the real harness boots the real SystemPrompt already —
    // the SideChatService permission install registers persona sections
    // through agent.ctx.systemPrompt exactly like in the live Host). A
    // `parentKey` binds the agent scope as a CHILD of that scope — the real
    // preset registry join() (bindScopeParent, agent-preset-registry/src/
    // index.ts:265-266) — so parent-layer contributions assemble for this
    // agent while same-layer duplicates still throw.
    const Holder = class {
      static inject = ['tools', 'systemPrompt']
      constructor(serviceCtx: unknown) {
        scopeCtx = (options?.parentKey === undefined
          ? scopePkg.createScope(serviceCtx, agent)
          : scopePkg.createScope(serviceCtx, agent, { parent: options.parentKey })
        ).ctx
      }
    }
    await ctx.plugin(Holder)
    const agentCtx = scopeCtx as { readonly tools: ToolRegistry; readonly systemPrompt: Harness['systemPrompt'] }
    if (options?.mode === 'native') agentCtx.tools.presentAs('native')
    return { agent, ctx: agentCtx }
  }

  const createPresetScope = async (applyRow?: (ctx: unknown, config: PersonaRowConfig) => void, row?: PersonaRowConfig) => {
    const presetKey = {}
    let scopeCtx: unknown
    // The preset registry activates each definition in its own scope minted
    // from the registry context (activate(): createScope(this.owner, key)).
    // The Holder mirrors the registry's grant-holding service context.
    const Holder = class {
      static inject = ['tools', 'systemPrompt']
      constructor(serviceCtx: unknown) {
        scopeCtx = scopePkg.createScope(serviceCtx, presetKey).ctx
      }
    }
    await ctx.plugin(Holder)
    if (applyRow !== undefined && row !== undefined) applyRow(scopeCtx, row)
    return { key: presetKey }
  }

  return {
    registry,
    makeTool,
    makeAgentScope,
    createPresetScope,
    personaApply,
    executed,
    systemPrompt: ctx.get('systemPrompt') as Harness['systemPrompt'],
    context: ctx,
  }
}

describeReal('real alpha.2 tools permission enforcement (installed DSH runtime)', () => {
  it('native mode: snapshot capabilities pass, parent-external capabilities are denied by guard and removed by restrict', async () => {
    const harness = await bootRealTools()
    const { agent, ctx: agentCtx } = await harness.makeAgentScope({ mode: 'native' })
    for (const name of ['read', 'glob', 'write']) harness.registry.register(harness.makeTool(name))
    const visibleNames = agentCtx.tools.schemas(agent).map(tool => tool.name)
    expect(visibleNames).toEqual(['read', 'glob', 'write'])
    const { allowForRestrict, guard } = computePermissionScope({
      parentTools: ['read', 'glob'],
      allowedTools: ['read', 'glob'],
      visibleNames,
    })
    agentCtx.tools.guard(guard)
    agentCtx.tools.restrict({ allow: allowForRestrict })
    // Restrict removed the parent-external capability from the model surface
    // (registry insertion order, not sorted).
    expect(agentCtx.tools.schemas(agent).map(tool => tool.name)).toEqual(['read', 'glob'])
    const signal = new AbortController().signal
    const allowed = await agentCtx.tools.execute({ name: 'read', arguments: { value: 'a' }, agent, signal })
    expect(allowed.isError).toBe(false)
    const denied = await agentCtx.tools.execute({ name: 'write', arguments: { value: 'b' }, agent, signal })
    expect(denied.isError).toBe(true)
    expect(denied.error?.message).toContain('permission snapshot')
    expect(harness.executed).toEqual(['read:a'])
  }, 30_000)

  it('PTC mode: the run_code transport executes under a valid snapshot; a nested capability beyond the snapshot is denied per call', async () => {
    const harness = await bootRealTools()
    const { agent, ctx: agentCtx } = await harness.makeAgentScope()
    for (const name of ['read', 'glob', 'write']) harness.registry.register(harness.makeTool(name))
    // Same-layer scope-local registration: visible to the agent, never
    // restrictable upstream, covered by the scoped guard instead.
    agentCtx.tools.register(harness.makeTool('local_tool'))
    const visibleNames = agentCtx.tools.schemas(agent).map(tool => tool.name)
    expect(visibleNames).toEqual(['read', 'glob', 'write', 'local_tool', PTC_TRANSPORT_RUN_CODE])
    const { allowForRestrict, guard } = computePermissionScope({
      parentTools: ['read', 'glob'],
      allowedTools: ['read', 'glob'],
      visibleNames,
    })
    // Upstream rejects scope-local names AND the reserved transport in a
    // restrict filter, so only the inherited end capabilities may enter.
    expect(allowForRestrict).toEqual(['glob', 'read'])
    agentCtx.tools.guard(guard)
    agentCtx.tools.restrict({ allow: allowForRestrict })

    const signal = new AbortController().signal
    // The headline assertion: a blanket run_code denial would surface here as
    // a PTC failure. The transport must execute under the valid snapshot, and
    // an allowed nested capability must dispatch through the real scheduler.
    const run = await agentCtx.tools.execute({
      name: PTC_TRANSPORT_RUN_CODE,
      agent,
      signal,
      arguments: {
        description: 'exercise nested dispatch',
        code: JSON.stringify([['read', { value: 'a' }]]),
      },
    })
    expect(run.isError).toBe(false)
    expect((run.value as { readonly logs: unknown[] }).logs).toEqual([])
    expect((run.value as { readonly result?: unknown }).result).toEqual(['ok-read'])
    expect(harness.executed).toEqual(['read:a'])

    // The nested capability beyond the snapshot (a scope-local tool whose
    // binding still exists — own-layer tools stay visible) is denied per call
    // by the SAME scoped guard; the program fails with the guard reason.
    harness.executed.length = 0
    const deniedRun = await agentCtx.tools.execute({
      name: PTC_TRANSPORT_RUN_CODE,
      agent,
      signal,
      arguments: {
        description: 'exercise denied nested dispatch',
        code: JSON.stringify([['local_tool', { value: 'b' }]]),
      },
    })
    expect(deniedRun.isError).toBe(true)
    expect(deniedRun.error?.message).toContain('local_tool')
    expect(deniedRun.error?.message).toContain('permission snapshot')
    expect(harness.executed).toEqual([])
  }, 30_000)

  it('upstream restrict rejects the reserved transport and scope-local names outright', async () => {
    const harness = await bootRealTools()
    const { ctx: agentCtx } = await harness.makeAgentScope()
    harness.registry.register(harness.makeTool('read'))
    agentCtx.tools.register(harness.makeTool('local_tool'))
    expect(() => agentCtx.tools.restrict({ allow: [PTC_TRANSPORT_RUN_CODE] }))
      .toThrow(/reserved PTC mode presentation transport/)
    expect(() => agentCtx.tools.restrict({ allow: ['local_tool'] }))
      .toThrow(/unknown global tool/)
  }, 30_000)

  it('a failing restrict attempt leaves no restriction installed, so a blocked state denies everything', async () => {
    const harness = await bootRealTools()
    // Native presentation: under PTC mode a model-direct call to a terminal
    // capability is mode-collapsed BEFORE guards run, so the deny-all guard's
    // rejection is observable only in native mode (collapsed denial in PTC
    // mode is upstream behavior, also a denial — of every capability).
    const { agent, ctx: agentCtx } = await harness.makeAgentScope({ mode: 'native' })
    harness.registry.register(harness.makeTool('read'))
    const before = agentCtx.tools.schemas(agent).map(tool => tool.name)
    // Transactional failure: upstream validates before appending any effect,
    // so a throw must not leave a partial restriction behind.
    expect(() => agentCtx.tools.restrict({ allow: ['nonexistent_global'] })).toThrow(/unknown global tool/)
    expect(agentCtx.tools.schemas(agent).map(tool => tool.name)).toEqual(before)
    // The plugin records the blocked state instead (host-level behavior); the
    // deny-all guard it installs denies every capability, including the ones
    // the snapshot would have allowed.
    const blockedGuard = (execution: { readonly name: string }): string =>
      `SideChat permission enforcement failed; tool execution stays blocked until the snapshot reinstalls (${execution.name})`
    agentCtx.tools.guard(blockedGuard)
    const denied = await agentCtx.tools.execute({ name: 'read', arguments: { value: 'a' }, agent, signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(denied.error?.message).toContain('blocked')
    expect(harness.executed).toEqual([])
  }, 30_000)
})

/**
 * The ACTUAL SideChatService permission installation — the real
 * `ensurePermission` service method, not the extracted
 * `computePermissionScope` helper — driven against the real tools registry,
 * real scoped context, and real PTC transport.
 *
 * Honest disclosures:
 * - the service instance is the real SideChatService class; its `table`
 *   private field is pointed at a minimal in-memory stand-in (get/entries/
   * put/update over one stored v2 record) — exactly what `storedRecord` reads;
 * - the plugin's own module imports resolve through the repository test
 *   shims (vitest aliases) — the shim Service base only registers the service
 *   name on the context; all DSH behavior under test (tools registry, guard,
 *   restrict, PTC scheduler, system-prompt sections/assembly) is REAL;
 * - the PTC program host remains a minimal stub implementing the real
 *   `ptcRuntime` contract — no real TypeScript program interpreter exists in
 *   the fixture (see the file header and report §10).
 */
describeReal('real SideChatService permission installation (actual service method)', () => {
  /** Minimal in-memory stand-in for the service's private `table` field. */
  function makeStandInTable(childId: string, record: SideChatRecord): {
    get(key: string): SideChatRecord | undefined
    entries(): IterableIterator<[string, SideChatRecord]>
    put(key: string, value: SideChatRecord): Promise<void>
    update(key: string, update: (current: SideChatRecord) => SideChatRecord): Promise<SideChatRecord>
  } {
    const rows = new Map<string, SideChatRecord>([[childId, record]])
    return {
      get: key => rows.get(key),
      entries: () => rows.entries(),
      put: async (key, value) => { rows.set(key, value) },
      update: async (key, update) => {
        const current = rows.get(key)
        if (current === undefined) throw new Error(`missing ${key}`)
        const next = update(current)
        rows.set(key, next)
        return next
      },
    }
  }

  function storedRecord(childId: string, parentTools: readonly string[], allowedTools: readonly string[]): SideChatRecord {
    return {
      schema: 2, logFormat: 4, projectionVersion: 'test-projection-v1',
      childSessionId: childId, parentSessionId: 'parent',
      parent: { createdAt: 1, cwd: 'C:\\work' }, child: { createdAt: 2, cwd: 'C:\\work' },
      question: 'q', title: 't', status: 'open',
      seed: { mode: 'none', parentSessionId: 'parent', capturedThroughSeq: 0, capturedAt: 2, coordinates: { epoch: 'v4-offset', logFormat: 4 }, messages: [] },
      permission: {
        mode: 'readonly',
        childAgentPreset: 'standard',
        parentSandboxMode: 'workspace-write',
        childSandboxMode: 'read-only',
        parentApprovalPolicy: 'ask',
        childApprovalPolicy: 'never',
        parentTools: [...parentTools],
        allowedTools: [...allowedTools],
        capturedAt: 5,
      },
      modelStrategy: { kind: 'default' }, createdAt: 2, updatedAt: 3, revision: 0, folds: [], cites: [],
    }
  }

  it('ensurePermission installs the real snapshot: an allowed nested read executes through run_code, a capability outside the snapshot is denied with the guard reason', async () => {
    const harness = await bootRealTools()
    const { agent, ctx: agentCtx } = await harness.makeAgentScope()
    // The service consumes the real Agent shape (agent.ctx carries the scoped
    // context); the harness returns scope ctx separately, so join them.
    const serviceAgent = { id: agent.id, session: agent.session, ctx: agentCtx }
    // Same-layer FOREIGN persona sections under BOTH deployment section names
    // (exactly what a custom parent preset's real @deepseek-ai/dsh-persona row
    // provides: apply() registers prefix AND suffix unconditionally, even for
    // an empty suffix). With the SideChat-owned distinct section names both
    // foreign texts AND both SideChat texts coexist — no same-layer duplicate
    // collision, no silent shadowing.
    const FOREIGN_PARENT_PERSONA = 'FOREIGN PARENT ROLE PREFIX — custom preset persona (real section)'
    const FOREIGN_PARENT_SUFFIX = 'FOREIGN PARENT ROLE SUFFIX — custom preset persona (real section)'
    agentCtx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: FOREIGN_PARENT_PERSONA,
    })
    agentCtx.systemPrompt.section({
      name: 'deployment:persona-suffix',
      order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
      text: FOREIGN_PARENT_SUFFIX,
    })
    for (const name of ['read', 'glob', 'write']) harness.registry.register(harness.makeTool(name))
    const serviceErrors: string[] = []
    const service = new SideChatService({
      reflect: { provide: () => () => undefined },
      logger: { error: (...parts: unknown[]) => { serviceErrors.push(parts.map(String).join(' ')) } },
    } as never)
    const table = makeStandInTable(agent.id, storedRecord(agent.id, ['read', 'glob'], ['read', 'glob']))
    Object.defineProperty(service, 'table', { value: table, writable: true })

    // THE ACTUAL SERVICE METHOD (bracket access to the private member).
    const installed = (service as unknown as { ensurePermission: (a: unknown) => boolean }).ensurePermission(serviceAgent)
    expect(serviceErrors).toEqual([])
    expect(installed).toBe(true)

    const signal = new AbortController().signal
    // (a) An allowed nested read executes through the REAL run_code PTC
    // transport under the installed snapshot.
    const run = await agentCtx.tools.execute({
      name: PTC_TRANSPORT_RUN_CODE,
      agent,
      signal,
      arguments: {
        description: 'allowed nested read through the real transport',
        code: JSON.stringify([['read', { value: 'a' }]]),
      },
    })
    expect(run.isError).toBe(false)
    expect((run.value as { readonly result?: unknown }).result).toEqual(['ok-read'])
    expect(harness.executed).toEqual(['read:a'])

    // (b) A capability outside the snapshot is denied per nested call with
    // the guard reason; nothing outside the snapshot executes. The
    // beyond-snapshot capability that still owns a PTC binding is the
    // scope-local same-layer tool (upstream removes restrict-filtered names —
    // like 'write' — from the model surface entirely, assert that too).
    expect(agentCtx.tools.schemas(agent).map(tool => tool.name)).not.toContain('write')
    agentCtx.tools.register(harness.makeTool('local_tool'))
    harness.executed.length = 0
    const deniedRun = await agentCtx.tools.execute({
      name: PTC_TRANSPORT_RUN_CODE,
      agent,
      signal,
      arguments: {
        description: 'denied nested dispatch beyond the snapshot',
        code: JSON.stringify([['local_tool', { value: 'b' }]]),
      },
    })
    expect(deniedRun.isError).toBe(true)
    expect(deniedRun.error?.message).toContain('local_tool')
    expect(deniedRun.error?.message).toContain('permission snapshot')
    expect(harness.executed).toEqual([])

    // (R2 + persona suffix) The assembled system prompt carries BOTH foreign
    // parent persona texts (deployment sections) AND both SideChat texts (the
    // distinct SideChat-owned sections at the same deployment orders) — no
    // silent omission, no collision, parent suffix preserved.
    const assembly = await harness.systemPrompt.assemble({ scope: agent })
    const sections = assembly.sections as readonly { readonly name: string; readonly text: string }[]
    expect(sections.find(section => section.name === 'deployment:persona-prefix')?.text).toBe(FOREIGN_PARENT_PERSONA)
    expect(sections.find(section => section.name === 'deployment:persona-suffix')?.text).toBe(FOREIGN_PARENT_SUFFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)?.text).toBe(SIDECHAT_PERSONA_PREFIX)
    const suffixSection = sections.find(section => section.name === SIDECHAT_PERSONA_SUFFIX_SECTION)
    expect(suffixSection?.text).toContain('只读模式')
  }, 30_000)

  it('a real section-registration failure records the blocked state via the actual service', async () => {
    const harness = await bootRealTools()
    const { agent, ctx: agentCtx } = await harness.makeAgentScope({ mode: 'native' })
    const serviceAgent = { id: agent.id, session: agent.session, ctx: agentCtx }
    harness.registry.register(harness.makeTool('read'))
    const serviceErrors: string[] = []
    const service = new SideChatService({
      reflect: { provide: () => () => undefined },
      logger: { error: (...parts: unknown[]) => { serviceErrors.push(parts.map(String).join(' ')) } },
    } as never)
    // Simulate a corrupted scope where the SideChat-owned section name is
    // already taken: the service's persona-suffix/prefix registration then
    // THROWS for real (upstream duplicate-name rejection), the install fails,
    // and the actual service records the blocked state (fail closed).
    agentCtx.systemPrompt.section({
      name: 'sidechat:persona-prefix',
      order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: 'pre-existing rogue section',
    })
    const table = makeStandInTable(agent.id, storedRecord(agent.id, ['read'], ['read']))
    Object.defineProperty(service, 'table', { value: table, writable: true })
    const installed = (service as unknown as { ensurePermission: (a: unknown) => boolean }).ensurePermission(serviceAgent)
    expect(serviceErrors.join('\n')).toContain('failed to install permission scope')
    expect(installed).toBe(false)
    const blocked = (service as unknown as { permissionBlockedAgents: Map<string, unknown> }).permissionBlockedAgents.has(serviceAgent.id)
    expect(blocked).toBe(true)
  }, 30_000)

  it('Case A — real preset-parent dsh-persona row (empty suffix) + agent-child service registrations: parent prefix, full SideChat role and the mode suffix all assemble; the real PTC transport enforces the snapshot', async () => {
    const harness = await bootRealTools()
    // Parent layer: the ACTUAL published @deepseek-ai/dsh-persona row applied
    // in a real preset-revision scope — exactly what the upstream preset
    // registry's activate() does (createScope(owner, key) + the row's
    // apply()). The row registers BOTH deployment sections unconditionally,
    // even for an empty suffix.
    const PARENT_PREFIX = 'PARENT PRESET PERSONA PREFIX (real dsh-persona row, empty suffix)'
    const preset = await harness.createPresetScope(harness.personaApply, { prefix: PARENT_PREFIX })
    // Agent child layer joined to the preset scope via the REAL
    // bindScopeParent — the preset-parent/agent-child layering, not a
    // same-layer reproduction.
    const { agent, ctx: agentCtx } = await harness.makeAgentScope({ parentKey: preset.key })
    const serviceAgent = { id: agent.id, session: agent.session, ctx: agentCtx }
    for (const name of ['read', 'glob', 'write']) harness.registry.register(harness.makeTool(name))
    const serviceErrors: string[] = []
    const service = new SideChatService({
      reflect: { provide: () => () => undefined },
      logger: { error: (...parts: unknown[]) => { serviceErrors.push(parts.map(String).join(' ')) } },
    } as never)
    const table = makeStandInTable(agent.id, storedRecord(agent.id, ['read', 'glob'], ['read', 'glob']))
    Object.defineProperty(service, 'table', { value: table, writable: true })
    const installed = (service as unknown as { ensurePermission: (a: unknown) => boolean }).ensurePermission(serviceAgent)
    expect(serviceErrors).toEqual([])
    expect(installed).toBe(true)

    // An allowed real PTC nested read succeeds through the run_code transport.
    const signal = new AbortController().signal
    const run = await agentCtx.tools.execute({
      name: PTC_TRANSPORT_RUN_CODE, agent, signal,
      arguments: { description: 'allowed nested read', code: JSON.stringify([['read', { value: 'a' }]]) },
    })
    expect(run.isError).toBe(false)
    expect((run.value as { readonly result?: unknown }).result).toEqual(['ok-read'])
    // A capability outside the snapshot is blocked with the guard reason.
    agentCtx.tools.register(harness.makeTool('local_tool'))
    harness.executed.length = 0
    const deniedRun = await agentCtx.tools.execute({
      name: PTC_TRANSPORT_RUN_CODE, agent, signal,
      arguments: { description: 'denied nested dispatch', code: JSON.stringify([['local_tool', { value: 'b' }]]) },
    })
    expect(deniedRun.isError).toBe(true)
    expect(deniedRun.error?.message).toContain('permission snapshot')
    expect(harness.executed).toEqual([])

    // The assembled REAL system prompt carries: the parent layer's prefix
    // text (surviving through the scope-parent binding), the full
    // SideChat-owned prefix, and the SideChat permission-mode suffix.
    const assembly = await harness.systemPrompt.assemble({ scope: agent })
    const sections = assembly.sections as readonly { readonly name: string; readonly text: string }[]
    expect(sections.find(section => section.name === 'deployment:persona-prefix')?.text).toBe(PARENT_PREFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)?.text).toBe(SIDECHAT_PERSONA_PREFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_SUFFIX_SECTION)?.text).toContain('只读模式')
    // The parent row's empty suffix keeps the deployment section text ''
    // (parent-layer registration, shadowing the registry's own empty one) —
    // it neither overwrites the SideChat mode suffix nor disappears: the two
    // texts live in their own distinct sections.
    expect(sections.find(section => section.name === 'deployment:persona-suffix')?.text).toBe('')
  }, 30_000)

  it('Case B — inherited custom parent prefix AND NONEMPTY custom suffix both survive the real scope-parent binding alongside both SideChat texts', async () => {
    const harness = await bootRealTools()
    // Parent layer persona row with a distinct nonempty custom suffix: the
    // parent suffix must SURVIVE the SideChat mode suffix — proven through the
    // real preset-parent/agent-child binding, not a same-layer reproduction.
    const PARENT_PREFIX = 'CUSTOM PARENT PREFIX (nonempty suffix row)'
    const PARENT_SUFFIX = 'CUSTOM PARENT SUFFIX TEXT (must survive beside the SideChat mode suffix)'
    const preset = await harness.createPresetScope(harness.personaApply, { prefix: PARENT_PREFIX, suffix: PARENT_SUFFIX })
    const { agent, ctx: agentCtx } = await harness.makeAgentScope({ parentKey: preset.key })
    const serviceAgent = { id: agent.id, session: agent.session, ctx: agentCtx }
    for (const name of ['read', 'glob']) harness.registry.register(harness.makeTool(name))
    const serviceErrors: string[] = []
    const service = new SideChatService({
      reflect: { provide: () => () => undefined },
      logger: { error: (...parts: unknown[]) => { serviceErrors.push(parts.map(String).join(' ')) } },
    } as never)
    const table = makeStandInTable(agent.id, storedRecord(agent.id, ['read', 'glob'], ['read', 'glob']))
    Object.defineProperty(service, 'table', { value: table, writable: true })
    const installed = (service as unknown as { ensurePermission: (a: unknown) => boolean }).ensurePermission(serviceAgent)
    expect(serviceErrors).toEqual([])
    expect(installed).toBe(true)
    const assembly = await harness.systemPrompt.assemble({ scope: agent })
    const sections = assembly.sections as readonly { readonly name: string; readonly text: string }[]
    // BOTH parent texts AND both SideChat texts.
    expect(sections.find(section => section.name === 'deployment:persona-prefix')?.text).toBe(PARENT_PREFIX)
    expect(sections.find(section => section.name === 'deployment:persona-suffix')?.text).toBe(PARENT_SUFFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)?.text).toBe(SIDECHAT_PERSONA_PREFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_SUFFIX_SECTION)?.text).toContain('只读模式')
  }, 30_000)

  it('Case C — a legal same-layer persona contribution coexists with the SideChat suffix; the old shared deployment name would really throw here', async () => {
    const harness = await bootRealTools()
    const { agent, ctx: agentCtx } = await harness.makeAgentScope()
    const serviceAgent = { id: agent.id, session: agent.session, ctx: agentCtx }
    for (const name of ['read', 'glob']) harness.registry.register(harness.makeTool(name))
    // The real dsh-persona row applied in the SAME layer as the service's
    // registrations (the legacy same-layer reproduction): its apply()
    // registers deployment:persona-suffix unconditionally.
    const ROW_PREFIX = 'SAME-LAYER ROW PREFIX'
    const ROW_SUFFIX = 'SAME-LAYER ROW SUFFIX (persona row)'
    harness.personaApply(agentCtx, { prefix: ROW_PREFIX, suffix: ROW_SUFFIX })
    // Prove the same-layer duplicate-name throw is real: registering the
    // deployment suffix name AGAIN in this layer throws — exactly what the
    // service's old PERSONA_SUFFIX_SECTION registration would have done,
    // failing the permission install into the blocked state.
    expect(() => agentCtx.systemPrompt.section({
      name: 'deployment:persona-suffix',
      order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
      text: 'duplicate in the same layer',
    })).toThrow(/already registered in this scope/u)
    // With the DISTINCT SideChat-owned suffix name the same service
    // registration coexists with the row: no throw, install succeeds.
    const serviceErrors: string[] = []
    const service = new SideChatService({
      reflect: { provide: () => () => undefined },
      logger: { error: (...parts: unknown[]) => { serviceErrors.push(parts.map(String).join(' ')) } },
    } as never)
    const table = makeStandInTable(agent.id, storedRecord(agent.id, ['read', 'glob'], ['read', 'glob']))
    Object.defineProperty(service, 'table', { value: table, writable: true })
    const installed = (service as unknown as { ensurePermission: (a: unknown) => boolean }).ensurePermission(serviceAgent)
    expect(serviceErrors).toEqual([])
    expect(installed).toBe(true)
    const assembly = await harness.systemPrompt.assemble({ scope: agent })
    const sections = assembly.sections as readonly { readonly name: string; readonly text: string }[]
    // The persona row's suffix section AND the SideChat suffix coexist.
    expect(sections.find(section => section.name === 'deployment:persona-suffix')?.text).toBe(ROW_SUFFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_SUFFIX_SECTION)?.text).toContain('只读模式')
    expect(sections.find(section => section.name === 'deployment:persona-prefix')?.text).toBe(ROW_PREFIX)
    expect(sections.find(section => section.name === SIDECHAT_PERSONA_PREFIX_SECTION)?.text).toBe(SIDECHAT_PERSONA_PREFIX)
  }, 30_000)
})
