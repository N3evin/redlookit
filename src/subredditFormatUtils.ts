export function getSubredditIcon(subredditInformation: SubredditDetails): string {
    if (subredditInformation.icon_img != '') {
        return subredditInformation.icon_img;
    } else if (subredditInformation.community_icon != '') {
        return subredditInformation.community_icon.replaceAll("&amp;", "&");
    } else {
        return 'https://img.icons8.com/fluency-systems-regular/512/reddit.png';
    }
}

export function numberFormatter(value: string | number): string {
    const num = parseInt(String(value), 10);
    return Math.abs(num) > 999999
        ? Math.sign(num) * Number((Math.abs(num) / 1000000).toFixed(1)) + 'm'
        : Math.sign(num) * Number((Math.abs(num) / 1000).toFixed(1)) + 'k';
}
