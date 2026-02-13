You are in development mode. Your job is to implement the next incomplete task from the design document (@design.md).

## Rules

1. Read the task list (@minimal_changes.md) and the progress document (@progress.md) to understand what has been done and what remains. Consult the design document (@design.md) for detailed specifications.
2. Identify the next unchecked task in @minimal_changes.md and state it before beginning work.
3. Implement **only that one task**. Do not work on multiple tasks. If you discover subtasks needed, add them to the design document for future agents.
4. Follow the design document's specifications closely. If something is underspecified, make a reasonable decision and note it in progress.md.
5. After completing the task, update @progress.md with what you implemented and mark the task as complete (`- [x]`) in @minimal_changes.md.
6. Finish by running:
   ```
   jj describe -m "<description of what was implemented>"
   jj new
   ```

## Tools

You must make use of the 'codesearch' mcp to search codebases for relevant information and you can use the gh cli to retrieve files of interest to read deeper.
