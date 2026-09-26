export type Policy = 'Reflow' | 'Immediate' | 'Freeze';
export type Disposition = 'DEFER' | 'QUEUE_HIGH' | 'INTERRUPT' | 'NONE';
export type BlockId = 'baggage' | 'gate' | 'security' | 'weather';
export type Block = {id: BlockId; label:string; text:string; revision:number};
export type Snapshot = {version:number; blocks:Record<BlockId,Block>; blockId:BlockId; offset:number};
export type Update = {id:string; blockId:BlockId; text:string; revision:number; at:number; kind:'noise'|'gate'|'notice'|'baggage'; status:'pending'|'deferred'|'high'|'published'|'review';};
export type Verdict = {disposition:Disposition; source:'Jev'|'Fixture'|'Rule'|'Fallback'; latencyMs:number; confidence?:number; probabilities?:Record<Disposition,number>; model?:string; reason:string};
export type RequestKey = {taskEpoch:number; policyEpoch:number; lease:number; blockId:BlockId; blockRevision:number; eventId:string; eventRevision:number; snapshot:Snapshot; gateRevision:number};
export type Trace = Verdict & {id:string; text:string; at:number; stale?:boolean};
export type State = {version:number; blocks:Record<BlockId,Block>; snapshot:Snapshot; saved:Snapshot|null; active:Update|null; noticeOffset:number; policy:Policy; task:'before'|'after'; taskEpoch:number; policyEpoch:number; lease:number; events:Update[]; traces:Trace[]; updates:number; interruptions:number; resumes:number; exactResumes:number; rewrites:number; stale:number; phase:string};
export const SECURITY_NOTICE='Checkpoint A is no longer accepting passengers. Access to F gates continues through checkpoint B.';
export const taskText=(t:State['task'])=>t==='before'?'I am before security. Use checkpoint A to reach gate F18 before boarding closes.':'I am already at gate F18, after security. Wait here for boarding.';
export function initialState():State {
 const blocks:Record<BlockId,Block>={
 baggage:{id:'baggage',label:'Baggage information',text:'Baggage information · carousel 4 · Keep your baggage receipt until the end of your journey.',revision:1},
 gate:{id:'gate',label:'Your departure',text:'Flight UA 245 · Gate F18 · Boarding at 14:20 · San Francisco to New York.',revision:1},
 security:{id:'security',label:'Security & access',text:'Checkpoint A is open. Follow signs for F gates after security.',revision:1},
 weather:{id:'weather',label:'Local weather',text:'San Francisco · 68°F · Clear skies.',revision:1}};
 return {version:1,blocks,snapshot:{version:1,blocks:structuredClone(blocks),blockId:'baggage',offset:0},saved:null,active:null,noticeOffset:0,policy:'Reflow',task:'before',taskEpoch:0,policyEpoch:0,lease:1,events:[],traces:[],updates:0,interruptions:0,resumes:0,exactResumes:0,rewrites:0,stale:0,phase:'Ready when you are'};
}
export function visibleText(s:State,width=40) { const text=s.active?.text??s.snapshot.blocks[s.snapshot.blockId].text; return Array.from(text).slice(s.active?s.noticeOffset:s.snapshot.offset,(s.active?s.noticeOffset:s.snapshot.offset)+width).join(''); }
export function isHistorical(s:State) { return s.snapshot.blocks[s.snapshot.blockId].revision!==s.blocks[s.snapshot.blockId].revision; }
export function capture(s:State,event:Update):RequestKey {return {taskEpoch:s.taskEpoch,policyEpoch:s.policyEpoch,lease:s.lease,blockId:event.blockId,blockRevision:s.blocks[event.blockId].revision,eventId:event.id,eventRevision:event.revision,snapshot:structuredClone(s.snapshot),gateRevision:s.blocks.gate.revision};}
export type Action = {type:'update';event:Update}|{type:'decision';key:RequestKey;verdict:Verdict}|{type:'policy';value:Policy}|{type:'task';value:State['task']}|{type:'pan';direction:number;width:number}|{type:'block';id:BlockId}|{type:'resume'}|{type:'current'}|{type:'review';id:string}|{type:'reset'}|{type:'phase';value:string};
export function reducer(state:State,action:Action):State {
 if(action.type==='reset')return initialState();
 const s=structuredClone(state);
 const publish=(event:Update)=>{ if(!s.active)s.saved=structuredClone(s.snapshot);s.active=event;s.noticeOffset=0;s.lease++;s.interruptions++;s.rewrites++;event.status='published'; };
 switch(action.type){
 case 'update': {const e=action.event;s.version++;s.blocks[e.blockId]={...s.blocks[e.blockId],text:e.text,revision:e.revision};s.events.unshift(e);s.updates++;return s;}
 case 'decision': {const {key,verdict}=action;const e=s.events.find(e=>e.id===key.eventId);if(!e||e.status!=='pending')return state;
 const stale=key.taskEpoch!==s.taskEpoch||key.policyEpoch!==s.policyEpoch||key.lease!==s.lease||key.blockRevision!==s.blocks[key.blockId].revision||key.eventRevision!==e.revision||key.gateRevision!==s.blocks.gate.revision;
 s.traces.unshift({...verdict,id:e.id,text:e.text,at:Date.now(),stale});
 if(stale){e.status='review';s.stale++;return s;}
 if(s.policy==='Immediate'){publish(e);return s;}
 if(s.policy==='Freeze'){e.status='deferred';return s;}
 if(verdict.disposition==='INTERRUPT'){if(s.active){e.status='high';}else publish(e);}
 else e.status=verdict.disposition==='DEFER'?'deferred':verdict.disposition==='QUEUE_HIGH'?'high':'review';
 return s;}
 case 'resume': if(!s.saved)return state; {const target=structuredClone(s.saved);s.snapshot=target;s.active=null;s.saved=null;s.noticeOffset=0;s.lease++;s.resumes++;s.exactResumes++;s.rewrites++;return s;}
 case 'current': s.snapshot={version:s.version,blocks:structuredClone(s.blocks),blockId:s.snapshot.blockId,offset:0};s.active=null;s.saved=null;s.lease++;s.rewrites++;return s;
 case 'block': s.snapshot={version:s.version,blocks:structuredClone(s.blocks),blockId:action.id,offset:0};s.active=null;s.saved=null;s.lease++;s.rewrites++;return s;
 case 'pan': {const text=s.active?.text??s.snapshot.blocks[s.snapshot.blockId].text;const max=Math.max(0,Math.floor((Array.from(text).length-1)/action.width)*action.width);if(s.active)s.noticeOffset=Math.min(max,Math.max(0,s.noticeOffset+action.direction*action.width));else s.snapshot.offset=Math.min(max,Math.max(0,s.snapshot.offset+action.direction*action.width));s.lease++;s.rewrites++;return s;}
 case 'policy':s.policy=action.value;s.policyEpoch++;return s;
 case 'task':s.task=action.value;s.taskEpoch++;return s;
 case 'review': {const e=s.events.find(e=>e.id===action.id);if(e)publish(e);return s;}
 case 'phase':s.phase=action.value;return s;
 }
}
export function fixtureDecision(event:Update,task:State['task']):Verdict {
 if(event.kind==='noise')return {disposition:'DEFER',source:'Rule',latencyMs:0,reason:'Weather can wait while you read.'};
 if(event.kind==='gate')return {disposition:'INTERRUPT',source:'Rule',latencyMs:0,reason:'A known gate change invalidates the departure location.'};
 if(event.kind==='baggage')return {disposition:'QUEUE_HIGH',source:'Rule',latencyMs:0,reason:'Baggage information changed. Keep it ready for review.'};
 if(event.text===SECURITY_NOTICE)return {disposition:task==='before'?'INTERRUPT':'DEFER',source:'Fixture',latencyMs:0,reason:task==='before'?'Scripted example: the reader still needs to pass security.':'Scripted example: the reader has already passed security.'};
 return {disposition:'NONE',source:'Fallback',latencyMs:0,reason:'Live Jev is not configured. Unseen text is retained for manual review.'};
}
