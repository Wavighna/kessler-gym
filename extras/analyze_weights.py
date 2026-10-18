"""Inspect the existing Kessler policy without changing or retraining it.

Standalone Python utility. It is not called by the website or build script.
Only the standard library is required; pass --output to save an optional report.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Any

ARCHITECTURE = (28, 32, 32, 3)


def expected_parameters(layers: tuple[int, ...]) -> int:
    """Count a dense network's weights and biases."""
    return sum(inputs * outputs + outputs for inputs, outputs in zip(layers, layers[1:]))


def summarize(values: list[float]) -> dict[str, float | int]:
    """Calculate descriptive statistics without altering the source values."""
    if not values:
        raise ValueError("A parameter vector cannot be empty")
    return {
        "count": len(values),
        "minimum": min(values),
        "maximum": max(values),
        "mean": statistics.fmean(values),
        "population_stddev": statistics.pstdev(values),
        "l2_norm": math.hypot(*values),
        "zeros": sum(value == 0 for value in values),
    }


def inspect_policy(weights_path: Path) -> dict[str, Any]:
    payload = json.loads(weights_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("theta"), list):
        raise ValueError("Expected a JSON object containing a theta array")
    raw = payload["theta"]
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in raw):
        raise ValueError("Every parameter must be numeric")
    parameters = [float(value) for value in raw]
    if not all(math.isfinite(value) for value in parameters):
        raise ValueError("Policy contains a non-finite parameter")
    expected = expected_parameters(ARCHITECTURE)
    if len(parameters) != expected:
        raise ValueError(f"Expected {expected} parameters, received {len(parameters)}")

    offset = 0
    layers = []
    for index, (inputs, outputs) in enumerate(zip(ARCHITECTURE, ARCHITECTURE[1:]), start=1):
        end = offset + inputs * outputs + outputs
        layers.append({
            "layer": index,
            "inputs": inputs,
            "outputs": outputs,
            "parameters": summarize(parameters[offset:end]),
        })
        offset = end
    return {
        "source": str(weights_path),
        "architecture": list(ARCHITECTURE),
        "expected_parameter_count": expected,
        "parameters": summarize(parameters),
        "layers": layers,
        "note": "Parameter inspection only; this report does not measure policy performance.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, default=Path(__file__).resolve().parents[1] / "weights.json")
    parser.add_argument("--output", type=Path, help="Optional report path; input files remain unchanged")
    args = parser.parse_args()
    try:
        report = inspect_policy(args.weights)
    except (OSError, ValueError, OverflowError) as error:
        parser.exit(2, f"Cannot inspect policy: {error}\n")
    rendered = json.dumps(report, indent=2, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
