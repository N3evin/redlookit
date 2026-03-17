import {fetchData} from "./networkUtils";
import {assert, decodeHTML} from "./domQueryUtils";
import {getPostIdFromPermalink, type Permalink} from "./routingUtils";
import {loadCollapsedCommentsForPost, saveCollapsedCommentsForPost} from "./settingsStore";
import type {Random, UUID, UUIDFormat} from "./random";

type CommentBuilderOptions = {
    indent: number,
    ppBuffer: HTMLImageElement[],
    post: Permalink,
    postAuthor: string,
    collapsedCommentsSet: Set<string>,
    commentsEncounteredSoFar: Set<string>
};

type CreateCommentOptions = {
    ppBuffer: HTMLImageElement[],
    domNode?: HTMLElement,
    postAuthor?: string,
    postPermalink?: Permalink,
    collapsedCommentsSet?: Set<string>
};

type HTMLProfilePictureElement = HTMLCanvasElement | HTMLImageElement | HTMLSpanElement;

export type CommentsModuleDeps = {
    postSection: HTMLElement,
    redditBaseURL: string,
    rng: Random,
    colors: string[],
    initials: string[],
    isDebugMode: () => boolean,
    trackEvent: (eventName: string, params?: Record<string, string | number | boolean>) => void,
    getAnalyticsContext: () => Record<string, string | number | boolean>,
    renderCommentBodyHtml: (html: string) => string
};

function getHiddenRepliesCount(commentElement: HTMLElement): number {
    return Math.max(0, commentElement.querySelectorAll(".usertext").length - 1);
}

export function setCommentCollapsedState(commentElement: HTMLElement, shouldCollapse: boolean): void {
    commentElement.classList.toggle("comment-thread-collapsed", shouldCollapse);
    const collapseButton = commentElement.querySelector<HTMLButtonElement>(".comment-collapse-toggle");
    if (collapseButton !== null) {
        collapseButton.textContent = shouldCollapse ? "▸" : "▾";
        collapseButton.title = shouldCollapse ? "Expand thread" : "Collapse thread";
        collapseButton.setAttribute("aria-label", shouldCollapse ? "Expand comment thread" : "Collapse comment thread");
        collapseButton.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
    }
    const collapsedSummary = commentElement.querySelector<HTMLElement>(".comment-collapsed-summary");
    if (collapsedSummary !== null) {
        if (!shouldCollapse) {
            collapsedSummary.style.display = "none";
            collapsedSummary.textContent = "";
        } else {
            const hiddenReplies = getHiddenRepliesCount(commentElement);
            collapsedSummary.style.display = "inline";
            collapsedSummary.textContent = hiddenReplies > 0
                ? `${hiddenReplies} repl${hiddenReplies === 1 ? "y" : "ies"} hidden`
                : "Thread collapsed";
        }
    }
}

function refreshCollapsedCommentAncestors(startElement: HTMLElement, postSection: HTMLElement): void {
    let currentElement: HTMLElement | null = startElement;
    while (currentElement !== null && currentElement !== postSection) {
        if (currentElement.classList.contains("usertext") && currentElement.classList.contains("comment-thread-collapsed")) {
            setCommentCollapsedState(currentElement, true);
        }
        currentElement = currentElement.parentElement;
    }
}

async function generateGnomePic(deps: CommentsModuleDeps): Promise<HTMLImageElement> {
    const gnome = document.createElement<"img">("img");
    gnome.classList.add("gnome");

    const flipSeed = await deps.rng.random();
    const flip = flipSeed <= 0.5 ? "scaleX(-1) " : "";
    const mirrorSeed = await deps.rng.random();
    gnome.style.transform = `${flip}rotate(${Math.round(mirrorSeed * 40 - 20)}deg) `;

    const colorSeed = await deps.rng.random();
    gnome.style.backgroundColor = deps.colors[Math.floor(colorSeed * deps.colors.length)];

    return gnome;
}

async function generateTextPic(size: number, deps: CommentsModuleDeps): Promise<HTMLSpanElement> {
    const textPic = document.createElement<"span">("span");

    const pseudoRand1 = await deps.rng.random(0, deps.initials.length - 1);
    const pseudoRand2 = await deps.rng.random(0, deps.initials.length - 1);
    const ppInitials = deps.initials[Math.round(pseudoRand1)] + deps.initials[Math.round(pseudoRand2)];

    textPic.style.fontWeight = "600";
    textPic.style.fontSize = "16px";
    textPic.style.lineHeight = "40px";
    textPic.style.textAlign = "center";
    textPic.style.display = "inline-block";
    textPic.style.cssText += "-webkit-touch-callout: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none;";

    const colorSeed = await deps.rng.random(0, deps.colors.length - 1);
    textPic.style.backgroundColor = deps.colors[Math.round(colorSeed)];
    textPic.textContent = `${ppInitials}`;
    return textPic;
}

function copyImage2Canvas(origin: HTMLImageElement, newSize: number): HTMLCanvasElement | null {
    const canv: HTMLCanvasElement = document.createElement("canvas");
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

async function generateFacePic(ppBuffer: HTMLImageElement[], deps: CommentsModuleDeps, displaySize: number = 50): Promise<HTMLCanvasElement> {
    const imageSeed = Math.round(await deps.rng.random(0, ppBuffer.length - 1));
    const imageElement: HTMLImageElement = ppBuffer[imageSeed];
    const canv = copyImage2Canvas(imageElement, displaySize);
    assert(canv !== null, `generateFacePic couldn't get a canvas 2D context from image #${imageSeed}, ${imageElement.src} (img.${Array.from(imageElement.classList).join(".")})`);
    canv.classList.add(`human-${imageSeed}`);
    return canv;
}

async function createProfilePicture(commentData: SnooComment, size: number, ppBuffer: HTMLImageElement[], deps: CommentsModuleDeps): Promise<HTMLProfilePictureElement> {
    async function helper(): Promise<HTMLProfilePictureElement> {
        if (commentData.data.subreddit === "gnometalk") {
            return generateGnomePic(deps);
        }

        const chanceForAFacePic = (() => {
            if (ppBuffer.length < 10) {
                return 0;
            } else {
                const baseValue = 0.7;
                if (ppBuffer.length >= 25) {
                    return baseValue;
                } else {
                    return ((ppBuffer.length - 10) / 15) * baseValue;
                }
            }
        })();

        if ((await deps.rng.random()) < chanceForAFacePic) {
            return generateFacePic(ppBuffer, deps);
        } else {
            return generateTextPic(size, deps);
        }
    }

    const ppElem: HTMLProfilePictureElement = await helper();
    ppElem.classList.add("avatar");
    ppElem.style.marginRight = "10px";
    if (!ppElem.classList.contains("avatar-circle")) {
        ppElem.classList.add("avatar-circle");
    }
    return ppElem;
}

async function createComment(commentData: SnooComment, options: CreateCommentOptions, deps: CommentsModuleDeps): Promise<HTMLElement> {
    const domNode = options.domNode ?? document.createElement('div');
    domNode.id = commentData.data.id;
    domNode.classList.add("usertext");

    const author = document.createElement('div');
    author.classList.add("author", "comment-header");
    author.style.display = "flex";

    const collapseToggle = document.createElement("button");
    collapseToggle.type = "button";
    collapseToggle.classList.add("comment-collapse-toggle");
    collapseToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const willCollapse = !domNode.classList.contains("comment-thread-collapsed");
        setCommentCollapsedState(domNode, willCollapse);
        deps.trackEvent("toggle_comment_thread", {
            ...deps.getAnalyticsContext(),
            post_id: options.postPermalink !== undefined ? getPostIdFromPermalink(options.postPermalink) : "",
            comment_id: commentData.data.id,
            action: willCollapse ? "collapse" : "expand",
            method: "button"
        });
        if (options.collapsedCommentsSet !== undefined && options.postPermalink !== undefined) {
            if (willCollapse) {
                options.collapsedCommentsSet.add(commentData.data.id);
            } else {
                options.collapsedCommentsSet.delete(commentData.data.id);
            }
            saveCollapsedCommentsForPost(options.postPermalink, options.collapsedCommentsSet);
        }
    });
    author.append(collapseToggle);

    await deps.rng.setSeed(commentData.data.author);
    const ppSize = 50;
    const pfpPlaceHolder = document.createElement<"span">("span");
    pfpPlaceHolder.style.width = pfpPlaceHolder.style.height = `${ppSize}px`;
    author.appendChild(pfpPlaceHolder);

    createProfilePicture(commentData, ppSize, options.ppBuffer, deps).then((generatedPfp) => {
        author.replaceChild(generatedPfp, pfpPlaceHolder);
    });

    const authorText = document.createElement("div");
    authorText.classList.add("author-text");
    authorText.style.display = "flex";
    authorText.style.flexDirection = "column";

    const authorTextInfo = document.createElement("span");
    authorTextInfo.classList.add("username", "email");
    const scoreLength = (`${commentData.data.score}`).length;
    const format: UUIDFormat = [
        { n: 8, charset: "alpha" },
        { n: 4, charset: "alphanumerical" },
        { n: 4, charset: "alphanumerical" },
        { n: 4, charset: "alphanumerical" },
        { n: 12, charset: "alphanumerical" }
    ];
    deps.rng.randomUUID(format).then((uuid: UUID) => {
        const slicedUUID = uuid.slice(scoreLength);
        const isSubmitterFlag = "is_submitter" in commentData.data && commentData.data.is_submitter === true;
        const isCommentByPostOwner = isSubmitterFlag
            || (
                options.postAuthor !== undefined
                && commentData.data.author.toLowerCase() === options.postAuthor.toLowerCase()
            );
        const ownerCrown = isCommentByPostOwner ? ' <span class="op-crown">👑</span>' : '';

        if (localStorage.getItem('showLongAddress') == 'true' || localStorage.getItem('showLongAddress') == null) {
            authorTextInfo.innerHTML = `${commentData.data.author} <${commentData.data.score}${slicedUUID}@securemail.org>${ownerCrown}`;
        } else {
            authorTextInfo.innerHTML = `u/${commentData.data.author} (${commentData.data.score})${ownerCrown}`;
            authorTextInfo.title = `&lt;${commentData.data.author}@reddit.com&gt;`;
        }
    });
    authorText.append(authorTextInfo);

    const d = new Date(commentData.data.created_utc * 1000);
    const dateDiv = document.createElement("span");
    dateDiv.classList.add("comment-posted-date");
    dateDiv.innerHTML = d.toString().slice(0, 21);
    dateDiv.style.color = "#a2a2a2";
    dateDiv.style.fontSize = "0.85em";
    authorText.append(dateDiv);
    author.append(authorText);

    const collapsedSummary = document.createElement("span");
    collapsedSummary.classList.add("comment-collapsed-summary");
    collapsedSummary.style.display = "none";
    author.append(collapsedSummary);

    const commentText = document.createElement('div');
    commentText.classList.add("comment");
    commentText.insertAdjacentHTML('beforeend', deps.renderCommentBodyHtml(decodeHTML(commentData.data.body_html)));
    domNode.prepend(author, commentText);
    setCommentCollapsedState(domNode, domNode.classList.contains("comment-thread-collapsed"));

    author.addEventListener("click", () => {
        const willCollapse = !domNode.classList.contains("comment-thread-collapsed");
        setCommentCollapsedState(domNode, willCollapse);
        deps.trackEvent("toggle_comment_thread", {
            ...deps.getAnalyticsContext(),
            post_id: options.postPermalink !== undefined ? getPostIdFromPermalink(options.postPermalink) : "",
            comment_id: commentData.data.id,
            action: willCollapse ? "collapse" : "expand",
            method: "header"
        });
        if (options.collapsedCommentsSet !== undefined && options.postPermalink !== undefined) {
            if (willCollapse) {
                options.collapsedCommentsSet.add(commentData.data.id);
            } else {
                options.collapsedCommentsSet.delete(commentData.data.id);
            }
            saveCollapsedCommentsForPost(options.postPermalink, options.collapsedCommentsSet);
        }
    });

    return domNode;
}

function displayCommentsRecursive(parentElement: HTMLElement, listing: ApiObj[], options: CommentBuilderOptions, deps: CommentsModuleDeps): void {
    const { post, postAuthor, collapsedCommentsSet } = options;
    const indent = options.indent ?? 0;
    const ppBuffer = options.ppBuffer ?? [];
    const commentsEncounteredSoFar = options.commentsEncounteredSoFar ?? new Set<string>();

    if (listing.length === 0) {
        return;
    }

    for (const redditObj of listing) {
        if (redditObj.kind === "t1") {
            const comment: SnooComment = redditObj as SnooComment;
            commentsEncounteredSoFar.add(comment.data.id);

            const commentElement = document.createElement("div");
            if (indent > 0) {
                commentElement.classList.add('replied-comment');
            }
            if (collapsedCommentsSet.has(comment.data.id)) {
                commentElement.classList.add("comment-thread-collapsed");
            }

            parentElement.appendChild(commentElement);
            const prom = createComment(comment, {
                ppBuffer,
                domNode: commentElement,
                postAuthor,
                postPermalink: post,
                collapsedCommentsSet
            }, deps);
            prom.catch((reason) => {
                console.error("There was a problem drawing this comment on the page", { "reason": reason, "comment data": comment, "profile picture": ppBuffer, "anchor element on the page=": commentElement });
            });

            if (comment.data.replies) {
                displayCommentsRecursive(commentElement, comment.data.replies.data.children, {
                    indent: indent + 10,
                    ppBuffer,
                    post,
                    postAuthor,
                    collapsedCommentsSet,
                    commentsEncounteredSoFar
                }, deps);
            }
            if (commentElement.classList.contains("comment-thread-collapsed")) {
                setCommentCollapsedState(commentElement, true);
            }
            refreshCollapsedCommentAncestors(parentElement, deps.postSection);

            if (indent === 0) {
                parentElement.appendChild(document.createElement('hr'));
            }
        } else if (redditObj.kind === "more" && post !== undefined) {
            const data = redditObj as MoreComments;
            const moreElement = document.createElement("span");
            moreElement.classList.add("btn-more");
            const parentLink = `${deps.redditBaseURL}${post}${data.data.parent_id.slice(3)}`;

            moreElement.addEventListener("click", async () => {
                deps.trackEvent("load_more_replies", {
                    ...deps.getAnalyticsContext(),
                    post_id: getPostIdFromPermalink(post),
                    parent_comment_id: data.data.parent_id.replace(/^t[0-9]+_/, "")
                });
                moreElement.classList.add("waiting");
                try {
                    const data = await fetchData<ApiObj[]>(`${parentLink}.json`);
                    if (deps.isDebugMode()) console.log("Got data!", parentLink, data);
                    moreElement.remove();

                    let replies: Listing<SnooComment>;
                    try {
                        replies = (data as any)[1].data.children[0].data.replies.data;
                    } catch (e) {
                        moreElement.classList.remove("waiting");
                        return Promise.reject(e);
                    }

                    replies.children = replies.children.filter((v) => {
                        return !commentsEncounteredSoFar.has(v.data.id);
                    });

                    displayCommentsRecursive(parentElement, replies.children, {
                        indent: indent + 10,
                        ppBuffer,
                        post,
                        postAuthor,
                        collapsedCommentsSet,
                        commentsEncounteredSoFar
                    }, deps);
                    refreshCollapsedCommentAncestors(parentElement, deps.postSection);
                } catch (e) {
                    moreElement.classList.remove("waiting");
                    console.error(e);
                }
            });
            parentElement.appendChild(moreElement);
        }
    }
}

export function displayComments(commentsData: SnooComment[], options: { post: Permalink, postAuthor: string }, stableInTimeFaceBuffer: HTMLImageElement[], deps: CommentsModuleDeps): void {
    deps.postSection.classList.add('post-selected');
    deps.postSection.classList.remove('deselected');
    const collapsedCommentsSet = loadCollapsedCommentsForPost(options.post);
    displayCommentsRecursive(deps.postSection, commentsData, {
        indent: 0,
        ppBuffer: stableInTimeFaceBuffer,
        post: options.post,
        postAuthor: options.postAuthor,
        collapsedCommentsSet,
        commentsEncounteredSoFar: new Set()
    }, deps);
}
