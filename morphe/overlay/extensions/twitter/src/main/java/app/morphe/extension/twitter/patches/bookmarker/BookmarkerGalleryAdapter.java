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
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.Typeface;
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
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import app.morphe.extension.shared.Logger;
import app.morphe.extension.shared.ResourceType;
import app.morphe.extension.shared.ResourceUtils;
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
            setPadding(dp(activity, 12), dp(activity, 12), dp(activity, 12), dp(activity, 12));
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
            row.bind(items.get(position), this::notifyDataSetChanged);
            return row;
        }
    }

    /**
     * One post, drawn the way X draws one: the avatar, the name and handle line, the
     * text, the media, a quoted post and a poll, then the numbers.
     *
     * <p>The content comes from {@link FxTweet} once that answer lands and from the
     * archive until then. That order matters twice over: the list is painted from what
     * the database already holds, so it never waits on a third party, and a post that
     * is private, deleted or unreachable keeps showing the copy the user saved rather
     * than showing nothing.
     *
     * <p>Nothing in here is a button. The numbers are text, the media is not zoomable,
     * the video does not play — a tap anywhere in the row opens the post in X, which
     * is where the replies, the likes and the video actually live.
     */
    static final class PostRow extends LinearLayout {

        /** How tall a cell of a two-column media grid is. */
        private static final int GRID_HEIGHT_DP = 150;

        /** Replies, reposts, likes, views — the four numbers X puts under a post. */
        private static final int STAT_COUNT = 4;
        private static final int STAT_REPLIES = 0;
        private static final int STAT_REPOSTS = 1;
        private static final int STAT_LIKES = 2;
        private static final int STAT_VIEWS = 3;

        /**
         * The names each stat's glyph has gone by, tried in order.
         *
         * <p>None of these is a contract — X renames its own drawables like it
         * renames everything else — and unlike the verified badge Piko references
         * only one of the four ({@code ic_vector_heartline}), so the other three are
         * guesses with fallbacks. The strip is therefore all four glyphs or none:
         * one heart beside three bare numbers would read as a different kind of row,
         * and a drawable that moved must not look like a design decision. The numbers
         * are the information, and they are drawn either way.
         */
        private static final String[][] STAT_ICONS = {
                {"ic_vector_reply", "ic_vector_reply_stroke", "ic_vector_comment",
                        "ic_vector_chat_stroke"},
                {"ic_vector_retweet", "ic_vector_retweet_stroke", "ic_vector_repost"},
                {"ic_vector_heartline", "ic_vector_heart", "ic_vector_heart_stroke",
                        "ic_vector_like", "ic_vector_favorite"},
                {"ic_vector_views", "ic_vector_view", "ic_vector_analytics",
                        "ic_vector_chart_stroke"},
        };

        /**
         * What those names resolved to, once.
         *
         * <p>Static rather than per row: the answer is a property of the installed
         * build, it cannot change while the process lives, and a name lookup is not
         * free — a row is constructed every time one scrolls into view.
         */
        private static final int[] STAT_GLYPHS = resolveStatGlyphs();
        private static final boolean STAT_GLYPHS_COMPLETE = allResolved(STAT_GLYPHS);

        /** Bounds for a lone photo, so neither a panorama nor a sticker looks broken. */
        private static final int SINGLE_MIN_DP = 120;
        private static final int SINGLE_MAX_DP = 320;

        private final ImageView avatarView;
        private final TextView nameView;
        private final ImageView verifiedView;
        private final TextView metaView;
        private final TextView textView;
        private final LinearLayout mediaBox;
        private final LinearLayout[] mediaRows = new LinearLayout[2];
        private final ImageView[] mediaCells = new ImageView[4];
        private final TextView mediaNoteView;
        private final LinearLayout quoteBox;
        private final TextView quoteHeaderView;
        private final TextView quoteTextView;
        private final LinearLayout pollBox;
        private final LinearLayout actionBar;
        private final ImageView[] statIcons = new ImageView[STAT_COUNT];
        private final TextView[] statCounts = new TextView[STAT_COUNT];
        private final TextView noteView;
        private final TextView footerView;

        /** X's verified glyph, if this build of the app has one under that name. */
        private final int verifiedBadgeId;
        /** What each image view is currently waiting for, so a rebind can skip work. */
        private String avatarTag = "";
        private final String[] mediaTags = new String[4];

        PostRow(BookmarkerGalleryActivity activity) {
            super(activity);
            setOrientation(HORIZONTAL);
            // A ListView child cannot carry layout margins: it casts its children's
            // params to AbsListView.LayoutParams, which has none. Spacing inside the
            // row is therefore padding here and margins on the inner views.
            setLayoutParams(new AbsListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            int padding = dp(activity, 12);
            setPadding(padding, dp(activity, 10), padding, dp(activity, 10));
            setBackgroundColor(activity.backgroundColor());
            verifiedBadgeId = ResourceUtils.getIdentifier(ResourceType.DRAWABLE, "ic_vector_verified");

            avatarView = new ImageView(activity);
            avatarView.setScaleType(ImageView.ScaleType.CENTER_CROP);
            // The circle is the view's background, not the bitmap's job: an avatar
            // that is still loading, or that the archive never recorded, still
            // occupies its 40 dp and still looks like a face-sized hole rather than
            // letting the whole column slide left against the screen edge.
            avatarView.setBackground(circle(activity.placeholderColor()));
            LayoutParams avatarParams = new LayoutParams(dp(activity, 40), dp(activity, 40));
            avatarParams.setMargins(0, 0, dp(activity, 10), 0);
            avatarView.setLayoutParams(avatarParams);
            addView(avatarView);

            LinearLayout column = new LinearLayout(activity);
            column.setOrientation(VERTICAL);
            column.setLayoutParams(new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            addView(column);

            LinearLayout header = new LinearLayout(activity);
            header.setOrientation(HORIZONTAL);
            header.setGravity(Gravity.CENTER_VERTICAL);
            header.setLayoutParams(new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            column.addView(header);

            nameView = new TextView(activity);
            nameView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            nameView.setTypeface(Typeface.DEFAULT_BOLD);
            nameView.setSingleLine(true);
            nameView.setEllipsize(TextUtils.TruncateAt.END);
            header.addView(nameView);

            verifiedView = new ImageView(activity);
            int badgeSize = dp(activity, 16);
            LayoutParams badgeParams = new LayoutParams(badgeSize, badgeSize);
            badgeParams.setMargins(dp(activity, 3), 0, 0, 0);
            verifiedView.setLayoutParams(badgeParams);
            verifiedView.setVisibility(GONE);
            header.addView(verifiedView);

            metaView = new TextView(activity);
            metaView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            metaView.setSingleLine(true);
            metaView.setEllipsize(TextUtils.TruncateAt.END);
            LayoutParams metaParams = new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            metaParams.setMargins(dp(activity, 4), 0, 0, 0);
            metaView.setLayoutParams(metaParams);
            header.addView(metaView);

            textView = new TextView(activity);
            textView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            textView.setMaxLines(8);
            textView.setEllipsize(TextUtils.TruncateAt.END);
            LayoutParams textParams = new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            textParams.setMargins(0, dp(activity, 3), 0, 0);
            textView.setLayoutParams(textParams);
            column.addView(textView);

            mediaBox = new LinearLayout(activity);
            mediaBox.setOrientation(VERTICAL);
            LayoutParams mediaBoxParams = new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            mediaBoxParams.setMargins(0, dp(activity, 8), 0, 0);
            mediaBox.setLayoutParams(mediaBoxParams);
            mediaBox.setVisibility(GONE);
            column.addView(mediaBox);

            for (int row = 0; row < mediaRows.length; row++) {
                LinearLayout mediaRow = new LinearLayout(activity);
                mediaRow.setOrientation(HORIZONTAL);
                LayoutParams rowParams = new LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                if (row > 0) rowParams.setMargins(0, dp(activity, 2), 0, 0);
                mediaRow.setLayoutParams(rowParams);
                for (int cell = 0; cell < 2; cell++) {
                    ImageView view = new ImageView(activity);
                    view.setScaleType(ImageView.ScaleType.CENTER_CROP);
                    // Same idea as the avatar: a photo that has not arrived is a grey
                    // box of exactly the size it will be, so the row does not grow a
                    // black hole that later turns into a picture.
                    view.setBackground(rounded(activity.placeholderColor(), dp(activity, 8)));
                    view.setLayoutParams(gridCellParams(activity, row * 2 + cell, false));
                    view.setVisibility(GONE);
                    mediaCells[row * 2 + cell] = view;
                    mediaRow.addView(view);
                }
                mediaRows[row] = mediaRow;
                mediaBox.addView(mediaRow);
            }

            mediaNoteView = new TextView(activity);
            mediaNoteView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            mediaNoteView.setTextColor(activity.mutedColor());
            mediaNoteView.setPadding(0, dp(activity, 4), 0, 0);
            mediaNoteView.setVisibility(GONE);
            mediaBox.addView(mediaNoteView);

            quoteBox = new LinearLayout(activity);
            quoteBox.setOrientation(VERTICAL);
            GradientDrawable quoteBackground = new GradientDrawable();
            quoteBackground.setCornerRadius(dp(activity, 12));
            quoteBackground.setColor(activity.cardColor());
            quoteBackground.setStroke(
                    Math.max(1, (int) (activity.getResources().getDisplayMetrics().density / 2f)),
                    activity.borderColor());
            quoteBox.setBackground(quoteBackground);
            quoteBox.setPadding(dp(activity, 10), dp(activity, 8), dp(activity, 10), dp(activity, 8));
            LayoutParams quoteParams = new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            quoteParams.setMargins(0, dp(activity, 8), 0, 0);
            quoteBox.setLayoutParams(quoteParams);
            quoteBox.setVisibility(GONE);
            column.addView(quoteBox);

            quoteHeaderView = new TextView(activity);
            quoteHeaderView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            quoteHeaderView.setTypeface(Typeface.DEFAULT_BOLD);
            quoteHeaderView.setSingleLine(true);
            quoteHeaderView.setEllipsize(TextUtils.TruncateAt.END);
            quoteBox.addView(quoteHeaderView);

            quoteTextView = new TextView(activity);
            quoteTextView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            quoteTextView.setMaxLines(3);
            quoteTextView.setEllipsize(TextUtils.TruncateAt.END);
            quoteTextView.setPadding(0, dp(activity, 2), 0, 0);
            quoteBox.addView(quoteTextView);

            pollBox = new LinearLayout(activity);
            pollBox.setOrientation(VERTICAL);
            LayoutParams pollParams = new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            pollParams.setMargins(0, dp(activity, 8), 0, 0);
            pollBox.setLayoutParams(pollParams);
            pollBox.setVisibility(GONE);
            column.addView(pollBox);

            actionBar = new LinearLayout(activity);
            actionBar.setOrientation(HORIZONTAL);
            LayoutParams actionParams = new LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            actionParams.setMargins(0, dp(activity, 8), 0, 0);
            actionBar.setLayoutParams(actionParams);
            actionBar.setVisibility(GONE);
            for (int stat = 0; stat < STAT_COUNT; stat++) {
                LinearLayout item = new LinearLayout(activity);
                item.setOrientation(HORIZONTAL);
                item.setGravity(Gravity.CENTER_VERTICAL);
                // Equal shares of the width, which is how X spreads them: the four
                // columns line up from one post to the next down the list.
                item.setLayoutParams(new LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

                statIcons[stat] = new ImageView(activity);
                int size = dp(activity, 16);
                LayoutParams iconParams = new LayoutParams(size, size);
                iconParams.setMargins(0, 0, dp(activity, 5), 0);
                statIcons[stat].setLayoutParams(iconParams);
                statIcons[stat].setColorFilter(activity.mutedColor());
                if (STAT_GLYPHS_COMPLETE) {
                    statIcons[stat].setImageResource(STAT_GLYPHS[stat]);
                } else {
                    statIcons[stat].setVisibility(GONE);
                }
                item.addView(statIcons[stat]);

                statCounts[stat] = new TextView(activity);
                statCounts[stat].setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                statCounts[stat].setTextColor(activity.mutedColor());
                statCounts[stat].setSingleLine(true);
                item.addView(statCounts[stat]);

                actionBar.addView(item);
            }
            column.addView(actionBar);

            noteView = new TextView(activity);
            noteView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            noteView.setTextColor(activity.mutedColor());
            noteView.setPadding(0, dp(activity, 6), 0, 0);
            noteView.setVisibility(GONE);
            column.addView(noteView);

            footerView = new TextView(activity);
            footerView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            footerView.setTextColor(activity.mutedColor());
            footerView.setPadding(0, dp(activity, 6), 0, 0);
            column.addView(footerView);
        }

        void bind(final BookmarkerApi.Post post, final Runnable onEnriched) {
            final BookmarkerGalleryActivity activity = (BookmarkerGalleryActivity) getContext();
            FxTweet.Row fx = post.fxRow;
            boolean live = fx != null && fx.usable();

            nameView.setTextColor(activity.textColor());
            textView.setTextColor(activity.textColor());
            metaView.setTextColor(activity.mutedColor());
            quoteHeaderView.setTextColor(activity.textColor());
            quoteTextView.setTextColor(activity.textColor());

            String name = live && !fx.authorName.isEmpty() ? fx.authorName : post.author;
            nameView.setText(name.isEmpty() ? "unknown" : name);

            String handle = live && !fx.authorUsername.isEmpty() ? fx.authorUsername : post.username;
            String when = live && fx.createdAtMs > 0
                    ? relativeTime(fx.createdAtMs)
                    : shortDate(post.tweetDate);
            metaView.setText(meta(handle, when));

            // The glyph is a drawable of X's, and its name is not part of any
            // contract: when the lookup finds nothing the row simply has no badge,
            // which is better than showing someone else's icon next to a name.
            verifiedView.setVisibility(live && fx.verified && verifiedBadgeId != 0 ? VISIBLE : GONE);
            if (live && fx.verified && verifiedBadgeId != 0) {
                verifiedView.setImageResource(verifiedBadgeId);
            }

            String text = live ? fx.text : post.text;
            textView.setText(text);
            textView.setVisibility(text == null || text.isEmpty() ? GONE : VISIBLE);

            layoutMedia(mediaOf(fx, post));
            layoutQuote(live ? fx.quote : null);
            layoutPoll(live && fx != null ? fx.poll : Collections.<FxTweet.PollChoice>emptyList());

            layoutActionBar(live ? fx : null);

            noteView.setText(note(fx));
            noteView.setVisibility(noteView.getText().length() == 0 ? GONE : VISIBLE);

            footerView.setText(post.savedAt.isEmpty() ? "Saved" : "Saved " + shortDate(post.savedAt));

            layoutAvatar(live ? fx.avatarUrl : "");

            // The archive's copy is on screen at this point; ask Twitter what the post
            // says today and rebind once. Nothing else in the row waits on that.
            activity.enrich(post, onEnriched);
        }

        private void layoutAvatar(String url) {
            if (url == null || url.isEmpty()) {
                // No picture to show — the normal case for a post drawn from the
                // archive alone. The view keeps its size and its placeholder circle,
                // so the text beside it starts where it starts in every other row.
                avatarTag = "";
                avatarView.setTag("");
                avatarView.setImageDrawable(null);
                return;
            }
            if (url.equals(avatarTag) && avatarView.getDrawable() != null) return;
            avatarTag = url;
            avatarView.setTag(url);
            avatarView.setImageDrawable(null);
            Thumbnails.loadAvatar(url, avatarView);
        }

        /**
         * The media, at most four of it.
         *
         * <p>One item takes the full width at its own aspect ratio when the API knows
         * it, and a grid of equal cells above that — which is what X does, and keeps
         * a tall photo from pushing the rest of the row off the screen.
         */
        private void layoutMedia(List<FxTweet.Media> media) {
            BookmarkerGalleryActivity activity = (BookmarkerGalleryActivity) getContext();
            for (int i = 0; i < mediaCells.length; i++) {
                mediaCells[i].setVisibility(GONE);
                mediaTags[i] = "";
                mediaCells[i].setTag("");
                mediaCells[i].setImageDrawable(null);
            }
            mediaRows[0].setVisibility(GONE);
            mediaRows[1].setVisibility(GONE);
            mediaNoteView.setVisibility(GONE);

            if (media.isEmpty()) {
                mediaBox.setVisibility(GONE);
                return;
            }
            mediaBox.setVisibility(VISIBLE);

            int count = Math.min(media.size(), 4);
            if (count == 1) {
                FxTweet.Media only = media.get(0);
                int width = singleMediaWidth(activity);
                int height = dp(activity, GRID_HEIGHT_DP);
                if (only.width > 0 && only.height > 0) {
                    height = (int) ((long) width * only.height / only.width);
                }
                height = Math.max(dp(activity, SINGLE_MIN_DP),
                        Math.min(height, dp(activity, SINGLE_MAX_DP)));
                mediaCells[0].setLayoutParams(new LayoutParams(width, height));
                mediaRows[0].setVisibility(VISIBLE);
                showCell(0, only);
            } else {
                // Three media is a full row and then one: the leftover cell takes the
                // whole width rather than leaving a hole where a fourth would be.
                boolean fullWidthLast = count == 3;
                for (int i = 0; i < count; i++) {
                    mediaCells[i].setLayoutParams(
                            gridCellParams(activity, i, fullWidthLast && i == 2));
                    mediaRows[i < 2 ? 0 : 1].setVisibility(VISIBLE);
                    showCell(i, media.get(i));
                }
            }

            if (media.size() > count || media.get(0).isVideo) {
                mediaNoteView.setText(mediaNote(media, count));
                mediaNoteView.setVisibility(VISIBLE);
            }
        }

        private void showCell(int index, FxTweet.Media item) {
            ImageView cell = mediaCells[index];
            cell.setVisibility(VISIBLE);
            if (item.thumbnailUrl.isEmpty()) {
                mediaTags[index] = "";
                cell.setTag("");
                cell.setImageDrawable(null);
                return;
            }
            if (item.thumbnailUrl.equals(mediaTags[index]) && cell.getDrawable() != null) return;
            mediaTags[index] = item.thumbnailUrl;
            cell.setTag(item.thumbnailUrl);
            cell.setImageDrawable(null);
            Thumbnails.load(item.thumbnailUrl, cell, 640);
        }

        /**
         * A cell of the media grid: half the width, a fixed height.
         *
         * <p>The params are rebuilt on every bind rather than reused, because the same
         * view is a half-width cell for four photos and the whole width for three.
         */
        private LayoutParams gridCellParams(
                BookmarkerGalleryActivity activity, int index, boolean fullWidth) {
            LayoutParams params = fullWidth
                    ? new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                            dp(activity, GRID_HEIGHT_DP))
                    : new LayoutParams(0, dp(activity, GRID_HEIGHT_DP), 1f);
            if (!fullWidth && index % 2 == 1) params.setMargins(dp(activity, 2), 0, 0, 0);
            return params;
        }

        /** The width a lone photo may take: the row, minus the avatar column. */
        private int singleMediaWidth(BookmarkerGalleryActivity activity) {
            int screen = activity.getResources().getDisplayMetrics().widthPixels;
            return Math.max(dp(activity, 120), screen - dp(activity, 12 + 40 + 10 + 12));
        }

        /**
         * The four numbers, as icons and figures rather than a sentence.
         *
         * <p>When the live post never arrived there are no numbers to show, and the
         * row does not invent zeroes: the glyphs stay, greyed and without a figure,
         * which is the shape of X's own action bar and says "the numbers are in the
         * app" instead of claiming the post has no likes. A row where not one glyph
         * resolved has nothing to draw at all, and draws nothing.
         */
        private void layoutActionBar(FxTweet.Row fx) {
            int[] counts = new int[STAT_COUNT];
            boolean[] known = new boolean[STAT_COUNT];
            if (fx != null) {
                counts[STAT_REPLIES] = fx.replies;
                counts[STAT_REPOSTS] = fx.retweets;
                counts[STAT_LIKES] = fx.likes;
                counts[STAT_VIEWS] = fx.views;
                known[STAT_REPLIES] = true;
                known[STAT_REPOSTS] = true;
                known[STAT_LIKES] = true;
                // A negative view count is the API saying it does not have one; the
                // other three are always numbers, zero included.
                known[STAT_VIEWS] = fx.views >= 0;
            }

            boolean anything = false;
            for (int stat = 0; stat < STAT_COUNT; stat++) {
                boolean hasGlyph = statIcons[stat].getVisibility() == VISIBLE;
                boolean hasNumber = known[stat] && counts[stat] > 0;
                if (hasNumber) {
                    statCounts[stat].setText(NumberFormat.getIntegerInstance(Locale.getDefault())
                            .format(counts[stat]));
                } else {
                    statCounts[stat].setText("");
                }
                statCounts[stat].setVisibility(hasNumber ? VISIBLE : GONE);
                if (hasGlyph || hasNumber) anything = true;
            }
            actionBar.setVisibility(anything ? VISIBLE : GONE);
        }

        /** Every glyph in a resolved set, so the strip can be all or nothing. */
        private static boolean allResolved(int[] glyphs) {
            for (int glyph : glyphs) {
                if (glyph == 0) return false;
            }
            return true;
        }

        private static int[] resolveStatGlyphs() {
            int[] glyphs = new int[STAT_COUNT];
            for (int stat = 0; stat < STAT_COUNT; stat++) glyphs[stat] = statIconId(stat);
            return glyphs;
        }

        /** The first drawable name from a stat's list that this build actually has. */
        private static int statIconId(int stat) {
            for (String name : STAT_ICONS[stat]) {
                int id = ResourceUtils.getIdentifier(ResourceType.DRAWABLE, name);
                if (id != 0) return id;
            }
            return 0;
        }

        /** A filled circle of one colour: the avatar's placeholder. */
        private static GradientDrawable circle(int color) {
            GradientDrawable shape = new GradientDrawable();
            shape.setShape(GradientDrawable.OVAL);
            shape.setColor(color);
            return shape;
        }

        /** A filled rounded rectangle: a media cell's placeholder. */
        private static GradientDrawable rounded(int color, int radius) {
            GradientDrawable shape = new GradientDrawable();
            shape.setCornerRadius(radius);
            shape.setColor(color);
            return shape;
        }

        private void layoutQuote(FxTweet.Quote quote) {
            if (quote == null) {
                quoteBox.setVisibility(GONE);
                return;
            }
            quoteBox.setVisibility(VISIBLE);
            String handle = quote.authorUsername.isEmpty() ? "" : "@" + quote.authorUsername;
            if (quote.authorName.isEmpty()) {
                quoteHeaderView.setText(handle);
            } else {
                quoteHeaderView.setText(
                        handle.isEmpty() ? quote.authorName : quote.authorName + "  " + handle);
            }
            quoteTextView.setText(quote.text);
        }

        private void layoutPoll(List<FxTweet.PollChoice> poll) {
            pollBox.removeAllViews();
            if (poll.isEmpty()) {
                pollBox.setVisibility(GONE);
                return;
            }
            pollBox.setVisibility(VISIBLE);
            BookmarkerGalleryActivity activity = (BookmarkerGalleryActivity) getContext();
            for (FxTweet.PollChoice choice : poll) {
                TextView row = new TextView(activity);
                row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
                row.setTextColor(activity.textColor());
                row.setSingleLine(true);
                row.setEllipsize(TextUtils.TruncateAt.END);
                row.setText(choice.label + "  \u2014  " + choice.percentage + "%");
                pollBox.addView(row);
            }
        }

        /** The archive's own media, for a post Twitter will not describe. */
        private static List<FxTweet.Media> mediaOf(FxTweet.Row fx, BookmarkerApi.Post post) {
            if (fx != null && fx.usable()) return fx.media;
            if (post.media.isEmpty()) return Collections.emptyList();
            List<FxTweet.Media> out = new ArrayList<>(post.media.size());
            for (String url : post.media) {
                out.add(new FxTweet.Media(url, "", 0, 0, 0, false));
            }
            return out;
        }

        /** "{@code @handle · 3h}", or whichever half the post actually has. */
        private static String meta(String username, String when) {
            StringBuilder builder = new StringBuilder();
            if (username != null && !username.isEmpty()) builder.append('@').append(username);
            if (when != null && !when.isEmpty()) {
                if (builder.length() > 0) builder.append(" \u00b7 ");
                builder.append(when);
            }
            return builder.toString();
        }

        /** The muted line under the media: what kind it is, and how much is hidden. */
        private static String mediaNote(List<FxTweet.Media> media, int shown) {
            StringBuilder builder = new StringBuilder();
            FxTweet.Media first = media.get(0);
            if (first.isVideo) {
                builder.append("Video");
                if (first.durationSeconds > 0) {
                    builder.append(" \u00b7 ").append(duration(first.durationSeconds));
                }
            }
            if (media.size() > shown) {
                if (builder.length() > 0) builder.append(" \u00b7 ");
                builder.append('+').append(media.size() - shown).append(" more");
            }
            return builder.toString();
        }

        private static String duration(double seconds) {
            int total = (int) Math.round(seconds);
            int minutes = total / 60;
            int rest = total % 60;
            return minutes + ":" + (rest < 10 ? "0" : "") + rest;
        }

        /**
         * Why this row is showing the archive's copy instead of the post.
         *
         * <p>Empty when there is nothing to explain: either the post came back, or it
         * has not been asked for yet. A failure the user cannot act on is not worth a
         * line of the screen.
         */
        private static String note(FxTweet.Row fx) {
            if (fx == null) return "";
            if (fx.isPrivate()) {
                return "This post is private, so this is the copy saved in the archive.";
            }
            if (fx.code == FxTweet.NOT_FOUND) {
                return "This post is no longer on X, so this is the copy saved in the archive.";
            }
            return "";
        }

        /**
         * When a post was published, the way a timeline says it: minutes and hours
         * for today, a date after that.
         */
        static String relativeTime(long millis) {
            if (millis <= 0) return "";
            long minutes = (System.currentTimeMillis() - millis) / 60000L;
            if (minutes < 1) return "now";
            if (minutes < 60) return minutes + "m";
            long hours = minutes / 60L;
            if (hours < 24) return hours + "h";
            String pattern = hours < 24 * 7 ? "d MMM" : "d MMM yyyy";
            return new SimpleDateFormat(pattern, Locale.getDefault()).format(new Date(millis));
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

        /**
         * The images' own threads, four of them.
         *
         * <p>Separate from both the live-post fetches and the app's shared background
         * executor, so a slow host on either side cannot hold up the other: four
         * downloads at once is what fills a screen of thumbnails while the scroll is
         * still moving, and a queue that never grows past four is what keeps a long
         * collection from opening a connection per row.
         */
        private static final java.util.concurrent.ExecutorService POOL =
                BookmarkerThreads.fixedPool("twb-image", 4);

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

            POOL.execute(() -> {
                final Bitmap bitmap = download(url, maxWidthPx);
                if (bitmap == null) return;
                CACHE.put(key, bitmap);
                Utils.runOnMainThread(() -> {
                    if (url.equals(target.getTag())) target.setImageBitmap(bitmap);
                });
            });
        }

        /**
         * Loads a profile picture into a row, circular.
         *
         * <p>A separate cache entry from the square one, because the round bitmap is a
         * different bitmap: keyed by URL plus a suffix so the two can never be confused.
         */
        static void loadAvatar(final String url, final ImageView target) {
            if (url == null || url.isEmpty()) return;

            final String key = url + "#circle";
            Bitmap cached = CACHE.get(key);
            if (cached != null) {
                target.setImageBitmap(cached);
                return;
            }

            POOL.execute(() -> {
                Bitmap source = download(url, 128);
                if (source == null) return;
                final Bitmap round = circular(source);
                CACHE.put(url, source);
                CACHE.put(key, round);
                Utils.runOnMainThread(() -> {
                    if (url.equals(target.getTag())) target.setImageBitmap(round);
                });
            });
        }

        /**
         * The same bitmap, clipped to a circle.
         *
         * <p>Drawn into a fresh bitmap rather than done with a custom drawable: this
         * canvas is software-backed, so the xfer mode behaves the same on every device,
         * while clipping a hardware canvas would depend on the API level and leave the
         * corners to the view's own background.
         */
        private static Bitmap circular(Bitmap source) {
            int size = Math.min(source.getWidth(), source.getHeight());
            if (size <= 0) return source;

            Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            canvas.drawBitmap(source,
                    new Rect(0, 0, source.getWidth(), source.getHeight()),
                    new Rect(0, 0, size, size),
                    paint);
            // Keep what the circle covers, drop everything else.
            paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.DST_IN));
            canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
            return out;
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
