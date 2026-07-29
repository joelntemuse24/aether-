export type MemoryType =
  | "preference"
  | "person"
  | "project"
  | "belief_or_practice"
  | "open_question"
  | "writing_voice"
  | "constraint"
  | "note"
  | string;

export type MemoryDTO = {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  importance: string;
  tags: string[];
  updatedAt?: string;
};
