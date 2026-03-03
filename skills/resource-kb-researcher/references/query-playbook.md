# Resource Query Playbook

## 1) Paper Presence Check

Input:
- "Do we have RFMBench/RelBench materials?"

Steps:
1. Search `resource/` paths for paper name tokens.
2. Confirm whether folder exists.
3. Report key files found (`paper.pdf`, `README.md`, `arxiv_source/meta.json`).

Output:
- `status`: found | partial | missing
- `evidence`: list of concrete paths
- `gaps`: what is missing for deep QA

## 2) Proposal Refinement Support

Input:
- "Refine proposal using available papers/code only."

Steps:
1. Read `paper_assets_index.md` and `notes.md`.
2. Build table:
- claim
- supporting file path(s)
- confidence (high/medium/low)
3. Flag unsupported claims for removal.

Output:
- `validated_paths`
- `unsupported_paths`
- `recommended_rewrite`

## 3) Code Link Verification

Input:
- "Which paper folders include code links/repos?"

Steps:
1. Parse `paper_assets_index.json`.
2. Extract `code_links` and `cloned_repos`.
3. Verify corresponding local repo folders exist.

Output:
- `paper_title`
- `code_links`
- `repo_local_status`

## 4) Answer Format

Always return:
1. `Answer`
2. `Evidence Paths`
3. `Unknowns / Missing Evidence`
