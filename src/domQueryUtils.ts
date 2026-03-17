function isDebugMode(): boolean {
    // Won't support ipv6 loopback
    const url = new URL(document.URL);
    return url.protocol === "file:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function assert(condition: boolean, msg: string = "Assertion failed"): asserts condition {
    if (!condition && isDebugMode()) {
        throw new Error(msg);
    }
}

// A query selector that throws
export function strictQuerySelector<T extends Element>(selector: string): T {
    const element: T | null = document.querySelector<T>(selector);
    assert(element !== null, `Failed to find a DOM element matching selector "${selector}"`);
    return element;
}

export type SerializedHTML = string;
export function decodeHTML(html: SerializedHTML): SerializedHTML {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}

export function isHTMLElement(obj: any): obj is HTMLElement {
    return (typeof obj === "object") && (obj as HTMLElement).style !== undefined;
}
