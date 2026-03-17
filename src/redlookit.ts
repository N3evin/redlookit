import "../styles/redlookit.css"
import "./@types/reddit-types.ts"
import {HumanFacesSideLoader} from "./facesSideloader"
import {Random, UUID, UUIDFormat} from "./random";
import {isMediaHidden} from "./mediaUtils";
import {fetchData} from "./networkUtils";
import {setVoteDisplay} from "./voteUtils";
import {displayComments} from "./comments";
import {getAnalyticsContext, trackEvent, trackRouteView, trackSettingChange} from "./analyticsUtils";
import {decodeHTML, isHTMLElement, strictQuerySelector} from "./domQueryUtils";
import {getPostIdFromPermalink, parsePermalinkForAnalytics, permalinkFromURLAnchor, removeTrailingSlash, setURLAnchor, type Permalink} from "./routingUtils";
import {commentSortOptions, defaultCommentSort, defaultSubredditSort, defaultSubredditTopTime, getDefaultCommentSort, getDefaultSubredditPostSortQuery, getDefaultSubredditSort, getDefaultSubredditTopTime, getSavedSubredditSet, getSavedSubreddits, subredditSortOptions, subredditTopTimeOptions} from "./settingsStore";
import {getSubredditIcon, numberFormatter} from "./subredditFormatUtils";
import {createImage, embedRedditImages, getPostDetails, hasSelfText, isImage, isSelfPost, isValidAbsoluteImageURL} from "./postRendering";
import {createSubredditSearchController} from "./subredditSearch";
import {
    hideMedia as applyHideMediaSetting,
    setDarkMode as applyDarkModeSetting,
    setDefaultCommentSortUI as applyDefaultCommentSortUI,
    setDefaultSubredditSortUI as applyDefaultSubredditSortUI,
    setDynamicProfileAvatars,
    setPageTitle,
    showLongAddress as applyShowLongAddressSetting,
    showSubredditDetails as applyShowSubredditDetailsSetting,
    syncDefaultSubredditTopTimeVisibility as applyTopTimeVisibility
} from "./settings";
import {buildSubredditListingURL, isSameSubredditQuery, type ActiveSubredditQuery} from "./feedLoader";

function isDebugMode(): boolean {
    // Won't support ipv6 loopback
    const url = new URL(document.URL);
    return url.protocol === "file:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
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
const subredditPagingState: {
    query: ActiveSubredditQuery | null
    after: string | null
    pageIndex: number
    isLoading: boolean
    hasMore: boolean
    subredditInformation: SubredditDetails | null
} = {
    query: null,
    after: null,
    pageIndex: 0,
    isLoading: false,
    hasMore: true,
    subredditInformation: null
};

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
    subredditPagingState.pageIndex = 0;
    subredditPagingState.isLoading = false;
    subredditPagingState.hasMore = true;
    subredditPagingState.subredditInformation = null;
    setLoadMoreIndicatorVisible(false);
    setEndOfFeedMessageVisible(false);
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
        const url = buildSubredditListingURL(query, redditBaseURL, subredditPageLimit, subredditPagingState.after);
        const posts = await fetchData<Listing<Post>>(url);
        if (!isSameSubredditQuery(subredditPagingState.query, query)) {
            return;
        }
        displayPosts(
            posts.data.children,
            query.subreddit,
            subredditPagingState.subredditInformation === null ? undefined : subredditPagingState.subredditInformation
        );
        if (posts.data.children.length > 0) {
            subredditPagingState.pageIndex += 1;
            trackEvent("load_more_posts", {
                ...getAnalyticsContext(),
                subreddit: query.subreddit.toLowerCase(),
                tab: query.tab,
                top_time: query.sortType ?? "none",
                page_index: subredditPagingState.pageIndex
            });
        }
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
    syncSubredditSortIndicator(query);
    resetSubredditPaging(query);
    subredditPagingState.isLoading = true;
    try {
        const url = buildSubredditListingURL(query, redditBaseURL, subredditPageLimit, null);
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
        subredditPagingState.pageIndex = posts.data.children.length > 0 ? 1 : 0;
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
    trackEvent("change_subreddit_sort", {
        ...getAnalyticsContext(),
        subreddit: subreddit.toLowerCase(),
        tab: defaultSort.tab,
        top_time: defaultSort.sortType ?? "none",
        source: "default_setting"
    });
    await loadInitialSubredditPosts({
        subreddit,
        tab: defaultSort.tab,
        sortType: defaultSort.sortType,
        useBaseListingPath: defaultSort.tab === "hot" && defaultSort.sortType === null
    });
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
    for (const [postPosition, response] of responses.entries()) {
        let section: HTMLButtonElement = document.createElement('button');
        section.classList.add('post');

        let title = document.createElement('span');
        let titleText = decodeHTML(response.data.title);
        title.append(titleText);
        section.title = titleText;
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
            trackEvent("open_post", {
                ...getAnalyticsContext(),
                subreddit: response.data.subreddit.toLowerCase(),
                post_id: getPostIdFromPermalink(response.data.permalink),
                post_position: postPosition + 1
            });
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
        trackEvent("favorite_subreddit", {
            ...getAnalyticsContext(),
            subreddit: favoriteIcon.id.toLowerCase(),
            action: "add"
        });
        favoriteSubreddit(favoriteIcon.id);
    } else {
        favoriteIconClasses.remove('favorited');
        trackEvent("favorite_subreddit", {
            ...getAnalyticsContext(),
            subreddit: favoriteIcon.id.toLowerCase(),
            action: "remove"
        });
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

function syncSubredditSortIndicator({tab, sortType}: Pick<ActiveSubredditQuery, "tab" | "sortType">): void {
    const sortButtons = document.querySelectorAll<HTMLElement>(".sort-button");
    sortButtons.forEach((button) => {
        button.classList.remove("active-sort");
    });

    const activeMainButton = document.querySelector<HTMLElement>(`.sort-button.${tab}`);
    activeMainButton?.classList.add("active-sort");

    if (tab !== "top") {
        return;
    }

    const topSortTypeToClass: Record<string, string> = {
        day: "today",
        week: "week",
        month: "month",
        year: "year",
        all: "all-time"
    };
    if (sortType !== null && sortType in topSortTypeToClass) {
        const activeTopButton = document.querySelector<HTMLElement>(`.sort-button.${topSortTypeToClass[sortType]}`);
        activeTopButton?.classList.add("active-sort");
    }
}

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
            trackSettingChange("currentTheme", themeName);
        } else {
            theme.classList.remove('selected');
            document.body.classList.remove(themeName);
            localStorage.setItem('currentTheme', '');
            trackSettingChange("currentTheme", "defaultTheme");
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
    trackSettingChange("displayDensity", "roomy");
    cozyButton.classList.remove('selected');
    compactButton.classList.remove('selected');
    roomyButton.classList.add('selected');
    document.body.classList.remove('cozy', 'compact');
    document.body.classList.add('roomy');
})

cozyButton.addEventListener('click', function() {
    localStorage.setItem('displayDensity', 'cozy');
    trackSettingChange("displayDensity", "cozy");
    roomyButton.classList.remove('selected');
    compactButton.classList.remove('selected');
    cozyButton.classList.add('selected');
    document.body.classList.remove('compact', 'roomy');
    document.body.classList.add('cozy');
})

compactButton.addEventListener('click', function() {
    localStorage.setItem('displayDensity', 'compact');
    trackSettingChange("displayDensity", "compact");
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
    trackEvent("change_subreddit_sort", {
        ...getAnalyticsContext(),
        subreddit: subreddit.toLowerCase(),
        tab: tab,
        top_time: sortType ?? "none",
        source: "menu"
    });
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
    const postId = post.data.id ?? getPostIdFromPermalink(post.data.permalink);
    const subredditName = post.data.subreddit.toLowerCase();

    const trackExternalLink = (destinationUrl: string, surface: string, targetBlank: boolean): void => {
        try {
            const parsedDestination = new URL(destinationUrl, window.location.href);
            trackEvent("open_external_link", {
                ...getAnalyticsContext(),
                post_id: postId,
                subreddit: subredditName,
                link_surface: surface,
                destination_host: parsedDestination.host.toLowerCase(),
                target_blank: targetBlank
            });
        } catch (_) {
            return;
        }
    };

    const trackMediaInteraction = (mediaType: "image" | "video", interactionType: "click" | "play" | "pause", mediaSurface: "post_media" | "selftext_embed", mediaUrl: string): void => {
        try {
            const parsedMedia = new URL(mediaUrl, window.location.href);
            trackEvent("media_interaction", {
                ...getAnalyticsContext(),
                post_id: postId,
                subreddit: subredditName,
                media_type: mediaType,
                interaction_type: interactionType,
                media_surface: mediaSurface,
                media_host: parsedMedia.host.toLowerCase()
            });
        } catch (_) {
            return;
        }
    };

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
            trackEvent("change_comment_sort", {
                ...getAnalyticsContext(),
                post_id: getPostIdFromPermalink(permalink),
                sort: sortSelect.value
            });
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
    const titleText = decodeHTML(post.data.title);
    titleLink.href = `${redditBaseURL}${post.data.permalink}`;
    titleLink.append(titleText);
    titleLink.addEventListener("click", () => {
        trackExternalLink(titleLink.href, "post_title", titleLink.target === "_blank");
    });
    title.classList.add('post-section-title');
    postSection.append(title);

    const container = document.createElement('div');
    container.classList.add('post-contents')
    postSection.append(container);

    if (isImage(post)) {
        if (isDebugMode()) console.log("Post is image");
        const image = createImage(post.data.url_overridden_by_dest);
        if (image) {
            image.addEventListener("click", () => {
                trackMediaInteraction("image", "click", "post_media", image.src);
            });
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
        link.addEventListener("click", () => {
            trackExternalLink(link.href, "post_link_row", link.target === "_blank");
        });
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
        selftext.addEventListener("click", (event) => {
            const targetElement = event.target as HTMLElement | null;
            if (targetElement === null) {
                return;
            }
            const clickedLink = targetElement.closest("a");
            if (clickedLink !== null) {
                const anchor = clickedLink as HTMLAnchorElement;
                trackExternalLink(anchor.href, "selftext", anchor.target === "_blank");
                return;
            }
            const clickedImage = targetElement.closest("img.post-image");
            if (clickedImage !== null) {
                const img = clickedImage as HTMLImageElement;
                trackMediaInteraction("image", "click", "selftext_embed", img.src);
            }
        });
    
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
        video.addEventListener("play", () => {
            trackMediaInteraction("video", "play", "post_media", source.src);
        });
        video.addEventListener("pause", () => {
            trackMediaInteraction("video", "pause", "post_media", source.src);
        });
        if (!isMediaHidden()) {
            container.append(video);
        }
    }
    
    const postDetails = getPostDetails(response)
    postSection.append(...postDetails)
    postSection.appendChild(sortSelect);
    postSection.append(document.createElement('hr'));

    const stableInTimeFaceBuffer = facesSideLoader.getFaces().slice(0);
    displayComments(
        comments,
        { post: post.data.permalink, postAuthor: post.data.author },
        stableInTimeFaceBuffer,
        {
            postSection,
            redditBaseURL,
            rng,
            colors,
            initials,
            isDebugMode,
            trackEvent,
            getAnalyticsContext,
            renderCommentBodyHtml: embedRedditImages
        }
    );
}

document.body.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        clearPostSection();
    }
})

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
    const normalizedSubreddit = subredditName.value.trim().toLowerCase().replace(/^r\//, "");
    trackEvent("search_subreddit", {
        ...getAnalyticsContext(),
        results_count: document.querySelectorAll(".search-result-link").length,
        used_suggestion: false,
        ...(normalizedSubreddit !== "" ? { selected_subreddit: normalizedSubreddit } : {})
    });
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
    if (settingsPanel.classList.contains('settings-panel-show')) {
        trackEvent("open_panel", {
            ...getAnalyticsContext(),
            panel: "settings"
        });
    }
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
        trackSettingChange("isDarkMode", true);
    } else {
        body.classList.remove('dark')
        body.classList.add('light')
        localStorage.setItem('isDarkMode', 'false');
        trackSettingChange("isDarkMode", false);
    }
})

const checkbox2: HTMLInputElement = strictQuerySelector('#show-subreddit-details');
checkbox2.addEventListener('change', function() {
    const subredditInfoElement = document.querySelector('.subreddit-info') as HTMLElement | null;
    if (checkbox2.checked) {
        localStorage.setItem('showSubDetails', 'true');
        trackSettingChange("showSubDetails", true);
        if (subredditInfoElement) {
            subredditInfoElement.style.display = 'flex';
        }
        scrollable.style.height = 'calc(100vh - 273px)';
    } else {
        localStorage.setItem('showSubDetails', 'false');
        trackSettingChange("showSubDetails", false);
        if (subredditInfoElement) {
            subredditInfoElement.style.display = 'none';
        }
        subredditInfoContainer.style.display = 'none';
        headerButtons.style.borderRadius = "4px 4px 0px 0px";
        scrollable.style.height = 'calc(100vh - 178px)';
    }
})

const checkbox3: HTMLInputElement = strictQuerySelector('#show-long-emails');
checkbox3.addEventListener('change', function() {
    if (checkbox3.checked) {
        localStorage.setItem('showLongAddress', 'true');
        trackSettingChange("showLongAddress", true);
    } else {
        localStorage.setItem('showLongAddress', 'false');
        trackSettingChange("showLongAddress", false);
    }
})

const defaultSubredditSortSelect: HTMLSelectElement = strictQuerySelector('#default-subreddit-sort');
const defaultSubredditTopTimeContainer: HTMLElement = strictQuerySelector('#default-subreddit-top-time-container');
defaultSubredditSortSelect.addEventListener('change', function() {
    const selectedSort = defaultSubredditSortSelect.value;
    if (subredditSortOptions.some((option) => option.value === selectedSort)) {
        localStorage.setItem('defaultSubredditSort', selectedSort);
        trackSettingChange("defaultSubredditSort", selectedSort);
    } else {
        localStorage.setItem('defaultSubredditSort', defaultSubredditSort);
        defaultSubredditSortSelect.value = defaultSubredditSort;
        trackSettingChange("defaultSubredditSort", defaultSubredditSort);
    }
    applyTopTimeVisibility(defaultSubredditSortSelect, defaultSubredditTopTimeContainer, defaultSubredditTopTimeSelect);
})

const defaultSubredditTopTimeSelect: HTMLSelectElement = strictQuerySelector('#default-subreddit-top-time');
defaultSubredditTopTimeSelect.addEventListener('change', function() {
    const selectedTopTime = defaultSubredditTopTimeSelect.value;
    if (subredditTopTimeOptions.some((option) => option.value === selectedTopTime)) {
        localStorage.setItem('defaultSubredditTopTime', selectedTopTime);
        trackSettingChange("defaultSubredditTopTime", selectedTopTime);
    } else {
        localStorage.setItem('defaultSubredditTopTime', defaultSubredditTopTime);
        defaultSubredditTopTimeSelect.value = defaultSubredditTopTime;
        trackSettingChange("defaultSubredditTopTime", defaultSubredditTopTime);
    }
})

const defaultCommentSortSelect: HTMLSelectElement = strictQuerySelector('#default-comment-sort');
defaultCommentSortSelect.addEventListener('change', function() {
    const selectedSort = defaultCommentSortSelect.value;
    if (commentSortOptions.some((option) => option.value === selectedSort)) {
        localStorage.setItem('defaultCommentSort', selectedSort);
        trackSettingChange("defaultCommentSort", selectedSort);
    } else {
        localStorage.setItem('defaultCommentSort', defaultCommentSort);
        defaultCommentSortSelect.value = defaultCommentSort;
        trackSettingChange("defaultCommentSort", defaultCommentSort);
    }
})

const checkbox4: HTMLInputElement = strictQuerySelector('#hide-media');
checkbox4.addEventListener('change', function() {
    const postImage = document.querySelector('.post-image') as HTMLElement | null;
    const postVideo = document.querySelector('.post-video') as HTMLElement | null;
    if (checkbox4.checked) {
        localStorage.setItem('hideMedia', 'true');
        trackSettingChange("hideMedia", true);
        if (postImage) {
            postImage.style.display = 'none';
        } else if (postVideo) {
            postVideo.style.display = 'none';
        }
    } else {
        localStorage.setItem('hideMedia', 'false');
        trackSettingChange("hideMedia", false);
        if (postImage) {
            postImage.style.display = 'block';
        } else if (postVideo) {
            postVideo.style.display = 'block';
        }
    }
})

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
    trackSettingChange("pageTitle", "custom");
    document.title = pageTitleInputBox.value;
})

window.addEventListener("hashchange", () => {
    clearPost();
    const permalink = permalinkFromURLAnchor();
    if (isDebugMode()) console.log(`history buttons clicked`, permalink);
    trackRouteView(permalink);
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
    if (profilePanel.classList.contains('profile-panel-show')) {
        trackEvent("open_panel", {
            ...getAnalyticsContext(),
            panel: "profile"
        });
    }
})


const inputBox = document.querySelector(".search") as HTMLInputElement;
const searchResultsElement: HTMLElement = strictQuerySelector('.search-results');
const searchController = createSubredditSearchController({
    redditBaseURL,
    searchResultsElement,
    trackEvent,
    getAnalyticsContext
});

document.addEventListener('click', function handleClickOutsideBox(event) {
    const searchResults = document.querySelector('.search-results') as HTMLElement;
    let target = event.target as Node;
    if (!searchResults.contains(target)) {
        searchController.hideSearchResults();
    }
});

if (subredditName) {
    subredditName.addEventListener('input', function() {
        searchController.debouncedRunSubredditSearch(inputBox.value);
  });
}

let addSubreddit = document.querySelector('.add-subreddit-button') as HTMLElement;
if (addSubreddit) {
    addSubreddit.addEventListener('click', (event) => {
        console.log('inner button clicked');
        event.stopPropagation();
    })
}


applyDarkModeSetting(checkbox);
applyShowSubredditDetailsSetting(checkbox2);
applyShowLongAddressSetting(checkbox3);
applyDefaultSubredditSortUI(defaultSubredditSortSelect, defaultSubredditTopTimeSelect, getDefaultSubredditSort, getDefaultSubredditTopTime);
applyTopTimeVisibility(defaultSubredditSortSelect, defaultSubredditTopTimeContainer, defaultSubredditTopTimeSelect);
applyDefaultCommentSortUI(defaultCommentSortSelect, getDefaultCommentSort);
applySavedTheme();
setDisplayDensity();
applyHideMediaSetting(checkbox4);
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
trackRouteView(permalink);
showRedditPageOrDefault(permalink);

const sessionStartedAtMs = Date.now();
let sessionEngagementSentForHiddenCycle = false;
function trackSessionEngagement(trigger: "visibility_hidden" | "pagehide"): void {
    if (sessionEngagementSentForHiddenCycle) {
        return;
    }
    sessionEngagementSentForHiddenCycle = true;
    const routeInfo = parsePermalinkForAnalytics(permalinkFromURLAnchor());
    trackEvent("session_engagement", {
        ...getAnalyticsContext(),
        engagement_ms: Date.now() - sessionStartedAtMs,
        route_type: routeInfo.route_type,
        subreddit: routeInfo.subreddit,
        post_id: routeInfo.post_id,
        trigger
    });
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        trackSessionEngagement("visibility_hidden");
    } else if (document.visibilityState === "visible") {
        sessionEngagementSentForHiddenCycle = false;
    }
});
window.addEventListener("pagehide", () => {
    trackSessionEngagement("pagehide");
});

if (typeof (window as any).requestIdleCallback === "function") {
    (window as any).requestIdleCallback(() => {
        searchController.prefetchSearchIndexOnIdle();
    }, {timeout: 2500});
} else {
    setTimeout(() => {
        searchController.prefetchSearchIndexOnIdle();
    }, 1200);
}


