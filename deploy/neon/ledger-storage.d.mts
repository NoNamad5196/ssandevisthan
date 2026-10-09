import type {LedgerClient,LedgerEnvelope} from './ledger.mjs';
export const LEDGER_PREFIX:string;
export const LEDGER_MAX_OBJECTS:number;
export function ledgerExpiry(key:unknown):number|null;
export interface LedgerStorage {send(command:any,options?:any):Promise<any>}
export function storeLedgerSnapshot(client:LedgerClient,s3:LedgerStorage,bucket:string,options?:{now?:Date;factory?:(client:LedgerClient,now:Date)=>Promise<LedgerEnvelope>}):Promise<{key:string;sha256:string;bytes:number;createdAt:string;expiresAt:string}>;
export function sweepLedgerBackups(s3:LedgerStorage,bucket:string,options?:{now?:Date;audit?:(event:string,fields:{code:string;count:number})=>void}):Promise<{scanned:number;removed:number;overdue:number;invalid:number;failed:number;deferred:number;truncated:boolean}>;
