export type ProjectDTO = {
  id: string;
  title: string;
  instructions?: string;
  pinnedFileIds?: string[];
  updatedAt?: string;
};

/** Compact block for system prompt injection (safe for client + server). */
export function formatProjectForPrompt(
  project: ProjectDTO | null,
  knowledgeBlock?: string,
): string {
  if (!project) return "";
  return [
    `## Active project: ${project.title}`,
    project.instructions
      ? `Instructions: ${project.instructions.slice(0, 2000)}`
      : null,
    knowledgeBlock?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n");
}
