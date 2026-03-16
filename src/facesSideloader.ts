// To avoid risks of misunderstandings, we make it already explicit in the types that the code expects milliseconds.
type Milliseconds = number;
const API_URL = "https://thispersondoesnotexist.com"

// TimedTask
// \brief Wait a number of milliseconds then executes a task
// \description
//     Allows asynchronous execution of a task after a set number of milliseconds has passed
//     Provides getRemainingTime() to keep track of how long until the task starts
//     Gets used to space out calls to https://thispersondoesnotexist.com without having to think too much about it
class TimedTask {
    _finishTimeMS: Milliseconds = 0;
    _timeoutID: number = null;

    constructor(callback: (...unknown) => unknown, timeToWaitMS: Milliseconds) {
        const currentTime: Milliseconds = (new Date()).getTime();
        this._finishTimeMS = currentTime + timeToWaitMS;
        this._timeoutID = setTimeout(_ => callback(), timeToWaitMS);
    }

    // Possibly negative
    getRemainingTime(): Milliseconds {
        return this._finishTimeMS - (new Date()).getTime();
    }

    // noinspection JSUnusedGlobalSymbols
    cancel(): void {
        if (this._timeoutID) {
            clearTimeout(this._timeoutID);
        }
    }
}


// HumanFacesSideLoader
// \brief To preload pictures from https://thispersondoesnotexist.com
//     in the background & slowly build a backlog of them so that they can be instantly displayed
// \description
//     Provides: sideLoad()
//         The big strength is you can use sideLoad() in a loop, and it'll space out the queries for you
//     Provides: getFaces()
//         Access to all currently cached faces
export class HumanFacesSideLoader {
    _faces: HTMLImageElement[] = [];
    _promises: Promise<HTMLImageElement>[] = [];
    _tasks: TimedTask[] = [];
    _currentID: number = 0;
    maxConcurrentRequests: number = 6;
    minConcurrentRequests: number = 2;
    timeBetweenRequestsMS: Milliseconds = 1000;
    timeout: Milliseconds = 3000;

    constructor(sideLoadNFaces: number = 0) {
        // This, the fact that we can just use a `for` loop, is the whole reason we went with this weird architecture
        // It's all asynchronous, the loop is non-blocking, and it makes the requests nicely queue up
        for (let i: number = 0; i < sideLoadNFaces; i++) {
            // noinspection JSIgnoredPromiseFromCall
            this.sideLoad().catch();
        }
    }

    async checkIsAPIOnline(timeout: Milliseconds = this.timeout): Promise<boolean> {
        // Query the API with fetch(), and set a timeout
        // The API does not allow Cross-Origin requests, so this query will never go through
        // But it WILL go on for 30+ seconds if the server is unreachable, and error out quickly if it is

        // If the timeout is spent, we consider the API is not available
        // If the request fails earlier, likely because of CORS, we consider the API to be available

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        return new Promise( (resolve, _) => {
            fetch(`${API_URL}?rng=${Math.random()}`, {
                "credentials": "omit",
                "headers": {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0",
                    "Accept": "image/avif,image/webp,*/*",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Sec-Fetch-Dest": "image",
                    "Sec-Fetch-Mode": "no-cors",
                    "Sec-Fetch-Site": "cross-site",
                    "Pragma": "no-cache",
                    "Cache-Control": "no-cache"
                },
                "method": "GET",
                "mode": "cors",
                "signal": controller.signal
            }).then( _ => {
                resolve(true);
            }).catch( (error: Error) => {
                if (error.name === "AbortError") {
                    resolve(false);
                } else {
                    resolve(true);
                }
            }).finally(() => {
                clearTimeout(id);
            });
        })
    }

    getLastTask(): TimedTask | null {
        if (this._tasks.length === 0) {
            return null;
        }

        return this._tasks[this._tasks.length-1]
    }

    getFaces(): HTMLImageElement[] {
        return this._faces;
    }

    async all(): Promise<HTMLImageElement[]> {
        return Promise.all<HTMLImageElement>(this._promises);
    }

    private createFaceLoadPromise(id: number): Promise<HTMLImageElement> {
        const prom = new Promise<HTMLImageElement>( (resolve, reject) => {
            let ppElem = document.createElement("img");
            let timeoutTask: TimedTask;

            const onBoth = () => {
                if (timeoutTask) {
                    timeoutTask.cancel();
                }
            };
            const onSuccess = () => {
                onBoth();
                resolve(ppElem);
                this._faces.push(ppElem);
            };
            const onError = () => {
                onBoth();
                ppElem.remove();
                reject();
            };

            ppElem.src = `${API_URL}?cnh=${id}`;

            timeoutTask = new TimedTask(() => {
                ppElem.removeEventListener("load", onSuccess);
                ppElem.removeEventListener("error", onError);
                onError();
            }, this.timeout);

            ppElem.addEventListener("load", onSuccess, {once: true, passive: true});
            ppElem.addEventListener("error", onError, {once: true, passive: true});
        });

        this._promises.push(prom);
        return prom;
    }

    // Load many faces concurrently with a safe upper bound.
    // Concurrency auto-adjusts based on recent success/failure ratio.
    async sideLoadMany(totalFaces: number, maxConcurrentRequests: number = this.maxConcurrentRequests): Promise<HTMLImageElement[]> {
        if (totalFaces <= 0) {
            return [];
        }

        const maxConcurrency = Math.max(1, Math.min(maxConcurrentRequests, totalFaces));
        const minConcurrency = Math.max(1, Math.min(this.minConcurrentRequests, maxConcurrency));
        const loadedFaces: HTMLImageElement[] = [];
        let issued = 0;
        let currentConcurrency = minConcurrency;

        while (issued < totalFaces) {
            const remaining = totalFaces - issued;
            const batchSize = Math.min(currentConcurrency, remaining);
            const batch: Promise<boolean>[] = [];

            for (let i = 0; i < batchSize; i++) {
                const id = this._currentID;
                this._currentID++;
                issued++;

                const oneRequest = this.createFaceLoadPromise(id)
                    .then((face) => {
                        loadedFaces.push(face);
                        return true;
                    })
                    .catch(() => {
                        // Ignore failed single fetches; caller only needs best-effort warmup.
                        return false;
                    });

                batch.push(oneRequest);
            }

            const results = await Promise.all(batch);
            const successes = results.filter((ok) => ok).length;
            const failures = batchSize - successes;

            // If the whole batch is healthy, ramp up gradually.
            if (failures === 0 && currentConcurrency < maxConcurrency) {
                currentConcurrency++;
                continue;
            }

            // If more than half failed, back off quickly.
            if (failures > Math.floor(batchSize / 2) && currentConcurrency > minConcurrency) {
                currentConcurrency--;
            }
        }

        return loadedFaces;
    }

    async sideLoad(): Promise<HTMLImageElement> {
        let timeToStart = 0; // Now

        // If one request is on the way, queue this one next
        const lastTask = this.getLastTask();
        if (lastTask !== null) {
            const remainingTime: number = Math.max(0, lastTask.getRemainingTime());
            timeToStart = remainingTime + this.timeBetweenRequestsMS;
            if (timeToStart < 0) { 
                timeToStart = 0;
            }

            // Queries always spaced out by at least 1000ms
            // If the query has 900ms left before it starts, this one starts 1900ms after
            // If the query is just running (so 0ms to go), it starts 1000ms after
            // If the query has been running for 100ms (so -100ms to go) it starts in 900ms
        }

        // This will all be executed post-return (asynchronously), once `timeToStart` amount of milliseconds have elapsed.
        const prom = new Promise<HTMLImageElement>( (resolve, reject) => {
            const id = this._currentID; // Make a local copy of the value otherwise it will have changed post-return

            const task = new TimedTask(() => {
                this.createFaceLoadPromise(id).then(resolve).catch(() => {
                    // Cancel the requests that are not yet on the way
                    for (const task of this._tasks) {
                        task.cancel();
                    }
                    reject();
                });
            }, timeToStart);

            this._tasks.push(task);
        });

        this._currentID++;
        return prom;
    }
}