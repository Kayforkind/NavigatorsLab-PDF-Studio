#!/bin/bash
# PDF Studio screenshot retry worker.
# Called by cron: only acts when the box is calm; captures missing shots;
# signals completion by writing DONE marker. Removes nothing itself.
CAPTURE_DIR=/home/hatch/workspace/pdfstudio/docs/shots/capture
SHOTS_DIR=/home/hatch/workspace/pdfstudio/docs/shots
LOG=$CAPTURE_DIR/retry.log

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

LOAD=$(awk '{print $1}' /proc/loadavg)
if ! awk -v l="$LOAD" 'BEGIN{exit !(l < 4.5)}'; then
  log "load $LOAD too high, skipping"
  exit 0
fi

# vite must be up
if ! curl -s -o /dev/null --max-time 5 http://127.0.0.1:5199/; then
  log "vite down, starting"
  cd /home/hatch/workspace/pdfstudio && TMPDIR=/home/hatch/workspace/.tmp nohup node node_modules/.bin/vite --host 127.0.0.1 --port 5199 >/dev/null 2>&1 &
  sleep 8
fi

export HOME=/home/hatch
cd "$CAPTURE_DIR"

need() { [ ! -s "$SHOTS_DIR/$1" ]; }

ran=0
if need 03-annotate.png || need 04-redact.png || need 05-signature-pad.png || need 05b-signature-placed.png; then
  log "running shots2 (load $LOAD)"
  node shots2.cjs >> "$LOG" 2>&1 && ran=1
fi
if need 06-forms.png || need 07-compare.png || need 08-export.png; then
  log "running shots3 (load $LOAD)"
  node shots3.cjs >> "$LOG" 2>&1 && ran=1
fi
if need 09-ai.png || need 10-mobile.png; then
  log "running shots4 (load $LOAD)"
  node shots4.cjs >> "$LOG" 2>&1 && ran=1
fi

missing=0
for f in 03-annotate.png 04-redact.png 05-signature-pad.png 05b-signature-placed.png 06-forms.png 07-compare.png 08-export.png 09-ai.png 10-mobile.png; do
  need "$f" && { log "still missing: $f"; missing=1; }
done

if [ "$missing" -eq 0 ]; then
  log "ALL SHOTS PRESENT"
  touch "$CAPTURE_DIR/DONE"
fi
log "cycle done (ran=$ran)"
