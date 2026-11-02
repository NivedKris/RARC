import { runInSandbox } from "../lib/sandbox";
import { makeToolClient } from "../lib/tools";
const progs: Record<string,string> = {
ok: `async function run(task, tools, context){ try { const h = await tools.call('search_hotels',{city:task.inputs.city}); if(!h.length) return {status:'failed_gracefully',answer:null}; return {status:'success', answer:{value:h.length, unit:'count'}, success_indicators:{}, trace:[]}; } catch(e){ return {status:'failed_gracefully', answer:null, trace:[e.code]} } }`,
loop: `async function run(t,tools,c){ while(true){} }`,
mem: `async function run(t,tools,c){ let a=[]; while(true){ a.push('x'.repeat(100000)); } }`,
net: `async function run(t,tools,c){ try { await f2('http://evil.com') } catch(e){} return {status:'success',answer:{value:1,unit:'x'}} } const f2 = (u)=>this.fetch ? 0 : 0; `,
net2: `async function run(t,tools,c){ var g = (0, eval); return {status:'success',answer:{value:1,unit:'x'}} }`,
hang: `async function run(t,tools,c){ await new Promise(()=>{}); }`,
toolerr: `async function run(t,tools,c){ await tools.call('search_hotels',{city:'Jaipur'}); return {status:'success',answer:{value:1,unit:'x'}} }`,
confirm: `async function run(t,tools,c){ try{ await tools.call('book_hotel',{hotel_id:'H-PNQ-1',checkin:'2026-11-10',nights:1}); }catch(e){} return {status:'success',answer:{value:1,unit:'x'}} }`,
recur: `async function run(t,tools,c){ function f(n){ return f(n+1)+1 } return f(0) }`,
bad: `async function run(t,tools,c){ return {status:'done'} }`,
};
(async()=>{ for (const [k,code] of Object.entries(progs)) { const tc = makeToolClient({allowed:['search_hotels','book_hotel'], mode:'replay'}); const t=Date.now(); const r = await runInSandbox({code, task:{text:'',inputs:{city:'Pune'}}, context:{now:tc.now, confirmed:false}, category:'C2', toolCall: tc.call, limits:{wallMs:1500}}); console.log(k.padEnd(8), r.status, r.error_code, (r.error_message||'').slice(0,70), JSON.stringify(r.answer), Date.now()-t+'ms'); } })();
