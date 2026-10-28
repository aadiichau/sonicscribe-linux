export interface ModelInfo {
  id: string;
  label: string;
  size: number;
  note: string;
}

export const MODELS: ModelInfo[] = [
  { id: "large-v3-turbo", label: "large-v3-turbo", size: 1_620_000_000, note: "Recommended · near large-v3 accuracy, ~6× faster" },
  { id: "large-v3", label: "large-v3", size: 3_090_000_000, note: "Best accuracy · slowest" },
  { id: "medium", label: "medium", size: 1_530_000_000, note: "Good accuracy" },
  { id: "small", label: "small", size: 484_000_000, note: "Fast · fine for clear speech" },
  { id: "base", label: "base", size: 145_000_000, note: "Very fast · drafts" },
  { id: "tiny", label: "tiny", size: 75_000_000, note: "Fastest · rough" },
];

export const modelInfo = (id: string) => MODELS.find((m) => m.id === id);

// Whisper's languages, by ISO code.
export const LANGUAGES: [string, string][] = [
  ["auto", "Auto-detect"], ["en", "English"], ["hi", "Hindi"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["zh", "Chinese"],
  ["ja", "Japanese"], ["ko", "Korean"], ["ru", "Russian"], ["pt", "Portuguese"], ["it", "Italian"], ["ar", "Arabic"], ["ur", "Urdu"],
  ["bn", "Bengali"], ["pa", "Punjabi"], ["ta", "Tamil"], ["te", "Telugu"], ["mr", "Marathi"], ["gu", "Gujarati"], ["kn", "Kannada"],
  ["ml", "Malayalam"], ["ne", "Nepali"], ["si", "Sinhala"], ["af", "Afrikaans"], ["am", "Amharic"], ["as", "Assamese"], ["az", "Azerbaijani"],
  ["ba", "Bashkir"], ["be", "Belarusian"], ["bg", "Bulgarian"], ["bo", "Tibetan"], ["br", "Breton"], ["bs", "Bosnian"], ["ca", "Catalan"],
  ["cs", "Czech"], ["cy", "Welsh"], ["da", "Danish"], ["el", "Greek"], ["et", "Estonian"], ["eu", "Basque"], ["fa", "Persian"],
  ["fi", "Finnish"], ["fo", "Faroese"], ["gl", "Galician"], ["ha", "Hausa"], ["haw", "Hawaiian"], ["he", "Hebrew"], ["hr", "Croatian"],
  ["ht", "Haitian Creole"], ["hu", "Hungarian"], ["hy", "Armenian"], ["id", "Indonesian"], ["is", "Icelandic"], ["jw", "Javanese"],
  ["ka", "Georgian"], ["kk", "Kazakh"], ["km", "Khmer"], ["la", "Latin"], ["lb", "Luxembourgish"], ["ln", "Lingala"], ["lo", "Lao"],
  ["lt", "Lithuanian"], ["lv", "Latvian"], ["mg", "Malagasy"], ["mi", "Maori"], ["mk", "Macedonian"], ["mn", "Mongolian"], ["ms", "Malay"],
  ["mt", "Maltese"], ["my", "Myanmar"], ["nl", "Dutch"], ["nn", "Norwegian Nynorsk"], ["no", "Norwegian"], ["oc", "Occitan"], ["pl", "Polish"],
  ["ps", "Pashto"], ["ro", "Romanian"], ["sa", "Sanskrit"], ["sd", "Sindhi"], ["sk", "Slovak"], ["sl", "Slovenian"], ["sn", "Shona"],
  ["so", "Somali"], ["sq", "Albanian"], ["sr", "Serbian"], ["su", "Sundanese"], ["sv", "Swedish"], ["sw", "Swahili"], ["tg", "Tajik"],
  ["th", "Thai"], ["tk", "Turkmen"], ["tl", "Tagalog"], ["tr", "Turkish"], ["tt", "Tatar"], ["uk", "Ukrainian"], ["uz", "Uzbek"],
  ["vi", "Vietnamese"], ["yi", "Yiddish"], ["yo", "Yoruba"], ["yue", "Cantonese"],
];

export const languageName = (code: string | null | undefined) => (code ? (LANGUAGES.find(([c]) => c === code)?.[1] ?? code) : "—");

export const FORMATS: { id: import("../ipc/types").ExportFormat; label: string; hint: string }[] = [
  { id: "txt", label: "Text", hint: ".txt · paragraphs" },
  { id: "timestamps", label: "Text with timestamps", hint: ".txt · [mm:ss] per line" },
  { id: "srt", label: "SubRip subtitles", hint: ".srt" },
  { id: "vtt", label: "WebVTT subtitles", hint: ".vtt" },
  { id: "json", label: "JSON segments", hint: ".json" },
];
