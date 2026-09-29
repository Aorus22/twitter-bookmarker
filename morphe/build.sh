#!/usr/bin/env bash
#
# Build the Twitter Bookmarker patch bundle (patches-*.mpp) from the pinned Piko
# checkout. The patch sources live in overlay/ and are copied on top of upstream;
# nothing upstream is forked or edited in place.
#
# Usage:
#   morphe/build.sh                 # fetch the pin, apply the overlay, build
#   morphe/build.sh --refresh       # re-fetch the pin before building
#   GITHUB_TOKEN=ghp_... morphe/build.sh
#
# Requires a GitHub token with the read:packages scope — Morphe publishes its
# patch library to GitHub Packages, and that registry refuses anonymous reads.
# See morphe/README.md for the one-time `gh auth refresh` command.

set -euo pipefail

UPSTREAM_URL="https://github.com/crimera/piko.git"
UPSTREAM_COMMIT="50744aa07bb41c4e1f942a06614ef4e6f2e3610c"
UPSTREAM_LABEL="Piko v3.9.0"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$ROOT/.upstream"
OUT="$ROOT/out"

REFRESH=0
for arg in "$@"; do
    case "$arg" in
        --refresh) REFRESH=1 ;;
        -h | --help)
            sed -n '2,15p' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        *)
            echo "error: unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

die() {
    echo "error: $*" >&2
    exit 1
}

note() {
    echo "==> $*"
}

# --- prerequisites ----------------------------------------------------------

command -v java >/dev/null 2>&1 || die "java not found; install a JDK (upstream CI builds with JDK 17)"
command -v git >/dev/null 2>&1 || die "git not found"

JAVA_MAJOR="$(java -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/')"
case "$JAVA_MAJOR" in
    '' | *[!0-9]*) note "could not read the java version; continuing anyway" ;;
    17 | 21) note "java $JAVA_MAJOR" ;;
    *) note "warning: java $JAVA_MAJOR; upstream CI uses 17, and newer JDKs may be rejected by the Android plugin" ;;
esac

if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        export ANDROID_HOME="$HOME/Android/Sdk"
        note "ANDROID_HOME unset; using $ANDROID_HOME"
    else
        die "ANDROID_HOME/ANDROID_SDK_ROOT unset and ~/Android/Sdk missing; the extension modules are Android libraries"
    fi
fi

if [ -z "${GITHUB_TOKEN:-}" ] && ! grep -qs '^gpr.key' "$HOME/.gradle/gradle.properties"; then
    die "no GitHub Packages credentials. Morphe publishes its patch library to
       GitHub Packages (maven.pkg.github.com/MorpheApp/registry), which needs a
       token with the read:packages scope. Either:
         gh auth refresh -h github.com -s read:packages
         GITHUB_TOKEN=\$(gh auth token) morphe/build.sh
       or put gpr.user / gpr.key in ~/.gradle/gradle.properties."
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
    export GITHUB_ACTOR="${GITHUB_ACTOR:-$(gh api user --jq .login 2>/dev/null || echo token)}"
    note "authenticating to GitHub Packages as $GITHUB_ACTOR"
fi

# --- pinned checkout --------------------------------------------------------

if [ ! -d "$WORK/.git" ]; then
    note "cloning $UPSTREAM_URL"
    git clone --quiet "$UPSTREAM_URL" "$WORK"
    REFRESH=0
fi

if [ "$REFRESH" = "1" ]; then
    note "fetching upstream"
    git -C "$WORK" fetch --quiet origin
fi

if ! git -C "$WORK" cat-file -e "$UPSTREAM_COMMIT^{commit}" 2>/dev/null; then
    note "fetching the pinned commit"
    git -C "$WORK" fetch --quiet origin "$UPSTREAM_COMMIT" || git -C "$WORK" fetch --quiet origin
fi

note "checking out $UPSTREAM_LABEL ($UPSTREAM_COMMIT)"
git -C "$WORK" checkout --quiet --force "$UPSTREAM_COMMIT"
# Removes the previous overlay and every build output, so each build starts from
# exactly the pinned tree.
git -C "$WORK" clean --quiet -fdx -e .gradle

# --- overlay ----------------------------------------------------------------

note "applying the Twitter Bookmarker overlay"
cp -R "$ROOT/overlay/." "$WORK/"

# --- build ------------------------------------------------------------------

note "building the patch bundle (this needs network the first time)"
(
    cd "$WORK"
    ./gradlew --no-daemon --console=plain clean :patches:checkStringResources :patches:generatePatchesList
)

mkdir -p "$OUT"
rm -f "$OUT"/patches-*.mpp
cp "$WORK"/patches/build/libs/patches-*.mpp "$OUT/"

note "artifacts in $OUT"
for artifact in "$OUT"/patches-*.mpp; do
    note "  $(basename "$artifact")  $(sha256sum "$artifact" | cut -d' ' -f1)"
done
