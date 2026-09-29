/*
 * Copyright (C) 2026 piko <https://github.com/crimera/piko>
 *
 * See the included NOTICE file for GPLv3 §7(b) terms that apply to this code.
 *
 * Part of the Twitter Bookmarker overlay: see morphe/README.md. The button
 * plumbing mirrors Piko's InlineDownloadButton, which already solves "put a
 * clickable icon on the tweet inline action bar" for this app version.
 */

package app.morphe.extension.twitter.patches.bookmarker;

import android.content.Context;
import android.content.res.ColorStateList;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import app.morphe.extension.shared.Logger;
import app.morphe.extension.shared.ResourceType;
import app.morphe.extension.shared.ResourceUtils;
import app.morphe.extension.shared.Utils;
import app.morphe.extension.twitter.entity.Tweet;

/**
 * The save button on the tweet inline action bar: a sibling of the native
 * bookmark action, never a replacement for it.
 *
 * <p>Phase 2 skeleton. The click reads the tweet out of the action bar and shows
 * its URL, so a hooked-but-wrong build is obvious. Nothing is sent anywhere and
 * the app's own bookmark state is never touched.
 */
@SuppressWarnings("unused")
public class SaveButton {

    private static final String WRAPPER_TAG = "twb_save_wrapper";
    private static final String ICON_NAME = "ic_twb_bookmark";

    /** Last-resort icon, borrowed from the app, if our own resource is missing. */
    private static final String FALLBACK_ICON_NAME = "ic_vector_incoming";

    /** Neutral grey that reads on both X themes, used when no sibling tint is found. */
    private static final int FALLBACK_TINT = 0xFF536471;

    private static final Map<Class<?>, Field> FIELD_CACHE = new ConcurrentHashMap<>();

    /**
     * Placeholder rewritten at patch time to the field name the app really uses.
     * Never call this expecting the literal back.
     */
    private static String getTweetFieldName() {
        return "mTweet";
    }

    /**
     * Called from the patched {@code InlineActionBar.onFinishInflate}.
     *
     * <p>Posted rather than run inline: the bar has no children until it is laid
     * out, and the sibling styling below needs a child to copy from.
     */
    public static void onFinishInflate(ViewGroup inlineActionBar) {
        if (inlineActionBar == null) return;
        inlineActionBar.post(() -> {
            try {
                addSaveButton(inlineActionBar);
            } catch (Exception e) {
                Logger.printException(() -> "twb: could not add the save button", e);
            }
        });
    }

    private static void addSaveButton(ViewGroup inlineActionBar) {
        ViewParent currentParent = inlineActionBar.getParent();
        if (currentParent instanceof LinearLayout
                && WRAPPER_TAG.equals(((LinearLayout) currentParent).getTag())) {
            // The bar is recycled by the list; it is already ours.
            return;
        }
        if (!(currentParent instanceof ViewGroup)) return;

        ViewGroup parent = (ViewGroup) currentParent;
        int index = parent.indexOfChild(inlineActionBar);
        ViewGroup.LayoutParams originalLayoutParams = inlineActionBar.getLayoutParams();
        Context context = inlineActionBar.getContext();

        parent.removeView(inlineActionBar);

        LinearLayout wrapper = new LinearLayout(context);
        wrapper.setOrientation(LinearLayout.HORIZONTAL);
        wrapper.setGravity(Gravity.CENTER_VERTICAL);
        wrapper.setTag(WRAPPER_TAG);

        // The bar keeps the width of the actions it holds; the button adds one
        // more, so on a focal tweet the row stays evenly distributed.
        float barWeight = Math.max(1, visibleActionCount(inlineActionBar));
        wrapper.addView(
                inlineActionBar,
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, barWeight));

        ImageView icon = new ImageView(context);
        icon.setImageResource(iconResourceId());
        icon.setScaleType(ImageView.ScaleType.CENTER);

        FrameLayout container = new FrameLayout(context);
        container.setClickable(true);
        container.setLongClickable(true);
        container.setFocusable(true);
        container.setContentDescription("Save to Twitter Bookmarker");
        container.addView(
                icon,
                new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.CENTER));
        container.setOnClickListener(v -> onSaveClicked(inlineActionBar));

        wrapper.addView(
                container,
                new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));

        parent.addView(wrapper, index, originalLayoutParams);

        // Copy the look of the action next to us once the bar has real children,
        // so the button is not a differently sized odd one out.
        wrapper.post(() -> syncFromNeighbour(inlineActionBar, container, icon));
    }

    private static void onSaveClicked(ViewGroup inlineActionBar) {
        try {
            Object rawTweet = readField(inlineActionBar, getTweetFieldName());
            if (rawTweet == null) {
                Utils.showToastShort("Twitter Bookmarker: no tweet data");
                return;
            }

            String link = new Tweet(rawTweet).getTweetLink();
            Logger.printInfo(() -> "twb: tapped " + link);
            Utils.showToastShort("Twitter Bookmarker: " + link);
        } catch (Exception e) {
            Logger.printException(() -> "twb: could not read the tweet", e);
            Utils.showToastShort("Twitter Bookmarker: could not read the tweet");
        }
    }

    private static int iconResourceId() {
        int id = ResourceUtils.getIdentifier(ResourceType.DRAWABLE, ICON_NAME);
        if (id != 0) return id;

        Logger.printInfo(() -> "twb: " + ICON_NAME + " missing, falling back to " + FALLBACK_ICON_NAME);
        return ResourceUtils.getIdentifier(ResourceType.DRAWABLE, FALLBACK_ICON_NAME);
    }

    private static int visibleActionCount(ViewGroup inlineActionBar) {
        int count = 0;
        for (int i = 0; i < inlineActionBar.getChildCount(); i++) {
            if (inlineActionBar.getChildAt(i).getVisibility() == View.VISIBLE) {
                count++;
            }
        }
        return count;
    }

    /**
     * Matches the button to the last visible action, using only public view APIs:
     * the obfuscated colour field the sibling uses is not needed for a valid icon.
     */
    private static void syncFromNeighbour(ViewGroup inlineActionBar, FrameLayout container, ImageView icon) {
        View referenceAction = lastVisibleAction(inlineActionBar);
        if (referenceAction == null) {
            icon.setImageTintList(ColorStateList.valueOf(FALLBACK_TINT));
            return;
        }

        if (referenceAction instanceof ViewGroup) {
            ViewGroup referenceContainer = (ViewGroup) referenceAction;
            container.setPadding(
                    referenceContainer.getPaddingLeft(),
                    referenceContainer.getPaddingTop(),
                    referenceContainer.getPaddingRight(),
                    referenceContainer.getPaddingBottom());
        }

        ImageView referenceIcon = findIcon(referenceAction);
        if (referenceIcon == null) {
            icon.setImageTintList(ColorStateList.valueOf(FALLBACK_TINT));
            return;
        }

        icon.setScaleType(referenceIcon.getScaleType());

        ColorStateList tint = referenceIcon.getImageTintList();
        icon.setImageTintList(tint != null ? tint : ColorStateList.valueOf(FALLBACK_TINT));

        ViewGroup.LayoutParams referenceParams = referenceIcon.getLayoutParams();
        if (referenceParams != null) {
            icon.setLayoutParams(
                    new FrameLayout.LayoutParams(
                            referenceParams.width,
                            referenceParams.height,
                            Gravity.CENTER));
        }
    }

    private static View lastVisibleAction(ViewGroup inlineActionBar) {
        for (int i = inlineActionBar.getChildCount() - 1; i >= 0; i--) {
            View child = inlineActionBar.getChildAt(i);
            if (child.getVisibility() == View.VISIBLE && child.getWidth() > 0) {
                return child;
            }
        }
        return null;
    }

    private static ImageView findIcon(View view) {
        if (view instanceof ImageView && view.getVisibility() == View.VISIBLE) {
            return (ImageView) view;
        }
        if (!(view instanceof ViewGroup)) return null;

        ViewGroup group = (ViewGroup) view;
        for (int i = 0; i < group.getChildCount(); i++) {
            ImageView found = findIcon(group.getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }

    private static Object readField(Object target, String fieldName) throws ReflectiveOperationException {
        Class<?> targetClass = target.getClass();
        Field field = FIELD_CACHE.get(targetClass);
        if (field == null) {
            field = targetClass.getDeclaredField(fieldName);
            field.setAccessible(true);
            FIELD_CACHE.put(targetClass, field);
        }
        return field.get(target);
    }
}
