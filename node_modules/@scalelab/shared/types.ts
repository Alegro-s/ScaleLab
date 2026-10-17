export type Pt = [number, number];
export type UiMode = 'glass' | 'classic';
export type Theme = 'dark' | 'light';
export type Step = 'upload' | 'calibration' | 'measurement' | 'comparison' | 'report';
export const STEPS: Step[] = ['upload', 'calibration', 'measurement', 'comparison', 'report'];
export const STEP_RU: Record<Step, string> = {
  upload: 'Загрузка', calibration: 'Калибровка', measurement: 'Измерение', comparison: 'Сравнение', report: 'Отчёт',
};
export type SessionStatus = 'draft' | 'in_progress' | 'review' | 'ready';
export const STATUS_RU: Record<SessionStatus, string> = {
  draft: 'Черновик', in_progress: 'В работе', review: 'Нужна проверка', ready: 'Готов отчёт',
};
export type MeasureKind = 'polygon' | 'line' | 'angle' | 'circle' | 'mask';

export interface User { id: string; email: string; full_name: string; role: 'operator' | 'admin'; is_demo: boolean }
export interface Prefs {
  ui_mode: UiMode; theme: Theme; language: string; units: string; decimals: number;
  autosave: boolean; hints: boolean; sounds: boolean; extra: Record<string, unknown>;
}
export interface Calibration {
  sample_id: string; reference_type: string; side_mm: number; corners: Pt[]; px_per_mm: number;
  confidence: number; method: 'auto' | 'manual'; rel_error?: number; reference_id?: string | null;
}
export interface Measurement {
  id: string; sample_id: string; label: string; kind: MeasureKind; vertices: Pt[]; value: number; unit: string;
  perimeter_mm: number | null; area_px: number | null; error: number; px_per_mm: number | null; in_table: boolean; created_at: string;
}
export interface Sample {
  id: string; session_id: string; image_id: string; slot: number; name: string; species: string; tags: string[];
  width: number; height: number; filename: string; calibration: Calibration | null;
  measurements?: Measurement[]; session_title?: string; session_number?: number;
  area_mm2?: number | null; created_at: string;
}
export interface Session {
  id: string; number: number; title: string; status: SessionStatus; step: Step; created_at: string; updated_at: string;
  samples?: Sample[]; sample_count?: number; version_count?: number;
}
export interface ReferenceStandard {
  id: string; owner_id: string | null; name: string; kind: 'checker' | 'ruler' | 'coin' | 'custom';
  width_mm: number; height_mm: number; tolerance_mm: number; note: string;
}
export interface ReportSections {
  title: boolean; images: boolean; calibration: boolean; table: boolean; formulas: boolean;
  conclusions: boolean; checksum: boolean; signature: boolean;
}
export const DEFAULT_SECTIONS: ReportSections = {
  title: true, images: true, calibration: true, table: true, formulas: true, conclusions: true, checksum: true, signature: false,
};
export interface ReportOptions {
  title?: string; template?: string; language?: string; format?: string; operator?: string;
  sections?: Partial<ReportSections>; summary?: string; notes?: string;
}
export interface CompareResult {
  scales_match: boolean; scale_ratio: number; verdict: string;
  area_mm2: { a: number; b: number; delta: number; delta_pct: number | null } | null;
  perimeter_mm: { a: number; b: number; delta: number; delta_pct: number | null } | null;
  a?: { name: string; px_per_mm: number }; b?: { name: string; px_per_mm: number };
}
export interface ReportVersion {
  id: string; session_id: string; number: number; sha256: string; summary: string; created_at: string; author?: string;
}
export interface Region { vertices: Pt[]; area_px: number; area_mm2: number }
export interface SegmentResult {
  low: number; high: number; channel: string; regions: Region[]; coverage: number; total_area_mm2: number; histogram: number[]; erase_applied?: number;
}
export interface JournalEvent { _id?: string; session_id: string; kind: string; text: string; ts: string; user?: string; meta?: Record<string, unknown> }
export interface Stats { sessions_week: number; samples_total: number; avg_error_mm2: number | null; versions_total: number }
