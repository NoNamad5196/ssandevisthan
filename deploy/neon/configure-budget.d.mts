import type {RateConfig} from '../../supabase/shared/providers/openai.ts';

/** Types for the operator-only JavaScript command; importing it does not run it. */
export declare const rateSnapshot:RateConfig;
export declare function parseUsd(value:unknown):number;
export interface BudgetConfigurationClient {
  query(sql:string,parameters?:unknown[]):Promise<{rows:Array<Record<string,unknown>>}>;
}
export declare function applyInitialBudget(client:BudgetConfigurationClient,historicalTotalMicrousd:number,rates:RateConfig,minimum:number):Promise<void>;
