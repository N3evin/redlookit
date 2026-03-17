import {isMediaHidden} from "./mediaUtils";
import {setVoteDisplay} from "./voteUtils";

export function isCrosspost(post: Post): boolean {
    return (typeof post.data.crosspost_parent_list === "object") && post.data.crosspost_parent_list.length > 0;
}

export function isImage(post: Post): boolean {
    if (isCrosspost(post)) {
        return false;
    }

    if (post.data.post_hint === 'image' || post.data.domain === "i.redd.it") {
        return true;
    }

    if (post.data.url_overridden_by_dest !== undefined) {
        const url = new URL(post.data.url_overridden_by_dest);
        return url.host === "i.redd.it";
    }

    return false;
}

export function isSelfPost(post: Post): boolean {
    return post.data.is_self;
}

export function isValidAbsoluteImageURL(value: string | undefined): boolean {
    if (typeof value !== "string" || value.trim() === "") {
        return false;
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return false;
        }
        // Some Reddit preview hosts frequently reject hotlinked image fetches.
        if (parsed.hostname === "external-preview.redd.it" || parsed.hostname === "preview.redd.it") {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function hasSelfText(post: Post): boolean {
    return typeof post.data.selftext == "string" && post.data.selftext !== "";
}

export function createImage(src: string): HTMLImageElement | undefined {
    if (isMediaHidden()) {
        return;
    }
    try {
        const parsed = new URL(src);
        if (parsed.hostname === "external-preview.redd.it" || parsed.hostname === "preview.redd.it") {
            return;
        }
    } catch {
        return;
    }
    const image = document.createElement('img');
    image.src = src;
    image.classList.add('post-image');
    return image;
}

export function embedRedditImages(html: string): string {
    const virtualElement = document.createElement("div");
    virtualElement.innerHTML = html;

    const linksInside = virtualElement.querySelectorAll<HTMLAnchorElement>("a");
    for (const link of linksInside) {
        if (link !== null && link.href !== "") {
            const url = new URL(link.href);
            if (url.host == "preview.redd.it") {
                const img = createImage(link.href);
                if (img) {
                    link.replaceWith(img);
                }
            }
        }
    }

    return virtualElement.innerHTML;
}

export function getPostDetails(response: any): HTMLElement[] {
    const upvotes = document.createElement('span');
    setVoteDisplay(upvotes, response[0].data.children[0].data.ups, 'post-detail-info');
    const subreddit = document.createElement('a');
    subreddit.classList.add('post-detail-info');
    subreddit.href = `#/${response[0].data.children[0].data.subreddit_name_prefixed}`;
    subreddit.append(response[0].data.children[0].data.subreddit_name_prefixed);
    const numComments = document.createElement('span');
    numComments.append(`${response[0].data.children[0].data.num_comments.toLocaleString()} Comments`);
    numComments.classList.add('post-detail-info');
    const author = document.createElement('span');
    author.append(`Posted by u/${response[0].data.children[0].data.author}`);
    author.classList.add('post-detail-info');
    const sortButton = document.createElement('span');
    sortButton.append('Sort By:');
    sortButton.classList.add('post-detail-info');
    return [upvotes, subreddit, numComments, author, sortButton];
}
