from __future__ import annotations

import ast
import csv
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"


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


def load_dialect_dictionary(path: Path) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()

    with path.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.reader(
            line for line in source if line.strip() and not line.lstrip().startswith("#")
        ):
            if len(row) < 2:
                continue
            dialect = row[0].strip()
            standard = row[1].strip()
            region = row[2].strip() if len(row) >= 3 else "미상"
            key = (dialect, standard, region)
            if not dialect or not standard or key in seen:
                continue
            seen.add(key)
            entries.append(
                {"dialect": dialect, "standard": standard, "region": region}
            )

    return entries


def write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    knowledge_source = (DATA_DIR / "senior_food_knowledge_source.txt").read_text(encoding="utf-8")
    senior_food_knowledge = extract_python_list(knowledge_source, "food_data")
    food_ingredients = json.loads(
        (DATA_DIR / "food_ingredient_source.txt").read_text(encoding="utf-8")
    )
    dialect_dictionary = load_dialect_dictionary(DATA_DIR / "dialect_dictionary_source.csv")

    write_json(DATA_DIR / "senior_food_knowledge.json", senior_food_knowledge)
    write_json(DATA_DIR / "food_ingredient.json", food_ingredients)
    write_json(DATA_DIR / "dialect_dictionary.json", dialect_dictionary)

    print(
        "prepared",
        len(senior_food_knowledge),
        "senior foods,",
        len(food_ingredients),
        "recipes,",
        len(dialect_dictionary),
        "dialect entries",
    )


if __name__ == "__main__":
    main()
