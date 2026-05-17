// =========================================================
// 自動產生位置（Supabase CLI）
//
//   npx supabase login
//   npx supabase link --project-ref <project-ref>
//   npx supabase gen types typescript --linked > apps/web/src/types/db.ts
//
// 第一次連 Supabase 之前，先用下面 stub 讓 TypeScript 編譯通過。
// 真正開始接資料表查詢時，請把這份檔案換成 supabase 產生的 Database 型別。
// =========================================================

export type Database = Record<string, unknown>;
export type Tables<_T extends string> = Record<string, unknown>;
