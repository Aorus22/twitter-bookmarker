/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * One post, fetched from the tweet id alone.
 *
 * <p>This is what lets the gallery draw a real post instead of our copy of one:
 * the archive's {@code media}, {@code text} and {@code author} columns are a
 * snapshot taken when the tweet was saved, and they can be empty, stale or wrong,
 * while the post still exists and still says what it says. The id is the only
 * thing that cannot go stale.
 *
 * <p>The source is FxEmbed's status API — the same host Piko's own tweet-info
 * feature already calls ({@code patches/tweet/TweetInfoAPI.java}), which answers
 * without a token or a login and needs nothing but the id. Its contract is
 * documented at https://github.com/FxEmbed/FxEmbed/wiki/Status-Fetch-API: a
 * {@code code} of 200 with a {@code tweet} object, or 401 for a private post, 404
 * for one that is gone, 500 for its own failures.
 *
 * <p>Two deliberate choices. The class imports no Android type, so it is plain
 * Java and testable against the stub sources the overlay already builds with.
 * And every field is read through an {@code opt*} accessor with a default: this is
 * a third party describing content we do not control, and a post with a field
 * missing is a post we still want to show.
 */
public final class FxTweet {

    private static final String ENDPOINT = "https://api.fxtwitter.com/status/";

    /**
     * The API asks callers to identify themselves rather than arriving anonymous.
     * It also has no strict rate limit, which is the reason the gallery can fetch
     * one post at a time as the user scrolls.
     */
    private static final String USER_AGENT =
            "TwitterBookmarker/1.0 (+https://github.com/Aorus22/twitter-bookmarker)";

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_TIMEOUT_MS = 10000;

    /** The post is private or otherwise not embeddable; only our copy is left. */
    public static final int PRIVATE_TWEET = 401;
    /** The post is deleted or withheld. */
    public static final int NOT_FOUND = 404;
    /** The service itself failed; worth trying again later. */
    public static final int API_FAIL = 500;

    private FxTweet() {}

    /** One photo or video, already resolved to something an ImageView can load. */
    public static final class Media {
        /** The photo itself, or the video's poster frame. */
        public final String thumbnailUrl;
        /** The video file, empty for a photo. Never played here: the tap opens X. */
        public final String videoUrl;
        public final int width;
        public final int height;
        /** Seconds, or 0 for a photo. */
        public final double durationSeconds;
        public final boolean isVideo;

        Media(String thumbnailUrl, String videoUrl, int width, int height,
              double durationSeconds, boolean isVideo) {
            this.thumbnailUrl = thumbnailUrl;
            this.videoUrl = videoUrl;
            this.width = width;
            this.height = height;
            this.durationSeconds = durationSeconds;
            this.isVideo = isVideo;
        }
    }

    /** The post this one quotes. */
    public static final class Quote {
        public final String authorName;
        public final String authorUsername;
        public final String text;

        Quote(String authorName, String authorUsername, String text) {
            this.authorName = authorName;
            this.authorUsername = authorUsername;
            this.text = text;
        }
    }

    /** One poll option, as the API reports it. */
    public static final class PollChoice {
        public final String label;
        public final int percentage;

        PollChoice(String label, int percentage) {
            this.label = label;
            this.percentage = percentage;
        }
    }

    /** Everything a row draws, or the reason it cannot. */
    public static final class Row {

        /** 200 when the payload below is usable, or the API's own failure code. */
        public final int code;
        public final String message;

        public final String text;
        /** 0 when the API's timestamp could not be read. */
        public final long createdAtMs;
        public final String authorName;
        public final String authorUsername;
        public final String avatarUrl;
        public final boolean verified;
        /** -1 when Twitter does not publish a view count for this post. */
        public final int views;
        public final int replies;
        public final int retweets;
        public final int likes;
        public final List<Media> media;
        /** Null when the post quotes nothing. */
        public final Quote quote;
        public final List<PollChoice> poll;

        Row(int code, String message, String text, long createdAtMs, String authorName,
            String authorUsername, String avatarUrl, boolean verified, int views, int replies,
            int retweets, int likes, List<Media> media, Quote quote, List<PollChoice> poll) {
            this.code = code;
            this.message = message;
            this.text = text;
            this.createdAtMs = createdAtMs;
            this.authorName = authorName;
            this.authorUsername = authorUsername;
            this.avatarUrl = avatarUrl;
            this.verified = verified;
            this.views = views;
            this.replies = replies;
            this.retweets = retweets;
            this.likes = likes;
            this.media = media == null ? Collections.<Media>emptyList() : media;
            this.quote = quote;
            this.poll = poll == null ? Collections.<PollChoice>emptyList() : poll;
        }

        /** True when the payload can be drawn. */
        public boolean usable() {
            return code == HttpURLConnection.HTTP_OK;
        }

        /** True when the post is private, so only the archive's copy exists. */
        public boolean isPrivate() {
            return code == PRIVATE_TWEET;
        }
    }

    /** A terminal answer that carries no payload. */
    private static Row empty(int code, String message) {
        return new Row(code, message, "", 0L, "", "", "", false, -1, 0, 0, 0,
                Collections.<Media>emptyList(), null, Collections.<PollChoice>emptyList());
    }

    /**
     * The post with this id.
     *
     * <p>A 401 or 404 comes back as a {@link Row} rather than an exception: it is
     * Twitter's final answer about that id, not a transport failure, and the row
     * still has to be drawn from the archive. Anything else — no network, a timeout,
     * a body that is not the JSON we expect — throws, and the caller decides whether
     * to retry later.
     */
    public static Row fetch(String tweetId) throws IOException {
        if (tweetId == null || tweetId.isEmpty()) throw new IOException("no tweet id");

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(ENDPOINT + encode(tweetId)).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", USER_AGENT);

            int status = connection.getResponseCode();
            String body = read(connection, status);
            try {
                // The answer is in the body, and the body is what it is even when the
                // HTTP status is not 200: a private post that comes back as a 404 with
                // a JSON code still has to reach the row as "private", not as a
                // failure, or the row would keep quiet about why it is showing the
                // archive's copy.
                return parse(body);
            } catch (IOException e) {
                if (status < 200 || status >= 300) {
                    throw new IOException("fxtwitter returned " + status);
                }
                throw e;
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * The body as a {@link Row}.
     *
     * <p>Package-private so the parse can be exercised on its own; the Activity only
     * ever calls {@link #fetch}.
     */
    static Row parse(String body) throws IOException {
        JSONObject root;
        try {
            root = new JSONObject(body);
        } catch (Exception e) {
            throw new IOException("fxtwitter sent something that is not JSON: " + e);
        }

        int code = root.optInt("code", API_FAIL);
        String message = root.optString("message", "");
        if (code == PRIVATE_TWEET || code == NOT_FOUND) return empty(code, message);
        if (code != HttpURLConnection.HTTP_OK) {
            throw new IOException("fxtwitter code " + code
                    + (message.isEmpty() ? "" : ": " + message));
        }

        JSONObject tweet = root.optJSONObject("tweet");
        if (tweet == null) throw new IOException("fxtwitter sent no tweet");

        JSONObject author = tweet.optJSONObject("author");
        boolean verified = false;
        if (author != null) {
            JSONObject verification = author.optJSONObject("verification");
            if (verification != null) verified = verification.optBoolean("verified", false);
        }

        return new Row(
                HttpURLConnection.HTTP_OK,
                message,
                tweet.optString("text", ""),
                createdAtMs(tweet),
                author == null ? "" : author.optString("name", ""),
                author == null ? "" : author.optString("screen_name", ""),
                author == null ? "" : author.optString("avatar_url", ""),
                verified,
                tweet.optInt("views", -1),
                tweet.optInt("replies", 0),
                tweet.optInt("retweets", 0),
                tweet.optInt("likes", 0),
                mediaOf(tweet),
                quoteOf(tweet),
                pollOf(tweet));
    }

    /**
     * When the post was published, in milliseconds.
     *
     * <p>{@code created_timestamp} is the easy path; {@code created_at} is the
     * classic Twitter format ("Tue Mar 21 20:50:14 +0000 2006") and is only parsed
     * when the number is missing, because that is the field the API itself has kept
     * stable the longest. A post with neither has no date, which the row shows as
     * nothing rather than as 1970.
     */
    private static long createdAtMs(JSONObject tweet) {
        long seconds = tweet.optLong("created_timestamp", 0L);
        if (seconds > 0) return seconds * 1000L;

        String createdAt = tweet.optString("created_at", "");
        if (createdAt.isEmpty()) return 0L;
        try {
            SimpleDateFormat format =
                    new SimpleDateFormat("EEE MMM dd HH:mm:ss Z yyyy", Locale.US);
            Date when = format.parse(createdAt);
            return when == null ? 0L : when.getTime();
        } catch (Exception e) {
            return 0L;
        }
    }

    /**
     * The media, in the order the post shows it.
     *
     * <p>{@code media.all} preserves that order across photos and videos; the
     * separate arrays are the fallback for a reply that predates it.
     */
    private static List<Media> mediaOf(JSONObject tweet) {
        List<Media> out = new ArrayList<>();
        JSONObject media = tweet.optJSONObject("media");
        if (media == null) return out;

        JSONArray all = media.optJSONArray("all");
        if (all != null) {
            for (int i = 0; i < all.length(); i++) {
                addMedia(out, all.optJSONObject(i));
            }
            if (!out.isEmpty()) return out;
        }

        JSONArray photos = media.optJSONArray("photos");
        if (photos != null) {
            for (int i = 0; i < photos.length(); i++) addPhoto(out, photos.optJSONObject(i));
        }
        JSONArray videos = media.optJSONArray("videos");
        if (videos != null) {
            for (int i = 0; i < videos.length(); i++) addVideo(out, videos.optJSONObject(i));
        }
        return out;
    }

    private static void addMedia(List<Media> out, JSONObject item) {
        if (item == null) return;
        String type = item.optString("type", "");
        if ("video".equals(type) || "gif".equals(type)) {
            addVideo(out, item);
        } else {
            addPhoto(out, item);
        }
    }

    private static void addPhoto(List<Media> out, JSONObject photo) {
        if (photo == null) return;
        String url = photo.optString("url", "");
        if (url.isEmpty()) return;
        out.add(new Media(url, "", photo.optInt("width", 0), photo.optInt("height", 0), 0, false));
    }

    private static void addVideo(List<Media> out, JSONObject video) {
        if (video == null) return;
        String thumbnail = video.optString("thumbnail_url", "");
        String file = video.optString("url", "");
        if (thumbnail.isEmpty() && file.isEmpty()) return;
        out.add(new Media(
                thumbnail.isEmpty() ? file : thumbnail,
                file,
                video.optInt("width", 0),
                video.optInt("height", 0),
                video.optDouble("duration", 0),
                true));
    }

    private static Quote quoteOf(JSONObject tweet) {
        JSONObject quote = tweet.optJSONObject("quote");
        if (quote == null) return null;
        JSONObject author = quote.optJSONObject("author");
        return new Quote(
                author == null ? "" : author.optString("name", ""),
                author == null ? "" : author.optString("screen_name", ""),
                quote.optString("text", ""));
    }

    private static List<PollChoice> pollOf(JSONObject tweet) {
        List<PollChoice> out = new ArrayList<>();
        JSONObject poll = tweet.optJSONObject("poll");
        if (poll == null) return out;
        JSONArray choices = poll.optJSONArray("choices");
        if (choices == null) return out;
        for (int i = 0; i < choices.length(); i++) {
            JSONObject choice = choices.optJSONObject(i);
            if (choice == null) continue;
            String label = choice.optString("label", "");
            if (label.isEmpty()) continue;
            out.add(new PollChoice(label, (int) Math.round(choice.optDouble("percentage", 0))));
        }
        return out;
    }

    /** The error stream carries the reason for a 4xx/5xx, so both are read. */
    private static String read(HttpURLConnection connection, int status) {
        InputStream stream = null;
        try {
            stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) return "";
            StringBuilder builder = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    builder.append(line);
                }
            }
            return builder.toString();
        } catch (IOException e) {
            return "";
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }
}
