/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import android.content.Context;
import android.content.SharedPreferences;

import app.morphe.extension.shared.Utils;

/**
 * Where the phone keeps the backend address and the token.
 *
 * <p>These live in the overlay's own preference file rather than in Piko's
 * {@code piko_settings}. Piko's rows are built in Java inside its
 * {@code ScreenBuilder}, so a row there would mean shipping a modified copy of a
 * 1400-line upstream file and re-checking it on every pin bump; a file of our own
 * keeps the overlay additive and keeps these two values independently
 * resettable. The settings dialog in this package is their editor.
 */
public final class BookmarkerPrefs {

    private static final String FILE_NAME = "twb_settings";
    private static final String KEY_BACKEND_URL = "backend_url";
    private static final String KEY_BACKEND_TOKEN = "backend_token";

    private BookmarkerPrefs() {}

    private static SharedPreferences prefs() {
        return Utils.getContext().getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE);
    }

    /** The address as the user typed it, normalized, or "" when unset. */
    public static String backendUrl() {
        return BookmarkerApi.normalizeBaseUrl(prefs().getString(KEY_BACKEND_URL, ""));
    }

    /** The bearer token, or "" — which means "send no Authorization header". */
    public static String backendToken() {
        String token = prefs().getString(KEY_BACKEND_TOKEN, "");
        return token == null ? "" : token.trim();
    }

    /**
     * True once there is an address to talk to. A token is deliberately not part
     * of this: a backend reached over loopback or through a tunnel on this
     * machine needs none, and demanding one would block a setup that works.
     */
    public static boolean isConfigured() {
        return !backendUrl().isEmpty();
    }

    public static void save(String backendUrl, String token) {
        prefs().edit()
                .putString(KEY_BACKEND_URL, BookmarkerApi.normalizeBaseUrl(backendUrl))
                .putString(KEY_BACKEND_TOKEN, token == null ? "" : token.trim())
                .apply();
    }
}
