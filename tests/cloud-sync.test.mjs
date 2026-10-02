import test from "node:test";
import assert from "node:assert/strict";
import { mergeTasks, CloudTasks } from "../cloud-sync.js";
const task = (id, fields = {}) => ({ id, title: id, project: "", notes: "", intent: "must", urgent: false,
  done: false, due: "", deps: [], created: "2026-10-01T00:00:00Z", ...fields });
const clone = (x) => JSON.parse(JSON.stringify(x));
test("first sync preserves both phone tasks and tasks added from chat", () => {
  assert.deepEqual(mergeTasks([], [task("phone")], [task("chat")]).map(t => t.id), ["chat", "phone"]);
});
test("completion and independent edits combine without reviving deletions", () => {
  const base = [task("a"), task("b")];
  const local = [task("a", { done: true })];
  const remote = [task("a", { notes: "From desktop" }), task("b")];
  assert.deepEqual(mergeTasks(base, local, remote), [task("a", { done: true, notes: "From desktop" })]);
});
test("simultaneous edits and delete/edit conflicts pause instead of overwriting", () => {
  const base = [task("a")];
  assert.throws(() => mergeTasks(base, [task("a", { title: "Phone" })], [task("a", { title: "Chat" })]), /conflict/);
  assert.throws(() => mergeTasks(base, [], [task("a", { title: "Chat" })]), /conflict/);
  assert.equal(mergeTasks(base, [task("a", { title: "Phone" })], [task("a", { title: "Chat" })], "remote")[0].title, "Chat");
});
test("merges cannot introduce dangling dependencies or invalid completion", () => {
  const base = [task("a"), task("b")];
  assert.throws(() => mergeTasks(base, [task("b")], [task("a"), task("b", { deps: ["a"] })]), /missing/);
});
function setup(list = []) {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) };
  Object.defineProperty(globalThis,"navigator",{ configurable:true, value:{ onLine:true } });
  let tasks = clone(list), revision = 0, remote = [], calls = 0;
  const auth = { session:{user:{id:"owner"}}, enabled:false,
    rpc: async (name, body) => {
      calls++;
      if (name === "mydo_cloud_read") return {revision,tasks:clone(remote)};
      if (body.p_revision !== revision) return {ok:false};
      remote=clone(body.p_tasks); return {ok:true,revision:++revision,tasks:clone(remote)};
    } };
  const cloud = new CloudTasks({ auth,getTasks:()=>tasks,setTasks:x=>{tasks=x;} });
  return {cloud,auth,storage,get tasks(){return tasks;},set tasks(x){tasks=x;},get remote(){return remote;},set remote(x){remote=x;revision++;},get calls(){return calls;}};
}
test("first enable backs up local tasks and fetches tasks from another device", async () => {
  const s=setup([task("phone")]); s.remote=[task("chat")];
  await s.cloud.enable();
  assert.equal(s.cloud.message,"synced");
  assert.equal(s.tasks.length,2);
  assert.equal(JSON.parse(s.storage.get("mydo.cloud.backup.owner")).tasks.length,1);
  s.remote.push(task("more")); await s.cloud.sync(); assert.equal(s.tasks.length,3);
});
test("offline changes stay local and sync after reconnection", async () => {
  const s=setup([task("a")]); await s.cloud.enable();
  navigator.onLine=false; s.tasks=[task("a",{done:true})]; await s.cloud.sync();
  assert.equal(s.cloud.message,"pending"); assert.equal(s.remote[0].done,false);
  navigator.onLine=true; await s.cloud.sync(); assert.equal(s.remote[0].done,true);
});
test("pausing sync remains saved when the device cannot be unlinked offline", async () => {
  const s=setup([task("a")]); await s.cloud.enable();
  s.auth.rpc=async()=>{throw Error("offline");};
  await assert.rejects(s.cloud.disable(), /offline/);
  assert.equal(s.cloud.enabled,false);
  assert.equal(JSON.parse(s.storage.get("mydo.cloud.state")).enabled,false);
  const restored=new CloudTasks({auth:s.auth,getTasks:()=>s.tasks,setTasks:x=>{s.tasks=x;}});
  assert.equal(restored.enabled,false);
});
test("a stale cloud revision retries; local edits during write are preserved", async () => {
  const s=setup([task("a")]); const original=s.auth.rpc; let first=true;
  s.auth.rpc=async(name,body)=>{
    if(name==="mydo_cloud_write" && first){first=false;s.remote=[task("remote")];s.tasks.push(task("during"));return {ok:false};}
    return original(name,body);
  };
  await s.cloud.enable(); assert.equal(s.tasks.length,3); assert.equal(s.remote.length,3);
});
test("an edit made during an accepted write is sent on the next CAS pass", async () => {
  const s=setup([task("a")]); const original=s.auth.rpc; let first=true;
  s.auth.rpc=async(name,body)=>{
    const response=await original(name,body);
    if(name==="mydo_cloud_write" && first){first=false;s.tasks=[task("a",{notes:"Typed during sync"})];}
    return response;
  };
  await s.cloud.enable(); assert.equal(s.remote[0].notes,"Typed during sync");
});
test("task ordering is canonical across devices, avoiding revision churn", () => {
  const a=task("a"),b=task("b");
  assert.deepEqual(mergeTasks([], [a,b], [b,a]),mergeTasks([], [b,a], [a,b]));
});
test("Postgres JSONB key ordering does not cause false conflicts or endless sync", async () => {
  const s=setup([task("a")]); const original=s.auth.rpc;
  const reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==="object"
    ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,reorder(x[k])])):x;
  s.auth.rpc=async(name,body)=>reorder(await original(name,body));
  await s.cloud.enable();assert.equal(s.cloud.message,"synced");
  const calls=s.calls;await s.cloud.sync();assert.equal(s.calls,calls+1);
});
test("account changes and unreadable local tasks cannot overwrite cloud data", async () => {
  const s=setup([task("a")]); await s.cloud.enable(); const calls=s.calls;
  s.auth.session.user.id="another"; await s.cloud.sync(); assert.equal(s.cloud.message,"account");assert.equal(s.calls,calls);
  s.auth.session.user.id="owner";s.tasks=null; await s.cloud.sync();assert.equal(s.remote.length,1);
});
test("progress merges atomically and conflicts with simultaneous completion",()=>{
  const base=[task('a',{status:'preparing'})];
  const local=[task('a',{status:'ongoing'})];
  const remote=[task('a',{status:'preparing',notes:'Edited elsewhere'})];
  const merged=mergeTasks(base,local,remote)[0];assert.equal(merged.status,'ongoing');assert.equal(merged.done,false);assert.equal(merged.notes,'Edited elsewhere');
  assert.throws(()=>mergeTasks(base,local,[task('a',{status:'complete',done:true})]),/conflict/);
  const legacyComplete=mergeTasks(base,base,[task('a',{done:true})])[0];assert.equal(legacyComplete.status,'complete');assert.equal(legacyComplete.done,true);
  const reopened=mergeTasks([task('a',{status:'complete',done:true})],[task('a',{status:'complete',done:false})],[task('a',{status:'complete',done:true})])[0];assert.equal(reopened.status,'preparing');
});
