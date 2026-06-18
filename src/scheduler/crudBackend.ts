// Adapter between the fake backend (plain JS functions) and Bryntum's native CrudManager
// protocol. NO Bryntum imports — pure logic, testable, outside the engine code-split.
//
// Two halves, both DOCUMENTED extension points (no reverse-engineered contract):
//   • LOAD — the `requestData` config hook (overrides the built-in loadUrl fetch).
//   • SYNC — the `encode`/`decode` pair (JsonEncoder override points). Bryntum drives the fetch
//            itself to `syncUrl`; we only TRANSLATE: encode = Bryntum changeset -> our REST DTO,
//            decode = our REST response -> Bryntum sync-response. The endpoint speaks OUR language;
//            nothing Bryntum-specific leaks server-side.

import type {Resource, ShiftEvent} from '../types';

// --- LOAD ------------------------------------------------------------------------------------
// params (LazyLoadCrudManagerRequestParams): { startIndex, count, startDate?, endDate?, stores? }
// return (CrudManagerRequestResponse):       { resources:{rows,total}, events:{rows} }
export interface RequestDataParams {
    startIndex: number;
    count: number;
    startDate?: Date;
    endDate?: Date;
    stores?: string[];
}

export interface RequestDataResponse {
    resources?: { rows: object[]; total: number };
    events?: { rows: object[] };
}

export function createRequestData(deps: {
    getResources: () => Resource[];
    fetchEvents: (employeeIds: number[]) => Promise<ShiftEvent[]>;
}): (params: RequestDataParams) => Promise<RequestDataResponse> {
    return async (params) => {
        const {startIndex, count} = params;
        const all = deps.getResources();
        const slice = all.slice(startIndex, startIndex + count);
        const employeeIds = slice.map((r) => r.id);
        console.info('[crud] requestData', {
            startIndex,
            count,
            stores: params.stores,
            sliced: slice.length
        });

        const events = employeeIds.length ? await deps.fetchEvents(employeeIds) : [];
        return {
            // `total` sizes the scrollbar for the full set; rows is just this window. Raw events already
            // carry id/resourceId/startDate/endDate/name — the store reads them natively, no wrapping.
            resources: {rows: slice, total: all.length},
            events: {rows: events},
        };
    };
}

// --- SYNC (Option A: real syncUrl + encode/decode — the only Bryntum-specific mapper) ---------
// We DON'T touch the transport (no sendRequest, no fabricated Response, no reverse-engineered
// contract). We set `syncUrl` and let AjaxTransport do the fetch. The translation is two pure,
// documented functions:
//
//   encode(request) : Bryntum changeset  -> JSON body our `/api/events/batch` understands
//   decode(text)    : our API response   -> the short sync-response Bryntum applies ({ success })
//
// writeAllFields:true guarantees every changed row carries id+startDate+endDate+resourceId, so a
// time-only move still has the resourceId the backend needs.

interface SyncedEvent {
    id: string | number;
    startDate?: string;
    endDate?: string;
    resourceId?: number;
}

interface SyncRequest {
    type: 'load' | 'sync';
    requestId?: number;
    events?: { updated?: SyncedEvent[]; added?: SyncedEvent[] };
}

/** Our REST DTO — what the endpoint actually receives. Knows nothing about Bryntum. */
export interface BatchUpdateBody {
    requestId?: number;
    updates: { id: string; startDate: string; endDate: string; resourceId: number }[];
}

export interface SyncCodec {
    encode: (request: SyncRequest) => string | null;
    decode: (responseText: string) => unknown;
}

export function createSyncCodec(): SyncCodec {
    let logged = false;
    return {
        encode(request) {
            // Only 'sync' reaches the network — load is served by requestData. Guard defensively so any
            // non-sync request still encodes losslessly.
            if (request.type !== 'sync') return JSON.stringify(request);

            const rows = [...(request.events?.updated ?? []), ...(request.events?.added ?? [])];
            const body: BatchUpdateBody = {
                requestId: request.requestId,
                updates: rows
                    .filter((e) => e.startDate && e.endDate && e.resourceId != null)
                    .map((e) => ({
                        id: String(e.id),
                        startDate: e.startDate as string,
                        endDate: e.endDate as string,
                        resourceId: Number(e.resourceId),
                    })),
            };
            if (!logged) {
                console.info('[crud] encode(sync) ->', body);
                logged = true;
            }
            return JSON.stringify(body);
        },

        decode(responseText) {
            // Our API answers { success, requestId }. Map to the short sync-response (no store sections =
            // nothing to apply, just commit). Falls back to success on an empty/200 body.
            try {
                const r = JSON.parse(responseText) as { success?: boolean; requestId?: number };
                return {success: r.success ?? true, requestId: r.requestId};
            } catch {
                return {success: true};
            }
        },
    };
}

// --- SYNC TRANSPORT (Option B: app-owned fetch via sendRequest/cancelRequest) -----------------
// CrudManager still builds + ENCODES the changeset (`encode` above) into one string per cycle.
// We only swap the WIRE: `sendRequest` hands that string to an injected `syncShifts` function (the
// app's TanStack mutation / axios call), so the request travels through the app's axios instance —
// its interceptors (error reporting, 401->login, tracing) fire verbatim. `decode` still maps the reply.
//
// `cancelRequest` aborts an in-flight request (component unmount, or a sync that supersedes a
// pending one) via a per-request AbortController — it is the other half of the same abstract
// transport contract, so it MUST be provided alongside sendRequest.

/** The app's response to a sync POST (axios-style: HTTP status + parsed body). */
export interface SyncApiResponse {
    success?: boolean;
    requestId?: number;
}

export interface SyncApiResult {
    status: number;
    body: SyncApiResponse;
}

/**
 * Shape of the argument Bryntum passes to `sendRequest`. NOTE: the installed `.d.ts` types
 * `success`/`failure` as `(rawResponse: string) => void`, but at runtime they expect a Fetch
 * `Response` and `sendRequest` must RETURN the callback's result. We type them `unknown -> unknown`
 * to model the real (mis-documented) contract rather than the wrong one.
 */
export interface SendRequestArg {
    type: 'load' | 'sync';
    data: string;
    success: (rawResponse: unknown) => unknown;
    failure: (rawResponse: unknown) => unknown;
}

export interface SyncTransport {
    sendRequest: (request: SendRequestArg) => Promise<unknown>;
    cancelRequest: (requestPromise: Promise<unknown>) => void;
}

export function createSyncTransport(deps: {
    syncShifts: (body: string, signal: AbortSignal) => Promise<SyncApiResult>;
}): SyncTransport {
    // Maps the Promise we return from sendRequest -> its AbortController, so cancelRequest (which
    // receives that exact Promise) can abort the matching in-flight request.
    const inflight = new Map<Promise<unknown>, AbortController>();

    // Translate the app's axios-style result into Bryntum's transport contract. RUNTIME contract
    // (contradicts the `.d.ts` `string` typing — verified at runtime, and the single fragile point
    // of this approach): request.success/failure expect a Fetch `Response` (Bryntum calls `.ok`, then
    // `.text()`, then `decode()` on it), and sendRequest must RETURN whatever the callback returns —
    // otherwise the commit cycle never settles. We build a REAL Response (standard API, not a fake)
    // and route by outcome. A version-pinned contract test guards this on upgrade.
    function handToBryntum(result: SyncApiResult, request: SendRequestArg): unknown {
        const ok = result.status < 400 && result.body.success !== false;
        const response = new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: {'Content-Type': 'application/json'},
        });
        return ok ? request.success(response) : request.failure(response);
    }

    const sendRequest: SyncTransport['sendRequest'] = (request) => {
        const controller = new AbortController();
        const promise = (async () => {
            const result = await deps.syncShifts(request.data, controller.signal);
            return handToBryntum(result, request);
        })();
        inflight.set(promise, controller);
        void promise.catch(() => {
        }).finally(() => inflight.delete(promise));
        return promise;
    };

    const cancelRequest: SyncTransport['cancelRequest'] = (requestPromise) => {
        inflight.get(requestPromise)?.abort();
        inflight.delete(requestPromise);
    };

    return {sendRequest, cancelRequest};
}
