"""Find the entity with the most connections across all KBs."""
import sys
sys.path.insert(0, ".")
from pathlib import Path
import json
from collections import Counter

data_dir = Path("data")
gb = data_dir / "graph_store.json"
if not gb.exists():
    print("graph_store.json not found")
    sys.exit(1)

rows = json.loads(gb.read_text(encoding="utf-8"))
print(f"Total triples: {len(rows)}")

# Count per KB
kb_counter = Counter(r.get("knowledge_base_id", "?") for r in rows)
print("\nKB stats:")
for kb_id, count in kb_counter.most_common():
    print(f"  {kb_id[:8]}: {count} triples")

# Find KB with most triples
top_kb = kb_counter.most_common(1)[0][0]
kb_rows = [r for r in rows if r.get("knowledge_base_id") == top_kb]

# Count entity appearances in this KB
entity_counter = Counter()
for r in kb_rows:
    entity_counter[r.get("head", "")] += 1
    entity_counter[r.get("tail", "")] += 1

print(f"\nTop KB: {top_kb} ({len(kb_rows)} triples)")
print("Top 20 entities:")
for name, count in entity_counter.most_common(20):
    if name.strip():
        print(f"  {name}: {count} connections")
