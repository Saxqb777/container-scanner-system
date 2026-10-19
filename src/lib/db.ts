import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | null = null;

export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

export type ActiveWorkbook = {
  id: number;
  name: string;
  sheet_name: string;
  header_row: number;
  container_col: number;
  seal_col: number;
  uploaded_at: string;
};

export async function getActiveWorkbook(): Promise<ActiveWorkbook | null> {
  const rows = (await sql()`
    select id, name, sheet_name, header_row, container_col, seal_col, uploaded_at
    from workbooks where active order by id desc limit 1
  `) as ActiveWorkbook[];
  return rows[0] ?? null;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
