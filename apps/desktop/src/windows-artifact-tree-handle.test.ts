// Actual Windows/native tests. Written for root's technical window; never run by developer validation.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, ftruncateSync, linkSync, mkdtempSync, mkdirSync, openSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type FileRecord={path:string;identity:{volume:string;fileId:string};length:string;sha256:string;bytesRead:number;bufferBytes:number;readCalls:number;borrowedHandleCount:number;peCapture:{version:number;fileBytes:number;dosHex:string;peOffset:number|null;peHex:string}};
type Summary={status:string;scope:string;snapshotStatus:string;signatureStatus:string;fileCount:number;directoryCount:number;bytesRead:number;enumerationCalls:number;ownerHandleCount:number;borrowedViewCount:number;borrowedViewHandleCount:number;recordDigest:string};
type FixturePreparation={markerVerified:boolean;ownerSessionOpened:boolean;ownerReleased:boolean;requestedDirectoryCount:number;queriedDirectoryCount:number};
type Ready={summary:Summary;sample:FileRecord[];processId:number;psVersion:string;pointerBytes:number;fixturePreparation:FixturePreparation};
type Options={signal?:AbortSignal;timeoutMs?:number;readyTimeoutMs?:number;setupPaths?:string[]};
type Result={status:string;closeConfirmed:boolean;cleanupSafe:boolean;exitCode:number};

const cwd=resolve(process.cwd()),desktop=basename(cwd).toLowerCase()==="desktop"&&basename(dirname(cwd)).toLowerCase()==="apps"?cwd:join(cwd,"apps","desktop");
const require=createRequire(join(desktop,"package.json"));
const reader=require("./scripts/windows-artifact-reader-process.cjs") as {withOwnedReaderProcess(launch:{executable:string;helperPath:string;cwd:string;fixedArgs:string[]},input:Record<string,unknown>,consumer:(ready:Ready)=>unknown,options?:Options):Promise<Result>};
const library=join(desktop,"scripts/windows-artifact-handle-bridge.ps1"),directoryModule=join(desktop,"scripts/windows-artifact-directory-observation.ps1"),treeModule=join(desktop,"scripts/windows-artifact-tree-observation.ps1"),helper=join(desktop,"scripts/test-fixtures/windows-artifact-tree-probe.ps1");
const ps=join(process.env.SystemRoot??"C:\\Windows","System32/WindowsPowerShell/v1.0/powershell.exe"),quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
const imports=`. ([scriptblock]::Create([IO.File]::ReadAllText(${quote(library)}))); . ([scriptblock]::Create([IO.File]::ReadAllText(${quote(directoryModule)}))); . ([scriptblock]::Create([IO.File]::ReadAllText(${quote(treeModule)})));`;
const launch={executable:ps,helperPath:helper,cwd:desktop,fixedArgs:["-NoLogo","-NoProfile","-NonInteractive","-Command",`${imports} & ([scriptblock]::Create([IO.File]::ReadAllText(${quote(helper)}))) #`]};
function fixture(){const parent=mkdtempSync(join(tmpdir(),"xray-m7-owned-"));writeFileSync(join(parent,".xray-owned-material"),"M7 self-owned material; retained, no recursive cleanup");const directory=join(parent,"observed");mkdirSync(directory);return {parent,directory};}
function put(directory:string,name:string,content:string){const path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);return path;}
function run(directory:string,consumer:(ready:Ready)=>unknown=()=>undefined,mode="ordinary",options:Options={}){const {setupPaths=[],...processOptions}=options;return reader.withOwnedReaderProcess(launch,{directoryPath:directory,fixtureMode:mode,setupPaths},consumer,{timeoutMs:15000,readyTimeoutMs:10000,...processOptions});}
function reopen(file:string){const fd=openSync(file,"r+");closeSync(fd);}
function expectDenied(work:()=>unknown){let error:unknown;try{work();}catch(caught){error=caught;}expect(error).toBeDefined();expect(["EPERM","EACCES","EBUSY"]).toContain((error as NodeJS.ErrnoException).code);}
function direct(script:string){const out=spawnSync(ps,["-NoLogo","-NoProfile","-NonInteractive","-Command",`${imports} ${script}`],{windowsHide:true,encoding:"utf8",timeout:15000});expect(out.error).toBeUndefined();expect(out.status,out.stderr).toBe(0);return JSON.parse(out.stdout.trim()) as Record<string,unknown>;}

describe.skipIf(process.platform!=="win32")("M7 actual recursive same-HANDLE Windows artifact tree",()=>{
  it("hashes nested, hidden, Unicode, empty, and ordinary files with exact bounded samples",async()=>{
    const f=fixture(),nested=join(f.directory,"a-directory");mkdirSync(nested);mkdirSync(join(f.directory,"empty-directory"));
    const contents=new Map<string,string>([[".hidden","hidden material"],["a-directory/empty.bin",""],["a-directory/证据-'🙂.txt","nested material"]]);
    for(const [path,value] of contents)put(f.directory,path,value);
    await run(f.directory,ready=>{
      expect(ready.psVersion).toMatch(/^5\.1\./);expect(ready.pointerBytes).toBe(8);
      expect(ready.fixturePreparation).toEqual({markerVerified:true,ownerSessionOpened:true,ownerReleased:true,requestedDirectoryCount:3,queriedDirectoryCount:3});
      expect(ready.summary).toMatchObject({status:"observed",scope:"tree-files",snapshotStatus:"incomplete",signatureStatus:"not-evaluated",fileCount:3,directoryCount:3});
      expect(ready.summary.bytesRead).toBe([...contents.values()].reduce((sum,value)=>sum+Buffer.byteLength(value),0));
      expect(ready.summary.recordDigest).toMatch(/^[0-9a-f]{64}$/);expect(ready.summary.borrowedViewCount).toBe(3);
      expect(ready.sample.length).toBe(3);expect(ready.sample.map(item=>item.path)).toEqual(expect.arrayContaining([".hidden","a-directory/empty.bin","a-directory/证据-'🙂.txt"]));
      for(const item of ready.sample){const content=contents.get(item.path)!;expect(item.length).toBe(String(Buffer.byteLength(content)));expect(item.sha256).toBe(createHash("sha256").update(content).digest("hex"));expect(item.bufferBytes).toBe(1048576);expect(item.borrowedHandleCount).toBeGreaterThan(0);expect(item.identity.volume).toMatch(/^[0-9A-F]{16}$/);expect(item.identity.fileId).toMatch(/^[0-9A-F]{32}$/);expect(Buffer.from(item.identity.fileId,"hex").readBigUInt64LE()).toBe(statSync(join(f.directory,item.path),{bigint:true}).ino);}
      expect(ready.summary.borrowedViewHandleCount).toBeGreaterThan(ready.summary.borrowedViewCount);expect(ready.summary.ownerHandleCount).toBeGreaterThan(ready.summary.borrowedViewHandleCount/ready.summary.borrowedViewCount);
      expect(JSON.stringify(ready)).not.toContain(f.directory);expect(Buffer.byteLength(JSON.stringify(ready),"utf8")).toBeLessThan(65536);
    },"ordinary",{setupPaths:["a-directory","empty-directory"]});
    for(const path of contents.keys())reopen(join(f.directory,path));
    expect(readFileSync(join(f.directory,"a-directory/证据-'🙂.txt"),"utf8")).toBe("nested material");
  },30000);

  it("observes an empty root as one incomplete directory with no file samples",async()=>{
    const f=fixture();await run(f.directory,ready=>{expect(ready.summary).toMatchObject({scope:"tree-files",snapshotStatus:"incomplete",signatureStatus:"not-evaluated",fileCount:0,directoryCount:1,bytesRead:0,borrowedViewCount:0});expect(ready.sample).toEqual([]);});
  });

  it("accepts more than M6's default 128 members without truncation",async()=>{
    const f=fixture(),names=Array.from({length:129},(_,index)=>`member-${String(index).padStart(3,"0")}.txt`);
    for(const name of names)writeFileSync(join(f.directory,name),`owned-${name}`);
    await run(f.directory,ready=>{expect(ready.summary.fileCount).toBe(129);expect(ready.summary.directoryCount).toBe(1);expect(ready.sample).toHaveLength(3);expect(ready.summary.ownerHandleCount).toBeGreaterThan(129);});
    reopen(join(f.directory,names[0]!));
  },30000);

  it("rejects an actual self-owned file larger than 2 GiB before reading it",async()=>{
    const f=fixture(),file=put(f.directory,"oversized.bin",""),fd=openSync(file,"r+");ftruncateSync(fd,2147483649);closeSync(fd);
    expect(statSync(file).size).toBe(2147483649);let ready=false;
    await expect(run(f.directory,()=>{ready=true;})).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});
    expect(ready).toBe(false);reopen(file);
  },30000);

  it("holds files and directories through ready and releases the complete owner ledger",async()=>{
    const f=fixture(),file=put(f.directory,"nested/held.bin","held tree member"),nested=dirname(file);
    const result=await run(f.directory,ready=>{
      expect(ready.fixturePreparation).toEqual({markerVerified:true,ownerSessionOpened:true,ownerReleased:true,requestedDirectoryCount:2,queriedDirectoryCount:2});
      expectDenied(()=>writeFileSync(file,"mutation"));expectDenied(()=>unlinkSync(file));expectDenied(()=>renameSync(file,`${file}-moved`));expectDenied(()=>renameSync(nested,`${nested}-moved`));expect(ready.summary.ownerHandleCount).toBeGreaterThan(ready.summary.borrowedViewCount);
    },"ordinary",{setupPaths:["nested"]});
    expect(result).toMatchObject({status:"released",exitCode:0,closeConfirmed:true,cleanupSafe:true});reopen(file);expect(readFileSync(file,"utf8")).toBe("held tree member");
  });

  it("rejects a file inserted into a completed subtree before a later sibling is read",async()=>{
    const f=fixture(),first=put(f.directory,"a/b/first.bin","first owned file"),last=put(f.directory,"z-last.bin","later owned file");let ready=false;
    await expect(run(f.directory,()=>{ready=true;} ,"late-subtree-add")).rejects.toMatchObject({code:"CHILD_EXIT",exitCode:9,cleanupSafe:true,closeConfirmed:true});
    const inserted=join(f.directory,"a/b/added-after-subtree");expect(ready).toBe(false);expect(readFileSync(inserted,"utf8")).toBe("late tree-owned insertion");
    reopen(first);reopen(last);reopen(inserted);
  },30000);

  it("rejects a changed full metadata field during the global final same-handle pass",async()=>{
    const f=fixture(),first=put(f.directory,"a/b/first.bin","first owned file"),last=put(f.directory,"z-last.bin","later owned file");let ready=false;
    await expect(run(f.directory,()=>{ready=true;} ,"late-subtree-metadata",{setupPaths:["a","a/b"]})).rejects.toMatchObject({code:"CHILD_EXIT",exitCode:9,cleanupSafe:true,closeConfirmed:true});
    expect(ready).toBe(false);reopen(first);reopen(last);
  },30000);

  it("rechecks every file member's full metadata after later file content has been read",async()=>{
    const f=fixture(),first=put(f.directory,"a/b/first.bin","first owned file"),last=put(f.directory,"z-last.bin","later owned file");let ready=false;
    await expect(run(f.directory,()=>{ready=true;} ,"late-file-metadata",{setupPaths:["a","a/b"]})).rejects.toMatchObject({code:"CHILD_EXIT",exitCode:9,cleanupSafe:true,closeConfirmed:true});
    expect(ready).toBe(false);reopen(first);reopen(last);
  },30000);

  it("rejects hard-linked aliases by same-volume file identity and releases both names",async()=>{
    const f=fixture(),original=put(f.directory,"original.bin","one underlying file"),alias=join(f.directory,"alias.bin");linkSync(original,alias);
    expect(statSync(original,{bigint:true}).ino).toBe(statSync(alias,{bigint:true}).ino);let ready=false;
    await expect(run(f.directory,()=>{ready=true;})).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});
    expect(ready).toBe(false);reopen(original);reopen(alias);expect(readFileSync(alias,"utf8")).toBe("one underlying file");
  },30000);

  it("rejects a directory junction without reading outside its owned root",async()=>{
    const f=fixture(),outside=join(f.parent,"outside"),outsideFile=join(outside,"private.txt"),junction=join(f.directory,"junction");mkdirSync(outside);writeFileSync(outsideFile,"outside material");symlinkSync(outside,junction,"junction");let ready=false;
    await expect(run(f.directory,()=>{ready=true;})).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});
    expect(ready).toBe(false);expect(readFileSync(outsideFile,"utf8")).toBe("outside material");reopen(outsideFile);
  },30000);

  it.each([["post-vector-add",null],["post-vector-field",9],["metadata-change-write",null],["query-error",null]] as const)("fails closed and releases partial tree handles for %s",async(mode,exitCode)=>{
    const f=fixture(),file=put(f.directory,"member","M7 owned mutation target");let ready=false;
    await expect(run(f.directory,()=>{ready=true;},mode)).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true,...(exitCode===null?{}:{exitCode})});
    expect(ready).toBe(false);reopen(file);await run(f.directory);
  });

  it("rejects a directory deeper than 64 levels before ready and releases descendants",async()=>{
    const f=fixture();let current=f.directory;
    for(let index=0;index<65;index++){current=join(current,"d");mkdirSync(current);}
    const held=put(current,"held.txt","owned deep file");let ready=false;
    await expect(run(f.directory,()=>{ready=true;})).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});
    expect(ready).toBe(false);reopen(held);
  },30000);

  it("accepts a file exactly 64 tree levels deep with a bounded M5 borrowed view",async()=>{
    const f=fixture();let current=f.directory;
    for(let index=0;index<64;index++){current=join(current,"d");mkdirSync(current);}
    const file=put(current,"at-limit.txt","depth 64"),setupPaths=Array.from({length:64},(_,index)=>Array.from({length:index+1},()=>"d").join("/"));
    await run(f.directory,ready=>{expect(ready.fixturePreparation).toEqual({markerVerified:true,ownerSessionOpened:true,ownerReleased:true,requestedDirectoryCount:65,queriedDirectoryCount:65});expect(ready.summary).toMatchObject({fileCount:1,directoryCount:65,borrowedViewCount:1});expect(ready.sample).toHaveLength(1);expect(ready.sample[0]?.path).toBe(`${Array.from({length:64},()=>"d").join("/")}/at-limit.txt`);expect(ready.sample[0]?.borrowedHandleCount).toBe(65);},"ordinary",{setupPaths});
    reopen(file);expect(readFileSync(file,"utf8")).toBe("depth 64");
  },30000);

  it("rejects a UTF-8 root-relative path beyond 512 bytes before any handle open",()=>{
    const result=direct(`$code='ACCEPT';try{$parent='x'*400;$name='b'*113;$null=Get-XRayTreeRelativePath $parent $name}catch{$code=$_.Exception.Message};[Console]::WriteLine((@{code=$code}|ConvertTo-Json -Compress))`);
    expect(result.code).toBe("TREE_PATH_LIMIT");
  });

  it("rejects a record whose accounted UTF-8 size would exceed the 32 MiB budget",()=>{
    const result=direct(`$state=[pscustomobject]@{accountedBytes=[long](33554432-10)};$code='ACCEPT';try{$null=Add-XRayTreeAccountedValue $state ('x'*128) 384}catch{$code=$_.Exception.Message};[Console]::WriteLine((@{code=$code}|ConvertTo-Json -Compress))`);
    expect(result.code).toBe("TREE_LIMIT");
  });

  it("refuses cancellation after ready and confirms child close before reopening every file",async()=>{
    const f=fixture(),file=put(f.directory,"held.bin","cancel while owner ledger is held"),controller=new AbortController();let consumed=false;
    await expect(run(f.directory,ready=>{consumed=true;expectDenied(()=>{const fd=openSync(file,"r+");closeSync(fd);});controller.abort();return new Promise(()=>undefined);},"ordinary",{signal:controller.signal})).rejects.toMatchObject({code:"CANCELLED",cleanupSafe:true,closeConfirmed:true});
    expect(consumed).toBe(true);reopen(file);
  },20000);

  it("confirms every held tree handle is closed after the reader deadline",async()=>{
    const f=fixture(),file=put(f.directory,"held.bin","deadline while owner ledger is held");let consumed=false;
    await expect(run(f.directory,()=>{consumed=true;return new Promise(()=>undefined);},"ordinary",{timeoutMs:3500,readyTimeoutMs:3000})).rejects.toMatchObject({code:"DEADLINE_EXCEEDED",cleanupSafe:true,closeConfirmed:true});
    expect(consumed).toBe(true);reopen(file);
  },20000);

  it("does not report release when the first owner CloseHandle fails, then confirms recovery",async()=>{
    const f=fixture(),file=put(f.directory,"held.bin","tree close recovery target");let consumed=false;
    await expect(run(f.directory,()=>{consumed=true;},"close-failure")).rejects.toMatchObject({code:"CHILD_EXIT",cleanupSafe:true,closeConfirmed:true});
    expect(consumed).toBe(true);reopen(file);
  },20000);
});
