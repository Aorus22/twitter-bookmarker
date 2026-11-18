/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * The threads this screen's own network work runs on.
 *
 * <p>The app's background executor is shared by everything in the app and is not
 * ours to size. That was a real bug here rather than a theoretical one: every row
 * that scrolls into view starts a request for the live post, each with a five second
 * connect timeout, and they all queued — along with the thumbnail downloads, on the
 * same executor — behind one another. A host that answers slowly, or not at all,
 * left the screen with its layout drawn and nothing in it.
 *
 * <p>So the work is split instead: the live posts get a small pool of their own, the
 * images get another, and neither can starve the other. Both are daemon threads, so
 * a gallery left open never keeps the process alive, and both are named, because the
 * first thing worth knowing about a stall is which kind of work stalled.
 */
final class BookmarkerThreads {

    private BookmarkerThreads() {}

    /**
     * A fixed pool of named daemon threads.
     *
     * @param name  thread name prefix, so a thread dump says what was stuck
     * @param size  how many requests may be in flight at once
     */
    static ExecutorService fixedPool(final String name, int size) {
        return Executors.newFixedThreadPool(Math.max(1, size), new ThreadFactory() {
            private int created;

            @Override
            public Thread newThread(Runnable work) {
                Thread thread = new Thread(work, name + "-" + (++created));
                thread.setDaemon(true);
                return thread;
            }
        });
    }
}
