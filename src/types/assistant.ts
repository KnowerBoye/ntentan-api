
export interface Prescription {
  id: string;                           // Firestore doc ID
  userId: string;
  name: string;                         // drug name e.g. "Paracetamol"
  dosage: string;                       // e.g. "500mg"
  quantity: number;                     // e.g. 2 (tablets per dose)
  time: "morning" | "afternoon" | "evening";
  /**
   * date: ISO string (YYYY-MM-DD) for a one-off specific date,
   *       OR null for recurring prescriptions
   */
  date: string | null;
  /**
   * occurrence:
   *   "daily"    – taken every day (date must be null)
   *   "specified" – taken only on the specific `date`
   */
  occurrence: "daily" | "specified";
  special?: string;                     // special instructions
}

// ── Time-of-day windows ──────────────────────
export const TIME_WINDOWS = {
  morning:   { label: "Morning",   start: "06:00", end: "12:00" },
  afternoon: { label: "Afternoon", start: "12:00", end: "17:00" },
  evening:   { label: "Evening",   start: "17:00", end: "22:00" },
} as const;

// ── Query intent Gemini resolves ─────────────
export type QueryIntent =
  | "today"        // what do I take today?
  | "on_date"      // what did/do I take on a specific date?
  | "next"         // when is my next dose of X?
  | "last"         // when was my last dose of X?
  | "check"        // did I take X on date Y?
  | "all_active";  // list all active prescriptions

export interface QueryPrescriptionsInput {
  userId: string;
  intent: QueryIntent;
  /**
   * Resolved target date in YYYY-MM-DD format.
   * Gemini resolves relative terms ("today", "yesterday", "tomorrow")
   * to an absolute date using the currentDate injected in the system prompt.
   */
  targetDate?: string;
  /** Drug name filter – used for next/last/check/on_date queries */
  drugName?: string;
}


export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PrescriptionQueryResult {
  intent: QueryIntent;
  targetDate?: string;
  prescriptions: Prescription[];

  contextNote: string;
}


export interface DrugInfo {
  name: string;
  genericName?: string;
  brandNames?: string[];
  drugClass?: string;
  description?: string;
  commonUses?: string[];
  commonSideEffects?: string[];
  warnings?: string[];
  interactions?: string[];
  source: "llm" | "openfda" | "llm+openfda";
  needsLLMSupplement: boolean;
}

export interface SearchDrugInfoInput {
  drugName: string;
  query?: string;
}






export type ContentType = "text" | "audio"

export type SupportedLanguage = "english" | "twi";

export interface UserMessage { 
  content : string ;
  type : ContentType , 
  language : SupportedLanguage
}

export interface AssistantResponse {
  message: string;
  toolsUsed: string[];
  sources?: string[];
}


export interface ChatMessage {
  content : string  , 
  type : ContentType , 
  role : "user" | "assistant" , 
  language : SupportedLanguage
}


export interface VoiceRequest {
  userId: string;
  language: SupportedLanguage;
  /** Raw .wav file as a Buffer */
  audio: Buffer;
  /** Optional: session ID for conversation continuity */
  sessionId?: string;
}

export interface VoiceResponse {
  /** .wav audio Buffer to send back to the client */
  audio: Buffer;
  /** The English text the assistant produced (useful for logging/debugging) */
  englishText: string;
  /** The final text that was spoken (English or Twi depending on language) */
  spokenText: string;
  language: SupportedLanguage;
  toolsUsed: string[];
}



/** STT: transcribe English .wav → English text */
export type EnglishSTTFn = (audio: Buffer) => Promise<string>;

/** STT: transcribe Twi .wav → Twi text */
export type TwiSTTFn = (audio: Buffer) => Promise<string>;

/** Translate Twi text → English text */
export type TwiToEnglishFn = (twi: string) => Promise<string>;

/** Translate English text → Twi text */
export type EnglishToTwiFn = (english: string) => Promise<string>;

/** TTS: English text → .wav Buffer */
export type EnglishTTSFn = (text: string) => Promise<Buffer>;

/** TTS: Twi text → .wav Buffer */
export type TwiTTSFn = (text: string) => Promise<Buffer>;