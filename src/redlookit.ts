import "../styles/redlookit.css"
import "./@types/reddit-types.ts"
import {HumanFacesSideLoader} from "./facesSideloader"
import {Random, UUID, UUIDFormat} from "./random";
import {debounce} from "./domUtils";
import {isMediaHidden} from "./mediaUtils";
import {fetchData} from "./networkUtils";
import {setVoteDisplay} from "./voteUtils";

function isDebugMode(): boolean {
    // Won't support ipv6 loopback
    const url = new URL(document.URL);
    return url.protocol === "file:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function assert(condition: boolean, msg: string = "Assertion failed"): asserts condition {
    if (!condition && isDebugMode()) {
        throw new Error(msg);
    }
}

// A query selector that throws
function strictQuerySelector<T extends Element>(selector: string): T {
    const element: T | null = document.querySelector<T>(selector);
    assert(element !== null, `Failed to find a DOM element matching selector "${selector}"`);
    return element;
}

const redditBaseURL: string = "https://msoutlookkitapi.n3evin.com";
const postsList: HTMLElement = strictQuerySelector("#posts");
const postSection: HTMLElement = strictQuerySelector('section.reddit-post');
const subredditPageLimit = 75;
const postsScrollBufferPx = 80;
const endOfFeedMessageText = "That's enough reddit for now. Get back to work!";
let colors = ['#c24332', '#2e303f', '#63948c', '#ebe6d1', '#517c63', '#4c525f', '#371d31', '#f95950', '#023246', '#2e77ae', '#0d2137', '#ff8e2b'];
let initials = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]

const menuButton: HTMLElement = strictQuerySelector('.menu');
const sideNavBar: HTMLElement = strictQuerySelector('.menu-selector')
menuButton!.addEventListener('click', () => {
    sideNavBar!.classList.toggle('hidden')
})

const facesSideLoader = new HumanFacesSideLoader(0);
facesSideLoader.sideLoadMany(50, 6).catch();

const rng = new Random();

type Permalink = string;
const commentSortOptions = [
    { value: "top", label: "Top" },
    { value: "best", label: "Best" },
    { value: "new", label: "New" },
    { value: "controversial", label: "Controversial" },
    { value: "old", label: "Old" }
] as const;
type CommentSortValue = typeof commentSortOptions[number]["value"];
const defaultCommentSort: CommentSortValue = "top";
const subredditSortOptions = [
    { value: "hot", label: "Hot" },
    { value: "new", label: "New" },
    { value: "rising", label: "Rising" },
    { value: "top", label: "Top" }
] as const;
type SubredditSortValue = typeof subredditSortOptions[number]["value"];
const defaultSubredditSort: SubredditSortValue = "hot";
const subredditTopTimeOptions = [
    { value: "hour", label: "Hour" },
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
    { value: "all", label: "All Time" }
] as const;
type SubredditTopTimeValue = typeof subredditTopTimeOptions[number]["value"];
const defaultSubredditTopTime: SubredditTopTimeValue = "all";
interface ActiveSubredditQuery {
    sortType: null | "all" | "hour" | "day" | "week" | "month" | "year"
    tab: "hot" | "new" | "rising" | "controversial" | "top" | "gilded"
    subreddit: string
    useBaseListingPath: boolean
}

const subredditPagingState: {
    query: ActiveSubredditQuery | null
    after: string | null
    isLoading: boolean
    hasMore: boolean
    subredditInformation: SubredditDetails | null
} = {
    query: null,
    after: null,
    isLoading: false,
    hasMore: true,
    subredditInformation: null
};

function buildSubredditListingURL(query: ActiveSubredditQuery, after: string | null = null): string {
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

async function fetchSubredditDetails(subreddit: string): Promise<SubredditDetails | null> {
    try {
        const url = `${redditBaseURL}/r/${encodeURIComponent(subreddit)}/about.json`;
        const payload = await fetchData<{ data?: SubredditDetails }>(url);
        return payload?.data ?? null;
    } catch (_) {
        return null;
    }
}

function setEndOfFeedMessageVisible(shouldShow: boolean): void {
    const existing = postsList.querySelector('[data-end-of-feed-message="true"]');
    if (!shouldShow) {
        existing?.remove();
        return;
    }
    if (existing !== null) {
        return;
    }
    const message = document.createElement('div');
    message.dataset.endOfFeedMessage = "true";
    message.textContent = endOfFeedMessageText;
    postsList.append(message);
}

function setLoadMoreIndicatorVisible(shouldShow: boolean): void {
    const existing = postsList.querySelector('[data-load-more-indicator="true"]');
    if (!shouldShow) {
        existing?.remove();
        return;
    }
    if (existing !== null) {
        return;
    }

    const indicator = document.createElement('div');
    indicator.dataset.loadMoreIndicator = "true";
    indicator.classList.add('posts-loading-indicator');
    indicator.setAttribute("aria-live", "polite");

    const spinner = document.createElement('span');
    spinner.classList.add('posts-loading-spinner');
    spinner.setAttribute("aria-hidden", "true");

    const label = document.createElement('span');
    label.textContent = "Loading more posts...";

    indicator.append(spinner, label);
    postsList.append(indicator);
}

function resetSubredditPaging(query: ActiveSubredditQuery): void {
    subredditPagingState.query = query;
    subredditPagingState.after = null;
    subredditPagingState.isLoading = false;
    subredditPagingState.hasMore = true;
    subredditPagingState.subredditInformation = null;
    setLoadMoreIndicatorVisible(false);
    setEndOfFeedMessageVisible(false);
}

function isSameSubredditQuery(a: ActiveSubredditQuery | null, b: ActiveSubredditQuery): boolean {
    if (a === null) {
        return false;
    }
    return a.subreddit === b.subreddit
        && a.tab === b.tab
        && a.sortType === b.sortType
        && a.useBaseListingPath === b.useBaseListingPath;
}

function applyPageResultToState(posts: Listing<Post>): void {
    const nextAfter = posts.data.after;
    if (typeof nextAfter === "string" && nextAfter.length > 0) {
        subredditPagingState.after = nextAfter;
        subredditPagingState.hasMore = true;
        setEndOfFeedMessageVisible(false);
    } else {
        subredditPagingState.after = null;
        subredditPagingState.hasMore = false;
        setEndOfFeedMessageVisible(true);
    }
}

async function loadMorePostsFromSubreddit(): Promise<void> {
    const query = subredditPagingState.query;
    if (query === null || subredditPagingState.isLoading || !subredditPagingState.hasMore) {
        return;
    }

    subredditPagingState.isLoading = true;
    setLoadMoreIndicatorVisible(true);
    try {
        const url = buildSubredditListingURL(query, subredditPagingState.after);
        const posts = await fetchData<Listing<Post>>(url);
        if (!isSameSubredditQuery(subredditPagingState.query, query)) {
            return;
        }
        displayPosts(
            posts.data.children,
            query.subreddit,
            subredditPagingState.subredditInformation === null ? undefined : subredditPagingState.subredditInformation
        );
        applyPageResultToState(posts);
        maybeLoadMorePostsOnScroll();
    } catch (e) {
        console.error(e);
    } finally {
        setLoadMoreIndicatorVisible(false);
        if (isSameSubredditQuery(subredditPagingState.query, query)) {
            subredditPagingState.isLoading = false;
        }
    }
}

function maybeLoadMorePostsOnScroll(): void {
    const remaining = postsList.scrollHeight - (postsList.scrollTop + postsList.clientHeight);
    if (remaining <= postsScrollBufferPx) {
        loadMorePostsFromSubreddit().catch((reason: unknown) => {
            console.error("There was a problem loading more posts", {
                "reason": reason,
                "query": subredditPagingState.query
            });
        });
    }
}

async function loadInitialSubredditPosts(query: ActiveSubredditQuery): Promise<void> {
    clearPostsList();
    strictQuerySelector<HTMLElement>('.post-header-button.sort').id = query.subreddit;
    resetSubredditPaging(query);
    subredditPagingState.isLoading = true;
    try {
        const url = buildSubredditListingURL(query, null);
        const [posts, subredditInformation] = await Promise.all([
            fetchData<Listing<Post>>(url),
            fetchSubredditDetails(query.subreddit)
        ]);
        if (!isSameSubredditQuery(subredditPagingState.query, query)) {
            return;
        }
        subredditPagingState.subredditInformation = subredditInformation;
        displayPosts(
            posts.data.children,
            query.subreddit,
            subredditInformation === null ? undefined : subredditInformation
        );
        applyPageResultToState(posts);
        maybeLoadMorePostsOnScroll();
    } catch (e) {
        console.error(e);
    } finally {
        if (isSameSubredditQuery(subredditPagingState.query, query)) {
            subredditPagingState.isLoading = false;
        }
    }
}

function showRedditLink(permalink: Permalink): boolean {
    const postMatch = permalink.match(/\/?r\/([^/]+?)\/comments\/([^/]+)/);
    if (isDebugMode()) console.log("postMatch", postMatch);

    if (postMatch !== null) {
        // The anchor points to a post
        showSubreddit(postMatch[1]);
        clearPost();
        showPost(permalink).catch( (reason: unknown) => {
            console.error("There was a problem drawing this post on the page", {
                "reason": reason,
                "permalink": permalink,
                "match results": postMatch
            });
        });
        return true;
    } else {
        const subMatch = permalink.match(/\/?r\/([^/]+)/);
        if (isDebugMode()) console.log("subMatch", subMatch);

        if (subMatch !== null) {
            // The anchor points to a sub
            showSubreddit(subMatch[1]);
            return true;
        } else {
            // The anchor points to something weird
            return false;
        }
    }
}

function showRedditPageOrDefault(permalink: Permalink | null) {
    if (isDebugMode()) console.log("interpreting link", permalink);
    if (permalink === null) {
        // We don't have an anchor in the URL
        showSubreddit("popular");
        if (isDebugMode()) {
            showPost(`/r/test/comments/z0yiof/formatting_test/`).catch((reason: unknown) => {
                console.error("There was a problem drawing the test post on the page", {
                    "reason": reason,
                });
            });
        }
    } else {
        // We have an anchor in the URL
        const itWorked = showRedditLink(permalink);
        if (!itWorked) {
            // The anchor pointed to something we do not support
            showSubreddit("popular");
        }
    }

}

async function showSubreddit(subreddit: string) {
    const defaultSort = getDefaultSubredditPostSortQuery();
    await loadInitialSubredditPosts({
        subreddit,
        tab: defaultSort.tab,
        sortType: defaultSort.sortType,
        useBaseListingPath: defaultSort.tab === "hot" && defaultSort.sortType === null
    });
}

function getDefaultSubredditSort(): SubredditSortValue {
    const selectedSort = localStorage.getItem('defaultSubredditSort');
    if (selectedSort !== null && subredditSortOptions.some((option) => option.value === selectedSort)) {
        return selectedSort as SubredditSortValue;
    }
    return defaultSubredditSort;
}

function getDefaultSubredditTopTime(): SubredditTopTimeValue {
    const selectedTopTime = localStorage.getItem('defaultSubredditTopTime');
    if (selectedTopTime !== null && subredditTopTimeOptions.some((option) => option.value === selectedTopTime)) {
        return selectedTopTime as SubredditTopTimeValue;
    }
    return defaultSubredditTopTime;
}

function getDefaultSubredditPostSortQuery(): Pick<ActiveSubredditQuery, "tab" | "sortType"> {
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

function getDefaultCommentSort(): CommentSortValue {
    const selectedSort = localStorage.getItem('defaultCommentSort');
    if (selectedSort !== null && commentSortOptions.some((option) => option.value === selectedSort)) {
        return selectedSort as CommentSortValue;
    }
    return defaultCommentSort;
}

async function showPost(permalink: Permalink, sort?: string) {
    const resolvedSort = sort ?? getDefaultCommentSort();
    const baseurl = removeTrailingSlash(new URL(`${redditBaseURL}${permalink}`));
    const url = `${baseurl}/.json?limit=75&sort=${resolvedSort}`;
    try {
        const postData: ApiObj = await fetchData<ApiObj>(url);
        clearPostSection();
        showPostFromData(postData, permalink, resolvedSort);
    } catch (e) {
        console.error(e);
    }
}

function permalinkFromURLAnchor(): Permalink | null {
    // Capture the '/r/sub/...' part including the /r/
    const permalink = new URL(document.URL).hash
    if (permalink === "") {
        return null;
    }

    // Remove the starting #
    return permalink.slice(1);
}

function removeTrailingSlash(url: URL): URL {
    if (url.pathname.slice(-1) === '/') {
        url.pathname = url.pathname.slice(0,-1);
        return url;
    } else {
        return url;
    }
}

interface URLAnchorFlags {
    pushState: boolean
}
function setURLAnchor(permalink: Permalink, flags: URLAnchorFlags = {pushState:true}): void {
    const url = removeTrailingSlash(new URL(document.URL));
    if (url.protocol == "file:///" || ["localhost", "127.0.0.1", "[::1]"].find((v) => v == url.hostname) ) {
        // Can't pushState something local anymore because of browser security
        return;
    }
    const newurl = new URL(`${url.protocol}//${url.hostname}${url.pathname}#${permalink}`);
    if (flags.pushState) {
        window.history.pushState({}, '', newurl);
    }
}

function getSubredditIcon(subredditInformation: SubredditDetails) {
    if (subredditInformation.icon_img != '') {
        return subredditInformation.icon_img
    } else if (subredditInformation.community_icon != '') {
        return subredditInformation.community_icon.replaceAll("&amp;", "&");
    } else {
        return 'https://img.icons8.com/fluency-systems-regular/512/reddit.png';
    }
}

function getSavedSubredditSet(): Set<string> {
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

let subredditInfoContainer = document.createElement('div');
let subredditInfoHeading = document.createElement('div');
let subredditInfoDetails = document.createElement('div');
let subredditInfoIcon = document.createElement('img');
let subredditIconContainer = document.createElement('div');
let subredditDetailsContainer = document.createElement('div');
let headerButtons = document.querySelector('.header-buttons') as HTMLElement;
let scrollable = document.querySelector('#posts.scrollable') as HTMLElement;
let favoriteIcon = document.createElement('span');

function displayPosts(responses: Post[], subreddit, subredditInformation: SubredditDetails = {
    "title": null,
    "icon_img": '',
    "community_icon": '',
    "subscribers": null,
    "public_description": null,
    "active_user_count": 0,
    "display_name_prefixed": null,
    "over18": false,
    accounts_active_is_fuzzed: false,
    accounts_active: 0,
    advertiser_category: "",
    all_original_content: false,
    allow_discovery: false,
    allow_galleries: false,
    allow_images: false,
    allow_polls: false,
    allow_predictions_tournament: false,
    allow_predictions: false,
    allow_videogifs: false,
    allow_videos: false,
    banner_background_color: "",
    banner_background_image: "",
    can_assign_link_flair: false,
    can_assign_user_flair: false,
    collapse_deleted_comments: false,
    comment_score_hide_mins: 0,
    community_reviewed: false,
    created_utc: 0,
    created: 0,
    description_html: "",
    disable_contributor_requests: false,
    emojis_custom_size: undefined,
    emojis_enabled: false,
    has_menu_widget: false,
    header_img: "",
    header_title: "",
    hide_ads: false,
    id: "",
    is_crosspostable_subreddit: false,
    is_enrolled_in_new_modmail: undefined,
    lang: "",
    link_flair_position: "",
    mobile_banner_image: "",
    notification_level: "",
    original_content_tag_enabled: false,
    prediction_leaderboard_entry_type: "",
    primary_color: "",
    public_description_html: "",
    public_traffic: false,
    quarantine: false,
    show_media_preview: false,
    spoilers_enabled: false,
    submission_type: "",
    submit_link_label: "",
    submit_text_html: "",
    submit_text: "",
    subreddit_type: "",
    suggested_comment_sort: "",
    user_can_flair_in_sr: false,
    user_flair_background_color: undefined,
    user_flair_css_class: undefined,
    user_flair_enabled_in_sr: false,
    user_flair_position: "",
    user_flair_richtext: [],
    user_flair_template_id: undefined,
    user_flair_text_color: undefined,
    user_flair_text: undefined,
    user_flair_type: "",
    user_has_favorited: false,
    user_is_banned: false,
    user_sr_flair_enabled: false,
    user_sr_theme_enabled: false,
    whitelist_status: "",
    wiki_enabled: false,
    wls: 0,
    accept_followers: false,
    banner_img: "",
    banner_size: [],
    description: "",
    display_name: "",
    free_form_reports: false,
    header_size: [],
    icon_size: undefined,
    key_color: "",
    link_flair_enabled: false,
    name: "",
    restrict_commenting: false,
    restrict_posting: false,
    show_media: false,
    submit_text_label: "",
    url: "",
    user_is_contributor: false,
    user_is_moderator: false,
    user_is_muted: false,
    user_is_subscriber: false
}) {
    const showSubDetailsSetting = localStorage.getItem('showSubDetails');
    if (subreddit !== 'popular' && (showSubDetailsSetting === null || showSubDetailsSetting === 'true')) {
        subredditInfoContainer.style.display = 'flex';
        headerButtons.style.borderRadius = "0";
        subredditInfoContainer.classList.add('subreddit-info');
        subredditInfoHeading.innerHTML = subredditInformation.title;
        subredditInfoHeading.classList.add('subreddit-info-heading');
        favoriteIcon.id = subreddit;
        if (getSavedSubredditSet().has(subreddit.toLowerCase())) {
            favoriteIcon.innerHTML = '<svg width="16" height="16" class="favorite-icon favorited" viewBox="0 0 176 168" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M89.7935 6.93173L111.277 50.4619C113.025 54.0036 116.404 56.4584 120.312 57.0264L168.351 64.0068C169.991 64.2451 170.646 66.2611 169.459 67.4182L134.698 101.302C131.87 104.058 130.579 108.031 131.247 111.923L139.453 159.767C139.733 161.401 138.018 162.647 136.551 161.876L93.5841 139.287C90.0882 137.449 85.9118 137.449 82.4159 139.287L39.4491 161.876C37.9818 162.647 36.267 161.401 36.5472 159.768L44.7531 111.923C45.4208 108.031 44.1302 104.059 41.302 101.302L6.54106 67.4182C5.35402 66.2611 6.00905 64.2451 7.64948 64.0068L55.6879 57.0264C59.5964 56.4584 62.9752 54.0036 64.7231 50.4619L86.2065 6.93174C86.9402 5.44523 89.0599 5.44525 89.7935 6.93173Z"/></svg>'
        } else {
            favoriteIcon.innerHTML = '<svg width="16" height="16" class="favorite-icon" viewBox="0 0 176 168" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M89.7935 6.93173L111.277 50.4619C113.025 54.0036 116.404 56.4584 120.312 57.0264L168.351 64.0068C169.991 64.2451 170.646 66.2611 169.459 67.4182L134.698 101.302C131.87 104.058 130.579 108.031 131.247 111.923L139.453 159.767C139.733 161.401 138.018 162.647 136.551 161.876L93.5841 139.287C90.0882 137.449 85.9118 137.449 82.4159 139.287L39.4491 161.876C37.9818 162.647 36.267 161.401 36.5472 159.768L44.7531 111.923C45.4208 108.031 44.1302 104.059 41.302 101.302L6.54106 67.4182C5.35402 66.2611 6.00905 64.2451 7.64948 64.0068L55.6879 57.0264C59.5964 56.4584 62.9752 54.0036 64.7231 50.4619L86.2065 6.93174C86.9402 5.44523 89.0599 5.44525 89.7935 6.93173Z"/></svg>'
        }

        const onlineCount = typeof subredditInformation.active_user_count === "number"
            ? subredditInformation.active_user_count
            : (typeof subredditInformation.accounts_active === "number" ? subredditInformation.accounts_active : 0);
        const onlineSegment = onlineCount > 0 ? ` • ${numberFormatter(onlineCount)} online` : "";
        subredditInfoContainer.title = `${subredditInformation.display_name_prefixed} • ${numberFormatter(subredditInformation.subscribers)} members${onlineSegment} ${subredditInformation.public_description}`;
        subredditInfoDetails.innerHTML = `${subredditInformation.display_name_prefixed} • ${numberFormatter(subredditInformation.subscribers)} members${onlineSegment}`;
        if (subredditInformation.over18) {
            subredditInfoDetails.innerHTML += '<br><span>Warning: NSFW!</span>'
        }
        subredditInfoDetails.classList.add('subreddit-info-details');
        subredditInfoIcon.src = getSubredditIcon(subredditInformation);
        subredditInfoIcon.classList.add('subreddit-info-icon');
        if (subreddit == 'gnometalk') {
            subredditInfoHeading.innerHTML = 'You found an easter egg!';
            subredditInfoIcon.src = 'https://static.wikia.nocookie.net/surrealmemes/images/f/ff/Noggin.png/revision/latest?cb=20190114192842';
        }
        subredditDetailsContainer.append(subredditInfoHeading, subredditInfoDetails);
        subredditIconContainer.append(subredditInfoIcon);
        subredditIconContainer.classList.add('subreddit-icon-container');
        subredditDetailsContainer.classList.add('subreddit-details-container');
        subredditInfoContainer.append(subredditIconContainer, subredditDetailsContainer, favoriteIcon);
        headerButtons.parentNode.insertBefore(subredditInfoContainer, headerButtons);
        if (document.body.classList.contains('compact')) {
            scrollable.style.height = 'calc(100vh - 252px)';
        } else if (document.body.classList.contains('cozy')) {
            scrollable.style.height = 'calc(100vh - 265px)';
        } else {
            scrollable.style.height = 'calc(100vh - 273px)';
        }
    } else {
        subredditInfoContainer.style.display = 'none';
        headerButtons.style.borderRadius = "4px 4px 0px 0px";
        if (document.body.classList.contains('compact')) {
            scrollable.style.height = 'calc(100vh - 170px)';
        } else {
            scrollable.style.height = 'calc(100vh - 178px)';
        }
    }
    if (subreddit.toLowerCase() == 'crappydesign') {document.body.style.fontFamily = '"Comic Sans MS", "Comic Sans", cursive'; subredditInfoContainer.style.background = `linear-gradient(${Math.floor(Math.random() * (360 - 0 + 1) + 0)}deg, rgba(255,0,0,1) 0%, rgba(255,154,0,1) 10%, rgba(208,222,33,1) 20%, rgba(79,220,74,1) 30%, rgba(63,218,216,1) 40%, rgba(47,201,226,1) 50%, rgba(28,127,238,1) 60%, rgba(95,21,242,1) 70%, rgba(186,12,248,1) 80%, rgba(251,7,217,1) 90%, rgba(255,0,0,1) 100%)`; subredditInfoContainer.style.backgroundSize = '350px'; subredditInfoContainer.style.transform = `rotate(${Math.floor(Math.random() * (5 - -5 + 1) + -5)}deg)`; subredditInfoContainer.style.zIndex = '10'} else { document.body.style.fontFamily = 'Segoe UI'; subredditInfoContainer.style.background = 'var(--background-color-2)'; subredditInfoContainer.style.transform = 'none'; subredditInfoContainer.style.zIndex = 'auto'}
    const postsFragment = document.createDocumentFragment();
    for (const response of responses) {
        let section: HTMLButtonElement = document.createElement('button');
        section.classList.add('post');

        let title = document.createElement('span');
        let titleText = response.data.title;
        title.append(titleText);
        section.title = response.data.title;
        title.classList.add('title');

        let subreddit = document.createElement('span');
        subreddit.append(response.data.subreddit_name_prefixed);
        subreddit.classList.add('subreddit');
        let upvotes = document.createElement('span');
        setVoteDisplay(upvotes, response.data.score, 'post-data');
        let profile = document.createElement('span');
        profile.classList.add('profile');
        let ppInitials = initials[Math.floor(Math.random() * initials.length)] + initials[Math.floor(Math.random() * initials.length)];
        let ppColor = colors[Math.floor(Math.random() * colors.length)];
        if (ppColor === '#ebe6d1' || ppColor === '#ebe6d1') {
            profile.style.color = 'black';
        }
        profile.style.backgroundColor = ppColor;
        profile.append(ppInitials);
        section.append(profile, title, subreddit, upvotes);
        if (response.data.subreddit_name_prefixed.toLowerCase() == 'r/crappydesign') {
            section.style.transform = `rotate(${Math.floor(Math.random() * (5 - -5 + 1) + -5)}deg)`
            section.style.zIndex =  `${Math.floor(Math.random() * (10 - 1 + 1) + 1)}`
            profile.style.background = `linear-gradient(${Math.floor(Math.random() * (360 - 0 + 1) + 0)}deg, rgba(255,0,0,1) 0%, rgba(255,154,0,1) 10%, rgba(208,222,33,1) 20%, rgba(79,220,74,1) 30%, rgba(63,218,216,1) 40%, rgba(47,201,226,1) 50%, rgba(28,127,238,1) 60%, rgba(95,21,242,1) 70%, rgba(186,12,248,1) 80%, rgba(251,7,217,1) 90%, rgba(255,0,0,1) 100%)`;

        }
        section.addEventListener('click', () => {
            document.querySelector(".focused-post")?.classList.remove("focused-post");
            section.classList.add("focused-post");
            setURLAnchor(response.data.permalink);
            showPost(response.data.permalink).catch( (reason) => {
                console.error("There was a problem drawing this post on the page", {
                    "reason": reason,
                    "permalink": response.data.permalink,
                });
            });
        })
        postsFragment.append(section);
    }
    postsList.append(postsFragment);
}

favoriteIcon.addEventListener('click', function() {
    const icon = favoriteIcon.querySelector('.favorite-icon');
    if (!icon) {
        return;
    }
    let favoriteIconClasses = icon.classList
    let favorited = favoriteIconClasses.contains('favorited');
    if (!favorited) {
        favoriteIconClasses.add('favorited');
        favoriteSubreddit(favoriteIcon.id);
    } else {
        favoriteIconClasses.remove('favorited');
        unFavoriteSubreddit(favoriteIcon.id);
    }
})

function favoriteSubreddit(subreddit) {
    let subredditBtn: HTMLButtonElement = document.createElement<"button">('button');
    subredditBtn.classList.add('subreddit', 'button');
    subredditBtn.id = subreddit;
    subredditBtn.addEventListener('click', async () => {
        clearPost();
        if (isDebugMode()) console.log("custom sub click", subredditBtn.id);
        setURLAnchor(`/r/${subredditBtn.id}`);
        showSubreddit(subredditBtn.id);
    })
    if (localStorage.getItem('savedSubreddits')) {
        let savedSubreddits = localStorage.getItem('savedSubreddits');
        savedSubreddits += `,${subreddit}`;
        localStorage.setItem('savedSubreddits', savedSubreddits);
    } else {
        localStorage.setItem('savedSubreddits', subreddit);
    }
    subredditBtn.append('r/' + subreddit);
    subredditSection.append(subredditBtn);
}

function unFavoriteSubreddit(subreddit) {
    document.querySelector(`.your-subreddits .subreddit.button#${subreddit}`).remove();
    let savedSubreddits = localStorage.getItem('savedSubreddits');
    let newSavedSubreddits = savedSubreddits.split(',').filter(e => e !== subreddit);
    localStorage.setItem('savedSubreddits', newSavedSubreddits.toString());
}

type CommentBuilderOptions = {
    indent: number, 
    ppBuffer: HTMLImageElement[], 
    post: Permalink,
    postAuthor: string,
    commentsEncounteredSoFar: Set<string>    
};

function displayCommentsRecursive(parentElement: HTMLElement, listing: ApiObj[],  {post, postAuthor, indent=0, ppBuffer=[], commentsEncounteredSoFar=new Set()}: CommentBuilderOptions) {
    if (listing.length === 0) {
        return;
    }

    for (const redditObj of listing) {
        // At the end of the list reddit adds a "more" object
        if (redditObj.kind === "t1") {
            // kind being t1 assures us listing[0] is a SnooComment
            const comment: SnooComment = redditObj as SnooComment;
            commentsEncounteredSoFar.add(comment.data.id);
            
            const commentElement = document.createElement("div");
            if (indent > 0) {
                commentElement.classList.add('replied-comment');
            }

            parentElement.appendChild(commentElement);
            const prom: Promise<HTMLElement> = createComment(comment, {ppBuffer: ppBuffer, domNode: commentElement, postAuthor});
            prom.catch( (reason) => {
                console.error("There was a problem drawing this comment on the page", {"reason":reason, "comment data": comment, "profile picture": ppBuffer, "anchor element on the page=": commentElement});
            })

            if (comment.data.replies) {
                displayCommentsRecursive(commentElement, comment.data.replies.data.children, {
                    indent: indent + 10, 
                    ppBuffer: ppBuffer,
                    post: post,
                    postAuthor,
                    commentsEncounteredSoFar
                });
            }

            if (indent === 0) {
                parentElement.appendChild(document.createElement('hr'));
            }
        } else if (redditObj.kind === "more" && post !== undefined) {
            const data = redditObj as MoreComments;
            const moreElement = document.createElement("span");
            moreElement.classList.add("btn-more");
            
            // Fetch the parent of the "more" listing
            const parentLink = `${redditBaseURL}${post}${data.data.parent_id.slice(3)}`;
            
            moreElement.addEventListener("click", async () => {
                moreElement.classList.add("waiting");
                try {
                    const data = await fetchData<ApiObj[]>(`${parentLink}.json`);
                    if (isDebugMode()) console.log("Got data!", parentLink, data);
                    moreElement.remove();

                    // Our type definitions aren't robust enough to go through the tree properly
                    // We just cop out. Cast as `any` and try/catch.
                    let replies: Listing<SnooComment>;
                    try {
                        replies = (data as any)[1].data.children[0].data.replies.data
                    } catch (e) {
                        moreElement.classList.remove("waiting");
                        return Promise.reject(e);
                    }

                    replies.children = replies.children.filter((v) => {
                        return !commentsEncounteredSoFar.has(v.data.id)
                    })

                    displayCommentsRecursive(parentElement, replies.children, {
                        indent: indent + 10,
                        ppBuffer: ppBuffer,
                        post: post,
                        postAuthor,
                        commentsEncounteredSoFar
                    });
                } catch (e) {
                    moreElement.classList.remove("waiting");
                    console.error(e);
                }
            });
            parentElement.appendChild(moreElement);
        }
    }
}

function displayComments(commentsData, {post, postAuthor}: {post: Permalink, postAuthor: string}) {
    postSection.classList.add('post-selected');
    postSection.classList.remove('deselected');

    const stableInTimeFaceBuffer = facesSideLoader.getFaces().slice(0); // Stable-in-time copy of the full array
    displayCommentsRecursive(postSection, commentsData, { indent: 0, ppBuffer: stableInTimeFaceBuffer, post: post, postAuthor, commentsEncounteredSoFar: new Set()});
}

let sortButton = document.querySelector('.post-header-button.sort') as HTMLElement;
let sortMenu = document.querySelector('.sort-menu') as HTMLElement;

sortButton.addEventListener('click', function() {
    if (sortMenu.style.display == 'none' || sortMenu.style.display == '') {
        sortButton.classList.add('opened');
        sortMenu.style.display = 'flex';
    } else {
        sortButton.classList.remove('opened');
        sortMenu.style.display = 'none';
        let sortTopMenu = document.querySelector('.sort-top-menu') as HTMLButtonElement;
        sortTopMenu.style.display = 'none';
    }
})


let sortHot = document.querySelector('.sort-button.hot') as HTMLButtonElement;
sortHot.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'hot', subreddit: sortButton.id, sortType: null})
})

let sortNew = document.querySelector('.sort-button.new') as HTMLButtonElement;
sortNew.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'new', subreddit: sortButton.id, sortType: null})
})

let sortRising = document.querySelector('.sort-button.rising') as HTMLButtonElement;
sortRising.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'rising', subreddit: sortButton.id, sortType: null})
})
let sortTopMenu = document.querySelector('.sort-top-menu') as HTMLButtonElement;

let topButton = document.querySelector('.sort-button.top') as HTMLButtonElement;
topButton.addEventListener('click', function() {
    if ((sortTopMenu.style.display == 'none' || sortTopMenu.style.display == '') && sortMenu.style.display == 'flex') {
        sortTopMenu.style.display = 'flex';
    } else {
        sortTopMenu.style.display = 'none';
    }
})

// when adding a new theme in css, remember to add the theme class name to this list
let themeNames=['defaultTheme', 'theme1', 'theme2', 'theme3', 'theme4', 'theme5', 
                'theme6', 'theme7', 'theme8', 'theme9', 'theme10', 'theme11', 
                'theme12', 'theme13', 'theme14', 'theme15', 'theme16', 'theme17',
                'theme18', 'theme19', 'theme20', 'theme21', 'theme22']


let themes = document.querySelector('.theme-grid-container') as HTMLElement;

for (let theme of themes.children) {
    theme.addEventListener('click', function() {
        let themeName = theme.classList[1];
        removeThemeSelected()
        document.body.classList.remove(...themeNames);
        if (!theme.classList.contains('selected')) {
            document.body.classList.add(themeName);
            theme.classList.add('selected');
            localStorage.setItem('currentTheme', themeName);
        } else {
            theme.classList.remove('selected');
            document.body.classList.remove(themeName);
            localStorage.setItem('currentTheme', '');
        }
    })
}

function applySavedTheme() {
    if (localStorage.getItem('currentTheme')) {
        let currentTheme = localStorage.getItem('currentTheme');
        removeThemeSelected();
        document.body.classList.remove(...themeNames);
        document.querySelector(`.theme-button.${currentTheme}`).classList.add('selected');
        document.body.classList.add(currentTheme);
    } else {
        document.body.classList.remove(...themeNames);
        document.body.classList.add('defaultTheme');
    }
}

function removeThemeSelected() {
    for (let theme of themes.children) {
        theme.classList.remove('selected');
    }
}

let roomyButton = document.querySelector('.display-density-button.roomy') as HTMLElement;
let cozyButton = document.querySelector('.display-density-button.cozy') as HTMLElement;
let compactButton = document.querySelector('.display-density-button.compact') as HTMLElement;

roomyButton.addEventListener('click', function() {
    localStorage.setItem('displayDensity', 'roomy');
    cozyButton.classList.remove('selected');
    compactButton.classList.remove('selected');
    roomyButton.classList.add('selected');
    document.body.classList.remove('cozy', 'compact');
    document.body.classList.add('roomy');
})

cozyButton.addEventListener('click', function() {
    localStorage.setItem('displayDensity', 'cozy');
    roomyButton.classList.remove('selected');
    compactButton.classList.remove('selected');
    cozyButton.classList.add('selected');
    document.body.classList.remove('compact', 'roomy');
    document.body.classList.add('cozy');
})

compactButton.addEventListener('click', function() {
    localStorage.setItem('displayDensity', 'compact');
    roomyButton.classList.remove('selected');
    cozyButton.classList.remove('selected');
    compactButton.classList.add('selected');
    document.body.classList.remove('cozy', 'roomy');
    document.body.classList.add('compact');
})

function setDisplayDensity() {
    if (localStorage.getItem('displayDensity')) {
        let displayDensity = localStorage.getItem('displayDensity');
        document.body.classList.add(displayDensity);
        roomyButton.classList.remove('selected');
        cozyButton.classList.remove('selected');
        compactButton.classList.remove('selected');
        document.querySelector(`.display-density-button.${displayDensity}`).classList.add('selected');
    }
}


let sortTopDay = document.querySelector('.sort-button.today') as HTMLButtonElement;
sortTopDay.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'top', sortType: 'day', subreddit: sortButton.id})
})

let sortTopWeek = document.querySelector('.sort-button.week') as HTMLButtonElement;
sortTopWeek.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'top', sortType: 'week', subreddit: sortButton.id})
})

let sortTopMonth = document.querySelector('.sort-button.month') as HTMLButtonElement;
sortTopMonth.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'top', sortType: 'month', subreddit: sortButton.id})
})

let sortTopYear = document.querySelector('.sort-button.year') as HTMLButtonElement;
sortTopYear.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'top', sortType: 'year', subreddit: sortButton.id})
})

let sortTopAll = document.querySelector('.sort-button.all-time') as HTMLButtonElement;
sortTopAll.addEventListener('click', async function() {
    return fetchAndDisplaySub({tab:'top', sortType: 'all', subreddit: sortButton.id})
})

// Alternative function using Reddit's official API (requires app registration)
async function fetchDataWithAuth<T>(url: string): Promise<T> {
    const headers = {
        'User-Agent': 'Redlookit/1.0 (by /u/one-loop)',
        'Accept': 'application/json'
    };
    
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error('Network response was not ok' + response.statusText);
    }
    const data: T = await response.json();
    return data;
}

interface subredditQuery {
    sortType: null | "all" | "hour" | "day" | "week" | "month" | "year"
    tab: "hot" | "new" | "rising" | "controversial" | "top" | "gilded"
    subreddit: string
}
async function fetchAndDisplaySub({sortType=null, tab="hot", subreddit}: subredditQuery) {
    sortMenu.style.display = 'none';
    sortTopMenu.style.display = 'none';
    sortButton.classList.remove('opened');
    await loadInitialSubredditPosts({
        subreddit,
        tab,
        sortType,
        useBaseListingPath: false
    });
}

function isCrosspost(post: Post) {
    return (typeof post.data.crosspost_parent_list === "object") && post.data.crosspost_parent_list.length > 0;
}

function isImage(post: Post) {
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

function isSelfPost(post: Post) {
    return post.data.is_self;
}

function isValidAbsoluteImageURL(value: string | undefined): boolean {
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

function hasSelfText(post: Post) {
    return typeof post.data.selftext == "string" && post.data.selftext !== "";
}

function createImage(src: string) {
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
    let image = document.createElement('img');
    image.src = src;
    image.classList.add('post-image');
    return image
}

function embedRedditImages(html: string): string {
    const virtualElement = document.createElement("div");
    virtualElement.innerHTML = html;

    const linksInside = virtualElement.querySelectorAll<HTMLAnchorElement>("a")
    for (const link of linksInside) {
        if (link !== null && link.href !== "") {
            const url = new URL(link.href)
            if (url.host == "preview.redd.it") {
                const img = createImage(link.href)
                if (img) {
                    link.replaceWith(img);
                }
            }
        }
    }

    return virtualElement.innerHTML;
}

function showPostFromData(response: ApiObj, permalink?: Permalink, currentSort: string = "top") {
    try {
        // reset scroll position when user clicks on a new post
        let redditPost: HTMLElement = strictQuerySelector('.reddit-post');
        redditPost.scrollTop = 0;
    } catch (e) { 
        console.error(e);
    }
    
    const comments: SnooComment[] = response[1].data.children;
    const post: Post = response[0].data.children[0];

    // --- Comment Sort Dropdown ---
    const sortSelect = document.createElement("select");
    sortSelect.className = "post-detail-info comment-sort-dropdown";
    commentSortOptions.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        sortSelect.appendChild(option);
    });
    sortSelect.value = currentSort;
    sortSelect.title = "Sort comments by";
    sortSelect.addEventListener("change", () => {
        if (permalink) {
            showPost(permalink, sortSelect.value);
        }
    });
    // --- End Dropdown ---

    const author = document.createElement('span');
    author.append(`Posted by u/${response[0].data.children[0].data.author}`);
    author.classList.add('post-author')
    postSection.append(author);
    const title = document.createElement('h4')
    const titleLink = document.createElement('a');
    title.appendChild(titleLink);
    const titleText = post.data.title
    titleLink.href = `${redditBaseURL}${post.data.permalink}`;
    titleLink.append(titleText);
    title.classList.add('post-section-title');
    postSection.append(title);

    const container = document.createElement('div');
    container.classList.add('post-contents')
    postSection.append(container);

    if (isImage(post)) {
        if (isDebugMode()) console.log("Post is image");
        const image = createImage(post.data.url_overridden_by_dest);
        if (image) {
            container.append(image);
        }
    } 
    else if (isSelfPost(post)) {
        if (isDebugMode()) console.log("Post is self post");
    } 
    else {
        if (isDebugMode()) console.log("Post is something else");
        const row = document.createElement('div');
        container.append(row)
        const thumbnail = document.createElement('img');
        const link = document.createElement('a');

        if (isValidAbsoluteImageURL(post.data.thumbnail)) {
            thumbnail.src = post.data.thumbnail;
        } else {
            thumbnail.src = 'https://img.icons8.com/3d-fluency/512/news.png';
        }
        thumbnail.onerror = () => {
            thumbnail.src = 'https://img.icons8.com/3d-fluency/512/news.png';
        };
        link.href = post.data.url_overridden_by_dest;
        link.innerText = titleText;
        link.target = "_blank";
        link.classList.add('post-link');
        row.append(thumbnail);
        row.append(link);
        row.classList.add('post-link-container-row')
        container.classList.add('post-link-container')
    }

    if (hasSelfText(post)) {
        if (isDebugMode()) console.log("Post has self text");
        const selfpostHtml = embedRedditImages(decodeHTML(post.data.selftext_html));
        const selftext = document.createElement('div');
        selftext.innerHTML = selfpostHtml;
        selftext.classList.add("usertext");
    
        container.append(selftext);
    }

    const redditVideo = post.data?.secure_media?.reddit_video;
    if (redditVideo !== undefined) {
        if (isDebugMode()) console.log("Post has video");
        const video = document.createElement('video');
        video.classList.add('post-video');
        video.setAttribute('controls', '')
        const source = document.createElement('source');
        source.src = post.data.secure_media.reddit_video.fallback_url;
        video.appendChild(source);
        if (!isMediaHidden()) {
            container.append(video);
        }
    }
    
    const postDetails = getPostDetails(response)
    postSection.append(...postDetails)
    postSection.appendChild(sortSelect);
    postSection.append(document.createElement('hr'));

    displayComments(comments, { post: post.data.permalink, postAuthor: post.data.author });
}

document.body.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        clearPostSection();
    }
})

function getPostDetails(response: any) {
    let upvotes = document.createElement('span');
    setVoteDisplay(upvotes, response[0].data.children[0].data.ups, 'post-detail-info');
    let subreddit = document.createElement('a');
    subreddit.classList.add('post-detail-info');
    subreddit.href = `#/${response[0].data.children[0].data.subreddit_name_prefixed}`;
    subreddit.append(response[0].data.children[0].data.subreddit_name_prefixed);
    let numComments = document.createElement('span');
    numComments.append(`${response[0].data.children[0].data.num_comments.toLocaleString()} Comments`);
    numComments.classList.add('post-detail-info')
    let author = document.createElement('span');
    author.append(`Posted by u/${response[0].data.children[0].data.author}`);
    author.classList.add('post-detail-info')
    let sortButton = document.createElement('span');
    sortButton.append('Sort By:');
    sortButton.classList.add('post-detail-info')
    return [upvotes, subreddit, numComments, author, sortButton];
}

async function generateGnomePic(): Promise<HTMLImageElement> {
    const gnome = document.createElement<"img">("img");
    gnome.classList.add("gnome");

    // Potential Hmirror 
    const flipSeed = await rng.random();
    const flip = flipSeed <= 0.5 ? "scaleX(-1) " : "";

    // +Random rotation between -20deg +20deg
    const mirrorSeed = await rng.random();
    gnome.style.transform = `${flip}rotate(${Math.round(mirrorSeed * 40 - 20)}deg) `;
    
    const colorSeed = await rng.random();
    gnome.style.backgroundColor = colors[Math.floor(colorSeed * colors.length)];

    return gnome;
}

// noinspection JSUnusedLocalSymbols
async function generateTextPic(commentData: SnooComment, size: number): Promise<HTMLSpanElement> {
    const textPic = document.createElement<"span">("span");

    const pseudoRand1 = await rng.random(0, initials.length-1);
    const pseudoRand2 = await rng.random(0, initials.length-1);
    const ppInitials = initials[Math.round(pseudoRand1)] + initials[Math.round(pseudoRand2)];

    textPic.style.fontWeight = "600";
    textPic.style.fontSize = "16px";
    textPic.style.lineHeight = "40px";
    textPic.style.textAlign = "center";
    textPic.style.display = "inline-block";
    textPic.style.cssText += "-webkit-touch-callout: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none;";

    const colorSeed = await rng.random(0, colors.length-1);
    textPic.style.backgroundColor = colors[Math.round(colorSeed)];
    
    textPic.textContent = `${ppInitials}`;
    return textPic;
}

function copyImage2Canvas(origin: HTMLImageElement, newSize: number): HTMLCanvasElement | null {
    const canv: HTMLCanvasElement = document.createElement("canvas");

    // canvas will sample 4 pixels per pixel displayed then be downsized via css
    // otherwise if 1px = 1px the picture looks pixelated & jagged
    // css seems to do a small cubic interpolation when downsizing, and it makes a world of difference
    canv.height = canv.width = newSize * 2;

    canv.style.height = canv.style.width = newSize.toString();
    const ctx: CanvasRenderingContext2D | null = canv.getContext('2d');

    if (ctx !== null) {
        ctx.imageSmoothingEnabled = false;
        ctx.imageSmoothingQuality = "high";
        try {
            ctx.drawImage(origin, 0, 0, newSize * 2, newSize * 2);
        } catch (e) {
            console.error(origin, e);
        }
        
        return canv;
    } else {
        return null;
    }
}

async function generateFacePic(commentData: SnooComment, ppBuffer: HTMLImageElement[], displaySize: number = 50): Promise<HTMLCanvasElement> {
    const imageSeed = Math.round(await rng.random(0, ppBuffer.length-1));
    const imageElement: HTMLImageElement = ppBuffer[imageSeed];

    // Purpose of copying: A single <img> tag cannot be in multiple spots at the same time
    // I did not find a way to duplicate the reference to an img tag 
    // If you use Element.appendChild with the same reference multiple times, the method will move the element around
    // Creating a new <img> tag and copying the attributes would work, but it would fetch the src again
    // The image at thispersondoesnotexist changes every second so the src points to a new picture now
    // Since the URL has a parameter and hasn't changed, then most likely, querying the URL again would
    //     hit the browser's cache. but we can't know that.
    // Solution: make a canvas and give it the single <img> reference. It makes a new one every time. It doesn't query the src.
    const canv = copyImage2Canvas(imageElement, displaySize);
    assert(canv !== null, `generateFacePic couldn't get a canvas 2D context from image #${imageSeed}, ${imageElement.src} (img.${Array.from(imageElement.classList).join(".")})`);

    canv.classList.add(`human-${imageSeed}`);
    return canv;
}

type HTMLProfilePictureElement = HTMLCanvasElement | HTMLImageElement | HTMLSpanElement;
async function createProfilePicture(commentData: SnooComment, size: number = 50, ppBuffer: HTMLImageElement[] = []): Promise<HTMLProfilePictureElement> {
    async function helper(): Promise<HTMLProfilePictureElement> {
        if (commentData.data.subreddit === "gnometalk") {
            return generateGnomePic();
        } else {
            // 0-10  => 0
            // 10-25 => Between 0 and 0.7
            // 25+   => 0.7
            // Don't replace this with a formula filled with Math.min(), 
            //    divisions and substractions, this is meant to be readable for a beginner
            const chanceForAFacePic = (() => {
                if (ppBuffer.length < 10) {
                    return 0;
                } else {
                    const baseValue = 0.7; // Max .7

                    // What percentage of progress are you between 10 and 25
                    if (ppBuffer.length >= 25) {
                        return baseValue;
                    } else {
                        return ((ppBuffer.length - 10)/15)*baseValue;
                    }
                }
            })();

            if ((await rng.random()) < chanceForAFacePic) {
                return generateFacePic(commentData, ppBuffer);
            } else {
                return generateTextPic(commentData, size);
            }
        }
    }

    const ppElem: HTMLProfilePictureElement = await helper();

    ppElem.classList.add("avatar")
    ppElem.style.marginRight = "10px";
    if (!ppElem.classList.contains("avatar-circle")) {
        ppElem.classList.add("avatar-circle");
    }
    return ppElem;
}

type CreateCommentOptions = {
    ppBuffer: HTMLImageElement[],
    domNode?: HTMLElement,
    postAuthor?: string
};
async function createComment(commentData: SnooComment, options: CreateCommentOptions={ppBuffer: []}): Promise<HTMLElement> {
    if (options.domNode === undefined) {
        options.domNode = document.createElement('div');
    }
    options.domNode.id = commentData.data.id;
    options.domNode.classList.add("usertext");

    // Author parent div
    const author = document.createElement('div');
    author.classList.add("author")
    author.style.display = "flex";

    await rng.setSeed(commentData.data.author);
    
    // Placeholder pic
    const ppSize = 50; //px
    const pfpPlaceHolder = document.createElement<"span">("span");
    pfpPlaceHolder.style.width = pfpPlaceHolder.style.height = `${ppSize}px`;
    author.appendChild(pfpPlaceHolder);

    // Real Profile pic
    createProfilePicture(commentData, ppSize, options.ppBuffer).then( (generatedPfp) => {
        author.replaceChild(generatedPfp, pfpPlaceHolder);
    });

    // Author's name and sent date
    let authorText = document.createElement("div");
    authorText.classList.add("author-text")
    authorText.style.display = "flex";
    authorText.style.flexDirection = "column";
    {
        // Name
        let authorTextInfo = document.createElement("span");
        authorTextInfo.classList.add("username")
        authorTextInfo.classList.add("email")
        const scoreLength = (""+commentData.data.score).length
        
        // Email addresses are composed of uuids and hide the score within the first block
        const format: UUIDFormat = [
            { n: 8, charset: "alpha" }, // // First section is only letters to avoid ambiguity on the score
            { n: 4, charset: "alphanumerical" },
            { n: 4, charset: "alphanumerical" },
            { n: 4, charset: "alphanumerical" },
            { n: 12, charset: "alphanumerical" }
        ];
        rng.randomUUID(format).then((uuid: UUID) => {
            const slicedUUID = uuid.slice(scoreLength); // Remove a bunch of letters from the start
            const isSubmitterFlag = "is_submitter" in commentData.data && commentData.data.is_submitter === true;
            const isCommentByPostOwner = isSubmitterFlag
                || (
                    options.postAuthor !== undefined
                    && commentData.data.author.toLowerCase() === options.postAuthor.toLowerCase()
                );
            const ownerCrown = isCommentByPostOwner ? ' <span class="op-crown">👑</span>' : '';

            // We overwrite the 1st section with the comment's score
            if (localStorage.getItem('showLongAddress') == 'true' || localStorage.getItem('showLongAddress') == null) {
                authorTextInfo.innerHTML = `${commentData.data.author} <${commentData.data.score}${slicedUUID}@securemail.org>${ownerCrown}`;
            } else {
                authorTextInfo.innerHTML = `u/${commentData.data.author} (${commentData.data.score})${ownerCrown}`;
                authorTextInfo.title = `&lt;${commentData.data.author}@reddit.com&gt;`
            }
        })
        authorText.append(authorTextInfo);

        // Sent date
        let d = new Date(commentData.data.created_utc*1000);
        const dateDiv = document.createElement("span");
        dateDiv.classList.add("comment-posted-date")
        dateDiv.innerHTML = d.toString().slice(0,21);
        dateDiv.style.color = "#a2a2a2";
        dateDiv.style.fontSize = "0.85em";
        authorText.append(dateDiv);
    }
    author.append(authorText);

    const commentText = document.createElement('div');
    commentText.classList.add("comment");
    commentText.insertAdjacentHTML('beforeend', embedRedditImages(decodeHTML(commentData.data.body_html)));

    options.domNode.prepend(author, commentText);
    return options.domNode
}

type SerializedHTML = string;
function decodeHTML(html: SerializedHTML): SerializedHTML {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}

function clearPost() {
    postSection.innerHTML = '';
    sortMenu.style.display = 'none';
    sortTopMenu.style.display = 'none';
    sortButton.classList.remove('opened');
    subredditInfoContainer.style.display = 'none';
    headerButtons.style.borderRadius = "4px 4px 0px 0px";
}

function clearPostSection() {
    postSection.innerHTML = '';
}

function clearPostsList() {
    if (postsList !== null) {
        postsList.innerHTML = '';
        setLoadMoreIndicatorVisible(false);
        setEndOfFeedMessageVisible(false);
        subredditInfoContainer.style.display = 'none';
        headerButtons.style.borderRadius = "4px 4px 0px 0px";
    }
}


const searchForm: HTMLFormElement = strictQuerySelector('form');
const subredditName: HTMLInputElement = strictQuerySelector('input');
const subredditSection: HTMLElement = strictQuerySelector('.your-subreddits')

searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showSubreddit(subredditName.value);
    (document.querySelector('.search-results') as HTMLElement).style.display = 'none';
})

function displaySavedSubreddits() {
    let savedSubreddits = getSavedSubreddits()    
    if (savedSubreddits) {
        for (let savedSubreddit of savedSubreddits) {
            let subredditBtn = document.createElement('button');
            subredditBtn.classList.add('subreddit', 'button');
            subredditBtn.id = savedSubreddit;
            subredditBtn.addEventListener('click', async () => {
                clearPost();
                if (isDebugMode()) console.log("custom sub click", subredditBtn.id);
                setURLAnchor(`/r/${subredditBtn.id}`);
                showSubreddit(subredditBtn.id);
            })
            subredditBtn.append('r/' + savedSubreddit);
            subredditSection.append(subredditBtn);
        }
    }
}

function getSavedSubreddits() {
    if (localStorage.getItem('savedSubreddits')) {
        let savedSubreddits = localStorage.getItem('savedSubreddits');
        return savedSubreddits.split(',');
    } else {
        return false
    }
    
}

// noinspection JSUnusedLocalSymbols
function removeSavedSubreddit(subreddit) {
    let savedSubreddits = getSavedSubreddits();
    if (savedSubreddits) {
        savedSubreddits = savedSubreddits.filter(function(e) { return e !== subreddit });
        localStorage.setItem('savedSubreddits', savedSubreddits.toString());
    }
}

displaySavedSubreddits();

const popularSubreddits: NodeListOf<HTMLButtonElement> = document.querySelectorAll('.popular-subreddits>button')

for (let subreddit of popularSubreddits) {
    subreddit.addEventListener('click', async () => {
        if (isDebugMode()) console.log("default sub click", subreddit.id);
        setURLAnchor(`/r/${subreddit.id}`);
        clearPost();
        showSubreddit(subreddit.id);
    })
}

const inboxButton: HTMLElement = strictQuerySelector('.inbox-button');
inboxButton.addEventListener('click', async () => {
    if (isDebugMode()) console.log("inbox click", "/r/popular");
    setURLAnchor("/r/popular");
    clearPost();
    showSubreddit('popular');
})

function isHTMLElement(obj: any): obj is HTMLElement {
    return (typeof obj === "object") && (obj as HTMLElement).style !== undefined;
}

let collapsible: NodeListOf<HTMLElement> = document.querySelectorAll(".collapsible");
for (let coll of collapsible) {
    coll.addEventListener("click", function() {
        let content = this?.nextElementSibling;
        if (!isHTMLElement(content)) {
            return;
        }
        
        let nextSibling = this?.firstChild?.nextSibling;
        if (!isHTMLElement(nextSibling)) {
            return;
        }
        
        if (content.style.display === "none") {
            nextSibling.classList.remove('ms-Icon--ChevronRight')
            nextSibling.classList.add('ms-Icon--ChevronDownMed')
            content.style.display = "block";
        } else {
            nextSibling.classList.remove('ms-Icon--ChevronDownMed')
            nextSibling.classList.add('ms-Icon--ChevronRight')
            content.style.display = "none";
        }
    });
}

const BORDER_SIZE = 8;
const panel: HTMLElement = strictQuerySelector(".post-sidebar");

// Add a visible resize handle to the right edge
let resizeHandle = document.createElement('div');
resizeHandle.className = 'resize-handle';
panel.appendChild(resizeHandle);

let isResizing = false;
let startX = 0;
let startWidth = 0;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;

resizeHandle.addEventListener('mousedown', function(e: MouseEvent) {
    isResizing = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
});

document.addEventListener('mousemove', function(e: MouseEvent) {
    if (!isResizing) return;
    let newWidth = startWidth + (e.clientX - startX);
    if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
    if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;
    panel.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', function() {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
    }
});

let settingsButton: HTMLElement = strictQuerySelector('.settings-button');
let settingsPanel: HTMLElement = strictQuerySelector('.settings-panel');

settingsButton.addEventListener('click', () => {
    profilePanel.classList.remove('profile-panel-show');
    settingsPanel.classList.toggle('settings-panel-show');
})

let closeButton: HTMLElement = strictQuerySelector('.close-settings');

closeButton.addEventListener('click', () => {
    settingsPanel.classList.remove('settings-panel-show');
})


const checkbox: HTMLInputElement = strictQuerySelector('#flexSwitchCheckChecked');
checkbox.addEventListener('change', function() {
    const body = strictQuerySelector('body');
    if (checkbox.checked) {
        body.classList.remove('light')
        body.classList.add('dark')
        localStorage.setItem('isDarkMode', 'true');
    } else {
        body.classList.remove('dark')
        body.classList.add('light')
        localStorage.setItem('isDarkMode', 'false');
    }
})

function setDarkMode() {
    if (localStorage.getItem('isDarkMode') == 'true') {
        checkbox.checked = true;
        strictQuerySelector('body').classList.remove('light');
        strictQuerySelector('body').classList.add('dark');
    } else if (localStorage.getItem('isDarkMode') == 'false') {
        strictQuerySelector('body').classList.remove('dark');
        strictQuerySelector('body').classList.add('light');
        checkbox.checked = false;
    }    
}

const checkbox2: HTMLInputElement = strictQuerySelector('#show-subreddit-details');
checkbox2.addEventListener('change', function() {
    const subredditInfoElement = document.querySelector('.subreddit-info') as HTMLElement | null;
    if (checkbox2.checked) {
        localStorage.setItem('showSubDetails', 'true');
        if (subredditInfoElement) {
            subredditInfoElement.style.display = 'flex';
        }
        scrollable.style.height = 'calc(100vh - 273px)';
    } else {
        localStorage.setItem('showSubDetails', 'false');
        if (subredditInfoElement) {
            subredditInfoElement.style.display = 'none';
        }
        subredditInfoContainer.style.display = 'none';
        headerButtons.style.borderRadius = "4px 4px 0px 0px";
        scrollable.style.height = 'calc(100vh - 178px)';
    }
})

function showSubredditDetails() {
    if (localStorage.getItem('showSubDetails') == 'true') {
        checkbox2.checked = true;
    } else if (localStorage.getItem('showSubDetails') == 'false') {
        checkbox2.checked = false;
    }    
}

const checkbox3: HTMLInputElement = strictQuerySelector('#show-long-emails');
checkbox3.addEventListener('change', function() {
    if (checkbox3.checked) {
        localStorage.setItem('showLongAddress', 'true');
    } else {
        localStorage.setItem('showLongAddress', 'false');
    }
})

function showLongAddress() {
    if (localStorage.getItem('showLongAddress') == 'true') {
        checkbox3.checked = true;
    } else if (localStorage.getItem('showLongAddress') == 'false') {
        checkbox3.checked = false;
    }    
}

const defaultSubredditSortSelect: HTMLSelectElement = strictQuerySelector('#default-subreddit-sort');
const defaultSubredditTopTimeContainer: HTMLElement = strictQuerySelector('#default-subreddit-top-time-container');
function syncDefaultSubredditTopTimeVisibility(): void {
    const showTopTime = defaultSubredditSortSelect.value === "top";
    defaultSubredditTopTimeContainer.style.display = showTopTime ? "block" : "none";
    defaultSubredditTopTimeSelect.disabled = !showTopTime;
}

defaultSubredditSortSelect.addEventListener('change', function() {
    const selectedSort = defaultSubredditSortSelect.value;
    if (subredditSortOptions.some((option) => option.value === selectedSort)) {
        localStorage.setItem('defaultSubredditSort', selectedSort);
    } else {
        localStorage.setItem('defaultSubredditSort', defaultSubredditSort);
        defaultSubredditSortSelect.value = defaultSubredditSort;
    }
    syncDefaultSubredditTopTimeVisibility();
})

const defaultSubredditTopTimeSelect: HTMLSelectElement = strictQuerySelector('#default-subreddit-top-time');
defaultSubredditTopTimeSelect.addEventListener('change', function() {
    const selectedTopTime = defaultSubredditTopTimeSelect.value;
    if (subredditTopTimeOptions.some((option) => option.value === selectedTopTime)) {
        localStorage.setItem('defaultSubredditTopTime', selectedTopTime);
    } else {
        localStorage.setItem('defaultSubredditTopTime', defaultSubredditTopTime);
        defaultSubredditTopTimeSelect.value = defaultSubredditTopTime;
    }
})

function setDefaultSubredditSortUI() {
    defaultSubredditSortSelect.value = getDefaultSubredditSort();
    defaultSubredditTopTimeSelect.value = getDefaultSubredditTopTime();
    syncDefaultSubredditTopTimeVisibility();
}

const defaultCommentSortSelect: HTMLSelectElement = strictQuerySelector('#default-comment-sort');
defaultCommentSortSelect.addEventListener('change', function() {
    const selectedSort = defaultCommentSortSelect.value;
    if (commentSortOptions.some((option) => option.value === selectedSort)) {
        localStorage.setItem('defaultCommentSort', selectedSort);
    } else {
        localStorage.setItem('defaultCommentSort', defaultCommentSort);
        defaultCommentSortSelect.value = defaultCommentSort;
    }
})

function setDefaultCommentSortUI() {
    const savedSort = getDefaultCommentSort();
    defaultCommentSortSelect.value = savedSort;
}

const checkbox4: HTMLInputElement = strictQuerySelector('#hide-media');
checkbox4.addEventListener('change', function() {
    const postImage = document.querySelector('.post-image') as HTMLElement | null;
    const postVideo = document.querySelector('.post-video') as HTMLElement | null;
    if (checkbox4.checked) {
        localStorage.setItem('hideMedia', 'true');
        if (postImage) {
            postImage.style.display = 'none';
        } else if (postVideo) {
            postVideo.style.display = 'none';
        }
    } else {
        localStorage.setItem('hideMedia', 'false');
        if (postImage) {
            postImage.style.display = 'block';
        } else if (postVideo) {
            postVideo.style.display = 'block';
        }
    }
})

function hideMedia() {
    const hideMediaSetting = localStorage.getItem('hideMedia');
    const redditPostImage = document.querySelector('.reddit-post img') as HTMLElement | null;
    const postImage = document.querySelector('.post-image') as HTMLElement | null;
    const postVideo = document.querySelector('.post-video') as HTMLElement | null;
    if (hideMediaSetting == 'true') {
        checkbox4.checked = true;
        if (redditPostImage) {
            redditPostImage.style.visibility = 'hidden';
        }
        if (postImage) {
            postImage.style.visibility = 'hidden';
        } else if (postVideo) {
            postVideo.style.visibility = 'hidden';
        }
    } else if (hideMediaSetting == 'false') {
        checkbox4.checked = false;
        if (redditPostImage) {
            redditPostImage.style.visibility = 'visible';
        }
        if (postImage) {
            postImage.style.visibility = 'visible';
        } else if (postVideo) {
            postVideo.style.visibility = 'visible';
        }
    }
}

let spoilerTexts = document.querySelectorAll('span.md-spoiler-text') as NodeListOf<HTMLElement>;
if (spoilerTexts) {
    for (let spoilerText of spoilerTexts) {
        spoilerText.addEventListener('click', function () {
            spoilerText.classList.add('hello');
        });
    }
}

let sidebarButtons = document.querySelectorAll('.collapses button, .subreddit.button') as NodeListOf<HTMLElement>;
for (let sidebarButton of sidebarButtons) {
    sidebarButton.addEventListener('click', (event) => {
        event.stopPropagation();
        for (let allsidebarButton of sidebarButtons) {
            allsidebarButton.classList.remove('selected');
        }
        sidebarButton.classList.add('selected');
    })
}

let pageTitleInputForm = document.querySelector('.page-title-input-form') as HTMLInputElement;
let pageTitleInputBox = document.querySelector('.page-title-input-box') as HTMLInputElement;

pageTitleInputForm.addEventListener('submit', (event) => {
    event.preventDefault();
    localStorage.setItem('pageTitle', pageTitleInputBox.value);
    document.title = pageTitleInputBox.value;
})

function setPageTitle() {
    if (localStorage.getItem('pageTitle')) {
        document.title = localStorage.getItem('pageTitle');
    }
}

function generateRandomAvatarSeed(): string {
    const randomPart = Math.random().toString(36).slice(2, 10);
    const timestampPart = Date.now().toString(36).slice(-6);
    return `${randomPart}${timestampPart}`;
}

function setDynamicProfileAvatars(): void {
    const avatarSeed = generateRandomAvatarSeed();
    const avatarUrl = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${avatarSeed}&backgroundColor=ffffff`;
    const avatarImages = document.querySelectorAll<HTMLImageElement>('.dynamic-dicebear-avatar');
    avatarImages.forEach((img) => {
        img.src = avatarUrl;
    });
}

window.addEventListener("hashchange", () => {
    clearPost();
    const permalink = permalinkFromURLAnchor();
    if (isDebugMode()) console.log(`history buttons clicked`, permalink);
    showRedditPageOrDefault(permalink);
});

let scrollQueued = false;
postsList.addEventListener('scroll', () => {
    if (scrollQueued) {
        return;
    }
    scrollQueued = true;
    requestAnimationFrame(() => {
        scrollQueued = false;
        maybeLoadMorePostsOnScroll();
    });
}, { passive: true });

let profileButton: HTMLElement = strictQuerySelector('.profile-button');
let profilePanel: HTMLElement = strictQuerySelector('.profile-panel');

profileButton.addEventListener('click', () => {
    settingsPanel.classList.remove('settings-panel-show');
    profilePanel.classList.toggle('profile-panel-show');
})


document.addEventListener('click', function handleClickOutsideBox(event) {
    const searchResults = document.querySelector('.search-results') as HTMLElement;
    let target = event.target as Node;

    // hdie search results/open menus if user clicks out of it
	if (!searchResults.contains(target)) {hideSearchResults()}
});



let inputBox = document.querySelector(".search") as HTMLInputElement;
const searchResultsElement: HTMLElement = strictQuerySelector('.search-results');
type SearchSubredditRecord = {
    subreddit: string;
    subredditLower: string;
    members: number;
    icon: string;
    isNSFW: boolean;
}

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
        const searchUrl = `${redditBaseURL}/subreddits/search.json?limit=${limit}&include_over_18=on&q=${encodeURIComponent(query)}`;
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

    // Backup mode: local static list when remote search is empty/unavailable.
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

if (subredditName) {
    subredditName.addEventListener('input', function() {
        debouncedRunSubredditSearch(inputBox.value);
  });
}

function displaySearchResults(results) {
    searchResultsElement.style.display = 'block';
    searchResultsElement.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const result of results) {
        const link = document.createElement('a');
        link.href = `#/r/${result.subreddit}`;
        link.classList.add('search-result-link');
        link.addEventListener('click', () => {
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

    searchResultsElement.append(fragment);
}

let addSubreddit = document.querySelector('.add-subreddit-button') as HTMLElement;
if (addSubreddit) {
    addSubreddit.addEventListener('click', (event) => {
        console.log('inner button clicked');
        event.stopPropagation();
    })
}


function hideSearchResults() {
    searchResultsElement.style.display = 'none';
}

function prefetchSearchIndexOnIdle(): void {
    if (indexedSubredditsCache !== null || indexedSubredditsPromise !== null) {
        return;
    }
    getIndexedSubreddits().catch(() => {
        // Non-critical optimization; ignore prefetch failures.
    });
}

function numberFormatter(number) {
	let num = parseInt(number)
    return Math.abs(num) > 999999 ? Math.sign(num)*Number((Math.abs(num)/1000000).toFixed(1)) + 'm' : Math.sign(num)*Number((Math.abs(num)/1000).toFixed(1)) + 'k'
}

setDarkMode();  
showSubredditDetails();
showLongAddress();
setDefaultSubredditSortUI();
setDefaultCommentSortUI();
applySavedTheme();
setDisplayDensity();
hideMedia();
setPageTitle();
setDynamicProfileAvatars();

// Everything set up.
// We start actually doing things now

if (isDebugMode()) {
    // Remove loading screen
    const loadingScreen = document.getElementById("loadingScreen");
    if (loadingScreen) {
        loadingScreen.style.display = "none";
    }
}

const permalink = permalinkFromURLAnchor();
showRedditPageOrDefault(permalink);

if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(() => {
        prefetchSearchIndexOnIdle();
    }, {timeout: 2500});
} else {
    setTimeout(() => {
        prefetchSearchIndexOnIdle();
    }, 1200);
}


