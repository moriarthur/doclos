# PART 9 — DEVELOPMENT SYSTEM

This document defines the workflow and development system for generating the Doclos project using the agent system.

Goals:

• automate backend, frontend, AI pipeline code generation
• maintain session memory and progress tracking
• provide the agent with modular instructions
• enable reproducible and structured code output

---

# PROJECT STRUCTURE

the agent will read the documentation files (Parts 1–8) and generate code based on the modular structure:

```
root/
 ├─ src/
 │   ├─ backend/
 │   ├─ frontend/
 │   ├─ workers/
 │   ├─ ai_pipeline/
 │   └─ shared/
 ├─ tests/
 ├─ scripts/
 ├─ docs/ (Parts 1–9)
 ├─ package.json
 ├─ tsconfig.json
 └─ README.md
```

the agent reads files sequentially and outputs code files into the corresponding folders.

---

# TASK ORCHESTRATION

1. **Task Queue**

- the agent receives modular tasks, e.g., generate backend API controllers for documents.
- Each task has input, expected output, and constraints.

2. **Execution Order**

- Backend core (API, DB models)
- AI pipeline workers
- Frontend pages & components
- Excel export system
- Auth & security modules
- Integration tests

3. **Chunking**

- Large files or complex features broken into multiple subtasks to avoid context overflow.

---

# PROMPT TEMPLATES

the agent receives standardized prompts for generating code:

Example:

```
Task: Generate NestJS controller for document upload.
Input: API spec from PART4_API_SPECIFICATION.md
Constraints:
- TypeScript
- Zod validation
- JWT authentication
- Async background job trigger
Output: src/backend/controllers/documents.controller.ts
```

Similar templates exist for frontend pages, AI pipeline modules, and workers.

---

# MEMORY SYSTEM

the agent will maintain a **memory file** (memory.json) to track progress:

Structure:

```
{
  "completed_tasks": ["backend_models", "document_upload_controller"],
  "pending_tasks": ["frontend_dashboard", "excel_export_worker"],
  "last_session_timestamp": "2026-03-10T15:00:00Z"
}
```

- At the end of each session, the agent updates this file.
- At start of new session, the agent reads it to resume where it left off.
- Ensures continuity and avoids duplicate work.

---

# SESSION WORKFLOW

1. Load memory file
2. Identify next pending task
3. Read relevant documentation files (Parts 1–8)
4. Generate code with inline comments and typing
5. Save code to project folder
6. Update memory file
7. Log completion

This loop continues until all tasks are complete.

---

# TEST GENERATION

- the agent generates unit and integration tests alongside code
- Test files stored in `/tests/` folder
- Coverage reports generated automatically

---

# ERROR HANDLING

- If a task fails due to missing context, the agent flags it and moves on
- Memory file records failed tasks for retry
- Optional human intervention for ambiguous modules

---

# CODING STANDARDS

- TypeScript strict mode
- ESLint + Prettier formatting
- Modular, maintainable code
- Clear inline comments referencing documentation source

---

# INTEGRATION WITH CI/CD

- the agent can be triggered via CI pipeline
- Generates code into staging branch
- Automated tests run post-generation
- Merge to main only if all tests pass

---

# FUTURE IMPROVEMENTS

- Multi-session parallel task processing
- AI-assisted code reviews and refactoring
- Prompt optimization for faster code generation
- Enhanced memory with per-module context tracking

---

END OF PART 9

With this, the full documentation set for Doclos is complete.
the agent system can now read Parts 1–9 and generate a full production-ready project including backend, frontend, AI workers, export system, security modules, and infrastructure deployment scripts.

