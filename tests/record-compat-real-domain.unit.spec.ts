import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseStoredRecord } from '../src/record-compat.ts'
import { sideChatDomainSpec } from '../src/spec.ts'
import { sideChatRecordSchema, type SideChatRecord } from '../src/types.ts'

/**
 * Real-storageDomain drill (upgrade plan item 9): the pure-function tests in
 * record-compat.unit.spec.ts prove the plugin-side parse contract; this file
 * runs the REAL published `@deepseek-ai/dsh-storage-domain` (plus the real
 * `@deepseek-ai/dsh-storage` hub and `@deepseek-ai/dsh-storage-json` file
 * backend) from the installed alpha.2 fixture over a TEMP directory, against
 * the plugin's real `sideChatRecordSchema` — proving that unknown/corrupt
 * records surface as diagnosable errors at the durable read boundary while
 * the original bytes survive, and that nothing silently becomes an empty
 * table. Skipped cleanly when the fixture is absent (portable runs).
 *
 * Real behaviors verified from upstream source d743267388641bc76f17c45ce8b4c231aed1d32c:
 * - `KvTable.put` does NOT re-validate the value: "must satisfy the spec's
 *   schema (not re-checked here — validation happens at the durable read
 *   boundary)" (packages/storage/storage-domain/src/domain.ts:29-31); the
 *   implementation writes straight through `unit.putRecord` then memory
 *   (domain.ts:307-313). Errors surface on `DomainFacility.open`, which
 *   zod-parses every stored record and wraps the failure as
 *   `DomainError('invalid-record')` carrying `detail: { table, key }` and the
 *   zod issue as `cause` (packages/storage/storage-domain/src/index.ts:123-126
 *   and parseRecord at index.ts:198-209). A failed open closes the unit and
 *   rethrows without publishing anything (index.ts:164-167).
 * - The `json` backend stores one whole-unit document at
 *   `<root>/<name>.json` (default `single` layout; spec.ts:29 of
 *   storage-domain) — a human-readable file (packages/storage/storage-json/
 *   src/format.ts:28-39), which is the lower-level raw medium this drill
 *   seeds corrupt bytes through. Bad JSON rejects `open` with
 *   `StorageError('malformed-medium')` at the backend boundary
 *   (storage-json/src/single-unit.ts:33-48 → format.ts:47-56); a foreign
 *   unit header is malformed-medium (format.ts:58-64) and a version stamp
 *   mismatch is `version-mismatch` (format.ts:66-71).
 */

interface DrillTable {
  get(key: string): unknown
  entries(): IterableIterator<[string, unknown]>
  readonly size: number
  put(key: string, value: SideChatRecord): Promise<void>
}

interface DrillDomain {
  readonly name: string
  table(name: string): DrillTable
  close(): Promise<void>
}

interface DrillFacility {
  open(spec: unknown): Promise<DrillDomain>
  closeAll(): Promise<void>
}

interface DrillContext {
  plugin(plugin: unknown): Promise<unknown>
  storage: { backend: { register(name: string, backend: unknown): () => void } }
}

/** Error contract of the real domain layer (packages/.../storage-domain/src/error.ts). */
interface DomainFailure {
  readonly name: string
  readonly code: 'already-open' | 'facet-unsupported' | 'invalid-record' | 'missing-key' | 'closed'
  readonly detail?: { readonly table: string; readonly key: string }
  readonly cause?: unknown
  readonly message: string
}

interface RealModules {
  Context: new () => DrillContext
  Storage: unknown
  JsonStorageBackend: new (root: string) => { close(): Promise<void> }
  DomainFacility: new (ctx: DrillContext, config: { backend: string; routes?: Record<string, string> }) => DrillFacility
  defineDomain: <T>(spec: T) => T
  domainTable: (schema: unknown) => { valueSchema: unknown }
}

const FOLD_ID_A = '11111111-1111-4111-8111-111111111111'
const FOLD_ID_B = '22222222-2222-4222-8222-222222222222'

const fixtureNodeModules = new URL('./contracts/alpha2-fixture/node_modules/', import.meta.url)
const fixturePresent = existsSync(new URL('@deepseek-ai/dsh-storage-domain/package.json', fixtureNodeModules))
  && existsSync(new URL('@deepseek-ai/dsh-storage-json/package.json', fixtureNodeModules))

function importFixture(specifier: string): Promise<unknown> {
  return import(new URL(specifier, fixtureNodeModules).href)
}

/** One legacy v1 record exactly as the pre-domain plugin era stored it: NO coordinates anywhere. */
function legacyV1Record(): Record<string, unknown> {
  return {
    schema: 1,
    childSessionId: 'child-session',
    parentSessionId: 'parent-session',
    parent: { createdAt: 1, cwd: 'C:\\work' },
    child: { createdAt: 2, cwd: 'C:\\work' },
    question: 'why is the sky blue?',
    title: 'sky',
    status: 'archived',
    seed: { mode: 'none', parentSessionId: 'parent-session', capturedThroughSeq: 7, capturedAt: 2, messages: [] },
    permission: {
      mode: 'readonly',
      parentSandboxMode: 'workspace-write',
      childSandboxMode: 'read-only',
      parentApprovalPolicy: 'ask',
      childApprovalPolicy: 'never',
      parentTools: ['read', 'glob', 'grep', 'run_code'],
      allowedTools: ['read', 'glob', 'grep'],
      capturedAt: 5,
    },
    modelStrategy: { kind: 'default' },
    createdAt: 2,
    updatedAt: 3,
    revision: 1,
    folds: [
      {
        foldId: FOLD_ID_A,
        revision: 1,
        state: 'committed',
        generatedContent: 'v1 preview',
        committedContent: 'v1 committed',
        baselineSeq: 3,
        previewThroughSeq: 9,
        estimatedTokens: 4,
        structureValid: true,
        createdAt: 3,
        updatedAt: 4,
        committedAt: 4,
        committedMessageId: 'm1',
        revisionState: 'superseded',
      },
      {
        foldId: FOLD_ID_B,
        revision: 2,
        state: 'committed',
        generatedContent: 'v2 preview',
        committedContent: 'v2 committed',
        baselineSeq: 10,
        previewThroughSeq: 15,
        estimatedTokens: 6,
        structureValid: true,
        createdAt: 5,
        updatedAt: 6,
        committedAt: 5,
        revisionState: 'withdrawn',
        withdrawalState: 'committed',
        withdrawalReason: 'obsolete',
        withdrawnAt: 6,
      },
    ],
    cites: [],
  }
}

/** The fixture itself must never pre-fill coordinates: the legacy epoch is the schema's job. */
function assertNoCoordinates(record: unknown): void {
  expect(JSON.stringify(record)).not.toContain('coordinates')
}

describe.skipIf(!fixturePresent)('record-compat against the real alpha.2 storageDomain (installed fixture)', () => {
  let drillBase = ''
  const real = {} as {
    modules: RealModules
    spec: unknown
  }
  const drills: { backend: { close(): Promise<void> }; facility: DrillFacility }[] = []

  beforeAll(async () => {
    if (!fixturePresent) return
    const [cordis, storage, storageJson, storageDomain] = await Promise.all([
      importFixture('@deepseek-ai/cordis/lib/index.js'),
      importFixture('@deepseek-ai/dsh-storage/lib/index.js'),
      importFixture('@deepseek-ai/dsh-storage-json/lib/index.js'),
      importFixture('@deepseek-ai/dsh-storage-domain/lib/index.js'),
    ]) as [RealModules & object, RealModules & object, RealModules & object, RealModules & object]
    const modules: RealModules = {
      Context: (cordis as { Context: RealModules['Context'] }).Context,
      Storage: (storage as { default: RealModules['Storage'] }).default,
      JsonStorageBackend: (storageJson as { JsonStorageBackend: RealModules['JsonStorageBackend'] }).JsonStorageBackend,
      DomainFacility: (storageDomain as { DomainFacility: RealModules['DomainFacility'] }).DomainFacility,
      defineDomain: (storageDomain as { defineDomain: RealModules['defineDomain'] }).defineDomain,
      domainTable: (storageDomain as { domainTable: RealModules['domainTable'] }).domainTable,
    }
    drillBase = await mkdtemp(join(tmpdir(), 'sidechat-domain-drill-'))
    real.modules = modules
    // The plugin's src/spec.ts is identical, but under `pnpm test` the repo
    // shim erases domainTable's wrapper (tests/shims/dsh-runtime.ts:87 returns
    // the schema itself), so rebuild the SAME declaration (same name, version,
    // and plugin-authored zod schema) with upstream's real spec vocabulary.
    real.spec = modules.defineDomain({
      name: sideChatDomainSpec.name,
      version: sideChatDomainSpec.version,
      tables: { chats: modules.domainTable<string, SideChatRecord>(sideChatRecordSchema) },
    })
  })

  afterAll(async () => {
    for (const drill of drills) {
      await drill.facility.closeAll().catch(() => {})
      await drill.backend.close().catch(() => {})
    }
    if (drillBase) {
      await rm(drillBase, { recursive: true, force: true })
    }
  })

  /** Boot one isolated drill: real cordis Context + storage hub + real JSON backend over its own temp root. */
  async function bootDrill(label: string): Promise<{ root: string; facility: DrillFacility }> {
    const root = join(drillBase, label)
    await mkdir(root, { recursive: true })
    const ctx = new real.modules.Context()
    await ctx.plugin(real.modules.Storage)
    const backend = new real.modules.JsonStorageBackend(root)
    ctx.storage.backend.register('json', backend)
    const facility = new real.modules.DomainFacility(ctx, { backend: 'json' })
    drills.push({ backend, facility })
    return { root, facility }
  }

  /** Raw bytes of the single-layout unit file (the backend's raw medium). */
  function unitFile(root: string): string {
    return join(root, 'sidechat.json')
  }

  it('round-trips a valid v1 legacy record through the real domain with frozen evidence intact', async () => {
    const { facility } = await bootDrill('valid-roundtrip')
    const domain = await facility.open(real.spec)
    const raw = legacyV1Record()
    // The legacy fixture carries NO coordinates anywhere: no whitewashing of
    // the unknown epoch before the bytes even reach the medium.
    assertNoCoordinates(raw)

    const table = domain.table('chats')
    await table.put('legacy-chat', raw as unknown as SideChatRecord)

    // The medium holds the record verbatim: the domain layer does not
    // sanitize permissions or stamp coordinates on the write path.
    const stored = table.get('legacy-chat')
    expect(stored).toEqual(raw)
    expect(table.size).toBe(1)
    expect([...table.entries()].map(([key]) => key)).toEqual(['legacy-chat'])

    // The plugin's real read path over the real stored bytes: parse keeps the
    // legacy generation and every frozen field, deriving the legacy epoch
    // purely from the schema default (types.ts:337-339, types.ts:247-250).
    const parsed = parseStoredRecord(stored)
    expect(parsed).toMatchObject({ ok: true, legacy: true })
    if (!parsed.ok) return
    expect(parsed.record.schema).toBe(1)
    expect(parsed.record.folds[0]).toMatchObject({
      baselineSeq: 3,
      previewThroughSeq: 9,
      coordinates: { epoch: 'legacy-v1' },
      committedContent: 'v1 committed',
      committedAt: 4,
      committedMessageId: 'm1',
      revisionState: 'superseded',
    })
    expect(parsed.record.folds[1]).toMatchObject({
      baselineSeq: 10,
      previewThroughSeq: 15,
      revisionState: 'withdrawn',
      withdrawalState: 'committed',
      withdrawalReason: 'obsolete',
      withdrawnAt: 6,
    })
    expect(parsed.record.seed).toMatchObject({
      mode: 'none',
      parentSessionId: 'parent-session',
      capturedThroughSeq: 7,
      capturedAt: 2,
      coordinates: { epoch: 'legacy-v1' },
    })
    // Permission sanitization happens in the plugin read layer, never in the
    // medium: run_code removed from the ceiling with the explicit marker.
    expect(parsed.record.permission).toMatchObject({
      mode: 'readonly',
      parentTools: ['read', 'glob', 'grep'],
      transportRunCodeRemoved: true,
      capturedAt: 5,
    })
    await domain.close()
  })

  it('accepts unknown/corrupt records on the write path, fails the reopen with invalid-record, and preserves every original byte', async () => {
    const { root, facility } = await bootDrill('unknown-and-corrupt')
    const domain = await facility.open(real.spec)
    const table = domain.table('chats')
    const valid = legacyV1Record() as unknown as SideChatRecord

    // Real put behavior (domain.ts:29-31, domain.ts:307-313): no runtime
    // re-validation — these writes resolve and land durably.
    await table.put('ok-record', valid)
    await table.put('unknown-schema', { ...legacyV1Record(), schema: 99 } as unknown as SideChatRecord)
    await table.put('corrupt-title', { ...legacyV1Record(), title: 42 } as unknown as SideChatRecord)

    // Nothing was dropped or emptied along the way.
    expect(table.size).toBe(3)
    expect(table.get('ok-record')).toEqual(valid)

    await domain.close()

    // The durable read boundary rejects the open, naming the first offending
    // record (insertion order) with its table/key and the zod cause.
    const failure = await facility.open(real.spec).catch((error: DomainFailure) => error)
    expect(failure.name).toBe('DomainError')
    expect(failure.code).toBe('invalid-record')
    expect(failure.detail).toEqual({ table: 'chats', key: 'unknown-schema' })
    expect(failure.cause).toBeDefined()
    expect(failure.message).toContain('sidechat')

    // No empty-table write-back: the raw medium still carries ALL three
    // records byte-for-byte, valid ones included.
    const document = JSON.parse(await readFile(unitFile(root), 'utf8')) as {
      unit: { name: string; version: number }
      tables: Record<string, Record<string, unknown>>
    }
    expect(document.unit).toEqual({ name: 'sidechat', version: 1 })
    expect(Object.keys(document.tables.chats ?? {})).toEqual(['ok-record', 'unknown-schema', 'corrupt-title'])
    expect(document.tables.chats['ok-record']).toEqual(valid)
    expect(document.tables.chats['unknown-schema']).toMatchObject({ schema: 99 })
    expect(document.tables.chats['corrupt-title']).toMatchObject({ title: 42 })
  })

  it('reports seeded corrupt bytes as diagnosable medium errors while the original bytes stay untouched', async () => {
    // Phase 1: raw garbage in the unit file — the backend boundary rejects
    // with malformed-medium (single-unit.ts:33-48 → format.ts:47-56).
    const garbageDrill = await bootDrill('corrupt-bytes-garbage')
    const garbage = ']{ this is not json at all'
    await writeFile(unitFile(garbageDrill.root), garbage, 'utf8')
    const garbageFailure = await garbageDrill.facility.open(real.spec).catch((error: DomainFailure) => error)
    expect(garbageFailure.name).toBe('StorageError')
    expect(garbageFailure.code).toBe('malformed-medium')
    expect(garbageFailure.message).toContain('not valid JSON')
    // The failed open published nothing: original bytes preserved exactly.
    expect(await readFile(unitFile(garbageDrill.root), 'utf8')).toBe(garbage)

    // Phase 2: well-formed unit document holding a schema-violating record —
    // the domain layer rejects with invalid-record naming the seeded key.
    const seededDrill = await bootDrill('corrupt-bytes-record')
    const seededDocument = {
      unit: { name: 'sidechat', version: 1 },
      global: null,
      tables: {
        chats: {
          'seeded-valid': legacyV1Record(),
          'seeded-corrupt': { schema: 1 },
        },
      },
    }
    const seededBytes = `${JSON.stringify(seededDocument, null, 2)}\n`
    await writeFile(unitFile(seededDrill.root), seededBytes, 'utf8')
    const seededFailure = await seededDrill.facility.open(real.spec).catch((error: DomainFailure) => error)
    expect(seededFailure.name).toBe('DomainError')
    expect(seededFailure.code).toBe('invalid-record')
    expect(seededFailure.detail).toEqual({ table: 'chats', key: 'seeded-corrupt' })
    // Both records — the valid one and the offender — are still on the medium.
    expect(await readFile(unitFile(seededDrill.root), 'utf8')).toBe(seededBytes)
  })

  it('survives close and re-open over the same storage: records persist and the legacy epoch materializes from the schema default', async () => {
    const { root, facility } = await bootDrill('reopen')
    const raw = legacyV1Record()
    assertNoCoordinates(raw)

    const firstOpen = await facility.open(real.spec)
    await firstOpen.table('chats').put('legacy-chat', raw as unknown as SideChatRecord)
    await firstOpen.close()

    // The medium never received a coordinates field: reopening must derive
    // the epoch from the zod default at the durable read boundary, not from
    // stored whitewashing.
    expect(await readFile(unitFile(root), 'utf8')).not.toContain('coordinates')

    const reopened = await facility.open(real.spec)
    const table = reopened.table('chats')
    expect(table.size).toBe(1)
    const revived = table.get('legacy-chat') as SideChatRecord
    expect(revived.schema).toBe(1)
    expect(revived.folds[0]).toMatchObject({
      baselineSeq: 3,
      previewThroughSeq: 9,
      coordinates: { epoch: 'legacy-v1' },
      committedMessageId: 'm1',
      revisionState: 'superseded',
    })
    expect(revived.folds[1]).toMatchObject({
      revisionState: 'withdrawn',
      withdrawalState: 'committed',
      withdrawalReason: 'obsolete',
    })
    expect(revived.seed).toMatchObject({
      capturedThroughSeq: 7,
      coordinates: { epoch: 'legacy-v1' },
    })
    // The domain layer returns the stored object as-is; sanitization stays in
    // the plugin read layer over the revived bytes.
    expect(parseStoredRecord(revived)).toMatchObject({ ok: true, legacy: true })
    await reopened.close()
  })
})
