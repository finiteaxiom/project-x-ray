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
