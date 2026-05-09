from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any

from .model_adapter import OpenAICompatibleAdapter
from .schemas import Entity, Triple


DEFAULT_ONTOLOGY = {
    "entity_types": ["Process", "Equipment", "Material", "QualityIndex", "Defect", "DocumentConcept"],
    "relations": ["includes", "uses", "affects", "belongs_to", "causes", "requires", "related_to"],
}

DOMAIN_TERMS = OrderedDict(
    [
        ("船体装配", "Process"),
        ("放样", "Process"),
        ("号料", "Process"),
        ("切割", "Process"),
        ("组立", "Process"),
        ("焊接", "Process"),
        ("焊接设备", "Equipment"),
        ("设备", "Equipment"),
        ("钢板", "Material"),
        ("材料", "Material"),
        ("装配精度", "QualityIndex"),
        ("精度", "QualityIndex"),
        ("变形", "Defect"),
        ("缺陷", "Defect"),
        ("工艺规程", "DocumentConcept"),
        ("知识图谱", "DocumentConcept"),
        ("实体", "DocumentConcept"),
        ("关系", "DocumentConcept"),
        ("多智能体", "DocumentConcept"),
        ("智能体", "DocumentConcept"),
    ]
)

STOP_TOKENS = {
    "包括",
    "通过",
    "进行",
    "用于",
    "可以",
    "以及",
    "之后",
    "之前",
    "需要",
    "形成",
    "实现",
}


def _dedupe_by_name(items: list[Entity]) -> list[Entity]:
    seen: dict[str, Entity] = {}
    for item in items:
        key = item.name.strip().lower()
        if key and key not in seen:
            seen[key] = item
    return list(seen.values())


def _guess_type(token: str) -> str:
    if token in DOMAIN_TERMS:
        return DOMAIN_TERMS[token]
    if any(word in token for word in ["设备", "系统", "平台", "工具"]):
        return "Equipment"
    if any(word in token for word in ["流程", "工艺", "装配", "抽取", "校验", "写入"]):
        return "Process"
    if any(word in token for word in ["质量", "精度", "指标", "评分"]):
        return "QualityIndex"
    if any(word in token for word in ["缺陷", "错误", "失败", "变形"]):
        return "Defect"
    return "DocumentConcept"


def _heuristic_entities(text: str) -> list[Entity]:
    found: list[Entity] = []
    for term, entity_type in DOMAIN_TERMS.items():
        if term in text:
            found.append(Entity(name=term, entity_type=entity_type, evidence=text[:160], confidence=0.8))

    tokens = re.findall(r"[\u4e00-\u9fa5A-Za-z0-9]{2,16}", text)
    for token in tokens:
        if token in STOP_TOKENS or len(token) < 2:
            continue
        if any(token in item.name or item.name in token for item in found):
            continue
        found.append(Entity(name=token, entity_type=_guess_type(token), evidence=text[:160], confidence=0.55))
        if len(found) >= 12:
            break

    return _dedupe_by_name(found)


def _heuristic_triples(text: str, entities: list[Entity]) -> list[Triple]:
    names = [x.name for x in entities if x.name.strip()]
    triples: list[Triple] = []
    if len(names) < 2:
        return triples

    if "包括" in text or "包含" in text or "由" in text:
        head = names[0]
        for tail in names[1:6]:
            triples.append(Triple(head=head, relation="includes", tail=tail, evidence=text[:160], confidence=0.72))

    if "使用" in text or "采用" in text or "用于" in text:
        triples.append(Triple(head=names[0], relation="uses", tail=names[-1], evidence=text[:160], confidence=0.68))

    if "影响" in text or "提高" in text or "降低" in text:
        triples.append(Triple(head=names[0], relation="affects", tail=names[-1], evidence=text[:160], confidence=0.64))

    if "导致" in text or "造成" in text or "引起" in text:
        triples.append(Triple(head=names[0], relation="causes", tail=names[-1], evidence=text[:160], confidence=0.64))

    if "需要" in text or "依赖" in text:
        triples.append(Triple(head=names[0], relation="requires", tail=names[-1], evidence=text[:160], confidence=0.64))

    if not triples:
        for i in range(min(len(names) - 1, 5)):
            triples.append(
                Triple(
                    head=names[i],
                    relation="related_to",
                    tail=names[i + 1],
                    evidence=text[:160],
                    confidence=0.55,
                )
            )

    return triples


class PlannerAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(self, text: str, retrieved_context: list[str]) -> dict[str, Any]:
        fallback = dict(DEFAULT_ONTOLOGY)
        prompt = (
            "请根据输入文本给出知识图谱本体约束。只返回严格 JSON，不要解释，不要 Markdown。\n"
            'JSON 格式：{"entity_types":[],"relations":[],"notes":""}\n'
            f"文本：{text[:800]}\n"
            f"参考上下文：{' | '.join(retrieved_context[:3])}"
        )
        result = self._adapter.chat_json(
            system_prompt="你是知识图谱本体设计助手。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        if not result.get("entity_types") or not result.get("relations"):
            return fallback
        return result


class EntityAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(self, text: str, ontology_schema: dict[str, Any], retrieved_context: list[str]) -> list[Entity]:
        heuristic = _heuristic_entities(text)
        fallback = {"entities": [x.model_dump() for x in heuristic]}
        prompt = (
            "从文本中抽取适合构建知识图谱的实体。只返回严格 JSON，不要解释，不要 Markdown。\n"
            'JSON 格式：{"entities":[{"name":"","entity_type":"","aliases":[],"evidence":"","confidence":0.0}]}\n'
            f"允许实体类型：{ontology_schema.get('entity_types', DEFAULT_ONTOLOGY['entity_types'])}\n"
            f"文本：{text[:800]}\n"
            f"上下文：{' | '.join(retrieved_context[:3])}"
        )
        result = self._adapter.chat_json(
            system_prompt="你是信息抽取助手。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        output: list[Entity] = []
        for item in result.get("entities", []):
            try:
                entity = Entity(**item)
                if entity.name.strip():
                    output.append(entity)
            except Exception:
                continue
        return _dedupe_by_name(output) if output else heuristic


class RelationAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(self, text: str, entities: list[Entity], ontology_schema: dict[str, Any], retrieved_context: list[str]) -> list[Triple]:
        heuristic = _heuristic_triples(text=text, entities=entities)
        fallback = {"triples": [x.model_dump() for x in heuristic]}
        prompt = (
            "基于给定实体和文本抽取知识图谱三元组。只返回严格 JSON，不要解释，不要 Markdown。\n"
            'JSON 格式：{"triples":[{"head":"","relation":"","tail":"","evidence":"","confidence":0.0,"head_type":"","tail_type":""}]}\n'
            f"关系集合：{ontology_schema.get('relations', DEFAULT_ONTOLOGY['relations'])}\n"
            f"实体：{[x.model_dump() for x in entities]}\n"
            f"文本：{text[:800]}\n"
            f"上下文：{' | '.join(retrieved_context[:3])}"
        )
        result = self._adapter.chat_json(
            system_prompt="你是关系抽取助手。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        output: list[Triple] = []
        for item in result.get("triples", []):
            try:
                triple = Triple(**item)
                if triple.head.strip() and triple.relation.strip() and triple.tail.strip():
                    output.append(triple)
            except Exception:
                continue
        return output if output else heuristic


class FusionAgent:
    def run(self, entities: list[Entity], triples: list[Triple], normalizer) -> tuple[list[Entity], list[Triple], dict[str, Any]]:
        entity_map: dict[str, Entity] = {}
        for entity in entities:
            normalized = normalizer(entity.name)
            key = normalized.lower()
            if key not in entity_map:
                entity_map[key] = Entity(
                    name=normalized,
                    entity_type=entity.entity_type,
                    aliases=list(set(entity.aliases + ([entity.name] if normalized != entity.name else []))),
                    evidence=entity.evidence,
                    confidence=entity.confidence,
                )

        unique = set()
        fused_triples: list[Triple] = []
        dropped = 0
        for triple in triples:
            head = normalizer(triple.head)
            tail = normalizer(triple.tail)
            relation = triple.relation.strip()
            key = (head.lower(), relation.lower(), tail.lower())
            if not head or not tail or not relation:
                dropped += 1
                continue
            if key in unique:
                dropped += 1
                continue
            unique.add(key)
            fused_triples.append(
                Triple(
                    head=head,
                    relation=relation,
                    tail=tail,
                    evidence=triple.evidence,
                    confidence=triple.confidence,
                    head_type=triple.head_type,
                    tail_type=triple.tail_type,
                )
            )
        report = {
            "input_entity_count": len(entities),
            "output_entity_count": len(entity_map),
            "input_triple_count": len(triples),
            "output_triple_count": len(fused_triples),
            "dropped_count": dropped,
        }
        return list(entity_map.values()), fused_triples, report
