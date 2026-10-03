/**
 * Governed MDSE identity allocation used by Workbench-created notes and independently referenceable
 * Local Model records (WB-114). Pure core: callers provide author code, time and used tokens.
 */
export const AUTHOR_CODE = /^[a-z-]{13}$/;
export const MDSE_UID = /^\d{17}[a-z-]{13}$/;

export function normalizeAuthorCode(first: string, last: string): string {
  const letters = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z]/g, "");
  return (letters(last) + letters(first)).slice(0, 13).padEnd(13, "-");
}

export function assertAuthorCode(code: string): string {
  const trimmed=code.trim();
  if (!AUTHOR_CODE.test(trimmed)) throw new Error("Author code must be exactly 13 lowercase letters/hyphens.");
  return trimmed;
}

/** Local-time timestamp per the governed uid definition; no UTC conversion. */
export function localTimestamp(date: Date): string {
  const pad=(n:number,width=2)=>String(n).padStart(width,"0");
  return (
    String(date.getFullYear()).padStart(4,"0") +
    pad(date.getMonth()+1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds()) +
    pad(date.getMilliseconds(),3)
  );
}

export interface IdentityAllocation {
  uid: string;
  timestamp: string;
  authorCode: string;
  collisionSteps: number;
}

export function allocateUid(
  at: Date,
  authorCode: string,
  used: ReadonlySet<string>,
): IdentityAllocation {
  const code=assertAuthorCode(authorCode);
  let cursor=new Date(at.getTime());
  let collisionSteps=0;
  let uid=localTimestamp(cursor)+code;
  while (used.has(uid)) {
    cursor=new Date(cursor.getTime()+1);
    collisionSteps++;
    uid=localTimestamp(cursor)+code;
  }
  return {uid,timestamp:localTimestamp(cursor),authorCode:code,collisionSteps};
}

export type LocalIdentityKind="part"|"endpoint"|"connection"|"flow";

const PREFIX: Record<LocalIdentityKind,string>={
  part:"part-",
  endpoint:"ep-",
  connection:"conn-",
  flow:"flow-",
};

export interface LocalIdentityAllocation extends IdentityAllocation {
  localId: string;
  kind: LocalIdentityKind;
}

export function allocateLocalId(
  kind: LocalIdentityKind,
  at: Date,
  authorCode: string,
  used: ReadonlySet<string>,
): LocalIdentityAllocation {
  const allocation=allocateUid(at,authorCode,used);
  return {...allocation,kind,localId:PREFIX[kind]+allocation.uid};
}

/** Extract the global identity token from a governed Local Model block ID. */
export function tokenFromLocalId(localId:string): string|null {
  const m=/^(?:part|ep|conn|flow)-(\d{17}[a-z-]{13})$/.exec(localId);
  return m?.[1] ?? null;
}
