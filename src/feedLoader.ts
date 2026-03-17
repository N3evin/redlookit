export interface ActiveSubredditQuery {
    sortType: null | "all" | "hour" | "day" | "week" | "month" | "year"
    tab: "hot" | "new" | "rising" | "controversial" | "top" | "gilded"
    subreddit: string
    useBaseListingPath: boolean
}

export function buildSubredditListingURL(
    query: ActiveSubredditQuery,
    redditBaseURL: string,
    subredditPageLimit: number,
    after: string | null = null
): string {
    const base = query.useBaseListingPath
        ? `${redditBaseURL}/r/${query.subreddit}.json`
        : `${redditBaseURL}/r/${query.subreddit}/${query.tab}/.json`;
    const params = new URLSearchParams();
    if (query.sortType !== null) {
        params.set('t', query.sortType);
    }
    params.set('limit', subredditPageLimit.toString());
    if (after !== null && after !== "") {
        params.set('after', after);
    }
    return `${base}?${params.toString()}`;
}

export function isSameSubredditQuery(a: ActiveSubredditQuery | null, b: ActiveSubredditQuery): boolean {
    if (a === null) {
        return false;
    }
    return a.subreddit === b.subreddit
        && a.tab === b.tab
        && a.sortType === b.sortType
        && a.useBaseListingPath === b.useBaseListingPath;
}
