export type TaskState =
  | "awaiting_skill_selection"
  | "awaiting_reference_selection"
  | "awaiting_final_answer"
  | "completed"
  | "cancelled"
  | "failed";
