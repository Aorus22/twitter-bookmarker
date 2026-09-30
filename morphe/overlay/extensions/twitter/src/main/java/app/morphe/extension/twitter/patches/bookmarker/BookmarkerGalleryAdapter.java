/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.morphe.extension.shared.Logger;
import app.morphe.extension.shared.Utils;

/**
 * The two lists the gallery draws, and the thumbnails they need.
 *
 * <p>Rows are recycled the way {@code ListView} expects — a row is a small view
 * group that knows how to rebind itself, and {@code convertView} is reused when it
 * is one of ours. Rebinding matters for more than speed here: an image load that
 * completes after its row scrolled away must not paint into the view that took its
 * place, so every row stamps the URL it is waiting for and the loader compares.
 */
final class BookmarkerGalleryAdapter {

    private BookmarkerGalleryAdapter() {}

    /** The folder list: a colour bar, the name, and how much is in it. */
    static final class FolderAdapter extends BaseAdapter {

        private final BookmarkerGalleryActivity activity;
        private final List<BookmarkerApi.Collection> items = new ArrayList<>();

        FolderAdapter(BookmarkerGalleryActivity activity) {
            this.activity = activity;
        }

        void setItems(List<BookmarkerApi.Collection> collections) {
            items.clear();
            if (collections != null) items.addAll(collections);
            notifyDataSetChanged();
        }

        BookmarkerApi.Collection itemAt(int position) {
            if (position < 0 || position >= items.size()) return null;
            return items.get(position);
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Object getItem(int position) {
            return itemAt(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            FolderRow row = convertView instanceof FolderRow ? (FolderRow) convertView : new FolderRow(activity);
            row.bind(itemAt(position));
            return row;
        }

    }

    /** One folder row. */
    static final class FolderRow extends LinearLayout {

        private final BookmarkerGalleryActivity activity;
        private final View colorBar;
        private final TextView nameView;
        private final TextView countView;

        FolderRow(BookmarkerGalleryActivity activity) {
            super(activity);
            this.activity = activity;
            setOrientation(HORIZONTAL);
            setGravity(Gravity.CENTER_VERTICAL);
            setPadding(0, dp(activity, 12), 0, dp(activity, 12));
            // A ListView casts its children's layout params to its own type, so a
            // row that arrives carrying LinearLayout's would crash the list.
            setLayoutParams(new AbsListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            colorBar = new View(activity);
            LayoutParams barParams = new LayoutParams(dp(activity, 6), dp(activity, 36));
            barParams.setMarginEnd(dp(activity, 12));
            colorBar.setLayoutParams(barParams);
            addView(colorBar);

            LinearLayout text = new LinearLayout(activity);
            text.setOrientation(VERTICAL);
            text.setLayoutParams(new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            nameView = new TextView(activity);
            nameView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            text.addView(nameView);

            countView = new TextView(activity);
            countView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            countView.setTextColor(activity.mutedColor());
            text.addView(countView);

            addView(text);

            TextView arrow = new TextView(activity);
            arrow.setText("\u203a");
            arrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
            arrow.setTextColor(activity.mutedColor());
            arrow.setPadding(dp(activity, 8), 0, 0, 0);
            addView(arrow);
        }

        void bind(BookmarkerApi.Collection collection) {
            if (collection == null) return;
            nameView.setText(collection.name);
            nameView.setTextColor(activity.textColor());
            countView.setText(collection.postCount == 1
                    ? "1 bookmark"
                    : collection.postCount + " bookmarks");

            GradientDrawable bar = new GradientDrawable();
            bar.setCornerRadius(dp(getContext(), 3));
            bar.setColor(colorOf(collection));
            colorBar.setBackground(bar);
        }
    }

    /** One collection's bookmarks, plus a trailing "load more" row while paging. */
    static final class PostAdapter extends BaseAdapter {

        private final BookmarkerGalleryActivity activity;
        private final List<BookmarkerApi.Post> items = new ArrayList<>();
        private boolean showFooter;

        PostAdapter(BookmarkerGalleryActivity activity) {
            this.activity = activity;
        }

        /**
         * @param posts the list the Activity keeps appending to; it is copied so a
         *              page arriving mid-render cannot change the count underneath
         *              {@code ListView}.
         */
        void setItems(List<BookmarkerApi.Post> posts, boolean hasMore) {
            items.clear();
            if (posts != null) items.addAll(posts);
            showFooter = hasMore;
            notifyDataSetChanged();
        }

        @Override
        public int getCount() {
            return items.size() + (showFooter ? 1 : 0);
        }

        @Override
        public Object getItem(int position) {
            return position < items.size() ? items.get(position) : null;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            if (position >= items.size()) {
                return convertView instanceof FooterRow ? convertView : new FooterRow(activity);
            }
            PostRow row = convertView instanceof PostRow ? (PostRow) convertView : new PostRow(activity);
            row.bind(items.get(position));
            return row;
        }
    }

    /** One bookmark card: who, what, when, and the first image if there is one. */
    static final class PostRow extends LinearLayout {

        private final TextView headerView;
        private final TextView textView;
        private final ImageView imageView;
        private final TextView mediaNoteView;
        private final TextView footerView;

        /** The URL this row is waiting for, so a late answer can be ignored. */
        private String pendingUrl = "";

        PostRow(BookmarkerGalleryActivity activity) {
            super(activity);
            setOrientation(VERTICAL);
            // The row itself is only the gap between two cards: the rounded
            // background belongs to the inner view, because a ListView child cannot
            // carry layout margins (it casts its children's params to
            // AbsListView.LayoutParams, which has none) and a margin is the only way
            // to keep two touching cards apart.
            setLayoutParams(new AbsListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            setPadding(0, dp(activity, 4), 0, dp(activity, 8));

            LinearLayout card = new LinearLayout(activity);
            card.setOrientation(VERTICAL);
            GradientDrawable background = new GradientDrawable();
            background.setCornerRadius(dp(activity, 16));
            background.setColor(activity.cardColor());
            card.setBackground(background);
            int padding = dp(activity, 12);
            card.setPadding(padding, padding, padding, padding);
            card.setLayoutParams(new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            addView(card);

            headerView = new TextView(activity);
            headerView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            headerView.setSingleLine(true);
            headerView.setEllipsize(TextUtils.TruncateAt.END);
            card.addView(headerView);

            textView = new TextView(activity);
            textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            textView.setMaxLines(10);
            textView.setEllipsize(TextUtils.TruncateAt.END);
            textView.setPadding(0, dp(activity, 6), 0, 0);
            card.addView(textView);

            imageView = new ImageView(activity);
            imageView.setScaleType(ImageView.ScaleType.CENTER_CROP);
            imageView.setVisibility(View.GONE);
            LayoutParams imageParams = new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 180));
            imageParams.setMargins(0, dp(activity, 8), 0, 0);
            imageView.setLayoutParams(imageParams);
            card.addView(imageView);

            mediaNoteView = new TextView(activity);
            mediaNoteView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            mediaNoteView.setTextColor(activity.mutedColor());
            mediaNoteView.setPadding(0, dp(activity, 4), 0, 0);
            mediaNoteView.setVisibility(View.GONE);
            card.addView(mediaNoteView);

            footerView = new TextView(activity);
            footerView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            footerView.setTextColor(activity.mutedColor());
            footerView.setPadding(0, dp(activity, 6), 0, 0);
            card.addView(footerView);
        }

        void bind(BookmarkerApi.Post post) {
            BookmarkerGalleryActivity activity = (BookmarkerGalleryActivity) getContext();
            headerView.setTextColor(activity.textColor());
            textView.setTextColor(activity.textColor());

            String handle = post.username == null || post.username.isEmpty() ? "" : " " + post.username;
            headerView.setText((post.author.isEmpty() ? "unknown" : post.author) + handle
                    + " \u00b7 " + shortDate(post.tweetDate));

            textView.setText(post.text);
            textView.setVisibility(post.text == null || post.text.isEmpty() ? View.GONE : View.VISIBLE);

            footerView.setText(post.savedAt.isEmpty()
                    ? "Saved"
                    : "Saved " + shortDate(post.savedAt));

            if (post.media.isEmpty()) {
                pendingUrl = "";
                imageView.setTag("");
                imageView.setImageDrawable(null);
                imageView.setVisibility(View.GONE);
                mediaNoteView.setVisibility(View.GONE);
                return;
            }

            String url = post.media.get(0);
            imageView.setVisibility(View.VISIBLE);
            mediaNoteView.setVisibility(post.media.size() > 1 ? View.VISIBLE : View.GONE);
            mediaNoteView.setText("+" + (post.media.size() - 1) + " more");

            if (url.equals(pendingUrl) && imageView.getDrawable() != null) return;
            pendingUrl = url;
            imageView.setTag(url);
            imageView.setImageDrawable(null);
            Thumbnails.load(url, imageView, 640);
        }
    }

    /** The trailing row that asks for the next page. */
    static final class FooterRow extends LinearLayout {

        FooterRow(BookmarkerGalleryActivity activity) {
            super(activity);
            setOrientation(VERTICAL);
            setGravity(Gravity.CENTER);
            setPadding(0, dp(activity, 18), 0, dp(activity, 18));
            setLayoutParams(new AbsListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

            TextView label = new TextView(activity);
            label.setText("Load more");
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            label.setTextColor(activity.mutedColor());
            addView(label);
        }
    }

    /**
     * Decoded thumbnails, shared by every row.
     *
     * <p>An {@code LruCache} sized to an eighth of the heap is the standard budget
     * for a list like this: big enough that scrolling back up is instant, small
     * enough that a long gallery cannot push the app into an OOM.
     */
    static final class Thumbnails {

        private static final int MAX_BYTES = 2 * 1024 * 1024;

        private static final LruCache<String, Bitmap> CACHE = new LruCache<String, Bitmap>(
                (int) (Runtime.getRuntime().maxMemory() / 1024 / 8)) {
            @Override
            protected int sizeOf(String key, Bitmap value) {
                return value.getByteCount() / 1024;
            }
        };

        private Thumbnails() {}

        /**
         * Loads an image into a row's view, off the main thread.
         *
         * <p>The row's tag is checked again on the main thread: by then the view may
         * have been recycled for a different bookmark, and painting a stale bitmap
         * into it would show one tweet's image under another tweet's text.
         */
        static void load(final String url, final ImageView target, final int maxWidthPx) {
            String key = url;
            Bitmap cached = CACHE.get(key);
            if (cached != null) {
                target.setImageBitmap(cached);
                return;
            }

            Utils.runOnBackgroundThread(() -> {
                final Bitmap bitmap = download(url, maxWidthPx);
                if (bitmap == null) return;
                CACHE.put(key, bitmap);
                Utils.runOnMainThread(() -> {
                    if (url.equals(target.getTag())) target.setImageBitmap(bitmap);
                });
            });
        }

        /** Bytes first, then a downsampled decode, so a huge photo is never decoded whole. */
        private static Bitmap download(String url, int maxWidthPx) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(10000);
                connection.setInstanceFollowRedirects(true);

                byte[] bytes = readCapped(connection.getInputStream(), MAX_BYTES);
                if (bytes == null || bytes.length == 0) return null;

                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = sampleSize(bounds.outWidth, maxWidthPx);
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            } catch (Exception e) {
                Logger.printInfo(() -> "twb: could not load a thumbnail: " + e);
                return null;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        private static int sampleSize(int width, int maxWidthPx) {
            int sample = 1;
            if (width <= 0 || maxWidthPx <= 0) return sample;
            while (width / sample > maxWidthPx * 2) {
                sample *= 2;
            }
            return sample;
        }

        /**
         * Reads at most {@code cap} bytes, then gives up on the download.
         *
         * <p>A media URL that is not an image — a redirect to an HTML page, a video
         * — would otherwise be read into memory in full before being discarded.
         */
        private static byte[] readCapped(InputStream stream, int cap) {
            if (stream == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            try {
                int read;
                while ((read = stream.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    if (out.size() >= cap) break;
                }
            } catch (Exception e) {
                return null;
            } finally {
                try {
                    stream.close();
                } catch (Exception ignored) {
                }
            }
            return out.toByteArray();
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Shared helpers                                                         */
    /* ---------------------------------------------------------------------- */

    private static int colorOf(BookmarkerApi.Collection collection) {
        try {
            return android.graphics.Color.parseColor(BookmarkerApi.displayColor(collection));
        } catch (Exception e) {
            // The backend validates the format, so this is only reachable through a
            // hand-edited database; the shared default is still a colour.
            return android.graphics.Color.parseColor(BookmarkerApi.DEFAULT_COLLECTION_COLOR);
        }
    }

    /**
     * An RFC 3339 instant as a short local date and time.
     *
     * <p>The archive stores instants in UTC, and a reader wants their own clock:
     * "01:05" is what the timeline showed, not what the database holds.
     */
    static String shortDate(String rfc3339) {
        if (rfc3339 == null || rfc3339.isEmpty()) return "";
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            parser.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            Date when = parser.parse(rfc3339.substring(0, Math.min(19, rfc3339.length())));
            if (when == null) return rfc3339;
            return new SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault()).format(when);
        } catch (Exception e) {
            // A date this client cannot read is still information; showing the raw
            // value beats showing nothing.
            return rfc3339;
        }
    }

    static int dp(Context context, int value) {
        return (int) (value * context.getResources().getDisplayMetrics().density);
    }
}
