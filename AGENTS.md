
# Automatic Git Version Control

## Repositories
- core and assets are independent Git repositories.
- Never combine their Git histories.
- Run Git commands separately in each repository.

## Before Editing
1. Run `git status --short` in each affected repository.
2. Record existing uncommitted changes.
3. Never overwrite or include unrelated user changes.

## After Each Completed Task
1. Run relevant tests or validation.
2. Review `git diff` and `git diff --check`.
3. Stage only files modified for the current task.
4. Create a Git commit automatically if validation succeeds.
5. If both repositories changed, commit them separately.
6. Report commit hashes and test results.

## Commit Messages
Use Conventional Commits:
- feat: new feature
- fix: bug fix
- refactor: code restructuring
- assets: asset changes
- docs: documentation changes
- chore: maintenance

## Safety
- Never use `git add -A` or `git add .`.
- Never use `git reset --hard`.
- Never use `git clean -fd`.
- Never use force push.
- Never amend or rewrite existing commits.
- Never automatically push to remote repositories.
- Never commit credentials, secrets, caches or generated files.
- If validation fails, do not commit; report the problem.
- If unrelated changes cannot be separated safely, ask first.

## Automation
- The user authorizes local Git commits for successfully completed coding tasks.
- Do not ask for confirmation before each routine local commit.
- Do not commit during read-only analysis tasks.
- Commit once per logical completed task, not after every file edit.
