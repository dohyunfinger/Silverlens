"""data/sources 의 원본 파일을 앱이 import 하는 data/*.json 으로 변환합니다.

사용법:
    python scripts/prepare_knowledge_data.py

data/sources 아래 파일만 사람이 직접 편집하고, data 루트의 생성물은
이 스크립트로만 갱신합니다. 단 health_terms.json, safety_rules.json,
food_aliases.json 은 손으로 관리하는 파일이라 여기서 건드리지 않습니다.
"""

from __future__ import annotations

import ast
import csv
import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
SOURCE_DIR = DATA_DIR / "sources"

VALID_REGIONS = {"경상", "전라", "충청", "강원", "제주", "전국"}
VALID_CATEGORIES = {"식재료", "음식", "신체증상", "생활"}
MIN_DIALECT_LENGTH = 2
MAX_DISH_VARIANTS = 6


def extract_python_list(source: str, variable_name: str) -> list[dict[str, object]]:
    marker = f"{variable_name} ="
    marker_index = source.index(marker) + len(marker)
    list_start = source.index("[", marker_index)
    depth = 0
    quote: str | None = None
    escaped = False

    for index, character in enumerate(source[list_start:], start=list_start):
        if quote is not None:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue

        if character in {"'", '"'}:
            quote = character
        elif character == "[":
            depth += 1
        elif character == "]":
            depth -= 1
            if depth == 0:
                value = ast.literal_eval(source[list_start : index + 1])
                if not isinstance(value, list):
                    raise ValueError(f"{variable_name} must be a list")
                return value

    raise ValueError(f"Could not find the end of {variable_name}")


def read_csv_rows(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        meaningful = (
            line
            for line in source
            if line.strip() and not line.lstrip().startswith("#")
        )
        return [row for row in csv.reader(meaningful) if row]


def load_dialect_dictionary(path: Path) -> list[dict[str, str]]:
    """사투리 사전을 읽어 검증한다.

    한 글자 사투리와 자기 자신으로 매핑되는 항목은 프롬프트에서 오탐만
    일으키므로 이 단계에서 걸러 낸다.
    """
    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    skipped: list[str] = []

    for row in read_csv_rows(path):
        if len(row) < 2:
            continue
        dialect = row[0].strip()
        standard = row[1].strip()
        region = row[2].strip() if len(row) >= 3 else "전국"
        category = row[3].strip() if len(row) >= 4 else "생활"

        if not dialect or not standard:
            continue
        if len(dialect) < MIN_DIALECT_LENGTH:
            skipped.append(f"{dialect}(1글자)")
            continue
        if dialect == standard:
            skipped.append(f"{dialect}(자기참조)")
            continue
        if dialect in seen:
            skipped.append(f"{dialect}(중복)")
            continue
        if region not in VALID_REGIONS:
            raise ValueError(f"알 수 없는 지역 값입니다: {region} ({dialect})")
        if category not in VALID_CATEGORIES:
            raise ValueError(f"알 수 없는 분류 값입니다: {category} ({dialect})")

        seen.add(dialect)
        entries.append(
            {
                "dialect": dialect,
                "standard": standard,
                "region": region,
                "category": category,
            }
        )

    if skipped:
        print(f"  - 사투리 사전에서 제외한 항목 {len(skipped)}개: {', '.join(skipped[:8])} ...")
    return entries


def load_disease_i18n(path: Path) -> list[dict[str, str]]:
    """질병명 한국어→영어·일본어 대응표."""
    rows = read_csv_rows(path)
    if not rows:
        return []

    header = [column.strip() for column in rows[0]]
    if header[:2] != ["key", "en"]:
        raise ValueError(f"disease_i18n.csv 헤더가 예상과 다릅니다: {header}")

    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows[1:]:
        padded = [*row, "", "", ""]
        korean = padded[0].strip()
        if not korean or korean in seen:
            continue
        seen.add(korean)
        entries.append(
            {
                "ko": korean,
                "en": padded[1].strip(),
                "ja": padded[2].strip(),
                "ja_romaji": padded[3].strip(),
            }
        )
    return entries


def load_senior_frequent_conditions(path: Path) -> list[dict[str, str]]:
    """노인 다빈도 상병 목록.

    원본에는 읽기 쉽게 띄어쓴 이름을 적고, 통계 원본 표기(raw)는 그 이름에서
    공백을 지워 만든다. 예전에는 붙여 쓴 이름만 원본에 두고 '및/또는' 앞뒤에만
    공백을 넣어 name 을 만들었는데, 그러면 "류마티스 관절염"처럼 손으로 띄어쓴
    이름을 되만들 수 없어 스크립트를 다시 돌릴 때마다 띄어쓰기가 사라졌다.

    붙여 쓴 이름을 적어도 되도록 '및/또는' 앞뒤를 띄우는 처리는 그대로 둔다.
    """
    written_names: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        # 주석은 줄 단위로 먼저 걸러 낸다. 예전에는 쉼표로 자른 뒤에 확인해서
        # 쉼표가 들어간 주석의 뒷부분이 상병명으로 섞여 들어갔다.
        if not stripped or stripped.startswith("#"):
            continue
        for chunk in stripped.split(","):
            name = chunk.strip()
            if name:
                written_names.append(name)

    entries: list[dict[str, str]] = []
    seen: set[str] = set()
    for written in written_names:
        readable = re.sub(
            r"\s+", " ", written.replace("및", " 및 ").replace("또는", " 또는 ")
        ).strip()
        raw = re.sub(r"\s+", "", readable)
        if not raw or raw in seen:
            continue
        seen.add(raw)
        entries.append({"name": readable, "raw": raw})
    return entries


def load_korean_dish_names(path: Path) -> list[dict[str, object]]:
    """한식 메뉴명 목록을 대표 이름과 부재료 변형으로 묶는다.

    원본은 `주꾸미볶음_채소` 처럼 `대표명_부재료` 형태가 섞인 19,000줄이라
    그대로 쓰면 프롬프트에 넣을 수 없다. 대표명으로 묶으면 1,200여 개로 줄어
    조리명 게이트웨이 용도로 쓸 수 있다.
    """
    grouped: dict[str, set[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        menu = line.strip()
        if not menu or menu.startswith("#"):
            continue
        base, _, variant_text = menu.partition("_")
        base = base.strip()
        if not base:
            continue
        variants = grouped.setdefault(base, set())
        for variant in variant_text.split("_"):
            cleaned = variant.strip()
            if cleaned:
                variants.add(cleaned)

    entries: list[dict[str, object]] = []
    for name, variants in sorted(grouped.items(), key=lambda item: item[0]):
        # 피자처럼 부재료 조합이 4,000개가 넘는 이름도 있어 프롬프트에 그대로 넣을 수 없다.
        # 짧고 일반적인 부재료 몇 개만 예시로 남기고 나머지는 개수로만 표시한다.
        ordered = sorted(variants, key=lambda variant: (len(variant), variant))
        entries.append(
            {
                "name": name,
                "variants": ordered[:MAX_DISH_VARIANTS],
                "variant_count": len(ordered),
            }
        )
    return entries


def write_json(path: Path, value: object) -> None:
    """생성물은 어느 OS에서 돌려도 같은 바이트가 나오도록 LF 로만 저장한다."""
    with path.open("w", encoding="utf-8", newline="\n") as target:
        target.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main() -> None:
    senior_food_knowledge = extract_python_list(
        (SOURCE_DIR / "senior_food_knowledge.py").read_text(encoding="utf-8"),
        "food_data",
    )
    recipes = json.loads((SOURCE_DIR / "recipes.json").read_text(encoding="utf-8"))
    dialect_dictionary = load_dialect_dictionary(SOURCE_DIR / "dialect_dictionary.csv")
    disease_i18n = load_disease_i18n(SOURCE_DIR / "disease_i18n.csv")
    frequent_conditions = load_senior_frequent_conditions(
        SOURCE_DIR / "senior_frequent_conditions.txt"
    )
    dish_names = load_korean_dish_names(SOURCE_DIR / "korean_dish_names.txt")

    write_json(DATA_DIR / "senior_food_knowledge.json", senior_food_knowledge)
    write_json(DATA_DIR / "recipes.json", recipes)
    write_json(DATA_DIR / "dialect_dictionary.json", dialect_dictionary)
    write_json(DATA_DIR / "disease_i18n.json", disease_i18n)
    write_json(DATA_DIR / "senior_frequent_conditions.json", frequent_conditions)
    write_json(DATA_DIR / "korean_dish_names.json", dish_names)

    print("generated data/*.json")
    print(f"  senior_food_knowledge     {len(senior_food_knowledge):>6}")
    print(f"  recipes                   {len(recipes):>6}")
    print(f"  dialect_dictionary        {len(dialect_dictionary):>6}")
    print(f"  disease_i18n              {len(disease_i18n):>6}")
    print(f"  senior_frequent_conditions{len(frequent_conditions):>6}")
    print(f"  korean_dish_names         {len(dish_names):>6}")


if __name__ == "__main__":
    main()
