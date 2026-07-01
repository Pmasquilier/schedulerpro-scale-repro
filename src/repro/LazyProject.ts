// Standalone repro of the lazy-load ORCHESTRATION behaviors (A/B/C) — separate from the perf repro (#1).
// Faithful to the forum architecture: a ProjectModel subclass used AS a CrudManager, but with NO HTTP transport.
// `sendRequest` routes every load() through a plain JS callback (`loadHandler`), and logs the request shape so we
// can SEE Bryntum's internal load orchestration (how many requests, which stores, which row window).
import type { AbstractCrudManagerMixinClass } from '@bryntum/schedulerpro';
import { ProjectModel } from '@bryntum/schedulerpro';

/** Bryntum's transport handlers call `.text()` on the response, then decode the string. */
type CrudResponseLike = { text: () => Promise<string> };
type TransportRequest = Parameters<AbstractCrudManagerMixinClass['sendRequest']>[0];
type TransportCallback = (response: CrudResponseLike, fetchOptions: unknown, request: TransportRequest) => void;

/** Post-JSON.parse shape of the lazy-load request Bryntum builds internally. */
export type LazyLoadRequest = {
    type?: string;
    stores?: string[];
    params: { startIndex?: number; count?: number; resourceIds?: (string | number)[] };
};

export type LazyLoadHandler = (request: LazyLoadRequest) => Promise<object>;

let requestSeq = 0;

/** Reset the request counter between reproduction runs. */
export const resetRequestLog = (): void => {
    requestSeq = 0;
};

export class LazyProject extends ProjectModel {
    // Mutable (not constructor config) so the React wrapper can point it at a closure reading the CURRENT filter.
    loadHandler?: LazyLoadHandler;

    override async sendRequest(request: TransportRequest): Promise<unknown> {
        const parsed = JSON.parse((request as { data: string }).data) as LazyLoadRequest;

        // THE INSTRUMENTATION the forum post asks for: one line per request Bryntum fires internally.
        // Watch `stores` and `count` — that is how Behavior B (the second, events-only request) becomes visible.
        // eslint-disable-next-line no-console
        console.log(
            `[sendRequest] seq=${++requestSeq} t=${Math.round(performance.now())} startIndex=${parsed.params?.startIndex} count=${parsed.params?.count} stores=${JSON.stringify(parsed.stores)}`,
        );

        const response = await this.loadHandler?.(parsed);
        const callback = request.success as unknown as TransportCallback;
        callback.call((request as { thisObj: unknown }).thisObj, toCrudResponse(JSON.stringify(response ?? { success: true })), undefined, request);
        return undefined;
    }
}

const toCrudResponse = (rawText: string): CrudResponseLike => ({ text: () => Promise.resolve(rawText) });
