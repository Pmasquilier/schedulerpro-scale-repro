// Ported from roger-platform PR #12440 (SchedulerProjectModel.ts), standalone.
// The PR's `castThirdPartyType<T>(x)` / `unsafeCast<T>(x)` helpers are inlined as `x as T`,
// and `handleError` is a console.error here (no toast infra in the repro).
import type { AbstractCrudManagerMixinClass } from '@bryntum/schedulerpro';
import { ProjectModel } from '@bryntum/schedulerpro';
import type { CrudLoadRequest, LoadHandler, RowRange, SchedulerStores } from './schedulerTypes';

/** Bryntum's handlers call `.text()` on the response, then decode the string. */
type CrudResponseLike = { text: () => Promise<string> };

/** The request Bryntum hands to `sendRequest` (the transport-agnostic mixin variant, not AjaxTransport). */
type TransportRequest = Parameters<AbstractCrudManagerMixinClass['sendRequest']>[0];

// Bryntum 7.3 invokes success/failure UNBOUND as (responseLike, fetchOptions, request), resolving `this` from thisObj.
type TransportCallback = (response: CrudResponseLike, fetchOptions: unknown, request: TransportRequest) => void;

// Repro stand-in for the PR's app-wide handleError (which raised a toast). We just log here.
const handleError = (error: unknown): void => {
    console.error('[scheduler] window load failed', error);
};

// A ProjectModel IS a CrudManager; overriding sendRequest routes load() through loadHandler. Read-only: no syncHandler.
export class SchedulerProjectModel extends ProjectModel {
    // Mutable (not constructor config) so the wrapper can repoint it at a closure reading the current search via a ref.
    loadHandler?: LoadHandler;

    override async sendRequest(request: TransportRequest): Promise<unknown> {
        try {
            // why: JSON.parse returns `any`; the package is structurally our load request.
            const response = await this.loadHandler?.(JSON.parse((request as { data: string }).data) as CrudLoadRequest);
            this.invoke(request.success, request, toCrudResponse(JSON.stringify(response ?? { success: true })));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Scheduler request failed';
            this.invoke(request.failure, request, toCrudResponse(JSON.stringify({ success: false, message })));
        }
        return undefined;
    }

    private invoke(handler: TransportRequest['success'], request: TransportRequest, response: CrudResponseLike): void {
        const callback = handler as unknown as TransportCallback;
        callback.call((request as { thisObj: unknown }).thisObj, response, undefined, request);
    }
}

/** Adapt a row-range loader to the CrudManager transport: translate the row-index request to offset/limit, then frame the stores as a load response. */
export const createLoadHandler =
    (load: (rowRange: RowRange) => Promise<SchedulerStores>): LoadHandler =>
    async ({ params }) => {
        try {
            const { resources, events, resourceTimeRanges } = await load({ offset: params.startIndex ?? 0, limit: params.count ?? 0 });
            // No `total`: end-of-data is inferred from a short page (rows < count).
            return { success: true, resources: { rows: resources }, events: { rows: events }, resourceTimeRanges: { rows: resourceTimeRanges } };
        } catch (error) {
            // Bryntum drives load() internally on scroll, past the wrapper's mount-only .catch — without this a failed
            // window load leaves a silently incomplete grid instead of a toast. Rethrow so the transport still fails the load.
            handleError(error);
            throw error;
        }
    };

/** Wrap a JSON string as the Fetch-Response-like object Bryntum's handlers consume. */
const toCrudResponse = (rawText: string): CrudResponseLike => ({ text: () => Promise.resolve(rawText) });
