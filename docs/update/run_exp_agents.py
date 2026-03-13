from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
EXP_DOC = REPO_ROOT / "docs" / "exp.md"
RUN_ROOT = REPO_ROOT / "outputs" / "exp_agent_runs"
STATE_PATH = RUN_ROOT / "state.json"
PLACEHOLDERS = ("TBD", "TODO")
DEFAULT_HARD_TIMEOUT_SECS = 8 * 60 * 60
DEFAULT_IDLE_TIMEOUT_SECS = 20 * 60


@dataclass(frozen=True)
class StepSpec:
    step_id: str
    title: str
    step_type: str
    depends_on: list[str]
    todo_id: str
    allowed_doc_markers: list[str]
    outputs_expected: list[str]
    max_recovery_attempts: int = 2


@dataclass(frozen=True)
class ValidationResult:
    status: str
    reason: str
    summary: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    if not path.is_absolute():
        return path.as_posix()
    return path.relative_to(REPO_ROOT).as_posix()


def step_marker(step_id: str) -> str:
    return f"step:{step_id}"


def todo_marker(todo_id: str) -> str:
    return todo_id


def make_step(
    step_id: str,
    title: str,
    step_type: str,
    depends_on: list[str],
    todo_id: str,
) -> StepSpec:
    return StepSpec(
        step_id=step_id,
        title=title,
        step_type=step_type,
        depends_on=depends_on,
        todo_id=todo_id,
        allowed_doc_markers=[step_marker(step_id), todo_marker(todo_id)],
        outputs_expected=["docs/exp.md"],
        max_recovery_attempts=2,
    )


def build_default_steps() -> list[StepSpec]:
    return [
        make_step("s1_freeze_protocol", "Freeze the shared Step 1 protocol", "freeze_protocol", [], "todo:s1_freeze_protocol"),
        make_step("s1_a_driver_dnf", "Run S1-A transfer on driver-dnf", "run_experiment", ["s1_freeze_protocol"], "todo:s1_a_driver_dnf"),
        make_step("s1_a_driver_position", "Run S1-A transfer on driver-position", "run_experiment", ["s1_freeze_protocol"], "todo:s1_a_driver_position"),
        make_step("s1_b_driver_dnf", "Run S1-B transfer on driver-dnf", "run_experiment", ["s1_freeze_protocol"], "todo:s1_b_driver_dnf"),
        make_step("s1_b_driver_position", "Run S1-B transfer on driver-position", "run_experiment", ["s1_freeze_protocol"], "todo:s1_b_driver_position"),
        make_step("s1_c_driver_dnf", "Run S1-C transfer on driver-dnf", "run_experiment", ["s1_freeze_protocol"], "todo:s1_c_driver_dnf"),
        make_step("s1_c_driver_position", "Run S1-C transfer on driver-position", "run_experiment", ["s1_freeze_protocol"], "todo:s1_c_driver_position"),
        make_step(
            "s1_rerun_top2",
            "Rerun the top two Step 1 candidates",
            "rerun",
            [
                "s1_a_driver_dnf",
                "s1_a_driver_position",
                "s1_b_driver_dnf",
                "s1_b_driver_position",
                "s1_c_driver_dnf",
                "s1_c_driver_position",
            ],
            "todo:s1_rerun_top2",
        ),
        make_step("s1_conclusion", "Write the Step 1 conclusion", "write_conclusion", ["s1_rerun_top2"], "todo:s1_conclusion"),
        make_step("s2_a_driver_dnf", "Run S2-A transfer on driver-dnf", "run_experiment", ["s1_conclusion"], "todo:s2_a_driver_dnf"),
        make_step("s2_a_driver_position", "Run S2-A transfer on driver-position", "run_experiment", ["s1_conclusion"], "todo:s2_a_driver_position"),
        make_step("s2_b_driver_dnf", "Run S2-B transfer on driver-dnf", "run_experiment", ["s1_conclusion"], "todo:s2_b_driver_dnf"),
        make_step("s2_b_driver_position", "Run S2-B transfer on driver-position", "run_experiment", ["s1_conclusion"], "todo:s2_b_driver_position"),
        make_step("s2_c_driver_dnf", "Run S2-C transfer on driver-dnf", "run_experiment", ["s1_conclusion"], "todo:s2_c_driver_dnf"),
        make_step("s2_c_driver_position", "Run S2-C transfer on driver-position", "run_experiment", ["s1_conclusion"], "todo:s2_c_driver_position"),
        make_step("s2_d_driver_dnf", "Run S2-D transfer on driver-dnf", "run_experiment", ["s1_conclusion"], "todo:s2_d_driver_dnf"),
        make_step("s2_d_driver_position", "Run S2-D transfer on driver-position", "run_experiment", ["s1_conclusion"], "todo:s2_d_driver_position"),
        make_step("s2_e_driver_dnf", "Run S2-E transfer on driver-dnf", "run_experiment", ["s1_conclusion"], "todo:s2_e_driver_dnf"),
        make_step("s2_e_driver_position", "Run S2-E transfer on driver-position", "run_experiment", ["s1_conclusion"], "todo:s2_e_driver_position"),
        make_step(
            "s2_conclusion",
            "Write the Step 2 conclusion",
            "write_conclusion",
            [
                "s2_a_driver_dnf",
                "s2_a_driver_position",
                "s2_b_driver_dnf",
                "s2_b_driver_position",
                "s2_c_driver_dnf",
                "s2_c_driver_position",
                "s2_d_driver_dnf",
                "s2_d_driver_position",
                "s2_e_driver_dnf",
                "s2_e_driver_position",
            ],
            "todo:s2_conclusion",
        ),
        make_step(
            "s3_fp4_infer_driver_dnf",
            "Run fp4 inference on driver-dnf",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_fp4_infer_driver_dnf",
        ),
        make_step(
            "s3_fp4_infer_driver_position",
            "Run fp4 inference on driver-position",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_fp4_infer_driver_position",
        ),
        make_step(
            "s3_int8_infer_driver_dnf",
            "Run int8 inference on driver-dnf",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_int8_infer_driver_dnf",
        ),
        make_step(
            "s3_int8_infer_driver_position",
            "Run int8 inference on driver-position",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_int8_infer_driver_position",
        ),
        make_step(
            "s3_fp4_train_driver_dnf",
            "Run fp4 train-time quantization on driver-dnf",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_fp4_train_driver_dnf",
        ),
        make_step(
            "s3_fp4_train_driver_position",
            "Run fp4 train-time quantization on driver-position",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_fp4_train_driver_position",
        ),
        make_step(
            "s3_int8_train_driver_dnf",
            "Run int8 train-time quantization on driver-dnf",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_int8_train_driver_dnf",
        ),
        make_step(
            "s3_int8_train_driver_position",
            "Run int8 train-time quantization on driver-position",
            "run_experiment",
            ["s2_conclusion"],
            "todo:s3_int8_train_driver_position",
        ),
        make_step(
            "s3_conclusion",
            "Write the Step 3 conclusion",
            "write_conclusion",
            [
                "s3_fp4_infer_driver_dnf",
                "s3_fp4_infer_driver_position",
                "s3_int8_infer_driver_dnf",
                "s3_int8_infer_driver_position",
                "s3_fp4_train_driver_dnf",
                "s3_fp4_train_driver_position",
                "s3_int8_train_driver_dnf",
                "s3_int8_train_driver_position",
            ],
            "todo:s3_conclusion",
        ),
    ]


def build_prompt(
    step: StepSpec,
    exp_doc: Path,
    log_path: Path,
    recovery_reason: str | None = None,
) -> str:
    lines = [f"Read {display_path(exp_doc)} first.", ""]
    if recovery_reason:
        lines.extend(
            [
                f"Then read {display_path(log_path)}.",
                "",
                f"You are a recovery agent for step {step.step_id}: {step.title}.",
                "Diagnose why the previous agent failed, fix the issue if possible, and complete only this step.",
                f"Validator failure reason: {recovery_reason}",
            ]
        )
    else:
        lines.extend(
            [
                f"You are assigned only step {step.step_id}: {step.title}.",
                "Execute only this step.",
            ]
        )
    lines.extend(
        [
            "",
            "Requirements:",
            f"- Update only the corresponding TODO item `{step.todo_id}` and the matching marked lines for `{step.step_id}` in docs/exp.md.",
            f"- The allowed document markers are: {', '.join(step.allowed_doc_markers)}.",
            "- Do not start later steps.",
            "- If blocked, write the blocker into the relevant notes section in docs/exp.md and stop.",
            "- Keep the file structure intact.",
            "",
            "Completion condition:",
            "- The assigned section in docs/exp.md is updated with concrete results or an explicit blocker.",
            "- End your response with a structured trailer in exactly this form:",
            "STEP_RESULT",
            f"step_id: {step.step_id}",
            "outcome: succeeded|blocked|partial",
            "summary: <one line>",
            "evidence:",
            "- <artifact or document update>",
        ]
    )
    return "\n".join(lines)


def line_for_marker(doc_text: str, marker: str) -> str | None:
    needle = f"<!-- {marker} -->"
    for line in doc_text.splitlines():
        if needle in line:
            return line
    return None


def has_step_result(log_text: str, step_id: str) -> bool:
    return "STEP_RESULT" in log_text and f"step_id: {step_id}" in log_text


def contains_placeholder(text: str) -> bool:
    return any(token in text for token in PLACEHOLDERS)


def validate_step_completion(
    step: StepSpec,
    before_doc: str,
    after_doc: str,
    exit_code: int,
    log_text: str,
) -> ValidationResult:
    if exit_code != 0:
        return ValidationResult("failed_runtime", f"codex exited with code {exit_code}", "runtime failure")
    if not has_step_result(log_text, step.step_id):
        return ValidationResult("failed_no_evidence", "missing STEP_RESULT trailer", "no structured completion evidence")
    if before_doc == after_doc:
        return ValidationResult("failed_no_evidence", "docs/exp.md did not change", "no document update")

    todo_before = line_for_marker(before_doc, step.todo_id)
    todo_after = line_for_marker(after_doc, step.todo_id)
    if todo_after is None:
        return ValidationResult("failed_wrong_section", f"missing todo marker {step.todo_id}", "todo marker missing")
    if "[x]" not in todo_after:
        return ValidationResult("failed_incomplete", f"todo marker {step.todo_id} was not checked", "todo not completed")
    if todo_before == todo_after:
        return ValidationResult("failed_incomplete", f"todo marker {step.todo_id} did not change", "todo line unchanged")

    primary_marker = step_marker(step.step_id)
    target_before = line_for_marker(before_doc, primary_marker)
    target_after = line_for_marker(after_doc, primary_marker)
    if target_after is None:
        return ValidationResult("failed_wrong_section", f"missing step marker {primary_marker}", "step marker missing")
    if target_before == target_after:
        return ValidationResult("failed_incomplete", f"step marker {primary_marker} did not change", "target line unchanged")
    if contains_placeholder(target_after):
        return ValidationResult("failed_incomplete", f"placeholder remains in step marker {primary_marker}", "placeholder still present")

    if step.step_type == "write_conclusion":
        conclusion_lines = [
            line for line in after_doc.splitlines() if f"<!-- {primary_marker} -->" in line
        ]
        if not conclusion_lines or any(contains_placeholder(line) for line in conclusion_lines):
            return ValidationResult("failed_incomplete", f"conclusion marker {primary_marker} still has placeholders", "conclusion incomplete")

    return ValidationResult("succeeded", "step completed and validated", "validated document and trailer")


def load_state(steps: list[StepSpec]) -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {
        "steps": {
            step.step_id: {
                "status": "pending",
                "attempt": 0,
                "started_at": None,
                "finished_at": None,
                "exit_code": None,
                "log_file": None,
                "validator_reason": None,
                "summary": None,
            }
            for step in steps
        }
    }


def save_state(state: dict[str, Any]) -> None:
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def next_runnable_step(steps: list[StepSpec], state: dict[str, Any], only_step: str | None) -> StepSpec | None:
    if only_step:
        chosen = next((step for step in steps if step.step_id == only_step), None)
        if chosen is None:
            raise SystemExit(f"Unknown step: {only_step}")
        return chosen

    for step in steps:
        info = state["steps"][step.step_id]
        if info["status"] in {"succeeded", "blocked", "failed_final"}:
            continue
        if info["status"] == "failed_needs_recovery":
            return step
        if info["status"] != "pending":
            continue
        if all(state["steps"][dep]["status"] == "succeeded" for dep in step.depends_on):
            return step
    return None


def run_codex_step(
    step: StepSpec,
    prompt: str,
    log_path: Path,
    hard_timeout_secs: int,
    idle_timeout_secs: int,
) -> tuple[int, str]:
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    command = ["codex", "exec", "--yolo", prompt]
    start = time.time()
    last_output = start
    output_chunks: list[str] = []

    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"$ {' '.join(command[:3])} <prompt omitted>\n")
        log_file.flush()
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        while True:
            line = process.stdout.readline()
            if line:
                output_chunks.append(line)
                log_file.write(line)
                log_file.flush()
                last_output = time.time()
            elif process.poll() is not None:
                break
            else:
                now = time.time()
                if now - start > hard_timeout_secs:
                    process.kill()
                    output_chunks.append("\nRUNNER_TIMEOUT: hard timeout reached\n")
                    return 124, "".join(output_chunks)
                if now - last_output > idle_timeout_secs:
                    process.kill()
                    output_chunks.append("\nRUNNER_TIMEOUT: idle timeout reached\n")
                    return 125, "".join(output_chunks)
                time.sleep(1)
        exit_code = process.wait()

    return exit_code, "".join(output_chunks)


def summarize_status(result: ValidationResult, recovery_reason: str | None) -> str:
    if recovery_reason:
        return f"recovery {result.status}: {result.summary}"
    return f"{result.status}: {result.summary}"


def execute_step(
    step: StepSpec,
    state: dict[str, Any],
    dry_run: bool,
    hard_timeout_secs: int,
    idle_timeout_secs: int,
) -> ValidationResult:
    info = state["steps"][step.step_id]
    recovery_reason = info["validator_reason"] if info["status"] == "failed_needs_recovery" else None
    original_info = dict(info)
    info["attempt"] += 1
    info["started_at"] = utc_now_iso()
    info["finished_at"] = None
    info["status"] = "running"
    log_path = RUN_ROOT / f"{step.step_id}.log"
    info["log_file"] = str(log_path.relative_to(REPO_ROOT))
    save_state(state)

    prompt = build_prompt(step=step, exp_doc=EXP_DOC, log_path=log_path, recovery_reason=recovery_reason)
    before_doc = EXP_DOC.read_text()

    if dry_run:
        print(f"[dry-run] {step.step_id}: {step.title}")
        print(prompt)
        for key, value in original_info.items():
            info[key] = value
        save_state(state)
        return ValidationResult("succeeded", "dry-run skipped execution", "dry-run only")

    exit_code, log_text = run_codex_step(
        step=step,
        prompt=prompt,
        log_path=log_path,
        hard_timeout_secs=hard_timeout_secs,
        idle_timeout_secs=idle_timeout_secs,
    )
    after_doc = EXP_DOC.read_text()
    result = validate_step_completion(step=step, before_doc=before_doc, after_doc=after_doc, exit_code=exit_code, log_text=log_text)
    info["exit_code"] = exit_code
    info["finished_at"] = utc_now_iso()
    info["summary"] = summarize_status(result, recovery_reason)
    info["validator_reason"] = result.reason

    if result.status == "succeeded":
        info["status"] = "succeeded"
    elif info["attempt"] <= step.max_recovery_attempts:
        info["status"] = "failed_needs_recovery"
    elif result.status in {"failed_runtime", "failed_timeout"}:
        info["status"] = "failed_final"
    else:
        info["status"] = "blocked"

    save_state(state)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run experiment steps through headless Codex agents.")
    parser.add_argument("--resume", action="store_true", help="Reuse existing state.json if present.")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without invoking Codex.")
    parser.add_argument("--step", help="Run only one specific step id.")
    parser.add_argument("--hard-timeout-secs", type=int, default=DEFAULT_HARD_TIMEOUT_SECS)
    parser.add_argument("--idle-timeout-secs", type=int, default=DEFAULT_IDLE_TIMEOUT_SECS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    steps = build_default_steps()
    if not args.resume and STATE_PATH.exists() and not args.step:
        STATE_PATH.unlink()
    state = load_state(steps)
    save_state(state)

    while True:
        step = next_runnable_step(steps, state, args.step)
        if step is None:
            print("No runnable steps remain.")
            return 0
        result = execute_step(
            step=step,
            state=state,
            dry_run=args.dry_run,
            hard_timeout_secs=args.hard_timeout_secs,
            idle_timeout_secs=args.idle_timeout_secs,
        )
        print(f"{step.step_id}: {result.status} - {result.reason}")
        current_status = state["steps"][step.step_id]["status"]
        if args.step:
            return 0 if current_status == "succeeded" else 1
        if current_status in {"blocked", "failed_final"}:
            return 1
        if args.dry_run:
            return 0


if __name__ == "__main__":
    sys.exit(main())
