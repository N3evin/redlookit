export type Permalink = string;

export type AnalyticsRouteType = "home" | "subreddit" | "post";

export interface URLAnchorFlags {
    pushState: boolean
}

export function permalinkFromURLAnchor(): Permalink | null {
    // Capture the '/r/sub/...' part including the /r/
    const permalink = new URL(document.URL).hash;
    if (permalink === "") {
        return null;
    }

    // Remove the starting #
    return permalink.slice(1);
}

export function removeTrailingSlash(url: URL): URL {
    if (url.pathname.slice(-1) === '/') {
        url.pathname = url.pathname.slice(0, -1);
        return url;
    } else {
        return url;
    }
}

export function setURLAnchor(permalink: Permalink, flags: URLAnchorFlags = { pushState: true }): void {
    const url = removeTrailingSlash(new URL(document.URL));
    if (url.protocol == "file:///" || ["localhost", "127.0.0.1", "[::1]"].find((v) => v == url.hostname)) {
        // Can't pushState something local anymore because of browser security
        return;
    }
    const newurl = new URL(`${url.protocol}//${url.hostname}${url.pathname}#${permalink}`);
    if (flags.pushState) {
        window.history.pushState({}, '', newurl);
    }
}

export function parsePermalinkForAnalytics(permalink: Permalink | null): { route_type: AnalyticsRouteType, subreddit: string, post_id: string } {
    if (permalink === null || permalink.trim() === "") {
        return { route_type: "home", subreddit: "", post_id: "" };
    }
    const postMatch = permalink.match(/\/?r\/([^/]+?)\/comments\/([^/]+)/i);
    if (postMatch !== null) {
        return { route_type: "post", subreddit: postMatch[1].toLowerCase(), post_id: postMatch[2] };
    }
    const subredditMatch = permalink.match(/\/?r\/([^/]+)/i);
    if (subredditMatch !== null) {
        return { route_type: "subreddit", subreddit: subredditMatch[1].toLowerCase(), post_id: "" };
    }
    return { route_type: "home", subreddit: "", post_id: "" };
}

export function getPostIdFromPermalink(permalink: Permalink): string {
    const postMatch = permalink.match(/\/comments\/([^/]+)/i);
    return postMatch !== null ? postMatch[1] : "";
}
