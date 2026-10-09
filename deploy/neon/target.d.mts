import type {BackendSettings} from './settings.mjs';
export declare const PRODUCTION_TARGET:Readonly<{project:string;branch:string;slug:string;database:string;role:string}>;
export declare function validateRollbackTarget(input:{connectionString:string;settings:BackendSettings;apiKey:string},fetcher?:typeof fetch):Promise<{project:string;branch:string;slug:string;database:string;endpointId:string;origin:string}>;
