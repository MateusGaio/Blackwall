// MIT License — Copyright (c) 2026 Mateus Gaio
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

void i18n.use(initReactI18next).init({
  fallbackLng: "pt-BR",
  interpolation: { escapeValue: false },
  resources: {
    "pt-BR": {
      translation: {
        brand: {
          note: "Privado por padrão. Seu contexto continua no seu computador.",
        },
      },
    },
    en: {
      translation: {
        brand: {
          note: "Private by default. Your context stays on your computer.",
        },
      },
    },
  },
});
