import { type SearchStatus, type TerminalStatus, isTerminalStatus } from '@ssandevisthan/contracts';

export interface TerminalDecisionInput { recommendations: number; canceled?: boolean; deadlineReached?: boolean; operatorStopped?: boolean; essentialFailure?: boolean; incomplete?: boolean }
export function decideTerminalStatus(input: TerminalDecisionInput): TerminalStatus {
  if (!Number.isSafeInteger(input.recommendations) || input.recommendations < 0) throw new Error('INVALID_RESULT_COUNT');
  if (input.canceled) return 'CANCELED';
  if (input.deadlineReached) return input.recommendations > 0 ? 'PARTIAL' : 'EXPIRED';
  if (input.operatorStopped || input.essentialFailure || input.incomplete) return input.recommendations > 0 ? 'PARTIAL' : 'FAILED';
  return input.recommendations > 0 ? 'COMPLETED' : 'NO_RELIABLE_MATCH';
}
export function canTransition(from: SearchStatus, to: SearchStatus): boolean {
  if (from === to) return true;
  if (isTerminalStatus(from)) return false;
  if (from === 'QUEUED') return to === 'RUNNING' || to === 'CANCELED' || to === 'EXPIRED' || to === 'FAILED';
  return isTerminalStatus(to);
}
