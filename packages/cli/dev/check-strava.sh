#!/usr/bin/env bash
# Runs the Strava sync checks against the fake Strava server in a throwaway data folder.
# Nothing in data/ or config/ is touched. Usage: packages/cli/dev/check-strava.sh
set -uo pipefail
cd "$(dirname "$0")/../../.."
ROOT=$PWD
TMP=$(mktemp -d)
PORT=${FAKE_PORT:-8724}
export JAM_DATA_DIR=$TMP/data JAM_NO_BROWSER=1 JAM_SLEEP_SCALE=0 NODE_NO_WARNINGS=1
mkdir -p "$TMP/config" "$JAM_DATA_DIR"
for f in config/*.example.jsonc; do cp "$f" "$TMP/config/$(basename "$f" .example.jsonc).jsonc"; done
sed -i.bak -e "s#https://www.strava.com/api/v3#http://127.0.0.1:$PORT/api/v3#" -e "s#https://www.strava.com/oauth#http://127.0.0.1:$PORT/oauth#" -e 's/"pageSize": 200/"pageSize": 50/' "$TMP/config/strava.jsonc"
echo '{ "strava": { "clientId": "1", "clientSecret": "fake-secret" } }' > "$TMP/config/secrets.jsonc"

node packages/cli/dev/fake-strava.ts --port "$PORT" > "$TMP/fake.log" 2>&1 &
FAKE=$!
failed=0
trap 'kill $FAKE 2>/dev/null; [ $failed = 0 ] && rm -rf "$TMP"' EXIT
for _ in $(seq 20); do curl -s "localhost:$PORT/__state" > /dev/null && break; sleep 0.3; done

jam() { node packages/cli/src/main.ts --config "$TMP/config" "$@"; }
ctl() { curl -s -XPOST "localhost:$PORT/__control" -d "$1" > /dev/null; }
sql() { node -e "const {DatabaseSync}=require('node:sqlite');const r=new DatabaseSync(process.argv[1]).prepare(process.argv[2]).get();console.log(Object.values(r)[0])" "$JAM_DATA_DIR/jam.sqlite" "$1"; }
count() { sql "SELECT COUNT(*) FROM activities WHERE source = 'strava'"; }
auth() {
  jam strava auth > "$TMP/auth.log" 2>&1 &
  local pid=$!
  for _ in $(seq 20); do grep -q authorize "$TMP/auth.log" && break; sleep 0.2; done
  curl -s -L "$(grep -o "http://127.0.0.1:$PORT/oauth/authorize[^ ]*" "$TMP/auth.log")" > /dev/null
  wait $pid
}
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1: expected $3, got $2"; failed=1; fi; }
expected=$(curl -s "localhost:$PORT/__state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=new Set(['Hike','Run','Walk','TrailRun','Ride']);console.log(JSON.parse(s).activities.filter(a=>m.has(a.sport)&&!a.private).length)})")

auth; check "sign-in" "$?" 0
jam sync strava > "$TMP/first.log"; check "first pull stores the expected count" "$(count)" "$expected"
check "  ...and fetches full tracks (heights, times) for a batch" "$(sql "SELECT COUNT(*) > 0 FROM tracks WHERE detail = 'full' AND elevations IS NOT NULL")" 1
check "  ...no more than fullTracksPerSync of them" "$(sql "SELECT COUNT(*) <= 80 FROM tracks WHERE detail = 'full'")" 1
jam sync strava > "$TMP/second.log"; check "second pull adds none" "$(grep -c '^0 added, 0 updated' "$TMP/second.log")" 1

jam strava wipe --yes > /dev/null
ctl '{"failPage":3,"failTimes":99}'
jam sync strava > /dev/null 2>&1; check "interrupted pull keeps the pages it finished" "$(count)" 70
ctl '{"failTimes":0}'
jam sync strava > "$TMP/resume.log" 2>&1; check "interrupted pull resumes" "$(count)" "$expected"
check "resume starts at the failed page" "$(grep -c 'from page 3' "$TMP/resume.log")" 1

first=$(sql "SELECT strava_id FROM activities ORDER BY start_time LIMIT 1")
cat > "$TMP/sheet.csv" << CSV
row_id,date,end_date,time_zone,activity_type,event_tags,name,place,status,lat,lon,distance_km,elevation_gain_m,duration,gpx_path,strava_id,show_strava_link,hide,notes
s001,2024-01-02,,,Hike,,Renamed in the sheet,,done,,,,,,,$first,,,
m001,2025-05-03,,,Hike,,Manual hike,,done,,,20.5,1700,9:30,,,,,
CSV
jam sync sheet "$TMP/sheet.csv" > /dev/null
jam strava wipe --yes > /dev/null; jam sync strava > /dev/null 2>&1
check "wipe + refetch restores the activities" "$(count)" "$expected"
check "sheet rows survive the wipe" "$(sql "SELECT COUNT(*) FROM activities WHERE source = 'sheet'")" 1
check "overrides still apply after the refetch" "$(sql "SELECT COUNT(*) FROM overrides o JOIN activities a ON 'strava:' || a.strava_id = o.target_id WHERE o.field = 'name'")" 1

sed -i.bak 's/"includePrivate": false/"includePrivate": true/' "$TMP/config/strava.jsonc"
jam sync strava > "$TMP/private.log" 2>&1; check "private on without re-auth stops" "$?" 1
check "  ...with a message to rerun strava auth" "$(grep -c 'Run `pnpm jam strava auth` again' "$TMP/private.log")" 1
auth; jam sync strava > /dev/null 2>&1
check "after re-auth, private activities are added" "$(sql "SELECT COUNT(*) FROM activities WHERE visibility = 'only_me'")" 16
sed -i.bak 's/"includePrivate": true/"includePrivate": false/' "$TMP/config/strava.jsonc"
jam sync strava > /dev/null 2>&1
check "turning private off removes them" "$(sql "SELECT COUNT(*) FROM activities WHERE visibility = 'only_me'")" 0
# Pulls: first, second, interrupted+resumed (one record), after the wipe, private refused, private on, private off.
check "every run left a pull record" "$(sql "SELECT COUNT(*) FROM pulls WHERE source = 'strava' AND outcome <> 'wiped'")" 7

# One range of days: --from and --to pull only those, and nothing later carries on from them.
day=$(sql "SELECT substr(start_local, 1, 10) FROM activities WHERE source = 'strava' ORDER BY start_time LIMIT 1 OFFSET 20")
gone=$(sql "SELECT strava_id FROM activities WHERE source = 'strava' AND substr(start_local, 1, 10) = '$day' LIMIT 1")
before=$(count)
jam sync strava --from "$day" --to "$day" > "$TMP/range.log" 2>&1
check "a pull of one range says so" "$(grep -c "^One-range pull, $day to $day" "$TMP/range.log")" 1
check "  ...and changes nothing that was already there" "$(count)" "$before"
ctl "{\"remove\": $gone}"
jam sync strava --from "$day" --to "$day" > "$TMP/range-kept.log" 2>&1
check "an activity gone from Strava in the range is reported and kept" "$(count) $(grep -c 'add --full to remove them' "$TMP/range-kept.log")" "$before 1"
jam sync strava --from "$day" --to "$day" --full > "$TMP/range-full.log" 2>&1
check "with --full it is removed, after a copy of the store" "$(count) $(ls "$JAM_DATA_DIR/backups" | grep -c before-wipe-strava-range)" "$((before - 1)) 1"
jam sync strava > "$TMP/after-range.log" 2>&1
check "the next plain pull carries on from the last plain one" "$(grep -c '^Incremental pull' "$TMP/after-range.log")" 1
jam sync strava --last 2x > "$TMP/last.log" 2>&1; check "--last refuses an age it cannot read" "$? $(grep -c 'such as 30d' "$TMP/last.log")" "1 1"
jam sync strava --full > "$TMP/full.log" 2>&1; check "--full alone is refused" "$?" 1

# Full tracks from exported files: matched by the id in the name, by activities.csv, or by start.
gpxfor() { # id, file: a GPX whose points start when the activity did
  node -e '
    const [id, file] = process.argv.slice(1);
    const { DatabaseSync } = require("node:sqlite");
    const row = new DatabaseSync(process.env.JAM_DATA_DIR + "/jam.sqlite").prepare("SELECT start_time FROM activities WHERE strava_id = ?").get(Number(id));
    const t0 = Date.parse(row.start_time);
    const pts = Array.from({ length: 12 }, (_, i) => `<trkpt lat="${(35.6812 + i * 0.0002).toFixed(6)}" lon="${(139.7671 + i * 0.0003).toFixed(6)}"><ele>${10 + i}</ele><time>${new Date(t0 + i * 30000).toISOString()}</time></trkpt>`).join("");
    require("node:fs").writeFileSync(file, `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg>${pts}</trkseg></trk></gpx>`);
  ' "$1" "$2"
}
ids=$(sql "SELECT group_concat(strava_id) FROM (SELECT strava_id FROM activities WHERE source = 'strava' AND has_track = 1 ORDER BY start_time LIMIT 3)")
a=${ids%%,*}; rest=${ids#*,}; b=${rest%%,*}; c=${rest#*,}
mkdir -p "$TMP/export"
gpxfor "$a" "$TMP/export/strava_$a.gpx"
gpxfor "$b" "$TMP/export/Morning Run.gpx"
gpxfor "$c" "$TMP/export/yamap_export.gpx"
printf 'Activity ID,Activity URL,File,Date\n%s,https://www.strava.com/activities/%s,Morning Run.gpx,2024-01-02\n' "$b" "$b" > "$TMP/export/activities.csv"
gpxfor "$a" "$TMP/export/strava_999999999.gpx"
jam sync strava --tracks-from "$TMP/export" --dry-run --replace > "$TMP/tracks-dry.log" 2>&1
check "tracks from files, dry run, writes nothing" "$(sql "SELECT COUNT(*) FROM tracks WHERE point_count = 12")" 0
jam sync strava --tracks-from "$TMP/export" --replace > "$TMP/tracks.log" 2>&1
check "tracks from files attach by name, by activities.csv and by start time" "$(grep -c 'Attached full tracks to 3 Strava activities (1 by the id in the file name, 1 by activities.csv, 1 by start time)' "$TMP/tracks.log")" 1
check "  ...the three now have full tracks of 12 points" "$(sql "SELECT COUNT(*) FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE t.detail = 'full' AND t.point_count = 12 AND a.strava_id IN ($a, $b, $c)")" 3
check "  ...a file for an unknown Strava id is reported, not stored" "$(grep -c 'strava_999999999.gpx: Strava activity 999999999 is not in the store' "$TMP/tracks.log")" 1
# Strava's own account export: files named by upload and gzipped, with a list saying whose they are.
d=$(sql "SELECT strava_id FROM activities WHERE source = 'strava' AND has_track = 1 ORDER BY start_time LIMIT 1 OFFSET 5")
e=$(sql "SELECT strava_id FROM activities WHERE source = 'strava' AND has_track = 1 ORDER BY start_time LIMIT 1 OFFSET 40")
mkdir -p "$TMP/account/activities"
gpxfor "$d" "$TMP/account/activities/7000001.gpx"; gzip "$TMP/account/activities/7000001.gpx"
printf 'Activity ID,Activity Date,Activity Name,Filename\n%s,"Jan 2, 2024",Run,activities/7000001.gpx.gz\n' "$d" > "$TMP/account/activities.csv"
# A file whose number happens to be another activity's id, recorded on another day.
gpxfor "$d" "$TMP/account/activities/$e.gpx"
gpxfor "$a" "$TMP/account/activities/strava_${b}_trimmed.gpx"
jam sync strava --tracks-from "$TMP/account" --replace > "$TMP/account.log" 2>&1
check "an account export's gzipped file is matched through its list" "$(grep -c 'Attached full tracks to 1 Strava activities (1 by activities.csv)' "$TMP/account.log")" 1
check "  ...a number in a name that is another activity's id is refused by its date" "$(grep -c "not when Strava activity $e did" "$TMP/account.log")" 1
check "  ...and a file with its ends cut off is refused" "$(grep -c 'export it again without hiding them' "$TMP/account.log")" 1
jam sync strava --tracks-from "$TMP/export" > "$TMP/tracks-again.log" 2>&1
check "  ...a second run leaves the full tracks alone" "$(grep -c '3 already had a full track' "$TMP/tracks-again.log")" 1

[ $failed = 0 ] && echo "All checks passed." || { echo "Some checks failed; the fake server log was $TMP/fake.log."; exit 1; }
