#!/usr/bin/env python3
import argparse
import json
import os
import shlex
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def normalize_output_path(root: Path, output: str) -> str:
    if not output:
        return ""
    try:
        out_path = Path(output)
        if out_path.is_absolute():
            try:
                return str(out_path.relative_to(root))
            except ValueError:
                marker = "/ops/v2/"
                raw = str(out_path)
                if marker in raw:
                    return f"ops/v2/{raw.split(marker, 1)[1]}"
        return output
    except Exception:
        return output


def init_state(config: dict) -> dict:
    state = {"project": config.get("project", "pipeline"), "updated_at": now_iso(), "batches": {}}
    for batch in config["batches"]:
        batch_state = {
            "status": batch.get("status", "pending"),
            "depends_on": batch.get("depends_on", []),
            "owner": batch.get("owner", ""),
            "tasks": {},
        }
        for task in batch["tasks"]:
            batch_state["tasks"][task["id"]] = {
                "status": task.get("status", "pending"),
                "attempts": 0,
                "output": "",
                "last_error": "",
            }
        state["batches"][batch["id"]] = batch_state
    return state


def sync_state_from_config(config: dict, state: dict) -> dict:
    state.setdefault("project", config.get("project", "pipeline"))
    state.setdefault("batches", {})

    for batch in config["batches"]:
        batch_id = batch["id"]
        batch_state = state["batches"].setdefault(
            batch_id,
            {
                "status": batch.get("status", "pending"),
                "depends_on": batch.get("depends_on", []),
                "owner": batch.get("owner", ""),
                "tasks": {},
            },
        )
        batch_state["depends_on"] = batch.get("depends_on", [])
        batch_state["owner"] = batch.get("owner", "")
        batch_state["status"] = batch.get("status", batch_state.get("status", "pending"))

        existing_tasks = batch_state.setdefault("tasks", {})
        for task in batch["tasks"]:
            task_state = existing_tasks.setdefault(
                task["id"],
                {
                    "status": task.get("status", "pending"),
                    "attempts": 0,
                    "output": "",
                    "last_error": "",
                },
            )
            task_state.setdefault("attempts", 0)
            task_state.setdefault("output", "")
            task_state.setdefault("last_error", "")
            task_state["status"] = task.get("status", task_state.get("status", "pending"))

    return state


def refresh_batch_status(state: dict, batch_id: str) -> None:
    statuses = [task["status"] for task in state["batches"][batch_id]["tasks"].values()]
    if statuses and all(status == "done" for status in statuses):
        state["batches"][batch_id]["status"] = "done"
    elif any(status == "failed" for status in statuses):
        state["batches"][batch_id]["status"] = "failed"
    elif any(status in ("running", "done") for status in statuses):
        state["batches"][batch_id]["status"] = "running"
    else:
        state["batches"][batch_id]["status"] = "pending"


def batch_ready(state: dict, batch_id: str) -> bool:
    return all(state["batches"][dependency]["status"] == "done" for dependency in state["batches"][batch_id]["depends_on"])


def next_batch(config: dict, state: dict):
    for batch in config["batches"]:
        batch_id = batch["id"]
        if batch.get("execution", "managed") == "manual":
            continue
        if state["batches"][batch_id]["status"] in ("done", "running"):
            continue
        if batch_ready(state, batch_id):
            return batch
    return None


def write_docs(root: Path, config: dict, state: dict) -> None:
    state["updated_at"] = now_iso()
    plan_lines = [f"# PLAN ({state['project']})", "", f"Updated: {state['updated_at']}", ""]
    todo_lines = [f"# TODO ({state['project']})", "", f"Updated: {state['updated_at']}", ""]
    status_lines = [f"# EXECUTION STATUS ({state['project']})", "", f"Updated: {state['updated_at']}", ""]

    for batch in config["batches"]:
        batch_id = batch["id"]
        batch_state = state["batches"][batch_id]
        batch_status = batch_state["status"]
        depends_on = ", ".join(batch.get("depends_on", [])) or "none"
        owner = batch.get("owner", "") or batch_state.get("owner", "")
        checks = ", ".join(batch.get("checks", [])) or "none"
        execution = batch.get("execution", "managed")

        plan_lines.append(f"## {batch_id} [{batch_status}]")
        plan_lines.append(f"- Description: {batch.get('description', '')}")
        plan_lines.append(f"- Depends on: {depends_on}")
        if owner:
            plan_lines.append(f"- Owner: {owner}")
        plan_lines.append(f"- Execution: {execution}")
        plan_lines.append(f"- Checks: {checks}")
        if batch.get("summary"):
            plan_lines.append(f"- Summary: {batch['summary']}")
        plan_lines.append("")

        todo_lines.append(f"## {batch_id}")
        for task in batch["tasks"]:
            task_id = task["id"]
            task_state = batch_state["tasks"][task_id]
            effective_status = task_state.get("status") or task.get("status", "pending")
            mark = "x" if effective_status == "done" else " "
            output_path = normalize_output_path(root, task_state["output"])
            output = f" | out: {output_path}" if output_path else ""
            error = f" | error: {task_state['last_error']}" if task_state["last_error"] else ""
            owner_text = f" | owner: {task.get('owner')}" if task.get("owner") else ""
            severity_text = f" | severity: {task.get('severity')}" if task.get("severity") else ""
            todo_lines.append(f"- [{mark}] {task_id} ({effective_status}){owner_text}{severity_text}{output}{error}")
        todo_lines.append("")

        status_lines.append(f"## {batch_id}")
        status_lines.append(f"- Status: {batch_status}")
        status_lines.append(f"- Owner: {owner or 'n/a'}")
        status_lines.append(f"- Execution: {execution}")
        status_lines.append(f"- Checks: {checks}")
        open_tasks = []
        for task in batch["tasks"]:
            task_state = batch_state["tasks"][task["id"]]
            effective_status = task_state.get("status") or task.get("status", "pending")
            if effective_status != "done":
                severity = task.get("severity", "n/a")
                owner_label = task.get("owner", owner or "n/a")
                open_tasks.append(f"  - {task['id']} [{effective_status}] ({severity}, {owner_label})")
        if open_tasks:
            status_lines.append("- Open tasks:")
            status_lines.extend(open_tasks)
        else:
            status_lines.append("- Open tasks: none")
        status_lines.append("")

    (root / "PLAN.md").write_text("\n".join(plan_lines), encoding="utf-8")
    (root / "TODO.md").write_text("\n".join(todo_lines), encoding="utf-8")
    (root / "STATUS.md").write_text("\n".join(status_lines), encoding="utf-8")

    root_status_path = config.get("root_status_path")
    if root_status_path:
        root_status = root / root_status_path
        root_status.parent.mkdir(parents=True, exist_ok=True)
        root_status.write_text("\n".join(status_lines), encoding="utf-8")


def run_cmd(command: str):
    process = subprocess.run(command, shell=True, text=True, capture_output=True, env=os.environ.copy())
    return process.returncode, process.stdout, process.stderr


def run_batch(root: Path, config: dict, state: dict, batch: dict) -> None:
    batch_id = batch["id"]
    logs_dir = root / "logs" / batch_id
    outputs_dir = root / "outputs" / batch_id
    logs_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)

    template = config["task_command_template"]
    jobs = []

    for task in batch["tasks"]:
        task_id = task["id"]
        task_state = state["batches"][batch_id]["tasks"][task_id]
        if task_state["status"] == "done":
            continue
        task_state["status"] = "running"
        task_state["attempts"] += 1
        output_file = outputs_dir / f"{task_id}.csv"
        log_file = logs_dir / f"{task_id}.log"
        command = template.format(
            batch=batch_id,
            task=task_id,
            query=shlex.quote(task["query"]),
            out=shlex.quote(str(output_file)),
        )
        jobs.append((task_id, command, output_file, log_file))

    refresh_batch_status(state, batch_id)
    workers = min(config.get("max_parallel_tasks", 4), max(1, len(jobs)))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(run_cmd, command): (task_id, command, output_file, log_file) for task_id, command, output_file, log_file in jobs}
        for future in as_completed(future_map):
            task_id, command, output_file, log_file = future_map[future]
            return_code, stdout, stderr = future.result()
            log_file.write_text(
                f"# command\n{command}\n\n# stdout\n{stdout}\n\n# stderr\n{stderr}\n",
                encoding="utf-8",
            )
            task_state = state["batches"][batch_id]["tasks"][task_id]
            if return_code == 0:
                task_state["status"] = "done"
                task_state["output"] = str(output_file)
                task_state["last_error"] = ""
            else:
                task_state["status"] = "failed"
                task_state["last_error"] = stderr.strip()[:800]

    refresh_batch_status(state, batch_id)


def show_status(config: dict, state: dict) -> None:
    print(f"Project: {state['project']}")
    print(f"Updated: {state['updated_at']}")
    for batch in config["batches"]:
        batch_id = batch["id"]
        print(f"- {batch_id}: {state['batches'][batch_id]['status']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["init", "status", "run-next", "run-all", "retry-failed"])
    parser.add_argument("--root", required=True)
    parser.add_argument("--config", default="pipeline.json")
    parser.add_argument("--state", default="state.json")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    config_path = root / args.config
    state_path = root / args.state
    config = read_json(config_path)

    if args.command == "init":
        state = init_state(config)
        write_docs(root, config, state)
        write_json(state_path, state)
        show_status(config, state)
        return 0

    state = read_json(state_path)
    state = sync_state_from_config(config, state)

    if args.command == "retry-failed":
        for batch in config["batches"]:
            batch_id = batch["id"]
            for task in batch["tasks"]:
                task_id = task["id"]
                if state["batches"][batch_id]["tasks"][task_id]["status"] == "failed":
                    state["batches"][batch_id]["tasks"][task_id]["status"] = "pending"
            refresh_batch_status(state, batch_id)

    if args.command == "status":
        write_docs(root, config, state)
        write_json(state_path, state)
        show_status(config, state)
        return 0

    if args.command == "run-next":
        batch = next_batch(config, state)
        if batch is None:
            print("No runnable batch")
        else:
            print(f"Running: {batch['id']}")
            run_batch(root, config, state, batch)
        write_docs(root, config, state)
        write_json(state_path, state)
        show_status(config, state)
        return 0

    if args.command == "run-all":
        while True:
            batch = next_batch(config, state)
            if batch is None:
                break
            print(f"Running: {batch['id']}")
            run_batch(root, config, state, batch)
            if any(state["batches"][batch_item["id"]]["status"] == "failed" for batch_item in config["batches"]):
                break
        write_docs(root, config, state)
        write_json(state_path, state)
        show_status(config, state)
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
