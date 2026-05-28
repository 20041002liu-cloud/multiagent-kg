"""Quick test: does OpenPangu on NPU produce valid JSON for extraction?"""
import json, sys
sys.path.insert(0, ".")
from app.config import settings
from app.model_adapter import OpenAICompatibleAdapter

adapter = OpenAICompatibleAdapter(settings)
print(f"Model enabled: {adapter.enabled}")
print(f"Base URL: {settings.model_base_url}")
print(f"Model: {settings.model_name}")

result = adapter.chat_json(
    system_prompt="你是严格的信息抽取引擎。你的输出必须是可解析 JSON。",
    user_prompt='''请从以下文本抽取实体和三元组。只输出 JSON。
JSON 格式：{"entities":[{"name":"实体名","entity_type":"类型"}],"triples":[{"head":"主语","relation":"关系","tail":"宾语"}]}
文本：船体装配包括放样、号料、切割、组立、焊接等工艺。''',
    fallback={"fallback": True},
)
print(json.dumps(result, ensure_ascii=False, indent=2))
