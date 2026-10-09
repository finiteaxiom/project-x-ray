import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeRemoteRecoveryDomain } from "./remote-recovery-capability.js";
const workers: Worker[] = [];
const domains: NativeRemoteRecoveryDomain[] = [];
const native = Worker.prototype.terminate;
function worker() { const w=new Worker("require('node:worker_threads').parentPort.on('message',()=>{});",{eval:true});workers.push(w);return w; }
function domain(){const d=new NativeRemoteRecoveryDomain();domains.push(d);return d;}
function gate(){let release!:()=>void;return {held:new Promise<void>(r=>release=r),release:()=>release()};}
afterEach(async()=>{vi.restoreAllMocks();vi.useRealTimers();for(const d of domains.splice(0))d.close();for(const w of workers.splice(0))await native.call(w);});
describe("application-owned native recovery proof",()=>{
  it("all purposes, owners and retired generations remain in the stop inventory",async()=>{
    const d=domain(),owner=randomUUID(),other=randomUUID();let old!:Worker;
    const first=d.create(owner,["feature-explanation"],()=>old=worker());d.retire(first);
    d.create(owner,["ownership-semantic-assessment"],worker);d.create(other,["feature-explanation","ownership-semantic-assessment"],worker);
    const proof=await d.freezeAndStop(),inventory=d.consume(proof);expect(inventory.map(p=>p.generation)).toEqual([1,2,3]);expect(old.threadId).toBe(-1);for(const w of workers)expect(w.threadId).toBe(-1);
    expect(()=>d.consume(proof)).toThrow();expect(()=>d.create(owner,["feature-explanation"],worker)).toThrow();
  });
  it.each(["boolean","promise","proxy","throw"])("factory %s poisons the resource domain instead of proving zero work",async kind=>{
    const d=domain(),w=worker();expect(()=>d.create(randomUUID(),["feature-explanation"],()=>kind==="throw"?(()=>{throw Error("private");})():kind==="boolean"?true as never:kind==="promise"?Promise.resolve(w) as never:new Proxy(w,{}) as never)).toThrow();
    await expect(d.freezeAndStop()).rejects.toBeDefined();expect(w.threadId).not.toBe(-1);
  });
  it("empty inventory and Boolean/ordinary promise cannot prove old process exit",async()=>{
    const d=domain();await expect(d.freezeAndStop()).rejects.toBeDefined();expect(()=>d.consume(true as never)).toThrow();expect(()=>d.consume(Promise.resolve() as never)).toThrow();
  });
  it("native exit is necessary and old operations must actually settle",async()=>{
    const d=domain(),ticket=d.create(randomUUID(),["feature-explanation"],worker),g=gate();const op=d.operation(ticket,"work",async()=>{await g.held;expect(()=>d.admit(ticket,()=>true)).toThrow();});
    let finished=false;const stopping=d.freezeAndStop().then(proof=>{finished=true;return proof;});
    await vi.waitFor(()=>expect(workers[0]!.threadId).toBe(-1));expect(finished).toBe(false);await expect(d.operation(ticket,"work",async()=>true)).rejects.toBeDefined();
    g.release();await expect(op).rejects.toMatchObject({code:"POLICY_INVALID"});expect(d.consume(await stopping)).toHaveLength(1);
  });
  it("public terminate promise and synthetic exit never replace the captured native verifier",async()=>{
    const d=domain();let w!:Worker;d.create(randomUUID(),["feature-explanation"],()=>w=worker());const fake=vi.fn(async()=>0);w.terminate=fake;w.emit("exit",0);
    expect(()=>d.consume({} as never)).toThrow();expect(w.threadId).not.toBe(-1);const proof=await d.freezeAndStop();expect(fake).not.toHaveBeenCalled();expect(w.threadId).toBe(-1);expect(d.consume(proof)).toHaveLength(1);
  });
  it.each(["clone","close","revision"])("stop proof %s cannot be reused",async kind=>{
    const d=domain(),ticket=d.create(randomUUID(),["ownership-semantic-assessment"],worker),proof=await d.freezeAndStop();
    if(kind==="close")d.close();if(kind==="revision")d.retire(ticket);expect(()=>d.consume(kind==="clone"?{...proof}:proof)).toThrow();
  });
  it("two purposes share one prepare and pending budget",async()=>{
    const d=domain(),owner=randomUUID(),first=d.create(owner,["feature-explanation"],worker),second=d.create(owner,["ownership-semantic-assessment"],worker),g=gate();
    const preparing=d.operation(first,"prepare",()=>g.held);await expect(d.operation(second,"prepare",async()=>true)).rejects.toMatchObject({code:"BUSY"});
    const pending=Array.from({length:19},()=>d.operation(second,"work",()=>g.held));await expect(d.operation(first,"work",async()=>true)).rejects.toMatchObject({code:"LIMIT_EXCEEDED"});g.release();await Promise.all([preparing,...pending]);
  });
  it("stop deadline leaves the domain closed and requires a fresh proof after real settlement",async()=>{
    const d=domain(),ticket=d.create(randomUUID(),["feature-explanation"],worker),g=gate();const op=d.operation(ticket,"work",()=>g.held);
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});const stopped=d.freezeAndStop().catch(e=>e);await vi.advanceTimersByTimeAsync(60_001);expect(await stopped).toMatchObject({code:"INTERRUPTED"});
    expect(()=>d.admit(ticket,()=>true)).toThrow();vi.useRealTimers();g.release();await expect(op).rejects.toMatchObject({code:"POLICY_INVALID"});expect(d.consume(await d.freezeAndStop())).toHaveLength(1);
  });
  it("a synchronous admission cannot hide asynchronous writes behind an ordinary Promise",async()=>{
    const d=domain(),ticket=d.create(randomUUID(),["feature-explanation"],worker);expect(()=>d.admit(ticket,async()=>true)).toThrow();await expect(d.freezeAndStop()).rejects.toMatchObject({code:"INTERRUPTED"});
  });
  it("the shared resource budget refuses creation before invoking the twenty-first factory",()=>{
    const d=domain(),factory=vi.fn(worker);for(let i=0;i<20;i++)d.create(randomUUID(),[i%2?"feature-explanation":"ownership-semantic-assessment"],factory);
    expect(()=>d.create(randomUUID(),["feature-explanation"],factory)).toThrow(expect.objectContaining({code:"LIMIT_EXCEEDED"}));expect(factory).toHaveBeenCalledTimes(20);
  });

});

import { createHash } from "node:crypto";
import { assertRemoteProducerContext, admitRemoteProducer, executeRemoteProducer, stopRemoteProducer } from "./remote-recovery-capability.js";
describe("opaque actual producer port", () => {
  it.each([true, Promise.resolve(), {}])("context veto refuses non-undefined %s before admission", value => {
    const d = domain(), ticket = d.create(randomUUID(), ["feature-explanation"], worker), admission = vi.fn();
    const port = d.producer(ticket, (() => value) as never, work => { admission(); return work(); });
    expect(() => admitRemoteProducer(port, () => ({ receipt: true }))).toThrow(); expect(admission).not.toHaveBeenCalled();
  });
  it("original receipt is admitted and exact stop does not wait for its own scope or sign a proof", async () => {
    const d = domain(), ticket = d.create(randomUUID(), ["feature-explanation"], worker), port = d.producer(ticket, () => undefined, work => d.admit(ticket, work)), receipt = Object.freeze({ receipt: randomUUID() });
    expect(admitRemoteProducer(port, () => receipt)).toBe(receipt); expect(() => assertRemoteProducerContext({ ...port })).toThrow();
    await d.operation(ticket, "work", async () => { await stopRemoteProducer(port); expect(workers.at(-1)!.threadId).toBe(-1); expect(() => d.consume(port as never)).toThrow(); });
    d.retire(ticket); const proof = await d.freezeAndStop(); expect(d.consume(proof)).toEqual([expect.objectContaining({ generation: 1 })]);
  });
  it.each(["proxy", "getter", "extra", "digest", "purpose", "outside-scope"])("wire %s sends no body", async kind => {
    const d = domain(), ticket = d.create(randomUUID(), ["feature-explanation"], worker), port = d.producer(ticket, () => undefined, work => d.admit(ticket, work)), post = vi.spyOn(workers.at(-1)!, "postMessage");
    const body = "{}", input = { purpose: "feature-explanation", body, bodyDigest: createHash("sha256").update(body).digest("hex") };
    let reads = 0;
    const raw = kind === "proxy" ? new Proxy(input, {}) : kind === "getter" ? Object.defineProperty({ ...input }, "body", { get() { reads++; return body; }, enumerable: true }) : kind === "extra" ? { ...input, injected: true } : kind === "digest" ? { ...input, bodyDigest: "a".repeat(64) } : kind === "purpose" ? { ...input, purpose: "ownership-semantic-assessment" } : input;
    if (kind === "outside-scope") expect(() => executeRemoteProducer(port, raw as never)).toThrow();
    else await d.operation(ticket, "work", async () => { expect(() => executeRemoteProducer(port, raw as never)).toThrow(); });
    expect(reads).toBe(0); expect(post).not.toHaveBeenCalled(); await stopRemoteProducer(port);
  });
});

describe("raw work retains native domain accounting", () => {
  it("retired raw prepare work retains shared prepare budget and generation until actual settlement", async () => {
    const d = domain(), owner = randomUUID(), first = d.create(owner, ["feature-explanation"], worker), other = d.create(owner, ["ownership-semantic-assessment"], worker), g = gate(); let pending!: Promise<unknown>, entered = false;
    await d.operation(first, "prepare", async () => { pending = d.track(first, async () => { entered = true; await g.held; return true; }); void pending.catch(() => undefined); }); expect(entered).toBe(true);
    const newWork = vi.fn(async () => true); await expect(d.operation(other, "prepare", newWork)).rejects.toMatchObject({ code: "BUSY" }); expect(newWork).not.toHaveBeenCalled(); d.retire(first);
    let finished = false; const recovery = d.freezeAndStop().then(proof => { finished = true; return proof; }); await vi.waitFor(() => expect(workers.at(-1)!.threadId).toBe(-1)); expect(finished).toBe(false);
    g.release(); await expect(pending).rejects.toMatchObject({ code: "POLICY_INVALID" }); expect(d.consume(await recovery).map(p => p.generation)).toEqual([1, 2]);
  });
  it("raw work consumes shared pending budget before callback invocation", async () => {
    const d = domain(), first = d.create(randomUUID(), ["feature-explanation"], worker), g = gate(), work = vi.fn(async () => { await g.held; return true; }), refused = vi.fn(async () => true); let pending: Promise<unknown>[] = [];
    await d.operation(first, "work", async () => { pending = Array.from({ length: 19 }, () => d.track(first, work)); await expect(d.track(first, refused)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" }); });
    expect(work).toHaveBeenCalledTimes(19); expect(refused).not.toHaveBeenCalled(); g.release(); await Promise.all(pending); await d.stopParticipant(first);
  });
  it("original stop deadline remains conservative when raw work outlives caller", async () => {
    const d = domain(), ticket = d.create(randomUUID(), ["feature-explanation"], worker), g = gate(); let pending!: Promise<unknown>;
    await d.operation(ticket, "work", async () => { pending = d.track(ticket, () => g.held); void pending.catch(() => undefined); });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); const recovery = d.freezeAndStop().catch(error => error); await vi.advanceTimersByTimeAsync(60_001); expect(await recovery).toHaveProperty("code", "INTERRUPTED"); vi.useRealTimers();
    const later = vi.fn(async () => true); expect(() => d.track(ticket, later)).toThrow(); expect(later).not.toHaveBeenCalled(); g.release(); await expect(pending).rejects.toHaveProperty("code"); expect(d.consume(await d.freezeAndStop())).toHaveLength(1);
  });
});
