#!/bin/sh
# Renders assets/readme/cards.html into the README images (needs Google Chrome; macOS path by default).
set -e
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
DIR=$(cd "$(dirname "$0")/../assets/readme" && pwd)
run() { h=$1; shift; "$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=5000 --window-size=880,"$h" "$@" 2>/dev/null; }
# card:height pairs, measured by the page itself; images are 2x (1760 wide).
SIZES=$(run 2000 --dump-dom "file://$DIR/cards.html#sizes" | sed -n 's:.*<pre id="sizes">\([a-z][^<]*\)</pre>.*:\1:p')
[ -n "$SIZES" ] || { echo "could not measure the cards" >&2; exit 1; }
for spec in $SIZES; do
  card=${spec%%:*}
  run "${spec#*:}" --force-device-scale-factor=2 --default-background-color=00000000 \
    --screenshot="$DIR/$card.png" "file://$DIR/cards.html#$card"
done
echo "rendered: $SIZES"
