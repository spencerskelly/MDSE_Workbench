/**
 * Internal Structure view (WB-123): one owner note is the visual boundary and its governed
 * Local Model topology is drawn inside it. Pure core; Canvas is presentation, never authority.
 */
import type { ModelIndex } from "./model";
import type { LinkRef, LocalModelIndex, LocalRecord } from "./localmodel";
import type { CanvasData, CanvasEdge, CanvasNode, ResolvePath } from "./views";

const PART_W=260;
const PART_H=110;
const END_W=150;
const END_H=52;
const PAD_X=220;
const PAD_Y=150;
const COL_GAP=170;
const ROW_GAP=150;
const COLS=3;

export interface InternalViewResult {
  ownerPath:string;
  canvas:CanvasData;
  signature:string;
  records:number;
  parts:number;
  endpoints:number;
  connections:number;
}

export function internalSignature(local:LocalModelIndex,ownerPath:string):string{
  const rows=local.recordsOf(ownerPath).map((r)=>{
    const fields=[...r.fields.entries()].map(([k,v])=>k+"="+v).join("|");
    return [r.kind,r.localId,r.identifier,fields,r.connectionId??""].join(";");
  }).sort().join("\n");
  let h=2166136261;
  for(const ch of ownerPath+"\n"+rows){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16);
}

export function buildInternalView(
  index:ModelIndex,
  local:LocalModelIndex,
  ownerPath:string,
  resolve:ResolvePath,
):InternalViewResult{
  const owner=index.notes.get(ownerPath);
  if(!owner) throw new Error(ownerPath+" is not indexed.");
  const records=local.recordsOf(ownerPath);
  if(!records.length) throw new Error(owner.name+" has no governed Local Model records.");

  const parts=records.filter((r)=>r.kind==="part").sort(byName);
  const endpoints=records.filter((r)=>r.kind==="endpoint").sort(byName);
  const connections=records.filter((r)=>r.kind==="connection").sort(byName);
  const flows=records.filter((r)=>r.kind==="flow").sort(byName);
  const boundary=endpoints.filter((r)=>!r.part&&!r.parent);
  const internal=endpoints.filter((r)=>!!r.part||!!r.parent);

  const rows=Math.max(1,Math.ceil(parts.length/COLS));
  const contentW=Math.max(900,Math.min(COLS,Math.max(1,parts.length))*(PART_W+COL_GAP)+PAD_X*2-COL_GAP);
  const contentH=Math.max(620,rows*(PART_H+ROW_GAP)+PAD_Y*2-ROW_GAP);
  const nodes:CanvasNode[]=[];
  const edges:CanvasEdge[]=[];
  const pos=new Map<string,{x:number;y:number;width:number;height:number}>();

  const groupId="internal:boundary";
  nodes.push({
    id:groupId,type:"group",label:owner.name,x:0,y:0,width:contentW,height:contentH,
  });

  const ownerLink=ownerPath.replace(/\.md$/i,"");
  parts.forEach((r,i)=>{
    const col=i%COLS,row=Math.floor(i/COLS);
    const x=PAD_X+col*(PART_W+COL_GAP);
    const y=PAD_Y+row*(PART_H+ROW_GAP);
    const id=nodeId(r);
    const def=r.definition?.text ?? "";
    const text=[
      "**[["+ownerLink+"#^"+r.localId+"|"+escapeMd(r.identifier)+"]]**",
      def ? "Definition: "+def : "",
      r.multiplicity ? "Multiplicity: "+r.multiplicity : "",
      r.usage!=="standard" ? "Usage: "+r.usage : "",
    ].filter(Boolean).join("\n");
    nodes.push({id,type:"text",text,x,y,width:PART_W,height:PART_H});
    pos.set(r.localId,{x,y,width:PART_W,height:PART_H});
  });

  const exposureSide=new Map<string,"left"|"right">();
  boundary.forEach((r,i)=>{
    const side:iSide=i%2===0?"left":"right";
    for(const link of r.exposes){
      const t=linkedLocal(local,resolve,ownerPath,link);
      if(t?.record.kind==="endpoint") exposureSide.set(t.record.localId,side);
    }
  });

  const partEndpointCount=new Map<string,number>();
  for(const r of internal){
    const parent=linkedLocal(local,resolve,ownerPath,r.part??r.parent);
    const parentPos=parent ? pos.get(parent.record.localId) : undefined;
    let side=exposureSide.get(r.localId);
    if(!side){
      const key=parent?.record.localId??"orphan";
      const n=partEndpointCount.get(key)??0;
      partEndpointCount.set(key,n+1);
      side=n%2===0?"left":"right";
    }
    const id=nodeId(r);
    let x=PAD_X+(side==="left"?0:contentW-PAD_X-END_W),y=PAD_Y;
    if(parentPos){
      x=side==="left"?parentPos.x-END_W-24:parentPos.x+parentPos.width+24;
      const n=partEndpointCount.get(parent?.record.localId??"")??1;
      y=parentPos.y+Math.min(parentPos.height-END_H,Math.max(0,(n-1)*58));
    }
    nodes.push({id,type:"text",text:endpointText(ownerLink,r),x,y,width:END_W,height:END_H});
    pos.set(r.localId,{x,y,width:END_W,height:END_H});
  }

  const left=boundary.filter((_,i)=>i%2===0);
  const right=boundary.filter((_,i)=>i%2===1);
  placeBoundary(left,"left",contentW,contentH,nodes,pos,ownerLink);
  placeBoundary(right,"right",contentW,contentH,nodes,pos,ownerLink);

  for(const r of boundary){
    const from=nodeId(r);
    for(const link of r.exposes){
      const t=linkedLocal(local,resolve,ownerPath,link);
      if(!t||t.record.kind!=="endpoint") continue;
      const to=nodeId(t.record);
      if(!pos.has(r.localId)||!pos.has(t.record.localId)) continue;
      edges.push(edge(
        "expose:"+r.localId+":"+t.record.localId,
        from,to,
        sideToward(pos.get(r.localId)!,pos.get(t.record.localId)!),
        sideToward(pos.get(t.record.localId)!,pos.get(r.localId)!),
        "exposes",
        "none",
      ));
    }
  }

  const flowsByConnection=new Map<string,LocalRecord[]>();
  for(const f of flows){
    if(!f.connectionId) continue;
    const list=flowsByConnection.get(f.connectionId)??[];
    list.push(f);flowsByConnection.set(f.connectionId,list);
  }

  for(const r of connections){
    const a=linkedLocal(local,resolve,ownerPath,r.endpointA);
    const b=linkedLocal(local,resolve,ownerPath,r.endpointB);
    if(!a||!b||a.record.kind!=="endpoint"||b.record.kind!=="endpoint") continue;
    const pa=pos.get(a.record.localId),pb=pos.get(b.record.localId);
    if(!pa||!pb) continue;
    const flowNames=(flowsByConnection.get(r.localId)??[]).map((f)=>f.identifier||f.definition?.alias||f.definition?.target||"flow");
    const label=[r.identifier,...flowNames].filter(Boolean).join(" · ");
    edges.push(edge(
      "connection:"+r.localId,
      nodeId(a.record),nodeId(b.record),
      sideToward(pa,pb),sideToward(pb,pa),
      label||"connection",
      "none",
    ));
  }

  return {
    ownerPath,
    canvas:{nodes,edges},
    signature:internalSignature(local,ownerPath),
    records:records.length,
    parts:parts.length,
    endpoints:endpoints.length,
    connections:connections.length,
  };
}

type iSide="left"|"right";

function placeBoundary(
  records:LocalRecord[],
  side:iSide,
  contentW:number,
  contentH:number,
  nodes:CanvasNode[],
  pos:Map<string,{x:number;y:number;width:number;height:number}>,
  ownerLink:string,
):void{
  const gap=contentH/(records.length+1);
  records.forEach((r,i)=>{
    const x=side==="left"?-END_W/2:contentW-END_W/2;
    const y=Math.round(gap*(i+1)-END_H/2);
    nodes.push({id:nodeId(r),type:"text",text:endpointText(ownerLink,r),x,y,width:END_W,height:END_H});
    pos.set(r.localId,{x,y,width:END_W,height:END_H});
  });
}

function endpointText(ownerLink:string,r:LocalRecord):string{
  return "**[["+ownerLink+"#^"+r.localId+"|"+escapeMd(r.identifier)+"]]**";
}

function nodeId(r:LocalRecord):string{return "local:"+r.localId;}

function edge(
  id:string,
  fromNode:string,
  toNode:string,
  fromSide:"left"|"right"|"top"|"bottom",
  toSide:"left"|"right"|"top"|"bottom",
  label:string,
  toEnd:"none"|"arrow"="arrow",
):CanvasEdge{
  return {id,fromNode,toNode,fromSide,toSide,label,toEnd};
}

function sideToward(
  a:{x:number;y:number;width:number;height:number},
  b:{x:number;y:number;width:number;height:number},
):"left"|"right"|"top"|"bottom"{
  const ax=a.x+a.width/2,ay=a.y+a.height/2,bx=b.x+b.width/2,by=b.y+b.height/2;
  const dx=bx-ax,dy=by-ay;
  if(Math.abs(dx)>=Math.abs(dy)) return dx>=0?"right":"left";
  return dy>=0?"bottom":"top";
}

function linkedLocal(
  local:LocalModelIndex,
  resolve:ResolvePath,
  fromPath:string,
  link:LinkRef|null,
):{path:string;record:LocalRecord}|null{
  if(!link?.blockId) return null;
  const path=link.target?resolve(link.target,fromPath):fromPath;
  if(!path) return null;
  const record=local.recordsOf(path).find((r)=>r.localId===link.blockId);
  return record?{path,record}:null;
}

function byName(a:LocalRecord,b:LocalRecord):number{
  return a.identifier.localeCompare(b.identifier)||a.localId.localeCompare(b.localId);
}

function escapeMd(value:string):string{
  return value.replace(/[\[\]|]/g," ");
}

/**
 * Curated Internal views: regenerate semantics while preserving positions/sizes of nodes the engineer
 * already arranged. New nodes keep generated positions. Removed nodes disappear.
 */
export function preserveInternalLayout(generated:CanvasData,existing:CanvasData):CanvasData{
  const old=new Map(existing.nodes.map((n)=>[n.id,n]));
  const nodes=generated.nodes.map((n)=>{
    const prior=old.get(n.id);
    if(!prior) return n;
    return {...n,x:prior.x,y:prior.y,width:prior.width,height:prior.height};
  });
  return {nodes,edges:generated.edges};
}
