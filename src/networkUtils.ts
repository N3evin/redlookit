const inFlightRequestCache = new Map<string, Promise<unknown>>();

export async function fetchData<T>(url: string): Promise<T> {
    const inFlight = inFlightRequestCache.get(url);
    if (inFlight !== undefined) {
        return inFlight as Promise<T>;
    }

    const requestPromise = (async () => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch data (${response.status} ${response.statusText}) from ${url}`);
        }
        const data: T = await response.json();
        return data;
    })();

    inFlightRequestCache.set(url, requestPromise as Promise<unknown>);
    try {
        return await requestPromise;
    } finally {
        inFlightRequestCache.delete(url);
    }
}
