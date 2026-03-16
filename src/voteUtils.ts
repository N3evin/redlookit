const upvoteArrowSVG = '<svg width="15" height="15" style="margin-right: 5px;" viewBox="0 0 94 97" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M88.1395 48.8394C84.9395 46.0394 60.4728 18.0061 48.6395 4.33939C46.6395 3.53939 45.1395 4.33939 44.6395 4.83939L4.63948 49.3394C2.1394 53.3394 7.63948 52.8394 9.63948 52.8394H29.1395V88.8394C29.1395 92.0394 32.1395 93.1727 33.6395 93.3394H58.1395C63.3395 93.3394 64.3062 90.3394 64.1395 88.8394V52.3394H87.1395C88.8061 52.0061 91.3395 51.6394 88.1395 48.8394Z" stroke="#818384" stroke-width="7"/></svg>';
const downvoteArrowSVG = '<svg width="15" height="15" style="transform: rotate(180deg); margin-left: 5px" viewBox="0 0 94 97" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M88.1395 48.8394C84.9395 46.0394 60.4728 18.0061 48.6395 4.33939C46.6395 3.53939 45.1395 4.33939 44.6395 4.83939L4.63948 49.3394C2.1394 53.3394 7.63948 52.8394 9.63948 52.8394H29.1395V88.8394C29.1395 92.0394 32.1395 93.1727 33.6395 93.3394H58.1395C63.3395 93.3394 64.3062 90.3394 64.1395 88.8394V52.3394H87.1395C88.8061 52.0061 91.3395 51.6394 88.1395 48.8394Z" stroke="#818384" stroke-width="7"/></svg>';

export function setVoteDisplay(target: HTMLElement, score: number, className: string): void {
    target.innerHTML = `${upvoteArrowSVG}${score.toLocaleString()}${downvoteArrowSVG}`;
    target.classList.add(className);
}
