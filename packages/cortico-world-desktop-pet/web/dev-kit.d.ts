export const KIT_TOOLS: string[];
export function runTool(id: string, text: string): Promise<{ ok: boolean; out: string }>;
