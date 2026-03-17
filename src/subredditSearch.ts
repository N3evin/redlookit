import {debounce} from "./domUtils";
import {fetchData} from "./networkUtils";
import {getSubredditIcon, numberFormatter} from "./subredditFormatUtils";

export type SearchSubredditRecord = {
    subreddit: string;
    subredditLower: string;
    members: number;
    icon: string;
    isNSFW: boolean;
};

type SearchDeps = {
    redditBaseURL: string,
    searchResultsElement: HTMLElement,
    trackEvent: (eventName: string, params?: Record<string, string | number | boolean>) => void,
    getAnalyticsContext: () => Record<string, string | number | boolean>
};

export function createSubredditSearchController(deps: SearchDeps) {
    let indexedSubredditsCache: SearchSubredditRecord[] | null = null;
    let indexedSubredditsPromise: Promise<SearchSubredditRecord[]> | null = null;
    const remoteSearchCache = new Map<string, SearchSubredditRecord[]>();
    let latestSearchToken = 0;

    async function getIndexedSubreddits(): Promise<SearchSubredditRecord[]> {
        if (indexedSubredditsCache !== null) {
            return indexedSubredditsCache;
        }
        if (indexedSubredditsPromise !== null) {
            return indexedSubredditsPromise;
        }

        indexedSubredditsPromise = import(/* webpackChunkName: "subreddit-list" */ "./subredditList").then((module) => {
            const indexed = module.subreddits.map((subredditData) => ({
                subreddit: subredditData.subreddit,
                subredditLower: subredditData.subreddit.toLowerCase(),
                members: parseInt(subredditData.members, 10) || 0,
                icon: subredditData.icon,
                isNSFW: false,
            }));
            indexedSubredditsCache = indexed;
            indexedSubredditsPromise = null;
            return indexed;
        });

        return indexedSubredditsPromise;
    }

    async function fetchRemoteSubredditSearch(query: string, limit: number = 5): Promise<SearchSubredditRecord[] | null> {
        const cached = remoteSearchCache.get(query);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const searchUrl = `${deps.redditBaseURL}/subreddits/search.json?limit=${limit}&include_over_18=on&q=${encodeURIComponent(query)}`;
            const payload = await fetchData<{ data?: { children?: Array<{ data?: SubredditDetails }> } }>(searchUrl);
            const children = payload?.data?.children || [];
            const results: SearchSubredditRecord[] = [];
            const seen = new Set<string>();
            for (const child of children) {
                const details = child?.data;
                if (!details || typeof details.display_name !== "string" || details.display_name.length === 0) {
                    continue;
                }
                const subredditLower = details.display_name.toLowerCase();
                if (seen.has(subredditLower)) {
                    continue;
                }
                seen.add(subredditLower);
                const rawIcon = getSubredditIcon(details);
                results.push({
                    subreddit: details.display_name,
                    subredditLower,
                    members: details.subscribers || 0,
                    icon: typeof rawIcon === "string" && rawIcon.length > 0
                        ? rawIcon
                        : 'https://img.icons8.com/fluency-systems-regular/512/reddit.png',
                    isNSFW: details.over18 === true,
                });
                if (results.length >= limit) {
                    break;
                }
            }
            remoteSearchCache.set(query, results);
            return results;
        } catch (_) {
            return null;
        }
    }

    function hideSearchResults(): void {
        deps.searchResultsElement.style.display = 'none';
    }

    function displaySearchResults(results: SearchSubredditRecord[]): void {
        deps.searchResultsElement.style.display = 'block';
        deps.searchResultsElement.innerHTML = '';
        const fragment = document.createDocumentFragment();

        for (const result of results) {
            const link = document.createElement('a');
            link.href = `#/r/${result.subreddit}`;
            link.classList.add('search-result-link');
            link.addEventListener('click', () => {
                deps.trackEvent("search_subreddit", {
                    ...deps.getAnalyticsContext(),
                    results_count: results.length,
                    used_suggestion: true
                });
                hideSearchResults();
            });

            const item = document.createElement('div');
            item.classList.add('search-result-item');

            const icon = document.createElement('img');
            icon.src = result.icon;
            icon.classList.add('search-subreddit-icon');

            const info = document.createElement('div');
            info.classList.add('search-result-item-info');

            const name = document.createElement('div');
            name.classList.add('search-result-subreddit-name');
            name.textContent = `r/${result.subreddit}`;
            if (result.isNSFW) {
                const nsfwBadge = document.createElement('span');
                nsfwBadge.classList.add('search-result-nsfw-badge');
                nsfwBadge.textContent = 'NSFW';
                name.append(nsfwBadge);
            }

            const members = document.createElement('div');
            members.classList.add('search-result-subreddit-info');
            members.textContent = `Community • ${numberFormatter(result.members)} members`;

            info.append(name, members);
            item.append(icon, info);
            link.append(item);
            fragment.append(link);
        }

        deps.searchResultsElement.append(fragment);
    }

    async function runSubredditSearch(rawInput: string): Promise<void> {
        const searchToken = ++latestSearchToken;
        const normalized = rawInput.toLowerCase();
        if (normalized.length === 0) {
            hideSearchResults();
            return;
        }

        const query = normalized.startsWith('r/') ? normalized.slice(2) : normalized;
        if (query.length === 0) {
            hideSearchResults();
            return;
        }

        const remoteResults = await fetchRemoteSubredditSearch(query, 5);
        if (searchToken !== latestSearchToken) {
            return;
        }

        if (remoteResults !== null && remoteResults.length > 0) {
            displaySearchResults(remoteResults);
            return;
        }

        const indexedSubreddits = await getIndexedSubreddits();
        if (searchToken !== latestSearchToken) {
            return;
        }

        const fallbackResults: SearchSubredditRecord[] = [];
        for (const sub of indexedSubreddits) {
            if (!sub.subredditLower.includes(query)) {
                continue;
            }
            fallbackResults.push(sub);
            if (fallbackResults.length >= 5) {
                break;
            }
        }

        displaySearchResults(fallbackResults);
    }

    const debouncedRunSubredditSearch = debounce(runSubredditSearch, 120);

    function prefetchSearchIndexOnIdle(): void {
        if (indexedSubredditsCache !== null || indexedSubredditsPromise !== null) {
            return;
        }
        getIndexedSubreddits().catch(() => {
            // Non-critical optimization; ignore prefetch failures.
        });
    }

    return {
        runSubredditSearch,
        debouncedRunSubredditSearch,
        hideSearchResults,
        prefetchSearchIndexOnIdle
    };
}
