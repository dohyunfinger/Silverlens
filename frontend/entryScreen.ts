/** A remembered home visit does not mean the information wizard was completed. */
export function getEntryScreen(introSeen: boolean, profileCompleted: boolean): "about" | "setup" | "chat" {
  if (!introSeen) return "about";
  return profileCompleted ? "chat" : "setup";
}
