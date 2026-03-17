import {parsePermalinkForAnalytics, type Permalink} from "./routingUtils";

export type AnalyticsParamValue = string | number | boolean;
export type AnalyticsParams = Record<string, AnalyticsParamValue>;

const productionAnalyticsHostnames = new Set(["redlookit.n3evin.com", "www.redlookit.n3evin.com"]);

export function isAnalyticsEnabled(): boolean {
    const hostName = window.location.hostname.toLowerCase();
    return productionAnalyticsHostnames.has(hostName);
}

export function getAnalyticsContext(): AnalyticsParams {
    return {
        theme: localStorage.getItem("currentTheme") || "defaultTheme",
        ui_density: localStorage.getItem("displayDensity") || "roomy",
        is_dark_mode: localStorage.getItem("isDarkMode") === "true"
    };
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
    if (!isAnalyticsEnabled()) {
        return;
    }
    const gtagFn = (window as any).gtag;
    if (typeof gtagFn !== "function") {
        return;
    }
    const cleanParams: AnalyticsParams = {};
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            cleanParams[key] = value;
        }
    }
    gtagFn("event", eventName, cleanParams);
}

export function trackSampledEvent(eventName: string, sampleRate: number, params: AnalyticsParams = {}): void {
    const normalizedSampleRate = Math.min(1, Math.max(0, sampleRate));
    if (normalizedSampleRate <= 0) {
        return;
    }
    if (normalizedSampleRate < 1 && Math.random() > normalizedSampleRate) {
        return;
    }
    trackEvent(eventName, params);
}

export function trackSettingChange(settingName: string, settingValue: string | boolean): void {
    trackEvent("change_setting", {
        ...getAnalyticsContext(),
        setting_name: settingName,
        setting_value: typeof settingValue === "boolean" ? (settingValue ? "true" : "false") : settingValue
    });
}

export function trackRouteView(permalink: Permalink | null): void {
    const routeInfo = parsePermalinkForAnalytics(permalink);
    trackEvent("view_route", {
        ...getAnalyticsContext(),
        route_type: routeInfo.route_type,
        subreddit: routeInfo.subreddit,
        post_id: routeInfo.post_id
    });
}
