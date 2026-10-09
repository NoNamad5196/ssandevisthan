export const LEDGER_POLICY:string;
export const LEDGER_MAX_BYTES:number;
export const LEDGER_TTL_MS:number;
export interface LedgerEnvelope {sha256:string;payload:{schemaVersion:1;policy:string;createdAt:string;expiresAt:string;migrations:{name:string;sha256:string}[];budget:{ceilingMicrousd:number;spentMicrousd:number};holds:{parentCount:number;parentMicrousd:number;unattributedChildCount:number;unattributedChildMicrousd:number}}}
export interface LedgerClient {query(sql:string,params?:unknown[]):Promise<{rows:any[]}>}
export function validateLedgerSnapshot(envelope:unknown,now?:Date):LedgerEnvelope;
export function exportLedgerSnapshot(client:LedgerClient,now?:Date):Promise<LedgerEnvelope>;
export function restoreLedgerSnapshot(client:LedgerClient,envelope:unknown,now?:Date):Promise<{paidExecutionEnabled:false;spentMicrousd:number;heldMicrousd:number;searchesRestored:0;reconciliationRequired:true}>;
