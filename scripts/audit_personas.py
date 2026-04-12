#!/usr/bin/env python3
"""Audit persona usage from chat logs."""
import json
import glob
from collections import defaultdict
from pathlib import Path

# All persona nicks (from personas-default.ts)
# Key: lowercase nick as it appears in logs, value: persona id
# Note: logs use capitalized nicks (e.g. "Radigue"), we lowercase for matching
# Special case: id="cirque" has nick="Fratellini"
PERSONA_NICKS = {
    "schaeffer", "batty", "radigue", "oliveros", "sunra", "haraway",
    "pharmacius", "turing", "swartz", "merzbow", "hypatia", "decroux",
    "mnouchkine", "royaldlx", "ikeda", "teamlab", "demoscene", "pina",
    "grotowski", "cirque", "curie", "foucault", "deleuze", "bookchin",
    "leguin", "cage", "bjork", "fuller", "tarkovski", "oram", "sherlock",
    "picasso", "eno",
}

# Map from lowercase log nick -> persona id
# Most are identity; exceptions:
NICK_TO_ID = {nick: nick for nick in PERSONA_NICKS}
NICK_TO_ID["fratellini"] = "cirque"    # id=cirque, nick=Fratellini in logs
NICK_TO_ID["royaldluxe"] = "royaldlx" # possible variant
NICK_TO_ID["le guin"] = "leguin"       # just in case

# All log nicks we track (includes aliases)
ALL_LOG_NICKS = set(NICK_TO_ID.keys())

# Functional personas — never archive
PROTECTED = {"pharmacius", "sherlock"}

# Mention patterns: "@Nick" in text, case-insensitive
# We build the set of all possible @mention strings -> persona id
MENTION_MAP = {}
for log_nick, pid in NICK_TO_ID.items():
    MENTION_MAP[f"@{log_nick}"] = pid
# Also add known capitalized forms from personas-default.ts nicks
DISPLAY_NICKS = {
    "schaeffer": "Schaeffer", "batty": "Batty", "radigue": "Radigue",
    "oliveros": "Oliveros", "sunra": "SunRa", "haraway": "Haraway",
    "pharmacius": "Pharmacius", "turing": "Turing", "swartz": "Swartz",
    "merzbow": "Merzbow", "hypatia": "Hypatia", "decroux": "Decroux",
    "mnouchkine": "Mnouchkine", "royaldlx": "RoyalDeLuxe", "ikeda": "Ikeda",
    "teamlab": "TeamLab", "demoscene": "Demoscene", "pina": "Pina",
    "grotowski": "Grotowski", "cirque": "Fratellini", "curie": "Curie",
    "foucault": "Foucault", "deleuze": "Deleuze", "bookchin": "Bookchin",
    "leguin": "LeGuin", "cage": "Cage", "bjork": "Bjork", "fuller": "Fuller",
    "tarkovski": "Tarkovski", "oram": "Oram", "sherlock": "Sherlock",
    "picasso": "Picasso", "eno": "Eno",
}
for pid, display in DISPLAY_NICKS.items():
    MENTION_MAP[f"@{display.lower()}"] = pid

responses = defaultdict(int)   # persona sent a message
mentions = defaultdict(int)    # @PersonaNick in human messages

log_files = sorted(glob.glob("data/chat-logs/v2-*.jsonl"))
print(f"Found {len(log_files)} log files")

for logfile in log_files:
    with open(logfile) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            nick_lower = entry.get("nick", "").lower()
            text = entry.get("text", "").lower()
            msg_type = entry.get("type", "")

            # Count persona responses (persona sent a message)
            if nick_lower in ALL_LOG_NICKS and msg_type == "message":
                pid = NICK_TO_ID[nick_lower]
                responses[pid] += 1

            # Count @mentions in all messages (case-insensitive)
            for mention_key, pid in MENTION_MAP.items():
                if mention_key in text:
                    mentions[pid] += 1

# Build combined score
INACTIVE_THRESHOLD = 3
all_personas = sorted(PERSONA_NICKS)
results = []
for pid in all_personas:
    r = responses[pid]
    m = mentions[pid]
    score = m * 2 + r
    status = "PROTECTED" if pid in PROTECTED else ("ACTIVE" if score >= INACTIVE_THRESHOLD else "INACTIVE")
    results.append((score, pid, r, m, status))

results.sort(reverse=True)

# Print report
print("\n=== PERSONA USAGE RANKING ===")
print(f"{'Persona':<15} {'Score':>6} {'Responses':>10} {'Mentions':>9} {'Status'}")
print("-" * 60)
for score, pid, r, m, status in results:
    print(f"{pid:<15} {score:>6} {r:>10} {m:>9} {status}")

active = [p for s, p, r, m, st in results if st == "ACTIVE"]
inactive = [p for s, p, r, m, st in results if st == "INACTIVE"]
protected = [p for s, p, r, m, st in results if st == "PROTECTED"]

print(f"\nActive ({len(active)}): {', '.join(active)}")
print(f"Inactive ({len(inactive)}): {', '.join(inactive)}")
print(f"Protected ({len(protected)}): {', '.join(protected)}")

# Save report
report_path = Path(".omc/audit-personas-2026-04-01.md")
report_path.parent.mkdir(exist_ok=True)
with open(report_path, "w") as f:
    f.write("# Audit Personas — 2026-04-01\n\n")
    f.write(f"**Log files analysed:** {len(log_files)}\n")
    f.write(f"**Total personas:** {len(all_personas)}\n")
    f.write(f"**Threshold:** score ≥ {INACTIVE_THRESHOLD} = active\n\n")
    f.write("## Ranking\n\n")
    f.write(f"| Persona | Score | Responses | Mentions | Status |\n")
    f.write(f"|---------|-------|-----------|----------|--------|\n")
    for score, pid, r, m, status in results:
        f.write(f"| {pid} | {score} | {r} | {m} | {status} |\n")
    f.write(f"\n## Summary\n\n")
    f.write(f"- **Active** ({len(active)}): {', '.join(active) or 'none'}\n")
    f.write(f"- **Inactive** ({len(inactive)}): {', '.join(inactive) or 'none'}\n")
    f.write(f"- **Protected** ({len(protected)}): {', '.join(protected)}\n")
    f.write(f"\n## Recommendation\n\n")
    if inactive:
        f.write(f"Désactiver les {len(inactive)} personas inactives : {', '.join(inactive)}\n")
    else:
        f.write("Toutes les personas ont au moins une activité.\n")

print(f"\nReport saved to {report_path}")
print(f"\nINACTIVE personas to archive: {inactive}")
