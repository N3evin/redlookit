export function setDarkMode(checkbox: HTMLInputElement): void {
    if (localStorage.getItem('isDarkMode') == 'true') {
        checkbox.checked = true;
        document.body.classList.remove('light');
        document.body.classList.add('dark');
    } else if (localStorage.getItem('isDarkMode') == 'false') {
        document.body.classList.remove('dark');
        document.body.classList.add('light');
        checkbox.checked = false;
    }
}

export function showSubredditDetails(checkbox: HTMLInputElement): void {
    if (localStorage.getItem('showSubDetails') == 'true') {
        checkbox.checked = true;
    } else if (localStorage.getItem('showSubDetails') == 'false') {
        checkbox.checked = false;
    }
}

export function showLongAddress(checkbox: HTMLInputElement): void {
    if (localStorage.getItem('showLongAddress') == 'true') {
        checkbox.checked = true;
    } else if (localStorage.getItem('showLongAddress') == 'false') {
        checkbox.checked = false;
    }
}

export function syncDefaultSubredditTopTimeVisibility(
    defaultSubredditSortSelect: HTMLSelectElement,
    defaultSubredditTopTimeContainer: HTMLElement,
    defaultSubredditTopTimeSelect: HTMLSelectElement
): void {
    const showTopTime = defaultSubredditSortSelect.value === "top";
    defaultSubredditTopTimeContainer.style.display = showTopTime ? "block" : "none";
    defaultSubredditTopTimeSelect.disabled = !showTopTime;
}

export function setDefaultSubredditSortUI(
    defaultSubredditSortSelect: HTMLSelectElement,
    defaultSubredditTopTimeSelect: HTMLSelectElement,
    getDefaultSubredditSort: () => string,
    getDefaultSubredditTopTime: () => string
): void {
    defaultSubredditSortSelect.value = getDefaultSubredditSort();
    defaultSubredditTopTimeSelect.value = getDefaultSubredditTopTime();
}

export function setDefaultCommentSortUI(
    defaultCommentSortSelect: HTMLSelectElement,
    getDefaultCommentSort: () => string
): void {
    const savedSort = getDefaultCommentSort();
    defaultCommentSortSelect.value = savedSort;
}

export function hideMedia(checkbox: HTMLInputElement): void {
    const hideMediaSetting = localStorage.getItem('hideMedia');
    const redditPostImage = document.querySelector('.reddit-post img') as HTMLElement | null;
    const postImage = document.querySelector('.post-image') as HTMLElement | null;
    const postVideo = document.querySelector('.post-video') as HTMLElement | null;
    if (hideMediaSetting == 'true') {
        checkbox.checked = true;
        if (redditPostImage) {
            redditPostImage.style.visibility = 'hidden';
        }
        if (postImage) {
            postImage.style.visibility = 'hidden';
        } else if (postVideo) {
            postVideo.style.visibility = 'hidden';
        }
    } else if (hideMediaSetting == 'false') {
        checkbox.checked = false;
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

export function setPageTitle(): void {
    if (localStorage.getItem('pageTitle')) {
        document.title = localStorage.getItem('pageTitle')!;
    }
}

export function generateRandomAvatarSeed(): string {
    const randomPart = Math.random().toString(36).slice(2, 10);
    const timestampPart = Date.now().toString(36).slice(-6);
    return `${randomPart}${timestampPart}`;
}

export function setDynamicProfileAvatars(): void {
    const avatarSeed = generateRandomAvatarSeed();
    const avatarUrl = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${avatarSeed}&backgroundColor=ffffff`;
    const avatarImages = document.querySelectorAll<HTMLImageElement>('.dynamic-dicebear-avatar');
    avatarImages.forEach((img) => {
        img.src = avatarUrl;
    });
}
