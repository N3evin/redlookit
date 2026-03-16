export function isMediaHidden(): boolean {
    return localStorage.getItem('hideMedia') === 'true';
}
