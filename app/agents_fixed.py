from __future__ import annotations

import re
from typing import Any

from .data_utils import repair_text_encoding
from .model_adapter import OpenAICompatibleAdapter
from .schemas import Entity, Triple


DEFAULT_ONTOLOGY = {
    "entity_types": [
        "Process",
        "Equipment",
        "Material",
        "QualityIndex",
        "Defect",
        "DocumentConcept",
        "Organization",
        "Role",
        "Document",
        "System",
        "Rule",
        "WorkProduct",
    ],
    "relations": [
        "includes",
        "uses",
        "affects",
        "belongs_to",
        "causes",
        "requires",
        "related_to",
        "describes",
        "submits",
        "registers",
        "reviews",
        "recommends",
    ],
}

RELATION_ALIASES = {
    "包含": "includes",
    "包括": "includes",
    "contains": "includes",
    "contain": "includes",
    "使用": "uses",
    "use": "uses",
    "uses": "uses",
    "影响": "affects",
    "affect": "affects",
    "affects": "affects",
    "属于": "belongs_to",
    "导致": "causes",
    "造成": "causes",
    "需要": "requires",
    "要求": "requires",
    "受规则约束": "requires",
    "只能参加": "requires",
    "相关": "related_to",
    "描述": "describes",
    "说明": "describes",
    "describe": "describes",
    "describes": "describes",
    "填写": "submits",
    "提交": "submits",
    "上传": "submits",
    "注册": "registers",
    "审核": "reviews",
    "推荐": "recommends",
}


def _clean_text(value: Any) -> str:
    return repair_text_encoding(str(value or "")).strip()


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", _clean_text(value)).strip()


def _compact_text(value: Any, limit: int = 520) -> str:
    text = _normalize_space(str(value or ""))
    return text if len(text) <= limit else text[:limit].rstrip()


def _compact_context(retrieved_context: list[str], top_k: int = 1, limit: int = 240) -> str:
    parts = [_compact_text(item, limit=limit) for item in retrieved_context[:top_k]]
    return " | ".join(part for part in parts if part)


def _entity_prompt_payload(entities: list[Entity]) -> list[dict[str, str]]:
    payload: list[dict[str, str]] = []
    for entity in _dedupe_by_name(entities):
        payload.append({"name": entity.name, "type": entity.entity_type})
    return payload


def _schema_values(schema: dict[str, Any], key: str, default: list[str]) -> set[str]:
    values = schema.get(key, default)
    if not isinstance(values, list):
        values = default
    clean_values = {_clean_text(value) for value in values if isinstance(value, str) and _clean_text(value)}
    default_values = {_clean_text(value) for value in default}
    return clean_values & default_values or default_values


def _normalize_relation_label(relation: str) -> str:
    relation = _clean_text(relation)
    return RELATION_ALIASES.get(relation, relation)


def _coerce_confidence(value: Any, default: float = 0.7) -> float:
    if isinstance(value, (int, float)):
        score = float(value)
    else:
        text = _clean_text(value).lower()
        if not text:
            score = default
        elif text in {"高", "高置信", "高置信度", "high"}:
            score = 0.9
        elif text in {"中", "中等", "中置信", "中置信度", "medium"}:
            score = 0.7
        elif text in {"低", "低置信", "低置信度", "low"}:
            score = 0.55
        else:
            match = re.search(r"0(?:\.\d+)?|1(?:\.0+)?|\d+(?:\.\d+)?%", text)
            if not match:
                score = default
            elif match.group(0).endswith("%"):
                score = float(match.group(0).rstrip("%")) / 100
            else:
                score = float(match.group(0))
                if score > 1:
                    score = score / 100
    return max(0.0, min(1.0, score))


def _canonical_entity_name(name: str, allowed_entities: set[str]) -> str | None:
    name = _clean_text(name)
    if not allowed_entities:
        return name
    by_lower = {item.lower(): item for item in allowed_entities}
    if name.lower() in by_lower:
        return by_lower[name.lower()]
    candidates = [item for item in allowed_entities if len(item) >= 2 and (item in name or name in item)]
    if not candidates:
        return None
    return max(candidates, key=len)


def _short_evidence(text: str, *terms: str, limit: int = 120) -> str:
    text = _normalize_space(text)
    if len(text) <= limit:
        return text
    anchors = [term for term in terms if term and term in text]
    if not anchors:
        return text[:limit].rstrip()
    index = min(text.find(term) for term in anchors if text.find(term) >= 0)
    start = max(0, index - 36)
    end = min(len(text), index + limit)
    snippet = text[start:end].strip()
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet += "..."
    return snippet


def _is_noise_name(name: str) -> bool:
    name = _normalize_space(name)
    if not name:
        return True
    if len(name) <= 1 or len(name) > 32:
        return True
    if re.fullmatch(r"\d+(?:[.\-]\d+)*", name):
        return True
    if re.search(r"https?://|www\.|@|\b1[3-9]\d{9}\b", name, re.IGNORECASE):
        return True
    if re.search(r"[，。；：！？、,.!?;:()\[\]{}<>《》]", name):
        return True
    if len(re.findall(r"[\u4e00-\u9fa5A-Za-z0-9]", name)) < 2:
        return True
    return False


def _is_meaningful_entity(name: str) -> bool:
    name = _normalize_space(name)
    if _is_noise_name(name):
        return False
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{1,20}", name):
        return True
    if len(re.findall(r"[\u4e00-\u9fa5]", name)) >= 2:
        return True
    return bool(re.search(r"[\u4e00-\u9fa5]", name) and re.search(r"[A-Za-z0-9]", name))


def _dedupe_by_name(items: list[Entity]) -> list[Entity]:
    seen: dict[str, Entity] = {}
    for item in items:
        name = _clean_text(item.name)
        if not _is_meaningful_entity(name):
            continue
        key = name.lower()
        if key not in seen:
            seen[key] = item.model_copy(update={"name": name, "evidence": _short_evidence(item.evidence, name)})
    return list(seen.values())


def _entity_from_item(item: dict[str, Any], allowed_types: set[str] | None = None) -> Entity | None:
    item = dict(item)
    item["confidence"] = _coerce_confidence(item.get("confidence"))
    aliases = item.get("aliases")
    if isinstance(aliases, str):
        item["aliases"] = [aliases]
    elif not isinstance(aliases, list):
        item["aliases"] = []
    try:
        entity = Entity(**item)
    except Exception:
        return None
    name = _clean_text(entity.name)
    if not _is_meaningful_entity(name):
        return None
    entity_type = _clean_text(entity.entity_type) or "Concept"
    if allowed_types and entity_type not in allowed_types:
        entity_type = "DocumentConcept" if "DocumentConcept" in allowed_types else next(iter(allowed_types))
    aliases = [_clean_text(alias) for alias in entity.aliases if _clean_text(alias)]
    return entity.model_copy(update={"name": name, "entity_type": entity_type, "aliases": aliases, "evidence": _clean_text(entity.evidence)})


def _triple_from_item(
    item: dict[str, Any],
    allowed_relations: set[str] | None = None,
    allowed_entities: set[str] | None = None,
) -> Triple | None:
    item = dict(item)
    item["confidence"] = _coerce_confidence(item.get("confidence"))
    try:
        triple = Triple(**item)
    except Exception:
        return None
    head = _clean_text(triple.head)
    relation = _normalize_relation_label(triple.relation)
    tail = _clean_text(triple.tail)
    if not relation:
        return None
    if allowed_relations and relation not in allowed_relations:
        return None
    if not _is_meaningful_entity(head) or not _is_meaningful_entity(tail) or head == tail:
        return None
    if allowed_entities:
        canonical_head = _canonical_entity_name(head, allowed_entities)
        canonical_tail = _canonical_entity_name(tail, allowed_entities)
        evidence_text = _clean_text(triple.evidence)
        if not canonical_head and head in evidence_text:
            canonical_head = head
        if not canonical_tail and tail in evidence_text:
            canonical_tail = tail
        if not canonical_head or not canonical_tail:
            return None
        head = canonical_head
        tail = canonical_tail
    if triple.confidence < 0.55:
        return None
    if not _clean_text(triple.evidence):
        return None
    return triple.model_copy(
        update={
            "head": head,
            "relation": relation,
            "tail": tail,
            "evidence": _short_evidence(triple.evidence or "", head, tail),
            "head_type": _clean_text(triple.head_type) or "Concept",
            "tail_type": _clean_text(triple.tail_type) or "Concept",
        }
    )


def _dedupe_triples(items: list[Triple]) -> list[Triple]:
    seen: set[tuple[str, str, str]] = set()
    out: list[Triple] = []
    for item in items:
        triple = _triple_from_item(item.model_dump())
        if not triple:
            continue
        key = (triple.head.lower(), triple.relation.lower(), triple.tail.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(triple)
    return out


def _heuristic_compress(text: str) -> str:
    lines = text.split("\n")
    clean: list[str] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if re.fullmatch(r"[\d\s\.\-\—\·\•\#\(\)（）\/]+", line):
            continue
        if re.match(r"^(第[一二三四五六七八九十\d]+[章节]|目录|摘要|参考文献|图\s*\d+|表\s*\d+|附图|附表)", line):
            continue
        if re.search(r"[\u4e00-\u9fa5A-Za-z]", line):
            clean.append(line)
    return "\n".join(clean) if clean else text


class PlannerAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(self, text: str, retrieved_context: list[str]) -> dict[str, Any]:
        text = _clean_text(text)
        fallback = {
            "clean_text": _heuristic_compress(text),
            "entity_types": DEFAULT_ONTOLOGY["entity_types"],
            "relations": DEFAULT_ONTOLOGY["relations"],
        }
        prompt = (
            "你是文本预处理助手。对输入文本去噪压缩，只保留包含事实信息的关键句子。\n"
            "只输出一个 JSON 对象，不要解释，不要 Markdown。\n"
            'JSON 格式：{"clean_text":"压缩后文本","entity_types":[],"relations":[]}\n'
            "规则：删除 OCR 乱码和格式标记；删除页眉页脚标题编号；保留含实体关系或业务事实的句子；保留原句不改写；clean_text 按原文顺序拼接关键句。\n"
            f"文本：{_compact_text(text, limit=900)}\n"
        )
        result = self._adapter.chat_json(
            system_prompt="你是文本预处理助手。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        clean = _clean_text(result.get("clean_text", ""))
        if not clean or len(clean) < 10:
            return fallback
        entity_types = result.get("entity_types", [])
        relations = result.get("relations", [])
        return {
            "clean_text": clean,
            "entity_types": entity_types if isinstance(entity_types, list) and entity_types else DEFAULT_ONTOLOGY["entity_types"],
            "relations": relations if isinstance(relations, list) and relations else DEFAULT_ONTOLOGY["relations"],
        }


class EntityAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(self, text: str, ontology_schema: dict[str, Any], retrieved_context: list[str]) -> list[Entity]:
        text = _clean_text(text)
        allowed_types = _schema_values(ontology_schema, "entity_types", DEFAULT_ONTOLOGY["entity_types"])
        fallback = {"entities": []}
        prompt = (
            "从文本中抽取适合构建知识图谱的核心名词实体。只输出一个 JSON 对象，不要解释，不要 Markdown。\n"
            "JSON 顶层键：entities。entities 是数组，每项包含 name, entity_type, aliases, evidence, confidence。\n"
            "抽取文本中所有明确、能参与关系的核心实体，不要因为数量多而省略；evidence 不超过 30 个汉字。\n"
            "不要抽取年份、电话号码、网址、密码、纯动作短语、整句说明、页码、图号。\n"
            "实体必须是业务对象、角色、流程、系统、文档、作品、材料、设备、质量指标或缺陷。\n"
            "必须覆盖可能参与关系的主体、客体和约束对象；如果句子表达 A 提交/使用/需要/包含/影响 B，A 和 B 都应作为候选实体。\n"
            f"允许实体类型：{ontology_schema.get('entity_types', DEFAULT_ONTOLOGY['entity_types'])}\n"
            f"文本：{_compact_text(text, limit=900)}\n"
        )
        result = self._adapter.chat_json(
            system_prompt="你是信息抽取助手。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        output = [_entity_from_item(item, allowed_types=allowed_types) for item in result.get("entities", []) if isinstance(item, dict)]
        clean_output = [x for x in output if x is not None]
        return _dedupe_by_name(clean_output)


RELATION_GROUPS = [
    {
        "relations": ["includes", "belongs_to"],
        "label": "结构归属",
        "hint": "includes=包含/组成, belongs_to=属于/归属",
    },
    {
        "relations": ["uses", "affects", "causes", "requires"],
        "label": "作用因果",
        "hint": "uses=使用/采用, affects=影响, causes=导致/造成, requires=需要/依赖",
    },
    {
        "relations": ["describes", "submits", "registers", "reviews", "recommends", "related_to"],
        "label": "描述动作",
        "hint": "describes=描述/说明, submits=提交/上传, registers=注册, reviews=审核, recommends=推荐, related_to=相关",
    },
]


def _build_relation_groups(allowed_relations: set[str]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for template in RELATION_GROUPS:
        rels = [r for r in template["relations"] if r in allowed_relations]
        if rels:
            groups.append({"relations": rels, "label": template["label"], "hint": template["hint"]})
    used = {r for g in groups for r in g["relations"]}
    leftovers = sorted(allowed_relations - used)
    if leftovers:
        groups.append({"relations": leftovers, "label": "其他", "hint": ", ".join(leftovers)})
    return groups if groups else [{"relations": sorted(allowed_relations), "label": "全部", "hint": ""}]


class RelationAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(
        self,
        text: str,
        entities: list[Entity],
        ontology_schema: dict[str, Any],
        retrieved_context: list[str],
        focus_relations: list[str] | None = None,
        focus_label: str = "",
    ) -> list[Triple]:
        text = _clean_text(text)
        entities = _dedupe_by_name(entities)
        allowed_relations = _schema_values(ontology_schema, "relations", DEFAULT_ONTOLOGY["relations"])
        if focus_relations:
            allowed_relations = {r for r in allowed_relations if r in focus_relations}
        if not allowed_relations:
            return []
        allowed_entities = {_clean_text(entity.name) for entity in entities if _clean_text(entity.name)}
        fallback = {"triples": []}
        entity_payload = _entity_prompt_payload(entities)
        focus_line = (
            f"只抽取{focus_label}关系：{', '.join(sorted(allowed_relations))}。逐句检查，不要遗漏任何符合这些关系的三元组。\n"
            if focus_label
            else ""
        )
        prompt = (
            "基于给定实体和文本抽取高置信知识图谱三元组。只输出一个 JSON 对象，不要解释，不要 Markdown。\n"
            "JSON 顶层键：triples。triples 是数组，每项包含 head, relation, tail, evidence, confidence, head_type, tail_type。\n"
            f"{focus_line}"
            "抽取文本中有直接证据的高置信关系；evidence 不超过 35 个汉字。\n"
            "不要输出弱相关关系；不要使用年份、电话号码、网址、密码、页码作为头实体或尾实体。\n"
            "三元组必须表达明确业务事实，例如 A 描述 B、A 需要 B、A 提交 B、A 使用 B、A 包含 B。\n"
            "关系含义：includes=包含，uses=使用，affects=影响，belongs_to=属于，causes=导致，requires=需要/依赖，related_to=相关，describes=描述，submits=提交/上传，registers=注册，reviews=审核，recommends=推荐。\n"
            "通用示例：若文本是「教师提交申请表，学生需要准考证」，实体含教师、申请表、学生、准考证，则输出教师-submits-申请表，学生-requires-准考证。\n"
            f"关系集合：{sorted(allowed_relations)}\n"
            f"实体：{entity_payload}\n"
            f"文本：{_compact_text(text, limit=900)}\n"
        )
        result = self._adapter.chat_json(
            system_prompt="你是关系抽取助手。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        output = [
            _triple_from_item(
                item,
                allowed_relations=allowed_relations,
                allowed_entities=allowed_entities,
            )
            for item in result.get("triples", [])
            if isinstance(item, dict)
        ]
        clean_output = [x for x in output if x is not None]
        return _dedupe_triples(clean_output)


class CombinedExtractionAgent:
    def __init__(self, adapter: OpenAICompatibleAdapter) -> None:
        self._adapter = adapter

    def run(
        self,
        text: str,
        ontology_schema: dict[str, Any],
        retrieved_context: list[str],
    ) -> tuple[list[Entity], list[Triple]]:
        text = _clean_text(text)
        allowed_types = _schema_values(ontology_schema, "entity_types", DEFAULT_ONTOLOGY["entity_types"])
        allowed_relations = _schema_values(ontology_schema, "relations", DEFAULT_ONTOLOGY["relations"])
        fallback = {"entities": [], "triples": []}
        prompt = (
            "你是知识图谱信息抽取器。请从给定中文文本中同时抽取实体和三元组。\n"
            "只输出一个合法 JSON 对象，不要解释，不要 Markdown。\n"
            "JSON 顶层键必须是 entities 和 triples。\n"
            "entities 是数组，每项包含 name, entity_type, aliases, evidence, confidence。\n"
            "triples 是数组，每项包含 head, relation, tail, evidence, confidence, head_type, tail_type。\n"
            "必须抽取文本中所有明确、有证据的核心事实；不要抽取年份、电话、网址、密码、页码、图号、整句说明作为实体。\n"
            "实体类型只能从这里选择："
            f"{list(allowed_types)}。\n"
            "关系只能从这里选择："
            f"{list(allowed_relations)}。\n"
            "关系含义：includes=包含，uses=使用，affects=影响，belongs_to=属于，causes=导致，requires=需要或受规则约束，related_to=相关，describes=描述，submits=提交/上传/填写，registers=注册，reviews=审核，recommends=推荐。\n"
            "每个三元组必须能在文本中找到直接证据，evidence 尽量不超过 35 个汉字。\n"
            "示例：文本【队长填写报名表并提交作品，系统审核报名表。】应抽取实体 队长、报名表、作品、系统；三元组 队长-submits-报名表，队长-submits-作品，系统-reviews-报名表。\n"
            f"上下文：{_compact_context(retrieved_context)}\n"
            f"文本：{_compact_text(text, limit=720)}\n"
        )
        result = self._adapter.chat_json(
            system_prompt="你是严格的信息抽取引擎。你的输出必须是可解析 JSON。",
            user_prompt=prompt,
            fallback=fallback,
        )
        entity_items = result.get("entities", [])
        entities = [
            _entity_from_item(item, allowed_types=allowed_types)
            for item in entity_items
            if isinstance(item, dict)
        ]
        clean_entities = _dedupe_by_name([item for item in entities if item is not None])
        allowed_entities = {_clean_text(entity.name) for entity in clean_entities if _clean_text(entity.name)}
        triple_items = result.get("triples", [])
        triples = [
            _triple_from_item(
                item,
                allowed_relations=allowed_relations,
                allowed_entities=allowed_entities or None,
            )
            for item in triple_items
            if isinstance(item, dict)
        ]
        clean_triples = _dedupe_triples([item for item in triples if item is not None])
        return clean_entities, clean_triples


class FusionAgent:
    def run(
        self,
        entities: list[Entity],
        triples: list[Triple],
        ontology_schema: dict[str, Any],
        normalizer,
    ) -> tuple[list[Entity], list[Triple], dict[str, Any]]:
        entity_map: dict[str, Entity] = {}
        for entity in entities:
            entity = _entity_from_item(entity.model_dump()) if isinstance(entity, Entity) else None
            if not entity:
                continue
            normalized = _clean_text(normalizer(entity.name))
            key = normalized.lower()
            if key not in entity_map:
                aliases = list({*_clean_aliases(entity.aliases), *([entity.name] if normalized != entity.name else [])})
                entity_map[key] = Entity(
                    name=normalized,
                    entity_type=entity.entity_type,
                    aliases=aliases,
                    evidence=_clean_text(entity.evidence),
                    confidence=entity.confidence,
                )

        unique = set()
        fused_triples: list[Triple] = []
        dropped = 0
        allowed_relations = _schema_values(ontology_schema, "relations", DEFAULT_ONTOLOGY["relations"])
        for item in triples:
            triple = _triple_from_item(item.model_dump(), allowed_relations=allowed_relations) if isinstance(item, Triple) else None
            if not triple:
                dropped += 1
                continue
            head = _clean_text(normalizer(triple.head))
            tail = _clean_text(normalizer(triple.tail))
            relation = _clean_text(triple.relation)
            if head.lower() not in entity_map:
                entity_map[head.lower()] = Entity(
                    name=head,
                    entity_type=_clean_text(triple.head_type) or "DocumentConcept",
                    evidence=_clean_text(triple.evidence),
                    confidence=triple.confidence,
                )
            if tail.lower() not in entity_map:
                entity_map[tail.lower()] = Entity(
                    name=tail,
                    entity_type=_clean_text(triple.tail_type) or "DocumentConcept",
                    evidence=_clean_text(triple.evidence),
                    confidence=triple.confidence,
                )
            key = (head.lower(), relation.lower(), tail.lower())
            if not head or not tail or not relation:
                dropped += 1
                continue
            if key in unique:
                dropped += 1
                continue
            unique.add(key)
            fused_triples.append(
                triple.model_copy(
                    update={
                        "head": head,
                        "relation": relation,
                        "tail": tail,
                        "evidence": _clean_text(triple.evidence),
                    }
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


def _clean_aliases(aliases: list[str]) -> list[str]:
    return [alias for alias in (_clean_text(x) for x in aliases) if alias]
