from __future__ import annotations

import random
from typing import Any


def evaluate_state(state: dict[str, Any]) -> dict[str, Any]:
    triples = state.get("triples", [])
    if not triples:
        return {
            "triple_count": 0,
            "entity_count": 0,
            "duplicate_ratio": 0.0,
            "connectivity": 0.0,
        }

    entity_set = set()
    triple_keys = []
    for item in triples:
        head = item.get("head", "")
        relation = item.get("relation", "")
        tail = item.get("tail", "")
        entity_set.add(head)
        entity_set.add(tail)
        triple_keys.append((head, relation, tail))

    unique_count = len(set(triple_keys))
    duplicate_ratio = 0.0 if not triple_keys else max(0.0, 1.0 - (unique_count / len(triple_keys)))
    node_count = max(1, len(entity_set))
    connectivity = float(len(triple_keys)) / float(node_count)

    return {
        "triple_count": len(triple_keys),
        "entity_count": len(entity_set),
        "duplicate_ratio": round(duplicate_ratio, 4),
        "connectivity": round(connectivity, 4),
    }


def _normalize_triple(item: dict) -> tuple[str, str, str]:
    head = str(item.get("head", "")).strip()
    relation = str(item.get("relation", "")).strip()
    tail = str(item.get("tail", "")).strip()
    return (head, relation, tail)


def evaluate_against_ground_truth(
    predicted_triples: list[dict],
    gt_triples: list[dict],
) -> dict:
    pred_set = {_normalize_triple(t) for t in predicted_triples}
    gt_set = {_normalize_triple(t) for t in gt_triples}

    tp_set = pred_set & gt_set
    tp = len(tp_set)
    fp = len(pred_set) - tp
    fn = len(gt_set) - tp

    precision = tp / len(pred_set) if pred_set else 0.0
    recall = tp / len(gt_set) if gt_set else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    details = {
        "matched": [{"head": h, "relation": r, "tail": t} for h, r, t in sorted(tp_set)],
        "missed": [{"head": h, "relation": r, "tail": t} for h, r, t in sorted(gt_set - pred_set)],
        "extra": [{"head": h, "relation": r, "tail": t} for h, r, t in sorted(pred_set - gt_set)],
    }

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "gt_total": len(gt_set),
        "pred_total": len(pred_set),
        "details": details,
    }


def evaluate_triples_with_model(adapter, triples: list[dict], sample_size: int = 12) -> dict[str, Any]:
    """Use the model to assess triple quality. Returns quality metrics."""
    if not triples or not adapter.enabled:
        return {"rated": 0, "passed": 0, "score": 0.0, "note": "model disabled or no triples"}

    sample = random.sample(triples, min(sample_size, len(triples)))
    items_text = "\n".join(
        f"{i+1}. ({t['head']}) --[{t['relation']}]--> ({t['tail']})"
        for i, t in enumerate(sample)
    )
    prompt = (
        "你是一个知识图谱质量评估器。请评估以下三元组的质量。\n"
        "对每个三元组，判断其是否表达了合理的业务事实，用 Y(合理) 或 N(不合理) 标注。\n"
        "三元组格式：(头实体) --[关系]--> (尾实体)\n\n"
        f"{items_text}\n\n"
        "请以 JSON 格式输出评估结果：\n"
        '{"results":[{"id":1,"verdict":"Y","reason":"简短理由"},...],"overall_note":"总体评价"}\n'
    )
    try:
        result = adapter.chat_json(
            system_prompt="你是严格的知识图谱质量评估器。只输出可解析 JSON。",
            user_prompt=prompt,
            fallback={"results": [], "overall_note": "model unavailable"},
        )
    except Exception:
        return {"rated": 0, "passed": 0, "score": 0.0, "note": "model call failed"}

    results = result.get("results", [])
    if not results:
        return {"rated": 0, "passed": 0, "score": 0.0, "note": result.get("overall_note", "")}

    passed = sum(1 for r in results if r.get("verdict", "").upper() == "Y")
    score = round(passed / len(results), 3) if results else 0.0
    return {
        "rated": len(results),
        "passed": passed,
        "score": score,
        "note": result.get("overall_note", ""),
        "details": results,
    }

