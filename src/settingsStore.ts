import type {Permalink} from "./routingUtils";

export const commentSortOptions = [
    { value: "top", label: "Top" },
    { value: "best", label: "Best" },
    { value: "new", label: "New" },
    { value: "controversial", label: "Controversial" },
    { value: "old", label: "Old" }
] as const;
export type CommentSortValue = typeof commentSortOptions[number]["value"];
export const defaultCommentSort: CommentSortValue = "top";

export const subredditSortOptions = [
    { value: "hot", label: "Hot" },
    { value: "new", label: "New" },
    { value: "rising", label: "Rising" },
    { value: "top", label: "Top" }
] as const;
export type SubredditSortValue = typeof subredditSortOptions[number]["value"];
export const defaultSubredditSort: SubredditSortValue = "hot";

export const subredditTopTimeOptions = [
    { value: "hour", label: "Hour" },
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
    { value: "all", label: "All Time" }
] as const;
export type SubredditTopTimeValue = typeof subredditTopTimeOptions[number]["value"];
export const defaultSubredditTopTime: SubredditTopTimeValue = "all";

type SubredditSortQuery = {
    tab: "hot" | "new" | "rising" | "controversial" | "top" | "gilded",
    sortType: null | "all" | "hour" | "day" | "week" | "month" | "year"
};

export function getDefaultSubredditSort(): SubredditSortValue {
    const selectedSort = localStorage.getItem('defaultSubredditSort');
    if (selectedSort !== null && subredditSortOptions.some((option) => option.value === selectedSort)) {
        return selectedSort as SubredditSortValue;
    }
    return defaultSubredditSort;
}

export function getDefaultSubredditTopTime(): SubredditTopTimeValue {
    const selectedTopTime = localStorage.getItem('defaultSubredditTopTime');
    if (selectedTopTime !== null && subredditTopTimeOptions.some((option) => option.value === selectedTopTime)) {
        return selectedTopTime as SubredditTopTimeValue;
    }
    return defaultSubredditTopTime;
}

export function getDefaultSubredditPostSortQuery(): SubredditSortQuery {
    const tab = getDefaultSubredditSort();
    if (tab === "top") {
        return {
            tab,
            sortType: getDefaultSubredditTopTime()
        };
    }
    return {
        tab,
        sortType: null
    };
}

export function getDefaultCommentSort(): CommentSortValue {
    const selectedSort = localStorage.getItem('defaultCommentSort');
    if (selectedSort !== null && commentSortOptions.some((option) => option.value === selectedSort)) {
        return selectedSort as CommentSortValue;
    }
    return defaultCommentSort;
}

export function getSavedSubredditSet(): Set<string> {
    const saved = localStorage.getItem('savedSubreddits');
    if (!saved) {
        return new Set();
    }
    return new Set(
        saved
            .split(',')
            .map((sub) => sub.trim().toLowerCase())
            .filter((sub) => sub.length > 0)
    );
}

export function getSavedSubreddits(): string[] | false {
    if (localStorage.getItem('savedSubreddits')) {
        const savedSubreddits = localStorage.getItem('savedSubreddits');
        return savedSubreddits!.split(',');
    } else {
        return false;
    }
}

const collapsedCommentsStorageKey = "collapsedCommentsByPost";
type CollapsedCommentsByPost = Record<string, string[]>;

function loadCollapsedCommentsMap(): CollapsedCommentsByPost {
    const rawStorage = localStorage.getItem(collapsedCommentsStorageKey);
    if (rawStorage === null) {
        return {};
    }
    try {
        const parsedStorage = JSON.parse(rawStorage);
        if (typeof parsedStorage !== "object" || parsedStorage === null || Array.isArray(parsedStorage)) {
            return {};
        }
        const safeCollapsedMap: CollapsedCommentsByPost = {};
        for (const [postPermalink, commentIds] of Object.entries(parsedStorage as Record<string, unknown>)) {
            if (!Array.isArray(commentIds)) {
                continue;
            }
            safeCollapsedMap[postPermalink] = commentIds
                .filter((commentId) => typeof commentId === "string" && commentId.length > 0);
        }
        return safeCollapsedMap;
    } catch (_) {
        return {};
    }
}

export function loadCollapsedCommentsForPost(postPermalink: Permalink): Set<string> {
    const collapsedMap = loadCollapsedCommentsMap();
    return new Set(collapsedMap[postPermalink] ?? []);
}

export function saveCollapsedCommentsForPost(postPermalink: Permalink, collapsedCommentIds: Set<string>): void {
    const collapsedMap = loadCollapsedCommentsMap();
    if (collapsedCommentIds.size === 0) {
        delete collapsedMap[postPermalink];
    } else {
        collapsedMap[postPermalink] = Array.from(collapsedCommentIds);
    }
    localStorage.setItem(collapsedCommentsStorageKey, JSON.stringify(collapsedMap));
}
