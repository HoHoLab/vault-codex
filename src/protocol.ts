import type {TokenUsage, TurnStatus} from './types';

// The app-server protocol is extensible. Model only the fields consumed here;
// unknown requests are still rejected by the controller rather than approved.
export interface RpcItem {
  id: string; type: string; status?: string; phase?: string; text?: string;
  command?: string; aggregatedOutput?: string; changes?: {path: string; diff?: string}[];
  server?: string; tool?: string; error?: unknown; result?: unknown;
  query?: string; action?: {query?: string};
}
export interface UserQuestion {
  id: string; question: string; isSecret?: boolean;
  options?: {label: string; description?: string}[];
}
export interface EventParams {
  threadId?: string; turnId?: string; itemId?: string; delta?: string;
  message?: string; success?: boolean; error?: string | {message?: string}; willRetry?: boolean;
  turn?: {id: string; status: TurnStatus; error?: {message?: string}};
  item?: RpcItem; requestId?: string | number; tokenUsage?: TokenUsage;
  reviewId?: string; review?: {status: string; rationale?: string};
  plan?: {step: string; status: string}[]; explanation?: string;
  questions?: UserQuestion[]; reason?: string; command?: string; grantRoot?: string;
  permissions?: Record<string, unknown>; availableDecisions?: unknown[];
}
export interface AccountResponse {account?: {type: string} | null; requiresOpenaiAuth?: boolean;}
export interface LoginResponse {authUrl?: string;}
export interface ThreadResponse {thread: {id: string};}
export interface TurnResponse {turn: {id: string};}
export type UserInput = {type: 'text'; text: string} | {type: 'localImage'; path: string};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function eventParams(value: unknown): EventParams {
  return isRecord(value) ? value : {};
}
