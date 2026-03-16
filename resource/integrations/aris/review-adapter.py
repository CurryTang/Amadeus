#!/usr/bin/env python3
"""
ARIS Review Adapter — Standalone LLM reviewer for the auto-review-loop skill.

Calls an OpenAI-compatible API to get an external review of research work.
Used by the auto-review-loop SKILL.md instead of requiring Codex MCP.

Usage:
    python3 review-adapter.py --prompt-file /path/to/review_prompt.txt
    python3 review-adapter.py --prompt "Review this research..."
    echo "Review this..." | python3 review-adapter.py --prompt -

Environment variables:
    REVIEW_MODEL        Model to use (default: gpt-4o)
    OPENAI_API_KEY      API key for OpenAI-compatible endpoint
    OPENAI_BASE_URL     Base URL override (for DeepSeek, local models, etc.)
    REVIEW_THREAD_FILE  Path to thread state file for multi-round continuity

Output: JSON to stdout with { score, verdict, action_items, raw_response }
"""

import argparse
import json
import os
import sys
from pathlib import Path

def get_client():
    """Create OpenAI client. Supports any OpenAI-compatible endpoint."""
    try:
        from openai import OpenAI
    except ImportError:
        print(
            json.dumps({
                "error": "openai package not installed. Run: pip install openai",
                "score": 0,
                "verdict": "error",
                "action_items": [],
                "raw_response": "",
            }),
            flush=True,
        )
        sys.exit(1)

    base_url = os.environ.get("OPENAI_BASE_URL")
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print(
            json.dumps({
                "error": "OPENAI_API_KEY not set",
                "score": 0,
                "verdict": "error",
                "action_items": [],
                "raw_response": "",
            }),
            flush=True,
        )
        sys.exit(1)

    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def load_thread(thread_file):
    """Load conversation history for multi-round continuity."""
    if not thread_file or not Path(thread_file).exists():
        return []
    try:
        with open(thread_file, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def save_thread(thread_file, messages):
    """Save conversation history for next round."""
    if not thread_file:
        return
    Path(thread_file).parent.mkdir(parents=True, exist_ok=True)
    with open(thread_file, "w") as f:
        json.dump(messages, f, indent=2)


def parse_review(raw_text):
    """Extract structured review fields from raw LLM response."""
    import re

    score = 0.0
    verdict = "not ready"
    action_items = []

    # Extract score (look for patterns like "Score: 7/10", "7/10", "score of 7")
    score_patterns = [
        r'[Ss]core\s*[:=]\s*(\d+(?:\.\d+)?)\s*/\s*10',
        r'(\d+(?:\.\d+)?)\s*/\s*10',
        r'[Ss]core\s+(?:of\s+)?(\d+(?:\.\d+)?)',
    ]
    for pattern in score_patterns:
        match = re.search(pattern, raw_text)
        if match:
            score = float(match.group(1))
            break

    # Extract verdict
    verdict_positive = re.search(
        r'\b(ready for submission|accept|sufficient|ready)\b',
        raw_text,
        re.IGNORECASE,
    )
    verdict_almost = re.search(r'\b(almost|close|minor revisions)\b', raw_text, re.IGNORECASE)
    if verdict_positive:
        verdict = "ready"
    elif verdict_almost:
        verdict = "almost"
    else:
        verdict = "not ready"

    # Extract action items (numbered list items after "weakness", "fix", "action")
    lines = raw_text.split("\n")
    in_action_section = False
    for line in lines:
        stripped = line.strip()
        if re.match(r'(?i)(weakness|fix|action|recommendation|suggestion|critical|major|minor)', stripped):
            in_action_section = True
            continue
        if in_action_section and re.match(r'^[\d\-\*]+[\.\)]\s+', stripped):
            item = re.sub(r'^[\d\-\*]+[\.\)]\s+', '', stripped).strip()
            if item:
                action_items.append(item)
        elif in_action_section and stripped == "":
            # End of section on blank line (but keep going if more items follow)
            pass
        elif in_action_section and not re.match(r'^[\d\-\*\s]', stripped) and len(stripped) > 50:
            in_action_section = False

    # Fallback: if no structured items found, grab all numbered items
    if not action_items:
        for line in lines:
            stripped = line.strip()
            match = re.match(r'^[\d]+[\.\)]\s+(.+)', stripped)
            if match and len(match.group(1)) > 10:
                action_items.append(match.group(1))

    return score, verdict, action_items


def review(prompt_text, model=None, thread_file=None):
    """Send review request to LLM and return structured result."""
    model = model or os.environ.get("REVIEW_MODEL", "gpt-4o")
    client = get_client()

    # Build messages with thread history
    history = load_thread(thread_file)

    system_msg = {
        "role": "system",
        "content": (
            "You are a senior ML researcher acting as a reviewer for a top venue "
            "(NeurIPS/ICML/ICLR level). Be thorough, specific, and constructively critical.\n\n"
            "For each review, provide:\n"
            "1. Score: X/10\n"
            "2. Verdict: READY / ALMOST / NOT READY\n"
            "3. Critical weaknesses (ranked by severity)\n"
            "4. For each weakness, the MINIMUM fix needed\n"
            "5. Strengths worth preserving\n\n"
            "Be honest. If the work is genuinely good, say so. "
            "If it needs work, specify exactly what."
        ),
    }

    if not history:
        messages = [system_msg, {"role": "user", "content": prompt_text}]
    else:
        messages = history + [{"role": "user", "content": prompt_text}]

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.3,
            max_tokens=4096,
        )
        raw_response = response.choices[0].message.content or ""
    except Exception as e:
        return {
            "error": str(e),
            "score": 0,
            "verdict": "error",
            "action_items": [],
            "raw_response": "",
        }

    # Save thread for continuity
    messages.append({"role": "assistant", "content": raw_response})
    save_thread(thread_file, messages)

    score, verdict, action_items = parse_review(raw_response)

    return {
        "score": score,
        "verdict": verdict,
        "action_items": action_items,
        "raw_response": raw_response,
    }


def main():
    parser = argparse.ArgumentParser(description="ARIS Review Adapter")
    parser.add_argument("--prompt", type=str, help="Review prompt (use - for stdin)")
    parser.add_argument("--prompt-file", type=str, help="File containing review prompt")
    parser.add_argument("--model", type=str, default=None, help="Model override")
    parser.add_argument("--thread-file", type=str, default=None, help="Thread state file")
    parser.add_argument("--round", type=int, default=1, help="Current round number")
    parser.add_argument("--max-rounds", type=int, default=4, help="Max rounds (for context)")
    args = parser.parse_args()

    # Read prompt
    if args.prompt_file:
        with open(args.prompt_file, "r") as f:
            prompt_text = f.read()
    elif args.prompt == "-":
        prompt_text = sys.stdin.read()
    elif args.prompt:
        prompt_text = args.prompt
    else:
        print(json.dumps({"error": "No prompt provided"}), flush=True)
        sys.exit(1)

    # Add round context to prompt
    round_header = f"[Round {args.round}/{args.max_rounds} of autonomous review loop]\n\n"
    prompt_text = round_header + prompt_text

    thread_file = args.thread_file or os.environ.get("REVIEW_THREAD_FILE")

    result = review(prompt_text, model=args.model, thread_file=thread_file)
    result["round"] = args.round
    result["max_rounds"] = args.max_rounds

    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
