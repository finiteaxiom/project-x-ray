// Windows technical tests: deliberately not part of the developer's pure validation window.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
type Observation = { status:string; snapshotStatus:string; signatureStatus:string; identity:{volume:string;fileId:string}; bytesRead:number; bufferBytes:number; readCalls:number; sha256:string; heldHandles:number; peCapture:{version:number;fileBytes:number;dosHex:string;peOffset:number|null;peHex:string} };
type Ready = { observation:Observation;processId:number;psVersion:string;pointerBytes:number };
type Result = { status:string;cleanupSafe:boolean;closeConfirmed:boolean;exitCode:number };
type Options = { signal?:AbortSignal;timeoutMs?:number;readyTimeoutMs?:number };
type Launch = { executable:string;fixedArgs:string[];helperPath:string;cwd:string };
const cwd=resolve(process.cwd()),desktop=basename(cwd).toLowerCase()==="desktop"&&basename(dirname(cwd)).toLowerCase()==="apps"?cwd:join(cwd,"apps","desktop");
const require=createRequire(join(desktop,"package.json"));
const reader=require("./scripts/windows-artifact-reader-process.cjs") as {withOwnedReaderProcess(launch:Launch,input:Record<string,unknown>,consumer:(ready:Ready)=>unknown,options?:Options):Promise<Result>};
const consumer=require("./scripts/windows-artifact-pe-capture.cjs") as {consumePeCapture(input:unknown):Omit<Observation,"peCapture">&{pe:{peStatus:string;architecture:string|null;issue:string|null}}};
const library=join(desktop,"scripts/windows-artifact-handle-bridge.ps1"),helper=join(desktop,"scripts/test-fixtures/windows-artifact-pe-handle-probe.ps1");
const powershell=join(process.env.SystemRoot??"C:\\Windows","System32/WindowsPowerShell/v1.0/powershell.exe"),quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
const command=`. ([scriptblock]::Create([IO.File]::ReadAllText(${quote(library)}))); & ([scriptblock]::Create([IO.File]::ReadAllText(${quote(helper)}))) #`;
const launch={executable:powershell,helperPath:helper,cwd:desktop,fixedArgs:["-NoLogo","-NoProfile","-NonInteractive","-Command",command]};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function bytes(size=4096,offset=64,machine=0x8664){const value=Buffer.alloc(size,0x61);if(size>=64){value.write("MZ");value.writeUInt32LE(offset,60);}if(offset>=64&&offset+24<=size){value.write("PE\0\0",offset,"ascii");value.writeUInt16LE(machine,offset+4);}return value;}
function fixture(value:Buffer){const directory=mkdtempSync(join(tmpdir(),"xray-m5-owned-"));writeFileSync(join(directory,".xray-owned-material"),"4B-M5 own material; retained, no cleanup");const file=join(directory,"PE-'有限.bin");writeFileSync(file,value);return {directory,file,value};}
function run(file:string,consume:(ready:Ready)=>unknown=()=>undefined,mode="ordinary",options:Options={}){return reader.withOwnedReaderProcess(launch,{filePath:file,maxBytes:2147483648,fixtureMode:mode},consume,{timeoutMs:15000,readyTimeoutMs:10000,...options});}
function reopen(file:string){const fd=openSync(file,"r+");closeSync(fd);}
function expectDenied(work:()=>unknown){let error:unknown;try{work();}catch(caught){error=caught;}expect(error).toBeDefined();expect(["EPERM","EACCES","EBUSY"]).toContain((error as NodeJS.ErrnoException).code);}

describe.skipIf(process.platform!=="win32")("M5 owned same-HANDLE PE capture and actual CJS consumption",()=>{
  it.each([64,1048576-11,1048576,1048576+17,3*1048576+5])("captures range %i across one sequential hash while the chain remains held",async(offset)=>{
    const f=fixture(bytes(offset+24,offset));let identity:Observation["identity"]|undefined;
    const result=await run(f.file,ready=>{
      const o=ready.observation,out=consumer.consumePeCapture(o);expect(ready.psVersion).toMatch(/^5\.1\./);expect(ready.pointerBytes).toBe(8);
      expect(o).toMatchObject({status:"observed",snapshotStatus:"incomplete",signatureStatus:"not-evaluated",bytesRead:f.value.length,bufferBytes:1048576,readCalls:Math.ceil(f.value.length/1048576)+1,sha256:sha(f.value)});
      expect(o.peCapture).toEqual({version:1,fileBytes:f.value.length,dosHex:f.value.subarray(0,64).toString("hex"),peOffset:offset,peHex:f.value.subarray(offset,offset+24).toString("hex")});
      expect(out.pe).toMatchObject({peStatus:"pe",architecture:"x64",issue:null});expect(JSON.stringify(out)).not.toContain("peCapture");expect(JSON.stringify(out)).not.toContain(f.file);
      expect(o.identity.volume).toMatch(/^[0-9A-F]{16}$/);expect(o.identity.fileId).toMatch(/^[0-9A-F]{32}$/);expect(Buffer.from(o.identity.fileId,"hex").readBigUInt64LE()).toBe(statSync(f.file,{bigint:true}).ino);identity=o.identity;
      expect(o.heldHandles).toBe(f.file.slice(3).split("\\").length+1);expectDenied(()=>{const fd=openSync(f.file,"r+");closeSync(fd);});expectDenied(()=>writeFileSync(f.file,"blocked"));
    });expect(result).toMatchObject({status:"released",exitCode:0,cleanupSafe:true,closeConfirmed:true});reopen(f.file);
    await run(f.file,ready=>expect(ready.observation.identity).toEqual(identity));expect(readFileSync(f.file)).toEqual(f.value);
  },30000);
  it.each([0x14c,0x8664,0xaa64])("consumes independently constructed machine %i",async(machine)=>{const f=fixture(bytes(200,64,machine));await run(f.file,ready=>expect(consumer.consumePeCapture(ready.observation).pe.architecture).toBe(machine===0x14c?"x86":machine===0x8664?"x64":"unknown"));reopen(f.file);});
  it.each([0,13,63])("keeps %i-byte DOS capture bounded",async(size)=>{const f=fixture(bytes(size));await run(f.file,ready=>{expect(ready.observation.peCapture.dosHex).toBe(f.value.toString("hex"));expect(ready.observation.peCapture.peOffset).toBeNull();expect(consumer.consumePeCapture(ready.observation).pe.issue).toBe("short-dos-header");});reopen(f.file);});
  it.each(["non-pe","bad-signature","inside-dos","outside-file","max-offset"])("rejects %s PE interpretation without invalidating full held hash",async(kind)=>{const value=bytes(100,kind==="inside-dos"?63:kind==="outside-file"?90:kind==="max-offset"?0xffffffff:64);if(kind==="non-pe")value.write("NO");if(kind==="bad-signature")value.write("NO",64);const f=fixture(value);await run(f.file,ready=>{const out=consumer.consumePeCapture(ready.observation);expect(out.sha256).toBe(sha(value));expect(out.pe.peStatus).toBe(kind==="non-pe"?"non-pe":"unknown");expect(out.snapshotStatus).toBe("incomplete");});reopen(f.file);});
  it("handles seven-byte native reads including DOS and PE split boundaries",async()=>{const f=fixture(bytes(161,79));await run(f.file,ready=>{const o=ready.observation;expect(o.readCalls).toBe(Math.ceil(f.value.length/7)+1);expect(o.peCapture.dosHex).toBe(f.value.subarray(0,64).toString("hex"));expect(o.peCapture.peHex).toBe(f.value.subarray(79,103).toString("hex"));expect(consumer.consumePeCapture(o).pe.architecture).toBe("x64");expect(o.sha256).toBe(sha(f.value));},"short-chunks");reopen(f.file);});
  it.each(["early-eof","read-failure","repeat-read","leaf-change","parent-change"])("never emits partial ready on %s and releases",async(mode)=>{const f=fixture(bytes(4096)),consume=()=>{throw Error("partial success must not be emitted");};await expect(run(f.file,consume,mode)).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});reopen(f.file);await run(f.file);});
  it("refuses existing writable occupancy and leaves preceding handles releasable",async()=>{const f=fixture(bytes()),writer=openSync(f.file,"r+");try{await expect(run(f.file)).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});}finally{closeSync(writer);}reopen(f.file);await run(f.file);});
  it.each(["cancel","deadline","consumer-failure"])("preserves checked process close on %s",async(mode)=>{const f=fixture(bytes()),controller=new AbortController();let consumed=false;const consume=(ready:Ready)=>{consumer.consumePeCapture(ready.observation);consumed=true;expectDenied(()=>{const fd=openSync(f.file,"r+");closeSync(fd);});if(mode==="consumer-failure")throw Error("PRIVATE_FIXTURE_DETAIL");if(mode==="cancel")controller.abort();return new Promise(()=>undefined);};await expect(run(f.file,consume,"ordinary",{signal:controller.signal,...(mode==="deadline"?{timeoutMs:3500,readyTimeoutMs:3000}:{})})).rejects.toMatchObject({code:mode==="cancel"?"CANCELLED":mode==="deadline"?"DEADLINE_EXCEEDED":"CONSUMER_FAILED",cleanupSafe:true,closeConfirmed:true});expect(consumed).toBe(true);reopen(f.file);},20000);
  it("never claims released terminal when an injected close fails",async()=>{const f=fixture(bytes());let consumed=false;await expect(run(f.file,ready=>{consumer.consumePeCapture(ready.observation);consumed=true;},"close-failure")).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});expect(consumed).toBe(true);reopen(f.file);});
  it("rejects traversal and a directory junction rather than reading external material",async()=>{const f=fixture(bytes()),outside=fixture(bytes(100,64,0x14c)),link=join(f.directory,"junction");symlinkSync(outside.directory,link,"junction");await expect(run(join(link,basename(outside.file)))).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true});await expect(run(`${f.directory}\\..\\${basename(f.directory)}\\${basename(f.file)}`)).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true});reopen(f.file);reopen(outside.file);});
  it.each(["duplicate","escaped-duplicate","wrong-token","duplicate-start"])("strictly rejects %s release frame and never reports released terminal",async(mode)=>{
    const f=fixture(bytes()),runId=randomUUID(),token="A".repeat(32),child=spawn(powershell,launch.fixedArgs,{windowsHide:true,cwd:desktop,stdio:["pipe","pipe","pipe"]});
    const closed=new Promise<number|null>((yes,no)=>{child.once("close",yes);child.once("error",no);});let stdout="",stderr="";child.stdout.on("data",d=>stdout+=String(d));child.stderr.on("data",d=>stderr+=String(d));const watchdog=setTimeout(()=>child.kill(),10000);
    try{child.stdin.write(JSON.stringify({protocolVersion:1,type:"start",runId,token,input:{filePath:f.file,maxBytes:2147483648,fixtureMode:"ordinary"}})+"\n");await new Promise<void>((yes,no)=>{const poll=setInterval(()=>{if(stdout.includes("\n")){clearInterval(poll);yes();}else if(child.exitCode!==null){clearInterval(poll);no(Error("ready missing"));}},10);setTimeout(()=>{clearInterval(poll);no(Error("ready deadline"));},8000).unref();});
      const release=JSON.stringify({protocolVersion:1,type:"release",runId,token});child.stdin.end(mode==="duplicate"?release.replace('"token":',`"token":"${token}","token":`)+"\n":mode==="escaped-duplicate"?release.replace('"token":',`"to\\u006ben":"${token}","token":`)+"\n":mode==="wrong-token"?JSON.stringify({protocolVersion:1,type:"release",runId,token:"B".repeat(32)})+"\n":JSON.stringify({protocolVersion:1,type:"start",runId,token})+"\n");expect(await closed).toBe(3);expect(stderr.trim()).toBe("CONTROL_INVALID");expect(stdout).not.toContain('"terminal"');expect(stderr).not.toContain(f.file);reopen(f.file);
    }finally{clearTimeout(watchdog);if(child.exitCode===null&&child.signalCode===null){child.kill();await closed;}}
  },15000);
  it("fixture failure is fixed and excludes private path or capture bytes",async()=>{const f=fixture(bytes());await expect(run(`${f.file}:private`)).rejects.toMatchObject({code:"CHILD_EXIT",message:"Reader process exited unsuccessfully",cleanupSafe:true,closeConfirmed:true});reopen(f.file);});
});
