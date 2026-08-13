// MIT License — Copyright (c) 2026 Mateus Gaio

type GreetingSet = {
  afternoon: string;
  evening: string;
  lateNight: string;
  morning: string;
  night: string;
};

const greetingSets: Record<string, GreetingSet> = {
  ar: {
    night: "تصبح على خير",
    morning: "صباح الخير",
    afternoon: "مساء الخير",
    evening: "مساء الخير",
    lateNight: "ليلة سعيدة",
  },
  bn: {
    night: "শুভ রাত্রি",
    morning: "সুপ্রভাত",
    afternoon: "শুভ অপরাহ্ন",
    evening: "শুভ সন্ধ্যা",
    lateNight: "শুভ রাত্রি",
  },
  da: {
    night: "Godnat",
    morning: "Godmorgen",
    afternoon: "God eftermiddag",
    evening: "Godaften",
    lateNight: "Hav en god aften",
  },
  de: {
    night: "Gute Nacht",
    morning: "Guten Morgen",
    afternoon: "Guten Tag",
    evening: "Guten Abend",
    lateNight: "Schönen Abend",
  },
  en: {
    night: "Good night",
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    lateNight: "Have a good night",
  },
  es: {
    night: "Buenas noches",
    morning: "Buenos días",
    afternoon: "Buenas tardes",
    evening: "Buenas noches",
    lateNight: "Que descanses",
  },
  fi: {
    night: "Hyvää yötä",
    morning: "Hyvää huomenta",
    afternoon: "Hyvää iltapäivää",
    evening: "Hyvää iltaa",
    lateNight: "Mukavaa iltaa",
  },
  fr: {
    night: "Bonne nuit",
    morning: "Bonjour",
    afternoon: "Bon après-midi",
    evening: "Bonsoir",
    lateNight: "Passez une bonne nuit",
  },
  he: {
    night: "לילה טוב",
    morning: "בוקר טוב",
    afternoon: "צהריים טובים",
    evening: "ערב טוב",
    lateNight: "לילה נעים",
  },
  hi: {
    night: "शुभ रात्रि",
    morning: "सुप्रभात",
    afternoon: "नमस्कार",
    evening: "शुभ संध्या",
    lateNight: "शुभ रात्रि",
  },
  id: {
    night: "Selamat malam",
    morning: "Selamat pagi",
    afternoon: "Selamat siang",
    evening: "Selamat sore",
    lateNight: "Selamat malam",
  },
  it: {
    night: "Buona notte",
    morning: "Buongiorno",
    afternoon: "Buon pomeriggio",
    evening: "Buonasera",
    lateNight: "Buona serata",
  },
  ja: {
    night: "おやすみなさい",
    morning: "おはようございます",
    afternoon: "こんにちは",
    evening: "こんばんは",
    lateNight: "良い夜を",
  },
  ko: {
    night: "안녕히 주무세요",
    morning: "좋은 아침이에요",
    afternoon: "안녕하세요",
    evening: "좋은 저녁이에요",
    lateNight: "편안한 밤 되세요",
  },
  nl: {
    night: "Goedenacht",
    morning: "Goedemorgen",
    afternoon: "Goedemiddag",
    evening: "Goedenavond",
    lateNight: "Een fijne avond",
  },
  no: {
    night: "God natt",
    morning: "God morgen",
    afternoon: "God ettermiddag",
    evening: "God kveld",
    lateNight: "Ha en fin kveld",
  },
  pl: {
    night: "Dobranoc",
    morning: "Dzień dobry",
    afternoon: "Dzień dobry",
    evening: "Dobry wieczór",
    lateNight: "Miłego wieczoru",
  },
  "pt-br": {
    night: "Boa madrugada",
    morning: "Bom dia",
    afternoon: "Boa tarde",
    evening: "Boa noite",
    lateNight: "Tenha uma boa noite",
  },
  ru: {
    night: "Доброй ночи",
    morning: "Доброе утро",
    afternoon: "Добрый день",
    evening: "Добрый вечер",
    lateNight: "Хорошего вечера",
  },
  sv: {
    night: "God natt",
    morning: "God morgon",
    afternoon: "God eftermiddag",
    evening: "God kväll",
    lateNight: "Ha en fin kväll",
  },
  th: {
    night: "ราตรีสวัสดิ์",
    morning: "สวัสดีตอนเช้า",
    afternoon: "สวัสดีตอนบ่าย",
    evening: "สวัสดีตอนเย็น",
    lateNight: "ขอให้ค่ำคืนนี้ดี",
  },
  tr: {
    night: "İyi geceler",
    morning: "Günaydın",
    afternoon: "Tünaydın",
    evening: "İyi akşamlar",
    lateNight: "İyi akşamlar",
  },
  uk: {
    night: "Добраніч",
    morning: "Доброго ранку",
    afternoon: "Добрий день",
    evening: "Добрий вечір",
    lateNight: "Гарного вечора",
  },
  vi: {
    night: "Chúc ngủ ngon",
    morning: "Chào buổi sáng",
    afternoon: "Chào buổi chiều",
    evening: "Chào buổi tối",
    lateNight: "Chúc buổi tối vui vẻ",
  },
  zh: {
    night: "晚安",
    morning: "早上好",
    afternoon: "下午好",
    evening: "晚上好",
    lateNight: "祝你今晚愉快",
  },
};

function languageKey(locale?: string): string {
  const normalized = (locale ?? "en").toLowerCase();
  if (normalized.startsWith("pt")) return "pt-br";
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  return normalized.split(/[-_]/)[0];
}

function mixedLanguageKey(date: Date): string {
  const day = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  const hour = date.getHours();
  const period = hour < 5 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : hour < 22 ? 3 : 4;
  const languages = Object.keys(greetingSets);
  return languages[Math.abs(day * 5 + period) % languages.length] ?? "en";
}

export function greetingForTime(date = new Date(), locale = "en"): string {
  const key = locale.toLowerCase() === "mixed" ? mixedLanguageKey(date) : languageKey(locale);
  const set = greetingSets[key] ?? greetingSets.en;
  const hour = date.getHours();
  if (hour < 5) return set.night;
  if (hour < 12) return set.morning;
  if (hour < 18) return set.afternoon;
  if (hour < 22) return set.evening;
  return set.lateNight;
}

export const supportedGreetingLanguages = Object.keys(greetingSets);
