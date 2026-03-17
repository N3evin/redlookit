import {getAnalyticsContext, trackSampledEvent} from "./analyticsUtils";

const inFlightRequestCache = new Map<string, Promise<unknown>>();
const apiErrorSampleRate = 0.1;

function getEndpointType(url: string): string {
    try {
        const parsed = new URL(url, window.location.origin);
        const path = parsed.pathname.toLowerCase();
        if (path.includes("/subreddits/search")) {
            return "subreddit_search";
        }
        if (path.includes("/about")) {
            return "subreddit_about";
        }
        if (path.includes("/comments")) {
            return "post_comments";
        }
        if (path.endsWith(".json")) {
            return "listing_json";
        }
        return "other";
    } catch (_) {
        return "other";
    }
}

function trackApiError(url: string, errorType: string, statusCode: number | null): void {
    trackSampledEvent("api_error", apiErrorSampleRate, {
        ...getAnalyticsContext(),
        endpoint_type: getEndpointType(url),
        error_type: errorType,
        status_code: statusCode === null ? -1 : statusCode
    });
}

export async function fetchData<T>(url: string): Promise<T> {
    const inFlight = inFlightRequestCache.get(url);
    if (inFlight !== undefined) {
        return inFlight as Promise<T>;
    }

    const requestPromise = (async () => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                trackApiError(url, "http_error", response.status);
                throw new Error(`Failed to fetch data (${response.status} ${response.statusText}) from ${url}`);
            }
            try {
                const data: T = await response.json();
                return data;
            } catch (e) {
                trackApiError(url, "parse_error", response.status);
                throw e;
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : "";
            if (!message.startsWith("Failed to fetch data")) {
                trackApiError(url, "network_error", null);
            }
            throw e;
        }
    })();

    inFlightRequestCache.set(url, requestPromise as Promise<unknown>);
    try {
        return await requestPromise;
    } finally {
        inFlightRequestCache.delete(url);
    }
}
