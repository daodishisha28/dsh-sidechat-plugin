type Disposable = () => void

export class Context {
  readonly reflect = {
    provide: (name: string, value: unknown): Disposable => this.provide(name, value),
  }

  provide(name: string, value: unknown): Disposable {
    Object.defineProperty(this, name, { configurable: true, enumerable: true, value, writable: true })
    return () => { Reflect.deleteProperty(this, name) }
  }

  /** Test shim: grants resolve immediately, mirroring satisfied injects. */
  inject(names: readonly string[], callback: (granted: Context) => void): void {
    void names
    callback(this)
  }
}

export class Service {
  static readonly init = Symbol('service.init')
  readonly name: string
  protected readonly ctx: Context

  constructor(ctx: Context, name: string) {
    this.ctx = ctx
    this.name = name
    ctx.reflect.provide(name, this)
  }
}

export class TypertRemoteService extends Service {
  readonly typertRemote: { readonly service: this; readonly serviceKey: string; readonly namespace: string }

  constructor(ctx: Context, name: string) {
    super(ctx, name)
    this.typertRemote = { service: this, serviceKey: name, namespace: name }
  }
}

export function Remote(name: string) {
  void name
  return () => undefined
}

class SchemaBuilder {
  step(value: number): this { void value; return this }
  min(value: number): this { void value; return this }
  max(value: number): this { void value; return this }
  default(value: unknown): this { void value; return this }
}

const schemastery = {
  object: (shape: unknown) => { void shape; return new SchemaBuilder() },
  number: () => new SchemaBuilder(),
  string: () => new SchemaBuilder(),
  boolean: () => new SchemaBuilder(),
}
export default schemastery

export function SessionId(value: string): string { return value }
export function ReasoningEffortId(value: string): string { return value }
export const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'
export const PERSONA_SUFFIX_SECTION = 'deployment:persona-suffix'
let shimMessageCounter = 0
export function createUserMessage<T extends { readonly content: unknown; readonly source: unknown }>(value: T): T & { id: string; role: 'user' } {
  shimMessageCounter += 1
  return { ...value, id: `shim-message-${shimMessageCounter}`, role: 'user' as const }
}
export function boundContextSummary<T>(value: T): T { return value }
export function setSandboxMode(session: { append: (type: string, data: unknown) => void }, mode: string): void {
  session.append('sandbox/mode', { mode })
}
export function setApprovalPolicy(session: { append: (type: string, data: unknown) => void }, policy: string): void {
  session.append('approval/policy', { policy })
}

export class BlockAssembler {
  readonly usage = undefined
  readonly finish = { kind: 'stop' as const }
  push(value: unknown): void { void value }
  blocks(): never[] { return [] }
}

export function defineTool<T>(value: T): T { return value }
export function defineDomain<T>(value: T): T { return value }
export function domainTable<T>(_schema: T): T { return _schema }
